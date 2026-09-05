// The End-to-end Run suite — drives the plugin in a real desktop Obsidian
// window against the Fixture, over the official Obsidian CLI. See
// packages/e2e/AGENTS.md and packages/scripts/CONTEXT.md for vocabulary.
//
// Skips cleanly (not fails) when no desktop Obsidian is reachable: the
// `describe.skipIf` below runs before test collection, so `vitest run` exits
// 0 with every test reported as skipped rather than erroring.

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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

const reachable = await isObsidianReachable();

describe.skipIf(!reachable)("End-to-end Run", () => {
  let vaultId = "";
  let booksNotePath = "";
  // The rule the settings UI configured below; the deletion flow restores
  // it so the warning names a rule the GUI produced.
  let bookRule: {
    id: string;
    scope: unknown;
    expression: string;
    profile: string;
  };
  let m: typeof import("@obsidian-messages");
  const bookRuleSummary = () =>
    m.settings_profile_rule_summary({
      conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
      libraries: m.settings_library_scope_personal(),
    });

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
    expect(
      await obEvalUntil(
        vaultId,
        "String(!!document.querySelector('.prompt .is-selected'))",
        { expected: "true" },
      ),
    ).toBe(true);
    // Without an explicit input the picker preselects Default; the Books
    // choice below belongs to this operation alone.
    const preselected = await obEval(
      vaultId,
      "document.querySelector('.prompt .is-selected').textContent",
    );
    expect(preselected).toContain(m.settings_profile_default_name());
    expect(preselected).toContain(m.modal_profile_preselected());
    expect(preselected).not.toContain(booksProfile.label);
    await obEval(
      vaultId,
      `(function(){var input=document.querySelector('.prompt input');input.value=${JSON.stringify(booksProfile.label)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String((document.querySelector('.prompt .is-selected')?.textContent??'').includes(${JSON.stringify(booksNotePath)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const selected = await obEval(
      vaultId,
      "document.querySelector('.prompt .is-selected').textContent",
    );
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

  it("creates a note under the Profile a rule configured through the settings UI selects", async () => {
    // Item 61 is a My Library book with no seeded Books note of its own; the
    // rule below sends every My Library book to Books.
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const seededPath = `literatures/${bookItem.literatureNoteName ?? bookItem.key}.md`;
    const ruleNotePath = `books/books-${bookItem.citationKey}.md`;
    await cli([`vault=${vaultId}`, "delete", `path=${seededPath}`]);
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(bookItem.key)}).length)`,
        { expected: "0" },
      ),
    ).toBe(true);

    // Configure the rule through the Profiles page: + on the rule list, then
    // the editor's labeled controls, then Save.
    await obEval(
      vaultId,
      `(function(){app.vault.setConfig('settingsPopoutWindow',false);app.setting.open();var tab=app.setting.openTabById('zotlit');app.setting.navigateToSearchResult({tab,pagePath:[${JSON.stringify(m.settings_page_profiles())}]});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var heading=Array.from(document.querySelectorAll('.setting-item-heading, .setting-item')).find(el=>el.textContent.includes(${JSON.stringify(m.settings_profile_rules_heading())}));var button=heading&&heading.querySelector('button, .clickable-icon');if(!button)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.modal')).some(modal=>modal.textContent.includes(${JSON.stringify(m.settings_profile_rule_title_new())})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const configured = await obEval(
      vaultId,
      `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);function row(name){return Array.from(modal.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===name);}function pick(select,value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}var scope=row(${JSON.stringify(m.settings_profile_rule_scope())}).querySelector('select');pick(scope,'selected');var libraryRow=Array.from(modal.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_library_scope_personal())});var toggle=libraryRow&&libraryRow.querySelector('.checkbox-container');if(toggle&&!toggle.classList.contains('is-enabled'))toggle.click();var selects=Array.from(modal.querySelectorAll('.setting-item')).filter(el=>el.querySelectorAll('select').length===3)[0].querySelectorAll('select');pick(selects[1],'is');pick(selects[2],'book');var target=row(${JSON.stringify(m.settings_profile_rule_target())}).querySelector('select');pick(target,${JSON.stringify(booksProfile.id)});return JSON.stringify({scope:scope.value,library:!!toggle,type:selects[2].value,target:target.value});})()`,
    );
    expect(JSON.parse(configured)).toEqual({
      scope: "selected",
      library: true,
      type: "book",
      target: booksProfile.id,
    });
    expect(
      await clickModalButton(vaultId, m.settings_profile_rule_save()),
    ).toBe(true);
    const ruleSummary = bookRuleSummary();
    // The list persists the rule and shows it after the tab re-renders.
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.setting-item')).some(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)}&&el.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(ruleSummary)})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const stored = JSON.parse(
      await obEval(
        vaultId,
        "JSON.stringify(app.plugins.plugins.zotlit.services.settings.current['profile.selection-rules'])",
      ),
    ) as (typeof bookRule)[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      scope: { mode: "selected", libraries: [{ type: "personal" }] },
      expression: 'itemType == "book"',
      profile: booksProfile.id,
    });
    bookRule = stored[0]!;
    await obEval(vaultId, "app.setting.close();true");

    // Quick Switch preselects the rule's Profile, names the rule, and shows
    // the destination; Enter creates the note there.
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:note-quick-switcher')",
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      `(function(){var input=document.querySelector('.prompt input');input.value=${JSON.stringify(bookItem.title)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String((document.querySelector('.prompt .is-selected')?.textContent??'').includes(${JSON.stringify(bookItem.title)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      vaultId,
      "document.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String((document.querySelector('.prompt .is-selected')?.textContent??'').includes(${JSON.stringify(ruleNotePath)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    const preselected = await obEval(
      vaultId,
      "document.querySelector('.prompt .is-selected').textContent",
    );
    expect(preselected).toContain(booksProfile.label);
    expect(preselected).toContain(m.modal_profile_preselected());
    expect(preselected).toContain(
      m.modal_profile_source_rule({ rule: ruleSummary }),
    );
    expect(preselected).toContain(ruleNotePath);
    await obEval(
      vaultId,
      "document.querySelector('.prompt input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));true",
    );
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, ruleNotePath), "utf-8").catch(
            () => "",
          )
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    const ruleNote = await readFile(join(e2eVaultPath, ruleNotePath), "utf-8");
    expect(ruleNote).toContain(`zotlit-profile: Books (${booksProfile.id})`);
    expect(ruleNote).toContain(`citekey: ${bookItem.citationKey}`);
    expect(await hasOneIndexedNote(vaultId, bookItem.key)).toBe(true);

    // Leave the later Profile flows what they expect: one Books note and no
    // rules. The rule list is the vault's own; clearing it is an ordinary edit.
    await cli([`vault=${vaultId}`, "delete", `path=${ruleNotePath}`]);
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.update({'profile.selection-rules':[]});true",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(bookItem.key)}).length)`,
        { expected: "0" },
      ),
    ).toBe(true);
  });

  it("deletes Books into Default and applies Default on the next update", async () => {
    const profilePath = `templates/${booksProfile.document}`;
    const profileSource = await readFile(
      join(e2eVaultPath, profilePath),
      "utf-8",
    );
    const exterior = "My discussion stays outside the managed region.";
    // The GUI-configured rule selects Books again, so the deletion dialog
    // has a referencing rule to warn about.
    await obEval(
      vaultId,
      `app.plugins.plugins.zotlit.services.settings.update({'profile.selection-rules':[${JSON.stringify(bookRule)}]});true`,
    );
    await obEval(
      vaultId,
      `(async function(){app.vault.setConfig('trashOption','local');app.vault.setConfig('settingsPopoutWindow',false);var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});await app.vault.append(file,${JSON.stringify(`\n${exterior}\n`)});app.setting.open();var tab=app.setting.openTabById('zotlit');app.setting.navigateToSearchResult({tab,pagePath:[${JSON.stringify(m.settings_page_profiles())}]});return true;})()`,
    );
    const beforeMove = await readFile(
      join(e2eVaultPath, booksNotePath),
      "utf-8",
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(row=>row.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.label)}&&row.querySelector('.setting-item-description')?.textContent===${JSON.stringify(booksProfile.document)});var button=row&&Array.from(row.querySelectorAll('button')).find(button=>button.textContent===${JSON.stringify(m.settings_profile_delete())});if(!button)return false;button.click();return true;})()`,
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
    // The warning lists the rule and says it needs manual repair; the
    // delete action stays available.
    expect(deletionDialog).toContain(
      m.settings_profile_delete_rules_count({ count: 1 }),
    );
    expect(deletionDialog).toContain(bookRuleSummary());
    expect(deletionDialog).toContain(m.settings_profile_delete_rules_repair());
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

    // Moving the note into Default left the rule's target alone: it still
    // names the deleted Books ID.
    const readStoredRules = async () =>
      JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify(app.plugins.plugins.zotlit.services.settings.current['profile.selection-rules'])",
        ),
      ) as (typeof bookRule)[];
    expect(await readStoredRules()).toEqual([bookRule]);

    // Manual repair through the existing rule editor: the row shows the
    // unavailable target, the editor's Profile control takes Default.
    await obEval(
      vaultId,
      `(function(){app.setting.open();var tab=app.setting.openTabById('zotlit');app.setting.navigateToSearchResult({tab,pagePath:[${JSON.stringify(m.settings_page_profiles())}]});return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(booksProfile.id)}&&el.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(m.settings_profile_rule_target_unavailable())}));var button=row&&row.querySelector('.clickable-icon');if(!button)return false;button.click();return true;})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.modal')).some(modal=>modal.textContent.includes(${JSON.stringify(m.settings_profile_rule_title_edit())})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var row=Array.from(modal.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_profile_rule_target())});var select=row.querySelector('select');select.value='default';select.dispatchEvent(new Event('change',{bubbles:true}));return select.value;})()`,
      ),
    ).toBe("default");
    expect(
      await clickModalButton(vaultId, m.settings_profile_rule_save()),
    ).toBe(true);
    await waitFor(
      async () => (await readStoredRules())[0]?.profile === "default",
    );
    expect(await readStoredRules()).toEqual([
      { ...bookRule, profile: "default" },
    ]);
    // The list shows the repaired rule under Default without the warning.
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(document.querySelectorAll('.setting-item')).some(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(m.settings_profile_default_name())}&&el.querySelector('.setting-item-description')?.textContent?.includes(${JSON.stringify(bookRuleSummary())})&&!el.textContent.includes(${JSON.stringify(m.settings_profile_rule_target_unavailable())})))`,
        { expected: "true" },
      ),
    ).toBe(true);
    // Leave the later flows without rules, as the earlier rule flow did.
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.update({'profile.selection-rules':[]});app.setting.close();true",
    );
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
  return obEvalUntil(
    vaultId,
    `String(app.plugins.plugins.zotlit.services.noteIndex.getNotesByItemKey(${JSON.stringify(indexedKey)}).length)`,
    { expected: "1" },
  );
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

function clickModalButton(vaultId: string, label: string): Promise<boolean> {
  return obEvalUntil(
    vaultId,
    `(function(){var button=Array.from(document.querySelectorAll('.modal button')).find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true;})()`,
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
