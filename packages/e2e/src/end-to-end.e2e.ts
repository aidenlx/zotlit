// The End-to-end Run suite — drives the plugin in a real desktop Obsidian
// window against the Fixture, over the official Obsidian CLI. See
// packages/e2e/AGENTS.md and packages/scripts/CONTEXT.md for vocabulary.
//
// Skips cleanly (not fails) when no desktop Obsidian is reachable: the
// `describe.skipIf` below runs before test collection, so `vitest run` exits
// 0 with every test reported as skipped rather than erroring.

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import {
  COLLECTIONS,
  findScopeCase,
  ITEMS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import type { LibrarySelector } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  waitFor,
} from "./obsidian-cli.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const vaultScriptPath = join(
  workspaceRoot,
  "packages",
  "scripts",
  "scripts",
  "obsidian-vault.ts",
);
// Distinct from the per-worktree dev vault (`getDevVaultDir`) and the raw
// Fixture Vault (`getFixtureLayout(...).vaultDir`) — see
// policies/scratch-artifacts.md.
const e2eVaultPath = join(workspaceRoot, "tmp", "e2e-fixture-vault");
const execFileAsync = promisify(execFile);

function runVaultScript(args: string[]) {
  return execFileAsync(process.execPath, [vaultScriptPath, ...args], {
    windowsHide: true,
  });
}

// The one My Library Fixture Item this suite renders and asserts against —
// itemID is unique across every Library, so it names the item without
// needing to filter on libraryID too (key "AAAAAAAA" repeats in library 2).
const targetItem = ITEMS.find((item) => item.itemID === 1)!;
const createTargetItem = ITEMS.find((item) => item.itemID === 2)!;
const defaultProfileTargetItem = ITEMS.find((item) => item.itemID === 6)!;
const booksProfileTargetItem = ITEMS.find((item) => item.itemID === 7)!;
const booksProfile = LITERATURE_NOTE_PROFILES[0]!;

async function isObsidianReachable(): Promise<boolean> {
  const result = await runVaultScript(["status"]).catch(() => undefined);
  return result?.stdout.trim().startsWith("ready ") ?? false;
}

async function availableLoopbackPort(): Promise<number> {
  await using server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address === "string" || address === null)
    throw new Error("Loopback server did not receive a TCP port");
  return address.port;
}

const reachable = await isObsidianReachable();

async function openProfilesSettings(vaultId: string, pageName: string) {
  await obEval(
    vaultId,
    "app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();true",
  );
  await obEval(vaultId, "app.setting.openTabById('zotlit');true");
  await obEval(
    vaultId,
    `app.setting.navigateToSearchResult({tab:app.setting.activeTab,pagePath:[${JSON.stringify(pageName)}]});true`,
  );
}

