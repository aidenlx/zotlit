// The End-to-end Run suite — drives the plugin in a real desktop Obsidian
// window against the Fixture, over the official Obsidian CLI. See
// packages/e2e/AGENTS.md and packages/scripts/CONTEXT.md for vocabulary.
//
// Skips cleanly (not fails) when no desktop Obsidian is reachable: the
// `describe.skipIf` below runs before test collection, so `vitest run` exits
// 0 with every test reported as skipped rather than erroring.

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
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

  beforeAll(async () => {
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
    const notePath = `literatures/${noteName}.md`;
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

  it("creates one differently shaped note per Item from two Profile documents", async () => {
    const defaultResult = await createFixtureNote(
      vaultId,
      defaultProfileTargetItem.itemID,
      "default",
    );
    const booksResult = await createFixtureNote(
      vaultId,
      booksProfileTargetItem.itemID,
      booksProfile.id,
    );

    expect(defaultResult.outcome).toBe("created");
    expect(booksResult.outcome).toBe("created");
    if (
      defaultResult.outcome !== "created" ||
      booksResult.outcome !== "created"
    ) {
      throw new Error("The two-Profile scenario did not create both notes");
    }
    booksNotePath = booksResult.path;

    expect(defaultResult.path.startsWith("literatures/")).toBe(true);
    expect(booksResult.path.startsWith("books/books-")).toBe(true);

    const defaultContent = await readFile(
      join(e2eVaultPath, defaultResult.path),
      "utf-8",
    );
    const booksContent = await readFile(
      join(e2eVaultPath, booksResult.path),
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

    for (const result of [defaultResult, booksResult]) {
      expect(await hasOneIndexedNote(vaultId, result.indexedKey)).toBe(true);
    }
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
      `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});if(!file||file.extension!=='md'){return 'missing';}await app.fileManager.processFrontMatter(file,function(frontmatter){frontmatter['fixture-obsolete']='stale';});return 'seeded';})()`,
      { expected: "seeded" },
    );
    expect(staleFieldSeeded).toBe(true);

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
    const confirmClicked = await obEvalUntil(
      vaultId,
      "(function(){var btns=Array.from(document.querySelectorAll('.modal button'));var btn=btns.find(function(b){return b.textContent.trim()==='Update notes'});if(btn){btn.click();return 'clicked';}return 'pending';})()",
      { expected: "clicked", tries: 40 },
    );
    expect(confirmClicked).toBe(true);

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
        `(function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(booksNotePath)});var frontmatter=file&&app.metadataCache.getFileCache(file)?.frontmatter;return JSON.stringify({title:frontmatter?.['fixture-title'],kind:frontmatter?.['fixture-kind'],obsolete:frontmatter?Object.prototype.hasOwnProperty.call(frontmatter,'fixture-obsolete'):false});})()`,
      ).catch(() => "");
      if (response === "") return false;
      managedFrontmatter = JSON.parse(response) as ManagedFrontmatterReport;
      return (
        managedFrontmatter.title === booksProfileTargetItem.title &&
        managedFrontmatter.kind === "reference/article" &&
        !managedFrontmatter.obsolete
      );
    }, 40);

    expect(managedFrontmatterApplied).toBe(true);
    expect(managedFrontmatter).toEqual({
      title: booksProfileTargetItem.title,
      kind: "reference/article",
      obsolete: false,
    });

    expect(await hasOneIndexedNote(vaultId, createTargetItem.key)).toBe(true);
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