describe.skipIf(!reachable)("End-to-end Run", () => {
  let vaultId = "";
  let booksNotePath = "";
  let m: typeof import("@obsidian-messages");
  const articlesProfile = {
    id: "Ar7Kd2QpX9Mn",
    label: "Articles",
    document: "zotlit-profile.articles.md",
  };
  const bookMatch = { and: ['itemType == "book"', 'library == "personal"'] };

  /** This ticket edits the document by hand; the match editor arrives in #988. */
  async function writeMatch(
    profile: { id: string; document: string },
    match: unknown,
  ) {
    const path = join(e2eVaultPath, "templates", profile.document);
    const source = await readFile(path, "utf-8");
    const headerEnd = source.indexOf("\n---\n", 4);
    const header = source
      .slice(0, headerEnd)
      .split("\n")
      .filter((line) => !line.startsWith("match:"))
      .join("\n");
    await writeFile(
      path,
      `${header}\nmatch: ${JSON.stringify(match)}${source.slice(headerEnd)}`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(JSON.stringify(app.plugins.plugins.zotlit.services.profile.profiles.find(p=>p.id===${JSON.stringify(profile.id)})?.match.tree)===${JSON.stringify(JSON.stringify(match))})`,
        { expected: "true" },
      ),
    ).toBe(true);
  }

  async function quickSwitchCreate(item: { title: string }) {
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:note-quick-switcher')",
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        "String(!!document.querySelector('.prompt input'))",
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var input=document.querySelector('.prompt input');input.value=${JSON.stringify(item.title)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    await selectSuggestion(vaultId, item.title);
    await obEval(
      vaultId,
      "document.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
  }

  beforeAll(async () => {
    // The dev build generates this facade; unreachable runs never load it.
    m = await import("@obsidian-messages");
    // `create` reuses whatever plugin bundle already sits in the target
    // vault's own plugin folder (the same way it reuses the per-worktree dev
    // vault's bundle, which `build:dev`'s Vite plugin copies there directly).
    // A fresh e2e vault has no such folder yet, so seed it from
    // `apps/obsidian/dist-dev` ourselves before `create` looks for it.
    const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
    const e2ePluginDir = join(e2eVaultPath, ".obsidian", "plugins", "zotlit");
    await mkdir(e2ePluginDir, { recursive: true });
    await cp(pluginBundleDir, e2ePluginDir, { recursive: true });

    // Rebuilds the Fixture (default Scope Case "all"), copies the Fixture
    // Vault to e2eVaultPath, registers + opens it, links its Device Overrides
    // to the Fixture profile and database, and confirms the plugin loaded.
    const created = await runVaultScript(["create", e2eVaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    const serverPort = await availableLoopbackPort();
    await obEval(
      vaultId,
      `app.plugins.plugins.zotlit.services.settings.update({'server.enabled':false,'server.port':${serverPort}});true`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.liveUpdate.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.update({'server.enabled':true});true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.plugins.plugins.zotlit.services.liveUpdate.available&&app.plugins.plugins.zotlit.services.settings.current['server.port']===${serverPort})`,
        { expected: "true" },
      ),
    ).toBe(true);
  }, 180000);

  afterAll(async () => {
    // Never let teardown itself throw and mask a test failure, but log a
    // warning on a nonzero exit rather than silently swallowing it.
    try {
      await runVaultScript(["remove", e2eVaultPath, "--purge"]);
    } catch (error) {
      console.warn(
        `obsidian-vault remove --purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 120000);

  it("keeps one Literature Note when create runs twice for one Item", async () => {
    const noteName =
      createTargetItem.literatureNoteName ?? createTargetItem.key;
    const profile = LITERATURE_NOTE_PROFILES.find(
      ({ id }) => id === createTargetItem.literatureNoteProfile,
    );
    const folder = profile?.bindings["note.literature-folder"] ?? "literatures";
    const notePath = `${folder}/${noteName}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);

    const removedFromIndex = await obEvalUntil(
      vaultId,
      `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(createTargetItem.key)}).length)`,
      { expected: "0" },
    );
    expect(removedFromIndex).toBe(true);

    const first = await createFixtureNote(vaultId, createTargetItem.itemID);
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") {
      throw new Error("The first create did not create a Literature Note");
    }

    const indexed = await obEvalUntil(
      vaultId,
      `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(createTargetItem.key)}).length)`,
      { expected: "1" },
    );
    expect(indexed).toBe(true);

    const second = await createFixtureNote(vaultId, createTargetItem.itemID);
    expect(second).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-exists",
        hint: "Open the existing Literature Note instead of creating another.",
        indexedKey: createTargetItem.key,
        paths: [first.path],
      },
    });

    const oneNote = await hasOneIndexedNote(vaultId, createTargetItem.key);
    expect(oneNote).toBe(true);
  });

  it("creates through the citekey command with an explicitly chosen Profile", async () => {
    const defaultResult = await createFixtureNote(
      vaultId,
      defaultProfileTargetItem.itemID,
      "default",
    );
    expect(defaultResult.outcome).toBe("created");
    if (defaultResult.outcome !== "created") {
      throw new Error("The Default scenario did not create a Literature Note");
    }
    booksNotePath = `books/books-${booksProfileTargetItem.citationKey}.md`;
    await obEval(
      vaultId,
      `(async function(){var plugin=app.plugins.plugins.zotlit;plugin.services.settings.update({'citation.pandoc-citations':true,'citation.open-as-links':true});var file=await app.vault.create('Profile flow source.md',${JSON.stringify(`[@${booksProfileTargetItem.citationKey}]\n`)});var leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.setCursor({line:0,ch:5});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:open-citekey')",
        { expected: "true" },
      ),
    ).toBe(true);
    // Without an explicit input the picker preselects Default; the Books
    // choice below belongs to this operation alone.
    const preselected = await selectSuggestion(
      vaultId,
      m.modal_profile_preselected(),
    );
    expect(preselected).toContain(m.settings_profile_default_name());
    expect(preselected).toContain(m.modal_profile_preselected());
    expect(preselected).not.toContain(booksProfile.label);
    await obEval(
      vaultId,
      `(function(){var input=document.querySelector('.prompt input');input.value=${JSON.stringify(booksProfile.label)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    const selected = await selectSuggestion(vaultId, booksNotePath);
    expect(selected).toContain(booksProfile.label);
    expect(selected).not.toContain(m.modal_profile_preselected());
    expect(selected).toContain(booksNotePath);
    await obEval(
      vaultId,
      "document.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, booksNotePath), "utf-8").catch(
            () => "",
          )
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(defaultResult.path.startsWith("literatures/")).toBe(true);

    const defaultContent = await readFile(
      join(e2eVaultPath, defaultResult.path),
      "utf-8",
    );
    const booksContent = await readFile(
      join(e2eVaultPath, booksNotePath),
      "utf-8",
    );
    expect(defaultContent).not.toContain("zotlit-profile:");
    expect(booksContent).toContain("zotlit-profile: Books (V1StGXR8Z5jd)");
    expect(booksContent).toContain(
      `zotlit-csl: ${booksProfile.bindings["citation.references-style"]}`,
    );
    expect(defaultContent).toContain("# ");
    expect(defaultContent).not.toContain("# Book profile:");
    expect(booksContent).toContain("# Book profile:");
    expect(booksContent).toContain("## Book details");
    expect(booksContent).toContain(
      `fixture-spread-title: ${booksProfileTargetItem.title}`,
    );
    expect(booksContent).toContain("fixture-spread-kind: journalArticle");

    expect(managedRegion(booksContent)).toContain(
      `Citation key: ${booksProfileTargetItem.citationKey}`,
    );
    expect(await hasOneIndexedNote(vaultId, defaultResult.indexedKey)).toBe(
      true,
    );
    const booksIndexedKey = await obEval(
      vaultId,
      `app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)})).frontmatter['zotero-key']`,
    );
    expect(await hasOneIndexedNote(vaultId, booksIndexedKey)).toBe(true);
  });

  // Covers both the "rendered literature note" and "batch operation"
  // acceptance-criteria bullets together — a deliberate simplification, not
  // an oversight: update-all-notes is itself a batch write of Literature
  // Notes, so exercising it also exercises rendering one.
  it("renders a Literature Note via the update-all-notes batch operation", async () => {
    const noteName = targetItem.literatureNoteName ?? targetItem.key;
    const notePath = join(e2eVaultPath, "literatures", `${noteName}.md`);
    if (booksNotePath === "") {
      throw new Error("The Books Profile note was not created");
    }

    const staleFieldSeeded = await obEvalUntil(
      vaultId,
      `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});if(!file||file.extension!=='md'){return 'missing';}await app.fileManager.processFrontMatter(file,function(frontmatter){frontmatter['fixture-obsolete']='stale';frontmatter['fixture-spread-title']='stale';frontmatter['fixture-spread-kind']='stale';frontmatter['fixture-manual']='mine';});return 'seeded';})()`,
      { expected: "seeded" },
    );
    expect(staleFieldSeeded).toBe(true);

    await using notices = await observeNotices(vaultId);
    const triggered = await obEvalUntil(
      vaultId,
      "app.commands.executeCommandById('zotlit:update-all-notes')",
      { expected: "true", tries: 20 },
    );
    expect(triggered).toBe(true);

    // The Fixture's My Library carries more than one Literature Note, so
    // `runBatchUpdateAll` (apps/obsidian/src/services/note-feature/update-batch.ts)
    // takes its multi-item path: a confirmation `BatchModal`, not an
    // immediate write — the same modal a person clicking the command would
    // see. Confirming it is an ordinary user action, not a bypass; the modal
    // classifies items asynchronously, so this polls for the button first.
    expect(
      await clickModalButton(vaultId, m.batch_update_confirm_button()),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.modal button')).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_close())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    // All seeded personal notes now use Default, plus the new group note;
    // the citekey-created note is the one existing Books note. The three
    // remaining group items (8, 9, 10) are created under Default, the batch's
    // fallback: the Books choice made in the citekey picker stayed with that
    // operation.
    const defaultCount =
      ITEMS.filter(({ libraryID }) => libraryID === 1).length + 1;
    const summary = await obEval(
      vaultId,
      "document.querySelector('.modal').textContent",
    );
    for (const [label, count] of [
      [m.settings_profile_default_name(), defaultCount],
      [booksProfile.label, 1],
    ] as const) {
      const updated = m.batch_profile_updated({ count, label });
      expect(summary).toContain(updated);
      expect((await notices.read()).join("\n")).toContain(updated);
    }
    const created = m.batch_profile_created({
      count: 3,
      label: m.settings_profile_default_name(),
    });
    expect(summary).toContain(created);
    expect((await notices.read()).join("\n")).toContain(created);
    expect(summary).toContain(
      m.batch_profile_group({
        group: m.batch_update_group_update({ count: 1 }),
        profile: booksProfile.label,
      }),
    );
    expect(await clickModalButton(vaultId, m.batch_update_close())).toBe(true);

    // The seed file the Fixture Vault ships already carries the title
    // heading and the `zotero-key`/`citekey` frontmatter, so polling for
    // those alone would pass even if the batch update silently no-oped.
    // `related`/`collections` frontmatter come only from a genuine re-render
    // against the Fixture's Zotero data — `targetItem` (see above) has both,
    // per the Fixture Spec (`relatedKeys: ["EEEE5555"]`, `collectionIDs: [1, 4]`).
    let content = "";
    const rendered = await waitFor(async () => {
      content = await readFile(notePath, "utf-8").catch(() => "");
      return content.includes("related:");
    }, 40);

    expect(rendered).toBe(true);
    expect(content).toContain(`zotero-key: ${targetItem.key}`);
    expect(content).toContain(`citekey: ${targetItem.citationKey}`);
    expect(content).toContain(`# ${targetItem.title}`);
    expect(content).toContain("related:");
    expect(content).toContain("collections:");

    let managedFrontmatter: ManagedFrontmatterReport | undefined;
    const managedFrontmatterApplied = await waitFor(async () => {
      const response = await obEval(
        vaultId,
        `(function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});var frontmatter=file&&app.metadataCache.getFileCache(file)?.frontmatter;return JSON.stringify({title:frontmatter?.['fixture-title'],kind:frontmatter?.['fixture-kind'],spreadTitle:frontmatter?.['fixture-spread-title'],spreadKind:frontmatter?.['fixture-spread-kind'],manual:frontmatter?.['fixture-manual'],obsolete:frontmatter?Object.prototype.hasOwnProperty.call(frontmatter,'fixture-obsolete'):false});})()`,
      ).catch(() => "");
      if (response === "") return false;
      managedFrontmatter = JSON.parse(response) as ManagedFrontmatterReport;
      return (
        managedFrontmatter.title === booksProfileTargetItem.title &&
        managedFrontmatter.kind === "reference/article" &&
        managedFrontmatter.spreadTitle === booksProfileTargetItem.title &&
        managedFrontmatter.spreadKind === "journalArticle" &&
        !managedFrontmatter.obsolete
      );
    }, 40);

    expect(managedFrontmatterApplied).toBe(true);
    expect(managedFrontmatter).toEqual({
      title: booksProfileTargetItem.title,
      kind: "reference/article",
      spreadTitle: booksProfileTargetItem.title,
      spreadKind: "journalArticle",
      manual: "mine",
      obsolete: false,
    });

    expect(await hasOneIndexedNote(vaultId, createTargetItem.key)).toBe(true);
  });

  it("creates under a document match and reports the matched Profile and path", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const seededPath = `literatures/${bookItem.literatureNoteName ?? bookItem.key}.md`;
    const notePath = `books/books-${bookItem.citationKey}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
    await writeMatch(booksProfile, bookMatch);
    await openProfilesSettings(vaultId, m.settings_page_profiles());
    const summary = `${m.settings_profile_rule_item_type_is({ type: "Book" })} and ${m.settings_profile_rule_library_is({ library: m.settings_library_scope_personal() })}`;
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.setting-item')).some(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)}&&el.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(summary)})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(vaultId, "app.setting.close();true");
    await using notices = await observeNotices(vaultId);
    await quickSwitchCreate(bookItem);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obEval(vaultId, "String(!!document.querySelector('.prompt'))"),
    ).toBe("false");
    expect(await notices.read()).toContain(
      m.notice_created_note_from_match({
        reason: m.profile_match_selected({ profile: booksProfile.label }),
        path: notePath,
      }),
    );
    expect(await readFile(join(e2eVaultPath, notePath), "utf-8")).toContain(
      `zotlit-profile: Books (${booksProfile.id})`,
    );
    expect(await hasOneIndexedNote(vaultId, bookItem.key)).toBe(true);

    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
    await obEval(
      vaultId,
      `(async function(){var plugin=app.plugins.plugins.zotlit;plugin.services.settings.update({'citation.pandoc-citations':true,'citation.open-as-links':true});var file=await app.vault.create('Match flow source.md',${JSON.stringify(`[@${bookItem.citationKey}]\n`)});var leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.setCursor({line:0,ch:5});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:open-citekey')",
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obEval(vaultId, "String(!!document.querySelector('.prompt'))"),
    ).toBe("false");
    expect(await notices.read()).toContain(
      m.notice_created_note_from_match({
        reason: m.profile_match_selected({ profile: booksProfile.label }),
        path: notePath,
      }),
    );
    expect(await hasOneIndexedNote(vaultId, bookItem.key)).toBe(true);
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, bookItem.key, 0)).toBe(true);
  });

  it("keeps per-Item matches in a mixed-Library batch with one unmatched-or-overlap fallback", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const sharedItem = ITEMS.find((item) => item.itemID === 6)!;
    const preprintItem = ITEMS.find((item) => item.itemID === 57)!;
    const labItem = ITEMS.find((item) => item.itemID === 9)!;
    const sharedLibrary = LIBRARIES.find(
      ({ libraryID }) => libraryID === sharedItem.libraryID,
    )!;
    const labLibrary = LIBRARIES.find(
      ({ libraryID }) => libraryID === labItem.libraryID,
    )!;
    const creating = [bookItem, sharedItem, preprintItem, labItem];
    for (const item of [sharedItem, preprintItem, labItem]) {
      const note = await indexedNote(vaultId, item.itemID);
      if (note.path)
        await cli([`vault=${vaultId}`, "delete", `path=${note.path}`]);
      expect(await hasIndexedNotes(vaultId, note.indexedKey, 0)).toBe(true);
    }
    const articlesSource = (
      await readFile(
        join(e2eVaultPath, "templates", booksProfile.document),
        "utf-8",
      )
    )
      .replace(`id: ${booksProfile.id}`, `id: ${articlesProfile.id}`)
      .replace("name: Books", "name: Articles")
      .replace("folder: books", "folder: articles")
      .replace("filename: 'books-", "filename: 'articles-");
    await writeFile(
      join(e2eVaultPath, "templates", articlesProfile.document),
      articlesSource,
    );
    const labMatch = `library == "group:${labLibrary.groupID}"`;
    await writeMatch(booksProfile, { or: [bookMatch, labMatch] });
    await writeMatch(articlesProfile, {
      or: [
        {
          and: [
            'itemType == "journalArticle"',
            `library == "group:${sharedLibrary.groupID}"`,
          ],
        },
        labMatch,
      ],
    });
    const server = JSON.parse(
      await obEval(
        vaultId,
        "(function(){var services=app.plugins.plugins.zotlit.services;var settings=services.settings.current;return JSON.stringify({hostname:settings['server.hostname'],port:settings['server.port'],sourceId:services.zoteroPref.sourceId});})()",
      ),
    ) as { hostname: string; port: number; sourceId: string };
    const pushed = await fetch(
      `http://${server.hostname}:${server.port}/literature-notes`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          [SOURCE_ID_HEADER]: server.sourceId,
        },
        body: JSON.stringify({
          items: [...creating, booksProfileTargetItem, targetItem].map(
            ({ itemID }) => itemID,
          ),
        }),
      },
    );
    expect(pushed.status).toBe(204);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(Array.from(document.querySelectorAll('.modal')).at(-1)?.querySelectorAll('button')??[]).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_confirm_button())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const bookPath = `books/books-${bookItem.citationKey}.md`;
    const articlesPath = `articles/articles-${sharedItem.citationKey}.md`;
    const preprintPath = `books/books-${preprintItem.citationKey}.md`;
    const labPath = `books/books-${labItem.citationKey}.md`;
    const confirmation = await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      bookPath,
      articlesPath,
      m.profile_match_selected({ profile: booksProfile.label }),
      m.profile_match_selected({ profile: articlesProfile.label }),
      m.profile_match_unmatched(),
      m.batch_profile_unresolved_help(),
      m.batch_profile_override_all_help(),
      m.modal_profile_problem_overlap({ profiles: "Articles, Books" }),
    ])
      expect(confirmation).toContain(text);
    for (const scope of ["unresolved", "all-new"])
      expect(
        await obEval(
          vaultId,
          `String(Array.from(document.querySelectorAll('.modal')).at(-1).querySelectorAll('[data-profile-choice-scope=${scope}]').length)`,
        ),
      ).toBe("1");
    expect(confirmation).not.toContain(m.batch_profile_recovery_help());
    await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.modal')).at(-1).querySelector('[data-profile-choice-scope=unresolved] [data-profile-choice]').click();true",
    );
    const candidate = await selectSuggestion(
      vaultId,
      `articles/articles-${preprintItem.citationKey}.md`,
    );
    expect(candidate).toContain(m.modal_profile_match_batch_candidate());
    expect(candidate).not.toContain(m.modal_profile_match_candidate());
    expect(candidate).toContain(articlesProfile.label);
    await obEval(
      vaultId,
      `(function(){var input=Array.from(document.querySelectorAll('.prompt')).at(-1).querySelector('input');input.value=${JSON.stringify(booksProfile.label)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    await selectSuggestion(vaultId, preprintPath);
    await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.prompt')).at(-1).querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String((Array.from(document.querySelectorAll('.modal')).at(-1)?.textContent??'').includes(${JSON.stringify(m.batch_profile_unresolved_destination({ count: 2, label: booksProfile.label }))}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const chosen = await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      bookPath,
      articlesPath,
      preprintPath,
      labPath,
      m.profile_match_selected({ profile: booksProfile.label }),
      m.profile_match_selected({ profile: articlesProfile.label }),
      m.batch_profile_source_chosen(),
    ])
      expect(chosen).toContain(text);
    await using notices = await observeNotices(vaultId);
    expect(
      await clickModalButton(vaultId, m.batch_update_confirm_button()),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(Array.from(document.querySelectorAll('.modal')).at(-1)?.querySelectorAll('button')??[]).some(button=>button.textContent.trim()===${JSON.stringify(m.batch_update_close())}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const summary = await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.modal')).at(-1).textContent",
    );
    for (const text of [
      m.batch_profile_created({ count: 3, label: booksProfile.label }),
      m.batch_profile_created({ count: 1, label: articlesProfile.label }),
      m.batch_profile_updated({ count: 1, label: booksProfile.label }),
      m.batch_profile_updated({
        count: 1,
        label: m.settings_profile_default_name(),
      }),
    ]) {
      expect(summary).toContain(text);
      expect((await notices.read()).join("\n")).toContain(text);
    }
    expect(await clickModalButton(vaultId, m.batch_update_close())).toBe(true);
    for (const [item, path, label, id] of [
      [bookItem, bookPath, booksProfile.label, booksProfile.id],
      [preprintItem, preprintPath, booksProfile.label, booksProfile.id],
      [labItem, labPath, booksProfile.label, booksProfile.id],
      [sharedItem, articlesPath, articlesProfile.label, articlesProfile.id],
    ] as const) {
      const content = await readFile(join(e2eVaultPath, path), "utf-8");
      expect(content).toContain(`zotlit-profile: ${label} (${id})`);
      const note = await indexedNote(vaultId, item.itemID);
      expect(await hasOneIndexedNote(vaultId, note.indexedKey)).toBe(true);
      await cli([`vault=${vaultId}`, "delete", `path=${path}`]);
      expect(await hasIndexedNotes(vaultId, note.indexedKey, 0)).toBe(true);
    }
    await cli([
      `vault=${vaultId}`,
      "delete",
      `path=templates/${articlesProfile.document}`,
    ]);
    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.id===${JSON.stringify(articlesProfile.id)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await writeMatch(booksProfile, bookMatch);
  });

  it("matches a Collection path through descendants and keeps direct filing separate", async () => {
    const childItem = ITEMS.find(({ itemID }) => itemID === 11)!;
    const childCollection = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === childCollection.parentCollectionID,
    )!;
    expect(childItem.collectionIDs).toEqual([childCollection.collectionID]);
    const seededPath = `literatures/${childItem.literatureNoteName ?? childItem.key}.md`;
    const notePath = `books/books-${childItem.citationKey}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await writeMatch(
      booksProfile,
      `collections.within(${JSON.stringify(parent.name)})`,
    );
    await quickSwitchCreate(childItem);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(await readFile(join(e2eVaultPath, notePath), "utf-8")).toContain(
      `zotlit-profile: Books (${booksProfile.id})`,
    );
    await cli([`vault=${vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await writeMatch(
      booksProfile,
      `collections.contains(${JSON.stringify(parent.name)})`,
    );
    await quickSwitchCreate(childItem);
    const fallback = await selectSuggestion(
      vaultId,
      m.modal_profile_preselected(),
    );
    expect(fallback).toContain(m.settings_profile_default_name());
    expect(fallback).toContain(`literatures/${childItem.citationKey}.md`);
    await obEval(
      vaultId,
      "document.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(vaultId, "String(!document.querySelector('.prompt'))", {
        expected: "true",
      }),
    ).toBe(true);
    expect(await hasIndexedNotes(vaultId, childItem.key, 0)).toBe(true);
    await writeMatch(booksProfile, bookMatch);
  });

  it("deletes Books into Default and applies Default on the next update", async () => {
    const profilePath = `templates/${booksProfile.document}`;
    const profileSource = await readFile(
      join(e2eVaultPath, profilePath),
      "utf-8",
    );
    const exterior = "My discussion stays outside the managed region.";
    await obEval(
      vaultId,
      `(async function(){app.vault.setConfig('trashOption','local');var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});await app.vault.append(file,${JSON.stringify(`\n${exterior}\n`)});return true;})()`,
    );
    await openProfilesSettings(vaultId, m.settings_page_profiles());
    const beforeMove = await readFile(
      join(e2eVaultPath, booksNotePath),
      "utf-8",
    );
    // The list's own delete icon is the last control on the row, after the
    // row's edit, duplicate, and share icons; Obsidian labels it itself.
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(row=>row.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)}&&row.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(booksProfile.document)}));var button=row&&Array.from(row.querySelectorAll('.clickable-icon')).at(-1);if(!button)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        "String(!!document.querySelector('input[name=\"zotlit-delete-profile-target\"]:checked'))",
        { expected: "true" },
      ),
    ).toBe(true);
    const target = await obEval(
      vaultId,
      "document.querySelector('input[name=\"zotlit-delete-profile-target\"]:checked').closest('label').textContent",
    );
    const movedPath = `literatures/${booksNotePath.slice(booksNotePath.lastIndexOf("/") + 1)}`;
    expect(target).toContain(m.settings_profile_default_name());
    expect(target).toContain(movedPath);
    expect(
      await obEval(
        vaultId,
        `(function(){var label=Array.from(document.querySelectorAll('.modal label')).find(label=>label.textContent===${JSON.stringify(m.settings_profile_delete_move_files({ folder: "literatures/" }))});var checkbox=label?.querySelector('input[type=checkbox]');if(!checkbox||checkbox.checked)return false;checkbox.click();return checkbox.checked;})()`,
      ),
    ).toBe("true");
    const deletionDialog = await obEval(
      vaultId,
      "Array.from(document.querySelectorAll('.modal')).at(-1).textContent",
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_literature_count({ count: 1 }),
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_imported_count({ count: 0 }),
    );
    expect(deletionDialog).toContain(
      m.settings_profile_delete_move_confirm({ count: 1 }),
    );
    expect(deletionDialog).not.toContain(
      m.settings_profile_delete_rules_repair(),
    );
    expect(
      await clickModalButton(
        vaultId,
        m.settings_profile_delete_move_confirm({ count: 1 }),
      ),
      deletionDialog,
    ).toBe(true);
    expect(
      await waitFor(async () =>
        readFile(join(e2eVaultPath, movedPath), "utf-8")
          .then((source) => !source.includes("zotlit-profile:"))
          .catch(() => false),
      ),
    ).toBe(true);
    const afterMove = await readFile(join(e2eVaultPath, movedPath), "utf-8");
    expect(
      await readFile(join(e2eVaultPath, booksNotePath), "utf-8").catch(
        () => null,
      ),
    ).toBeNull();
    expect(managedRegion(afterMove)).toBe(managedRegion(beforeMove));
    expect(noteBody(afterMove)).toBe(noteBody(beforeMove));
    expect(afterMove).not.toContain("zotlit-profile:");
    expect(afterMove).toContain(
      `fixture-title: ${booksProfileTargetItem.title}`,
    );
    expect(
      await waitFor(async () =>
        readFile(join(e2eVaultPath, profilePath), "utf-8")
          .then(() => false)
          .catch(() => true),
      ),
    ).toBe(true);
    const trashedPaths = await readdir(join(e2eVaultPath, ".trash"), {
      recursive: true,
    });
    const trashed = await Promise.all(
      trashedPaths
        .filter((path) => path.endsWith(".md"))
        .map((path) => readFile(join(e2eVaultPath, ".trash", path), "utf-8")),
    );
    expect(trashed).toContain(profileSource);
    await obEval(
      vaultId,
      `(async function(){app.setting.close();var file=app.vault.getAbstractFileByPath(${JSON.stringify(movedPath)});await app.fileManager.processFrontMatter(file,frontmatter=>{frontmatter.title='Not the Zotero title';});await app.workspace.getLeaf(false).openFile(file);return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:update-note')",
        { expected: "true" },
      ),
    ).toBe(true);
    let updated = "";
    expect(
      await waitFor(async () => {
        updated = await readFile(join(e2eVaultPath, movedPath), "utf-8");
        return (
          updated.includes(`\ntitle: ${booksProfileTargetItem.title}\n`) &&
          !managedRegion(updated).includes("## Book details")
        );
      }),
    ).toBe(true);
    expect(updated).toContain(`\ntitle: ${booksProfileTargetItem.title}\n`);
    expect(updated).toContain(`citekey: ${booksProfileTargetItem.citationKey}`);
    expect(updated).toContain("collections:");
    expect(managedRegion(updated)).toBe("%%zt-managed%%\n\n%%/zt-managed%%");
    expect(noteBody(updated).replace(managedRegion(updated), "")).toBe(
      noteBody(afterMove).replace(managedRegion(afterMove), ""),
    );
    expect(updated).toContain(exterior);

    expect(
      await obEvalUntil(
        vaultId,
        `String(!app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.id===${JSON.stringify(booksProfile.id)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(vaultId, "app.setting.close();true");
  });

  it("reflects a Scope Case switch through zotlit:library-scope", async () => {
    const availableCase = findScopeCase("available");
    const dataPath = join(
      e2eVaultPath,
      ".obsidian",
      "plugins",
      "zotlit",
      "data.json",
    );

    // Settle any pending settings write before editing its disk file; plugin
    // unload also flushes pending settings.
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.flush().then(()=>true)",
    );

    // Rewrite the e2e vault's own copy — the shared Fixture layout's vault
    // copy was already copied into the e2e vault during `create`; editing
    // that shared source afterward would have no further effect.
    const raw = await readFile(dataPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data[LIBRARY_SCOPE_SETTING_KEY] = availableCase.scope;
    await writeFile(dataPath, JSON.stringify(data, null, 2));

    // An ordinary user action (the Community Plugins toggle), not a bypass —
    // it makes the plugin re-read data.json from disk.
    const toggled = await obEvalUntil(
      vaultId,
      "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
      { expected: "true", tries: 20 },
    );
    expect(toggled).toBe(true);

    const reloaded = await obEvalUntil(
      vaultId,
      "String('zotlit' in app.plugins.plugins)",
      { expected: "true" },
    );
    expect(reloaded).toBe(true);

    // Dispatched as a registered CLI command, not `eval` — the way a real
    // caller would invoke it. Retried a few times: a window fresh off a
    // reload can still answer stray noise ahead of a well-formed reply.
    let scope: LibraryScopeReport | undefined;
    await waitFor(async () => {
      try {
        const response = await cliCommand(vaultId, "zotlit:library-scope");
        scope = JSON.parse(response) as LibraryScopeReport;
        return true;
      } catch {
        return false;
      }
    }, 10);
    if (!scope) {
      throw new Error("zotlit:library-scope never returned a parseable reply");
    }

    expect(scope.ok).toBe(true);
    expect(scope.mode).toBe(availableCase.scope.mode);
    if (availableCase.scope.mode === "selected") {
      expect(scope.available).toHaveLength(
        availableCase.scope.libraries.length,
      );
      expect(scope.unavailable ?? []).toHaveLength(0);
      const gotLibraryIDs = (scope.available ?? [])
        .map((entry) => entry.libraryID)
        .toSorted((a, b) => a - b);
      expect(gotLibraryIDs).toEqual(
        expectedLibraryIDs(availableCase.scope.libraries),
      );
    }
  });
});

/** The `zotlit:library-scope` reply shape this suite reads (see
 *  apps/obsidian/src/services/library-scope/cli.ts). */
interface LibraryScopeReport {
  contractVersion: number;
  ok: boolean;
  mode?: "all" | "selected";
  invalid?: boolean;
  available?: { selector: unknown; libraryID: number; name: string | null }[];
  unavailable?: unknown[];
}

interface ManagedFrontmatterReport {
  title?: unknown;
  kind?: unknown;
  spreadTitle?: unknown;
  spreadKind?: unknown;
  manual?: unknown;
  obsolete: boolean;
}

type CreateOperationReply =
  | { outcome: "created"; path: string; indexedKey: string }
  | {
      outcome: "refused";
      diagnostic: {
        code: "literature-note-exists" | "duplicate-literature-notes";
        hint: string;
        indexedKey: string;
        paths: string[];
      };
    };

async function createFixtureNote(
  vaultId: string,
  itemID: number,
  profile?: string,
): Promise<CreateOperationReply> {
  const response = await obEval(
    vaultId,
    `(async function(){var services=app.plugins.plugins.zotlit.services;var hits=await services.itemLookup.search('',{limit:100});var hit=hits.find(function(candidate){return candidate.item.itemID===${itemID};});if(!hit){throw new Error('Fixture Item not found');}var result=await services.noteFeature.createNote(hit.item,${JSON.stringify({ profile })});return JSON.stringify(result.outcome==='created'?{outcome:'created',path:result.file.path,indexedKey:hit.item.indexedKey}:{outcome:'refused',diagnostic:result.diagnostic});})()`,
  );
  return JSON.parse(response) as CreateOperationReply;
}

function hasOneIndexedNote(
  vaultId: string,
  indexedKey: string,
): Promise<boolean> {
  return hasIndexedNotes(vaultId, indexedKey, 1);
}

function hasIndexedNotes(
  vaultId: string,
  indexedKey: string,
  count: number,
): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(indexedKey)}).length)`,
    { expected: String(count) },
  );
}

/** A Fixture Item's Indexed Key and its current Literature Note, if any. */
async function indexedNote(
  vaultId: string,
  itemID: number,
): Promise<{ indexedKey: string; path: string | null }> {
  const response = await obEval(
    vaultId,
    `(async function(){var services=app.plugins.plugins.zotlit.services;var hits=await services.itemLookup.search('',{limit:100});var hit=hits.find(function(candidate){return candidate.item.itemID===${itemID};});if(!hit){throw new Error('Fixture Item not found');}var notes=services.noteIndex.getNotesByItemKey(hit.item.indexedKey);return JSON.stringify({indexedKey:hit.item.indexedKey,path:notes[0]?notes[0].path:null});})()`,
  );
  return JSON.parse(response) as { indexedKey: string; path: string | null };
}

/** Maps the Scope Case's stable selectors to the Fixture's libraryIDs. */
function expectedLibraryIDs(selectors: readonly LibrarySelector[]): number[] {
  return selectors
    .map((selector) => {
      const library =
        selector.type === "personal"
          ? LIBRARIES.find((candidate) => candidate.groupID === null)
          : LIBRARIES.find(
              (candidate) => candidate.groupID === selector.groupID,
            );
      if (!library) {
        throw new Error(
          `no Fixture Library for selector ${JSON.stringify(selector)}`,
        );
      }
      return library.libraryID;
    })
    .toSorted((a, b) => a - b);
}

/** Reads the user-visible Managed Region, including its boundary markers. */
function managedRegion(source: string): string {
  const start = source.indexOf("%%zt-managed%%");
  const end = source.indexOf("%%/zt-managed%%", start);
  if (start < 0 || end < 0) throw new Error("Missing Managed Region");
  return source.slice(start, end + "%%/zt-managed%%".length);
}

function noteBody(source: string): string {
  const end = source.indexOf("\n---", 3);
  if (!source.startsWith("---\n") || end < 0)
    throw new Error("Missing frontmatter");
  return source.slice(end + 4);
}

/**
 * Moves the open prompt's selection onto the suggestion whose text includes
 * `needle` and returns that row's text. The chooser selects on hover, and a
 * physical cursor resting over the prompt re-selects the row under it after
 * every re-render, so the wanted row is hovered explicitly instead of waited
 * for.
 */
async function selectSuggestion(
  vaultId: string,
  needle: string,
): Promise<string> {
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){var prompt=Array.from(document.querySelectorAll('.prompt')).at(-1);var row=Array.from(prompt?.querySelectorAll('.suggestion-item')??[]).find(el=>el.textContent.includes(${JSON.stringify(needle)}));if(!row)return false;row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));return row.classList.contains('is-selected');})()`,
      { expected: "true" },
    ),
  ).toBe(true);
  return obEval(
    vaultId,
    "Array.from(document.querySelectorAll('.prompt')).at(-1).querySelector('.is-selected').textContent",
  );
}

function clickModalButton(vaultId: string, label: string): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var button=modal&&Array.from(modal.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true;})()`,
    { expected: "true" },
  );
}

/** Captures transient UI notices without replacing the plugin's notifier. */
async function observeNotices(vaultId: string) {
  await obEval(
    vaultId,
    "(function(){var previous=new Set(document.querySelectorAll('.notice'));var values=new Map();var observer=new MutationObserver(()=>{for(var element of document.querySelectorAll('.notice'))if(!previous.has(element))values.set(element,element.textContent);});observer.observe(document.body,{childList:true,subtree:true});window.zotlitE2ENotices={observer,values};return true;})()",
  );
  return {
    async read(): Promise<string[]> {
      return JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify([...window.zotlitE2ENotices.values.values()])",
        ),
      ) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obEval(
        vaultId,
        "window.zotlitE2ENotices.observer.disconnect();delete window.zotlitE2ENotices;true",
      );
    },
  };
}
