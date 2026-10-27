import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import {
  COLLECTIONS,
  DEMO_ITEMS,
  ITEMS,
  LIBRARIES,
  LITERATURE_NOTE_PROFILES,
} from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import { webWorkbenchEnabled } from "./e2e-run-fixture.ts";
import {
  annotationKeys,
  booksProfile,
  booksProfileTargetItem,
  createTargetItem,
  defaultProfileTargetItem,
  e2eVaultPath,
  runVaultScript,
  targetItem,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import {
  changeNativeAnnotationCallout,
  openProfilesSettings,
} from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import {
  clickModalButton,
  createFixtureNote,
  hasIndexedNotes,
  hasOneIndexedNote,
  indexedNote,
  managedRegion,
  noteBody,
  observeNotices,
  pressPromptKey,
  recordFrames,
  selectSuggestion,
} from "./e2e-run-note-helpers.ts";
import type { ManagedFrontmatterReport } from "./e2e-run-note-types.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { useListingProfile } from "./listing-profile.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { clearNotices, cli, waitFor } from "./obsidian-cli.ts";
import type { CodeMirrorElement } from "./page-notes-types.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("customizes a first note in a fresh vault, then explicitly updates that note", async () => {
    const annotatedItem = ITEMS.find((item) => item.itemID === 46)!;
    const freshPath = e2eVaultDir(workspaceRoot, "first-note-vault");
    await clearVault(runVaultScript, freshPath);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await runVaultScript(["remove", freshPath, "--purge"]);
    });
    const created = await runVaultScript([
      "open",
      freshPath,
      "--vault-case",
      "fresh",
    ]);
    const freshId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(freshId);
    await obRun(
      freshId,
      async ({ app }) => {
        app.saveLocalStorage("zotlit-profile-customization", "native");
      },
      undefined,
    );
    expect(
      await obRun(
        freshId,
        async ({ zotlit }) => {
          return zotlit.services.profile.profiles.length;
        },
        undefined,
      ),
    ).toBe(0);
    // A default Profile that lists the Annotations in the note puts one
    // callout for each of them in the body, where the customized callout
    // must arrive.
    await useListingProfile(freshId);
    await suite.quickSwitchCreate(annotatedItem, freshId);
    await obRunUntil(
      freshId,
      async ({ app, zotlit }) => {
        return (
          !!app.workspace.getActiveFile() &&
          zotlit.services.noteIndex.getNotesByItemKey("RUGIER24").length === 1
        );
      },
      undefined,
      {
        what: "an active note file and exactly one Literature Note indexed for item RUGIER24",
      },
    );
    const note = await indexedNote(freshId, annotatedItem.itemID);
    expect(note.path).not.toBeNull();
    const personal = "\nMy own research question stays here.\n";
    // Customize is offered only on a note whose metadata cache names a paper.
    // Obsidian drops a note's cache when a write lands and restores it once
    // the worker has parsed the new content, so the command waits for that
    // `changed` event rather than racing the parse.
    await obRun(
      freshId,
      async ({ app }, { notePath, personal }) => {
        const file = app.vault.getFileByPath(notePath)!;
        const indexed = new Promise<void>((resolve) => {
          const ref = app.metadataCache.on("changed", (changed, data) => {
            if (changed !== file || !data.includes(personal)) return;
            app.metadataCache.offref(ref);
            resolve();
          });
        });
        await app.vault.append(file, personal);
        await indexed;
        await app.workspace.getLeaf(false).openFile(file);
      },
      { notePath: note.path!, personal },
    );
    const before = await readFile(join(freshPath, note.path!), "utf-8");
    expect(before.split("[!note]").length - 1).toBe(annotationKeys.length);
    expect(
      await obRun(
        freshId,
        async ({ app }) => {
          return app.commands.executeCommandById(
            "zotlit:customize-note-template",
          );
        },
        undefined,
      ),
    ).toBe(true);

    await obRunUntil(
      freshId,
      async ({ app }, { notePath }) => {
        return !!(function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()?.file;
      },
      { notePath: note.path! },
      {
        tries: 80,
        what: "the Template Workbench to open a file for the originating note",
      },
    );
    // The Default document already exists, so the workbench shows its file
    // before Customize sets the note it came from.
    await obRunUntil(
      freshId,
      async ({ app }, { notePath, expectedTemplateText }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        return (
          view.contentEl.textContent.includes(expectedTemplateText) &&
          view.store.getState().item?.id === "RUGIER24"
        );
      },
      {
        notePath: note.path!,
        expectedTemplateText: run.m.template_workbench_shared_template({
          name: run.m.settings_profile_default_name(),
        }),
      },
      {
        what: "the Template Workbench to show the expected template text for item RUGIER24",
      },
    );
    await changeNativeAnnotationCallout(freshId, {
      view: { originatingNote: note.path! },
      vaultPath: freshPath,
      tabLabel: run.m.workbench_tab_annotation(),
      beforeEdit: async () => {
        await obRunUntil(
          freshId,
          async ({ app }, { notePath, helpButtonLabel }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === notePath,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const help = view.contentEl.querySelector<HTMLElement>(
              `button[aria-label=${JSON.stringify(helpButtonLabel)}]`,
            );
            if (!help) return false;
            view.leaf.getContainer().focus();
            help!.focus();
            return (
              help === view.contentEl.ownerDocument.activeElement &&
              help!.getAttribute("aria-expanded") === "false"
            );
          },
          { notePath: note.path!, helpButtonLabel: run.m.workbench_help() },
          {
            what: "the Template Workbench help button to take focus while collapsed",
          },
        );
        await obRun(
          freshId,
          async ({ app, page }, { notePath, helpButtonLabel }) => {
            const { press } = page;
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === notePath,
                ) ?? leaves[0]
              )?.view;
            })()!;
            press(
              view.contentEl.querySelector<HTMLElement>(
                `button[aria-label=${JSON.stringify(helpButtonLabel)}]`,
              ),
              "Help",
            );
          },
          { notePath: note.path!, helpButtonLabel: run.m.workbench_help() },
        );
        await obRunUntil(
          freshId,
          async ({ app }, { notePath, helpSectionLabel, guideText }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === notePath,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const guide = view.contentEl.querySelector<HTMLElement>(
              `section[aria-label=${JSON.stringify(helpSectionLabel)}]`,
            );
            const source = Array.from(
              view.contentEl.querySelectorAll<CodeMirrorElement>(".cm-content"),
            ).find((element) => element.textContent.includes("[!note]"));
            return (
              !!guide &&
              guide.textContent.includes("[!quote]") &&
              guide.textContent.includes(guideText) &&
              guide!.getBoundingClientRect().height > 0 &&
              source!.getBoundingClientRect().height > 0
            );
          },
          {
            notePath: note.path!,
            helpSectionLabel: run.m.workbench_annotation_help_title(),
            guideText: run.m.template_workbench_update_this_note(),
          },
          {
            what: "the Template Workbench guide section to render with its quote callout visible",
          },
        );
        await obRun(
          freshId,
          async ({ app }, { notePath, helpSectionLabel }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === notePath,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const guide = view.contentEl.querySelector<HTMLElement>(
              `section[aria-label=${JSON.stringify(helpSectionLabel)}]`,
            );
            guide!.focus();
            guide!.dispatchEvent(
              new view.contentEl.ownerDocument.defaultView!.KeyboardEvent(
                "keydown",
                { key: "Escape", bubbles: true },
              ),
            );
          },
          {
            notePath: note.path!,
            helpSectionLabel: run.m.workbench_annotation_help_title(),
          },
        );
        await obRunUntil(
          freshId,
          async ({ app }, { notePath, helpButtonLabel }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === notePath,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const help = view.contentEl.querySelector<HTMLElement>(
              `button[aria-label=${JSON.stringify(helpButtonLabel)}]`,
            );
            return (
              help!.getAttribute("aria-expanded") === "false" &&
              help === view.contentEl.ownerDocument.activeElement &&
              Array.from(
                view.contentEl.querySelectorAll<CodeMirrorElement>(
                  ".cm-content",
                ),
              ).some((element) => element.textContent.includes("[!note]"))
            );
          },
          { notePath: note.path!, helpButtonLabel: run.m.workbench_help() },
          {
            what: "the help button collapsed and focused with the note source visible",
          },
        );
      },
    });
    // The linked Preview belongs to the editor's native window, which can differ from the CLI window.
    await obRunUntil(
      freshId,
      async ({ app }, { notePath }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        return !!view.contentEl.ownerDocument.querySelector<HTMLElement>(
          '.callout[data-callout="quote"]',
        );
      },
      { notePath: note.path! },
      {
        what: "a quote callout to render in the Preview of the editor's window",
      },
    );
    expect(await readFile(join(freshPath, note.path!), "utf-8")).toBe(before);
    const other = await createFixtureNote(freshId, createTargetItem.itemID);
    expect(other.outcome).toBe("created");
    if (other.outcome !== "created")
      throw new Error("Second note was not created");
    const otherBefore = await readFile(join(freshPath, other.path), "utf-8");
    await obRun(
      freshId,
      async ({ app }, { otherPath }) => {
        await app.workspace
          .getLeaf("tab")
          .openFile(app.vault.getFileByPath(otherPath)!);
        app.workspace.rootSplit.focus();
      },
      { otherPath: other.path },
    );
    await obRun(
      freshId,
      async ({ app }, { notePath }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        await app.workspace.revealLeaf(view.leaf);
        view.contentEl.ownerDocument.defaultView!.focus();
        app.workspace.setActiveLeaf(view.leaf, { focus: true });
      },
      { notePath: note.path! },
    );
    await obRunUntil(
      freshId,
      async ({ app }, { notePath }) => {
        return (
          activeWindow ===
          (function () {
            var leaves = app.workspace.getLeavesOfType(
              "zotlit-template-workbench",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
            })[];
            return (
              leaves.find(
                (leaf) => leaf.view.originatingNote?.path === notePath,
              ) ?? leaves[0]
            )?.view;
          })()!.contentEl.ownerDocument.defaultView
        );
      },
      { notePath: note.path! },
      { what: "the Template Workbench's window to become the active window" },
    );
    await obRunUntil(
      freshId,
      async ({ app }, { notePath, updateButtonText }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        const button = Array.from(
          view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) => button.innerText.trim() === updateButtonText);
        button!.focus();
        return (
          view.contentEl.ownerDocument.activeElement === button &&
          !button.disabled
        );
      },
      {
        notePath: note.path!,
        updateButtonText: run.m.template_workbench_update_this_note(),
      },
      {
        what: "the Template Workbench Update button to take focus and be enabled",
      },
    );
    // The first click after an edit writes the Managed Frontmatter with the
    // body: a managed Property removed now comes back with this one update.
    await obRun(
      freshId,
      async ({ app }, { notePath }) => {
        await app.fileManager.processFrontMatter(
          app.vault.getFileByPath(notePath)!,
          (fm) => {
            delete fm.collections;
          },
        );
      },
      { notePath: note.path! },
    );
    await obRun(
      freshId,
      async ({ app, page }, { notePath, updateButtonText }) => {
        const { press } = page;
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        press(
          Array.from(
            view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
          ).find((button) => button.innerText.trim() === updateButtonText),
          "Update this note",
        );
      },
      {
        notePath: note.path!,
        updateButtonText: run.m.template_workbench_update_this_note(),
      },
    );
    await obRunUntil(
      freshId,
      async ({ app }, { notePath }) => {
        return !(function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!.updatingNote;
      },
      { notePath: note.path! },
      { what: "the Template Workbench to clear its updating-note flag" },
    );
    expect(
      await waitFor(async () =>
        /^collections:/m.test(
          (await readFile(join(freshPath, note.path!), "utf-8")).split(
            "---",
          )[1]!,
        ),
      ),
    ).toBe(true);
    // The update puts the customized callout in the body, one for each
    // Annotation.
    expect(
      await waitFor(
        async () =>
          (await readFile(join(freshPath, note.path!), "utf-8")).split(
            "[!quote]",
          ).length -
            1 ===
          annotationKeys.length,
      ),
    ).toBe(true);
    const updated = run.m.template_workbench_updated_note({
      name: basename(note.path!, ".md"),
    });
    await obRunUntil(
      freshId,
      async ({ app }, { notePath, updated }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === notePath,
            ) ?? leaves[0]
          )?.view;
        })()!;
        return [view.contentEl.ownerDocument, document].some((doc) =>
          Array.from(doc.querySelectorAll<HTMLElement>(".notice")).some(
            (notice) => notice.textContent.includes(updated),
          ),
        );
      },
      { notePath: note.path!, updated },
      {
        what: "an Obsidian notice with the note update confirmation text to appear",
      },
    );
    const after = await readFile(join(freshPath, note.path!), "utf-8");
    expect(after.split("---")[1]).toMatch(/^collections:/m);
    expect(noteBody(after).replace(managedRegion(after), "")).toBe(
      noteBody(before).replace(managedRegion(before), ""),
    );
    expect(after).toContain(personal);
    expect(await readFile(join(freshPath, other.path), "utf-8")).toBe(
      otherBefore,
    );
  }, 180000);

  it("keeps one Literature Note when create runs twice for one Item", async () => {
    const noteName =
      createTargetItem.literatureNoteName ?? createTargetItem.key;
    const profile = LITERATURE_NOTE_PROFILES.find(
      ({ id }) => id === createTargetItem.literatureNoteProfile,
    );
    const folder = profile?.bindings["note.literature-folder"] ?? "literatures";
    const notePath = `${folder}/${noteName}.md`;
    await cli([`vault=${run.vaultId}`, "delete", `path=${notePath}`]);

    await obRunUntil(
      run.vaultId,
      async ({ zotlit }, { createTargetItemKey }) => {
        return zotlit.services.noteIndex.getNotesByItemKey(createTargetItemKey)
          .length;
      },
      { createTargetItemKey: createTargetItem.key },
      {
        ready: (value) => value === 0,
        what: "Literature Notes indexed for the create target item to reach 0",
      },
    );

    const first = await createFixtureNote(run.vaultId, createTargetItem.itemID);
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") {
      throw new Error("The first create did not create a Literature Note");
    }

    await obRunUntil(
      run.vaultId,
      async ({ zotlit }, { createTargetItemKey }) => {
        return zotlit.services.noteIndex.getNotesByItemKey(createTargetItemKey)
          .length;
      },
      { createTargetItemKey: createTargetItem.key },
      {
        ready: (value) => value === 1,
        what: "Literature Notes indexed for the create target item to reach 1",
      },
    );

    const second = await createFixtureNote(
      run.vaultId,
      createTargetItem.itemID,
    );
    expect(second).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-exists",
        hint: "Open the existing Literature Note instead of creating another.",
        indexedKey: createTargetItem.key,
        paths: [first.path],
      },
    });

    const oneNote = await hasOneIndexedNote(run.vaultId, createTargetItem.key);
    expect(oneNote).toBe(true);
  });

  it("creates a default note whose body renders once and imports no Child Note", async () => {
    const item = ITEMS.find(({ itemID }) => itemID === 1)!;
    const childNoteKey = "NNNNAAAA";

    await obRunUntil(
      run.vaultId,
      async ({ zotlit }) => {
        return (
          zotlit.services.profile.resolveProfile("default")?.document ===
          undefined
        );
      },
      undefined,
      { what: "the default Profile to resolve without a document" },
    );
    // Set the Item's seeded notes aside, so the default Profile writes a new
    // one; the cleanup puts them back.
    await using cleanup = new AsyncDisposableStack();
    const seeded = (await obRun(
      run.vaultId,
      async ({ app, zotlit }, { itemKey }) => {
        await zotlit.services.noteIndex.whenIndexed();
        const notes = [];
        for (const note of zotlit.services.noteIndex.getNotesByItemKey(
          itemKey,
        )) {
          const file = app.vault.getFileByPath(note.path)!;
          notes.push({ path: note.path, text: await app.vault.read(file) });
          await app.vault.delete(file);
        }
        return notes;
      },
      { itemKey: item.key },
    )) as { path: string; text: string }[];
    let created = "";
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { createdNotePath, seeded }) => {
          const created = app.vault.getFileByPath(createdNotePath)!;
          if (created) await app.vault.delete(created);
          for (const { path, text } of seeded)
            await app.vault.create(path, text);
        },
        { createdNotePath: created, seeded },
      );
    });
    expect(await hasIndexedNotes(run.vaultId, item.key, 0)).toBe(true);
    const markdownFiles = () =>
      obRun(
        run.vaultId,
        async ({ app }) => {
          return String(app.vault.getMarkdownFiles().length);
        },
        undefined,
      );
    const filesBefore = await markdownFiles();
    const importedNotes = () =>
      obRun(
        run.vaultId,
        async ({ zotlit }, { childNoteKey }) => {
          return String(
            zotlit.services.noteIndex.getImportedNoteByNoteKey(childNoteKey)
              .length,
          );
        },
        { childNoteKey },
      );
    const importedBefore = await importedNotes();

    const result = await createFixtureNote(run.vaultId, item.itemID, "default");
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created")
      throw new Error("The default Profile did not create a Literature Note");
    created = result.path;
    const text = await readFile(join(e2eVaultPath, created), "utf-8");
    expect(noteBody(text)).toContain("## Annotations\n\n```zotquery\n");
    expect(text).not.toContain("%%zt-managed%%");
    expect(text).not.toContain("## Notes");
    // Rendering the note wrote one file: the note. The Child Note stays in
    // Zotero until an import command brings it in.
    expect(await markdownFiles()).toBe(String(Number(filesBefore) + 1));
    expect(await importedNotes()).toBe(importedBefore);

    // A full Update refreshes the Properties and leaves the body as written.
    const personal = "\nMy own reading of this paper.\n";
    await obRun(
      run.vaultId,
      async ({ app }, { created, personal }) => {
        await app.vault.append(app.vault.getFileByPath(created)!, personal);
      },
      { created, personal },
    );
    const before = await readFile(join(e2eVaultPath, created), "utf-8");
    const update = (await obRun(
      run.vaultId,
      async ({ app, zotlit }, { created, itemKey }) => {
        const result = await zotlit.services.noteFeature.updateNote(
          app.vault.getFileByPath(created)!,
          { indexedKey: itemKey, scope: "full" },
        );
        return {
          bodyUpdated: result.bodyUpdated,
          diagnostic: result.diagnostic ?? null,
        };
      },
      { created, itemKey: item.key },
    )) as { bodyUpdated: boolean; diagnostic: unknown };
    expect(update).toEqual({ bodyUpdated: false, diagnostic: null });
    const after = await readFile(join(e2eVaultPath, created), "utf-8");
    expect(noteBody(after)).toBe(noteBody(before));
    expect(after).toContain(personal);
    expect(await markdownFiles()).toBe(String(Number(filesBefore) + 1));
  });

  it("creates through the citekey command with an explicitly chosen Profile", async () => {
    const defaultResult = await createFixtureNote(
      run.vaultId,
      defaultProfileTargetItem.itemID,
      "default",
    );
    expect(defaultResult.outcome).toBe("created");
    if (defaultResult.outcome !== "created") {
      throw new Error("The Default scenario did not create a Literature Note");
    }
    run.booksNotePath = `books/books-${booksProfileTargetItem.citationKey}.md`;
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { citationText }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.update({
            "citation.pandoc-citations": true,
            "citation.open-as-links": true,
          }),
        );
        var file = await app.vault.create(
          "Profile flow source.md",
          citationText,
        );
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setCursor({
          line: 0,
          ch: 5,
        });
      },
      { citationText: `[@${booksProfileTargetItem.citationKey}]\n` },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return app.commands.executeCommandById("zotlit:open-citekey");
      },
      undefined,
      { what: "the open-citekey command to run and report success" },
    );
    // Without an explicit input the picker preselects Default; the Books
    // choice below belongs to this operation alone.
    const preselected = await selectSuggestion(
      run.vaultId,
      run.m.modal_profile_preselected(),
    );
    expect(preselected).toContain(run.m.settings_profile_default_name());
    expect(preselected).toContain(run.m.modal_profile_preselected());
    expect(preselected).not.toContain(booksProfile.label);
    await obRun(
      run.vaultId,
      async (_context, { booksProfileLabel }) => {
        var input =
          activeDocument.querySelector<HTMLInputElement>(".prompt input");
        input!.value = booksProfileLabel;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { booksProfileLabel: booksProfile.label },
    );
    const selected = await selectSuggestion(run.vaultId, run.booksNotePath);
    expect(selected).toContain(booksProfile.label);
    expect(selected).not.toContain(run.m.modal_profile_preselected());
    expect(selected).toContain(run.booksNotePath);
    await pressPromptKey(run.vaultId, "Enter");
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, run.booksNotePath), "utf-8").catch(
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
      join(e2eVaultPath, run.booksNotePath),
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
    expect(await hasOneIndexedNote(run.vaultId, defaultResult.indexedKey)).toBe(
      true,
    );
    const booksIndexedKey = await obRun(
      run.vaultId,
      async ({ app }, { booksNotePath }) => {
        return String(
          await app.metadataCache.getFileCache(
            app.vault.getFileByPath(booksNotePath)!,
          )!.frontmatter!["zotero-key"],
        );
      },
      { booksNotePath: run.booksNotePath },
    );
    expect(await hasOneIndexedNote(run.vaultId, booksIndexedKey)).toBe(true);
  });

  it("refuses an update whose open note switched its Profile in unsaved text", async () => {
    const original = await readFile(
      join(e2eVaultPath, run.booksNotePath),
      "utf-8",
    );
    const stampLine = `zotlit-profile: ${booksProfile.label} (${booksProfile.id})\n`;
    expect(original).toContain(stampLine);
    const edited = original.replace(stampLine, "");
    await clearNotices(run.vaultId);
    // The stamp leaves the editor's text only; the metadata cache still names
    // Books when the update chooses its Profile, a moment later.
    await obRun(
      run.vaultId,
      async ({ app }, { booksNotePath, edited }) => {
        var file = app.vault.getFileByPath(booksNotePath)!;
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setValue(edited);
        return app.commands.executeCommandById("zotlit:update-note");
      },
      { booksNotePath: run.booksNotePath, edited },
    );
    await obRunUntil(
      run.vaultId,
      async ({ page }, { noticeText }) => {
        return page
          .windowDocuments()
          .some((doc) =>
            Array.from(doc.querySelectorAll<HTMLElement>(".notice")).some(
              (notice) => notice.textContent.includes(noticeText),
            ),
          );
      },
      { noticeText: run.m.notice_literature_note_profile_changed() },
      {
        what: "a notice refusing the update over an unsaved Profile switch to appear",
      },
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { edited }) => {
          return (
            (
              app.workspace.getActiveFileView() as import("obsidian").MarkdownView
            )?.getViewData() === edited
          );
        },
        { edited },
      ),
    ).toBe(true);
    // Put the stamp back, so the scenarios below find the note as it was.
    await obRun(
      run.vaultId,
      async ({ app }, { original }) => {
        var view =
          app.workspace.getActiveFileView() as import("obsidian").MarkdownView;
        view.editor.setValue(original);
        await view.save();
      },
      { original },
    );
    expect(
      await waitFor(
        async () =>
          (await readFile(join(e2eVaultPath, run.booksNotePath), "utf-8")) ===
          original,
      ),
    ).toBe(true);
  });

  // Covers both the "rendered literature note" and "batch operation"
  // acceptance-criteria bullets together — a deliberate simplification, not
  // an oversight: update-all-notes is itself a batch write of Literature
  // Notes, so exercising it also exercises rendering one.
  it("renders a Literature Note via the update-all-notes batch operation", async () => {
    const noteName = targetItem.literatureNoteName ?? targetItem.key;
    const notePath = join(e2eVaultPath, "literatures", `${noteName}.md`);
    if (run.booksNotePath === "") {
      throw new Error("The Books Profile note was not created");
    }

    await obRunUntil(
      run.vaultId,
      async ({ app }, { booksNotePath }) => {
        var file = app.vault.getFileByPath(booksNotePath)!;
        if (!file || file.extension !== "md") {
          return "missing";
        }
        await app.fileManager.processFrontMatter(file, function (frontmatter) {
          frontmatter["fixture-obsolete"] = "stale";
          frontmatter["fixture-spread-title"] = "stale";
          frontmatter["fixture-spread-kind"] = "stale";
          frontmatter["fixture-manual"] = "mine";
        });
        return "seeded";
      },
      { booksNotePath: run.booksNotePath },
      {
        ready: (value) => value === "seeded",
        what: "the Books note front matter to be seeded with stale fixture values",
      },
    );
    // The batch reads each note's Profile stamp from the metadata cache, and
    // the write above sends the Books note back through the parser. Until the
    // cache holds the rewritten frontmatter, the note reads as unstamped.
    await obRunUntil(
      run.vaultId,
      async ({ app }, { booksNotePath }) => {
        return (
          app.metadataCache.getFileCache(
            app.vault.getFileByPath(booksNotePath)!,
          )?.frontmatter?.["fixture-manual"] === "mine"
        );
      },
      { booksNotePath: run.booksNotePath },
      {
        what: "the metadata cache to hold fixture-manual as mine on the Books note",
      },
    );

    await using notices = await observeNotices(run.vaultId);
    await using frames = await recordFrames(run.vaultId);
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return app.commands.executeCommandById("zotlit:update-all-notes");
      },
      undefined,
      {
        tries: 20,
        what: "the zotlit update-all-notes command to run and report success",
      },
    );

    // The Fixture's My Library carries more than one Literature Note, so
    // `runBatchUpdateAll` (apps/obsidian/src/services/note-feature/update-batch.ts)
    // takes its multi-item path: a confirmation `BatchModal`, not an
    // immediate write — the same modal a person clicking the command would
    // see. Confirming it is an ordinary user action, not a bypass; the modal
    // classifies items asynchronously, so this polls for the button first.
    expect(
      await clickModalButton(run.vaultId, run.m.batch_update_confirm_button()),
    ).toBe(true);
    await obRunUntil(
      run.vaultId,
      async (_context, { closeButtonText }) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal button"),
        ).some((button) => button.textContent.trim() === closeButtonText);
      },
      { closeButtonText: run.m.batch_update_close() },
      { what: "the update-all-notes result modal to show its Close button" },
    );
    // All seeded personal notes now use Default, plus the new group note;
    // the citekey-created note is the one existing Books note. The three
    // remaining group items (8, 9, 10, 79) are created under Default, the batch's
    // fallback: the Books choice made in the citekey picker stayed with that
    // operation. The demo papers have no seeded note, so they are created
    // under Default too.
    const defaultCount =
      ITEMS.filter((item) => item.libraryID === 1 && !DEMO_ITEMS.includes(item))
        .length + 1;
    const summary = await obRun(
      run.vaultId,
      async (_context) => {
        return activeDocument.querySelector<HTMLElement>(".modal")!.textContent;
      },
      undefined,
    );
    for (const [label, count] of [
      [run.m.settings_profile_default_name(), defaultCount],
      [booksProfile.label, 1],
    ] as const) {
      const updated = run.m.batch_profile_updated({ count, label });
      expect(summary).toContain(updated);
      expect((await notices.read()).join("\n")).toContain(updated);
    }
    const created = run.m.batch_profile_created({
      count: 4 + DEMO_ITEMS.length,
      label: run.m.settings_profile_default_name(),
    });
    expect(summary).toContain(created);
    expect((await notices.read()).join("\n")).toContain(created);
    expect(summary).toContain(
      run.m.batch_profile_group({
        group: run.m.batch_update_group_update({ count: 1 }),
        profile: booksProfile.label,
      }),
    );
    expect(
      await clickModalButton(run.vaultId, run.m.batch_update_close()),
    ).toBe(true);
    // The batch's database reads run in the worker: the window kept painting
    // from the command to the summary.
    const painted = await frames.read();
    console.info("update-all frame gaps", painted);
    expect(painted.frames).toBeGreaterThan(1);
    expect(painted.maxFrameGapMs).toBeLessThan(250);
    expect(painted.longestTaskMs).toBeLessThan(250);

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
      const response = await obRun(
        run.vaultId,
        async ({ app }, { booksNotePath }) => {
          var file = app.vault.getFileByPath(booksNotePath)!;
          var frontmatter =
            file && app.metadataCache.getFileCache(file)?.frontmatter;
          return JSON.stringify({
            title: frontmatter?.["fixture-title"],
            kind: frontmatter?.["fixture-kind"],
            spreadTitle: frontmatter?.["fixture-spread-title"],
            spreadKind: frontmatter?.["fixture-spread-kind"],
            manual: frontmatter?.["fixture-manual"],
            obsolete: frontmatter
              ? Object.prototype.hasOwnProperty.call(
                  frontmatter,
                  "fixture-obsolete",
                )
              : false,
          });
        },
        { booksNotePath: run.booksNotePath },
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

    expect(await hasOneIndexedNote(run.vaultId, createTargetItem.key)).toBe(
      true,
    );
  });

  it("creates under a document match and reports the matched Profile and path", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const seededPath = `literatures/${bookItem.literatureNoteName ?? bookItem.key}.md`;
    const notePath = `books/books-${bookItem.citationKey}.md`;
    await cli([`vault=${run.vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(run.vaultId, bookItem.key, 0)).toBe(true);
    await suite.openMatchEditor();
    // A Profile with no Match shows one placeholder row.
    await suite.shapeCondition(0, "item-type", "book");
    await suite.addLibraryCondition("personal");
    await suite.saveMatch(suite.bookMatch);
    const description = run.m.settings_profile_match_status({
      state: "evaluable",
    });
    await obRunUntil(
      run.vaultId,
      async ({ app }, { booksProfileLabel, description }) => {
        return Array.from(
          app.setting.containerEl.querySelectorAll<HTMLElement>(
            ".setting-item",
          ),
        ).some(
          (el) =>
            el.querySelector<HTMLElement>(".setting-item-name")?.textContent ===
              booksProfileLabel &&
            el
              .querySelector<HTMLElement>(".setting-item-description")
              ?.textContent?.includes(description),
        );
      },
      { booksProfileLabel: booksProfile.label, description },
      {
        what: "the Books Profile row in settings to show the matched document description",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
      },
      undefined,
    );
    await using notices = await observeNotices(run.vaultId);
    await suite.quickSwitchCreate(bookItem);
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obRun(
        run.vaultId,
        async (_context) => {
          return !!activeDocument.querySelector<HTMLElement>(".prompt");
        },
        undefined,
      ),
    ).toBe(false);
    await expect
      .poll(() => notices.read(), { timeout: 5000 })
      .toContain(
        run.m.notice_created_note_from_match({
          reason: run.m.profile_match_selected({ profile: booksProfile.label }),
          path: notePath,
        }),
      );
    expect(await readFile(join(e2eVaultPath, notePath), "utf-8")).toContain(
      `zotlit-profile: Books (${booksProfile.id})`,
    );
    expect(await hasOneIndexedNote(run.vaultId, bookItem.key)).toBe(true);

    await cli([`vault=${run.vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(run.vaultId, bookItem.key, 0)).toBe(true);
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { fileContent }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.update({
            "citation.pandoc-citations": true,
            "citation.open-as-links": true,
          }),
        );
        var file = await app.vault.create("Match flow source.md", fileContent);
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setCursor({
          line: 0,
          ch: 5,
        });
      },
      { fileContent: `[@${bookItem.citationKey}]\n` },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return app.commands.executeCommandById("zotlit:open-citekey");
      },
      undefined,
      {
        what: "the open-citekey command to run from the document-match creation flow",
      },
    );
    expect(
      await waitFor(async () =>
        (
          await readFile(join(e2eVaultPath, notePath), "utf-8").catch(() => "")
        ).includes("%%zt-managed%%"),
      ),
    ).toBe(true);
    expect(
      await obRun(
        run.vaultId,
        async (_context) => {
          return !!activeDocument.querySelector<HTMLElement>(".prompt");
        },
        undefined,
      ),
    ).toBe(false);
    await expect
      .poll(() => notices.read(), { timeout: 5000 })
      .toContain(
        run.m.notice_created_note_from_match({
          reason: run.m.profile_match_selected({ profile: booksProfile.label }),
          path: notePath,
        }),
      );
    expect(await hasOneIndexedNote(run.vaultId, bookItem.key)).toBe(true);
    await cli([`vault=${run.vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(run.vaultId, bookItem.key, 0)).toBe(true);
  });

  it("checks a Profile Match against a chosen Item and marks a mistake on its row", async () => {
    const bookItem = ITEMS.find((item) => item.itemID === 61)!;
    const articleItem = ITEMS.find((item) => item.itemID === 1)!;
    const documentPath = join(e2eVaultPath, "templates", booksProfile.document);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }) => {
          for (const type of [
            "zotlit-template-workbench",
            "zotlit-template-data-explorer",
            "zotlit-note-preview",
          ])
            app.workspace.detachLeavesOfType(type);
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.writeMatch(booksProfile, suite.bookMatch);
    await suite.openMatchEditor();
    /** The Match tab's result once it tests the Item `key` and settles. */
    const resultFor = async (key: string) => {
      let text = "";
      await waitFor(async () => {
        text = await obRun(
          run.vaultId,
          async ({ app }, { key }) => {
            const view = app.workspace.activeLeaf!
              .view as import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
            if (view.getState().itemIndexedKey !== key)
              await view.setState(
                { ...view.getState(), itemIndexedKey: key },
                { history: false },
              );
            const result = view.contentEl.querySelector<HTMLElement>(
              '[data-part="result"]',
            );
            return result?.getAttribute("data-state") === "loading"
              ? "loading"
              : (result?.textContent ?? "loading");
          },
          { key },
        );
        return text !== "loading";
      });
      return text;
    };
    // ZotLit Query tests a real Item, as creation does.
    expect(await resultFor(bookItem.key)).toBe(
      run.m.workbench_match_result_yes(),
    );
    expect(await resultFor(articleItem.key)).toBe(
      run.m.workbench_match_result_no(),
    );
    // A mistake in one condition shows on that row, with the reason ZotLit
    // Query gives.
    await suite.writeMatch(booksProfile, {
      and: ['itemType == "book"', 'tags.contain("Read")'],
    });
    let rows: (string | null)[] = [];
    expect(
      await waitFor(async () => {
        rows = (await obRun(
          run.vaultId,
          async ({ page }) => {
            return Array.from(
              page
                .workbench()
                ?.contentEl?.querySelectorAll<HTMLElement>(
                  "[data-condition-row]",
                ) ?? [],
            ).map(
              (row) =>
                row.querySelector<HTMLElement>("[role=alert]")?.textContent ??
                null,
            );
          },
          undefined,
        )) as (string | null)[];
        return rows.length === 2 && rows[1] !== null;
      }),
    ).toBe(true);
    expect(rows[0]).toBeNull();
    expect(rows[1]).toContain("contain");
    /**
     * The text each condition row underlines, once the second row's is
     * `expected` or the wait ends: the editor draws its marks after the
     * frame that shows the row.
     */
    const underlines = async (expected: string) => {
      let marks: string[][] = [];
      await waitFor(async () => {
        marks = (await obRun(
          run.vaultId,
          async ({ page }) => {
            return Array.from(
              page
                .workbench()
                ?.contentEl?.querySelectorAll<HTMLElement>(
                  "[data-condition-row]",
                ) ?? [],
            ).map((row) =>
              Array.from(
                row.querySelectorAll<HTMLElement>(".cm-lintRange-error"),
              ).map((n) => n.textContent),
            );
          },
          undefined,
        )) as string[][];
        return marks[1]?.join() === expected;
      });
      return marks;
    };
    // The row underlines the name ZotLit Query found wrong.
    expect(await underlines("contain")).toEqual([[], ["contain"]]);
    // A Syntax Fault is underlined in its row, with no test to wait for.
    await suite.writeMatch(booksProfile, {
      and: ['itemType == "book"', "title =="],
    });
    expect(await underlines("==")).toEqual([[], ["=="]]);
    // Mod+Z in the expression field is its own history's, and the Match
    // follows the text it undoes; in a select's search field it undoes the
    // typed text and leaves the Match alone (#1667).
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press, until } = page;
          const { trusted } = page;
          const view = app.workspace.activeLeaf!
            .view as import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          const el = view.contentEl;
          const input = trusted(el.win);
          const contents = (
            el.win as Window & {
              electronWindow: { webContents: import("electron").WebContents };
            }
          ).electronWindow.webContents;
          const mod = process.platform === "darwin" ? "meta" : "control";
          const rows = el.querySelectorAll<HTMLElement>("[data-condition-row]");
          const content =
            rows[1]?.querySelector<CodeMirrorElement>(".cm-content");
          if (!content) throw new Error("Missing: expression field");
          const editor = content.cmTile!.root.view;
          await input.click(content);
          editor.dispatch({ selection: { anchor: editor.state.doc.length } });
          await contents.insertText(" x");
          await until("the typing reaches the Match", () =>
            view.controller.source.includes("title == x"),
          );
          await input.key("z", [mod]);
          await until(
            "undo takes the typing out of the field and the Match",
            () =>
              editor.state.doc.toString() === "title ==" &&
              !view.controller.source.includes("title == x"),
          );
          const select =
            rows[0]!.querySelector<HTMLButtonElement>("[role=combobox]");
          press(select, "the first select");
          const popup = await until(
            "the select opens",
            () =>
              select!.popoverTargetElement?.matches(":popover-open") &&
              select!.popoverTargetElement,
          );
          const search = await until(
            "focus in its search",
            () =>
              el.doc.activeElement ===
                popup.querySelector<HTMLInputElement>("input") &&
              (el.doc.activeElement as HTMLInputElement),
          );
          await contents.insertText("ab");
          await until("the search is typed", () => search.value === "ab");
          const before = view.controller.source;
          await input.key("z", [mod]);
          contents.undo();
          await until(
            "the search undoes its own text",
            () => search.value !== "ab",
          );
          const kept = view.controller.source === before;
          await input.key("Escape");
          return kept;
        },
        undefined,
      ),
    ).toBe(true);
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
    const booksProfileTargetExists =
      (await indexedNote(run.vaultId, booksProfileTargetItem.itemID)).path !==
      null;
    for (const item of creating) {
      const note = await indexedNote(run.vaultId, item.itemID);
      if (note.path)
        await cli([`vault=${run.vaultId}`, "delete", `path=${note.path!}`]);
      expect(await hasIndexedNotes(run.vaultId, note.indexedKey, 0)).toBe(true);
    }
    const articlesSource = (
      await readFile(
        join(e2eVaultPath, "templates", booksProfile.document),
        "utf-8",
      )
    )
      .replace(`id: ${booksProfile.id}`, `id: ${suite.articlesProfile.id}`)
      .replace("name: Books", "name: Articles")
      .replace("folder: books", "folder: articles")
      .replace("filename: 'books-", "filename: 'articles-");
    await writeFile(
      join(e2eVaultPath, "templates", suite.articlesProfile.document),
      articlesSource,
    );
    const labMatch = `library == "group:${labLibrary.groupID}"`;
    await suite.writeMatch(booksProfile, { or: [suite.bookMatch, labMatch] });
    await suite.writeMatch(suite.articlesProfile, {
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
    const server = (await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        var services = zotlit.services;
        var settings = services.bridge.runSync(services.settings.current);
        return {
          hostname: settings["server.hostname"],
          port: services.bridge.runSync(services.localServer.effectivePort),
          sourceId: services.zoteroPref.sourceId,
        };
      },
      undefined,
    )) as { hostname: string; port: number; sourceId: string };
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
    await obRunUntil(
      run.vaultId,
      async (_context, { confirmButtonText }) => {
        return Array.from(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .at(-1)
            ?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).some((button) => button.textContent.trim() === confirmButtonText);
      },
      { confirmButtonText: run.m.batch_update_confirm_button() },
      { what: "the topmost modal to show the batch confirm button" },
    );
    const bookPath = `books/books-${bookItem.citationKey}.md`;
    const articlesPath = `articles/articles-${sharedItem.citationKey}.md`;
    const preprintPath = `books/books-${preprintItem.citationKey}.md`;
    const labPath = `books/books-${labItem.citationKey}.md`;
    const confirmation = await obRun(
      run.vaultId,
      async (_context) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal"),
        ).at(-1)!.textContent;
      },
      undefined,
    );
    for (const text of [
      bookPath,
      articlesPath,
      run.m.profile_match_selected({ profile: booksProfile.label }),
      run.m.profile_match_selected({ profile: suite.articlesProfile.label }),
      run.m.profile_match_unmatched(),
      run.m.batch_profile_unresolved_help(),
      run.m.batch_profile_override_all_help(),
      run.m.modal_profile_problem_overlap({ profiles: "Articles, Books" }),
    ])
      expect(confirmation).toContain(text);
    for (const scope of ["unresolved", "all-new"])
      expect(
        await obRun(
          run.vaultId,
          (_context, { scope }) =>
            Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
              .at(-1)!
              .querySelectorAll<HTMLElement>(
                `[data-profile-choice-scope=${scope}]`,
              ).length,
          { scope },
        ),
      ).toBe(1);
    expect(confirmation).not.toContain(run.m.batch_profile_recovery_help());
    await obRun(
      run.vaultId,
      async ({ page }) => {
        const { press } = page;
        press(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .at(-1)!
            .querySelector<HTMLElement>(
              "[data-profile-choice-scope=unresolved] [data-profile-choice]",
            ),
          "unresolved Profile choice",
        );
      },
      undefined,
    );
    const candidate = await selectSuggestion(
      run.vaultId,
      `articles/articles-${preprintItem.citationKey}.md`,
    );
    expect(candidate).toContain(run.m.modal_profile_match_batch_candidate());
    expect(candidate).not.toContain(run.m.modal_profile_match_candidate());
    expect(candidate).toContain(suite.articlesProfile.label);
    await obRun(
      run.vaultId,
      async (_context, { booksProfileLabel }) => {
        var input = Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".prompt"),
        )
          .at(-1)!
          .querySelector<HTMLInputElement>("input");
        input!.value = booksProfileLabel;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { booksProfileLabel: booksProfile.label },
    );
    await selectSuggestion(run.vaultId, preprintPath);
    await pressPromptKey(run.vaultId, "Enter");
    await obRunUntil(
      run.vaultId,
      async (_context, { unresolvedDestinationLabel }) => {
        return (
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .at(-1)
            ?.querySelector<HTMLElement>(
              "[data-profile-choice-scope=unresolved] [data-profile-choice]",
            )
            ?.getAttribute("aria-label") === unresolvedDestinationLabel
        );
      },
      {
        unresolvedDestinationLabel: run.m.batch_profile_unresolved_destination({
          count: 2,
          label: booksProfile.label,
        }),
      },
      {
        what: "the unresolved Profile choice in the topmost modal to show its label",
      },
    );
    const chosen = await obRun(
      run.vaultId,
      async (_context) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal"),
        ).at(-1)!.textContent;
      },
      undefined,
    );
    for (const text of [
      bookPath,
      articlesPath,
      preprintPath,
      labPath,
      run.m.profile_match_selected({ profile: booksProfile.label }),
      run.m.profile_match_selected({ profile: suite.articlesProfile.label }),
      run.m.batch_profile_source_chosen(),
    ])
      expect(chosen).toContain(text);
    await using notices = await observeNotices(run.vaultId);
    expect(
      await clickModalButton(run.vaultId, run.m.batch_update_confirm_button()),
    ).toBe(true);
    await obRunUntil(
      run.vaultId,
      async (_context, { closeButtonText }) => {
        return Array.from(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .at(-1)
            ?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).some((button) => button.textContent.trim() === closeButtonText);
      },
      { closeButtonText: run.m.batch_update_close() },
      { what: "the close button in the topmost modal to appear" },
    );
    const summary = await obRun(
      run.vaultId,
      async (_context) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal"),
        ).at(-1)!.textContent;
      },
      undefined,
    );
    for (const text of [
      run.m.batch_profile_created({ count: 3, label: booksProfile.label }),
      run.m.batch_profile_created({
        count: booksProfileTargetExists ? 1 : 2,
        label: suite.articlesProfile.label,
      }),
      ...(booksProfileTargetExists
        ? [run.m.batch_profile_updated({ count: 1, label: booksProfile.label })]
        : []),
      run.m.batch_profile_updated({
        count: 1,
        label: run.m.settings_profile_default_name(),
      }),
    ]) {
      expect(summary).toContain(text);
      expect((await notices.read()).join("\n")).toContain(text);
    }
    expect(
      await clickModalButton(run.vaultId, run.m.batch_update_close()),
    ).toBe(true);
    for (const [item, path, label, id] of [
      [bookItem, bookPath, booksProfile.label, booksProfile.id],
      [preprintItem, preprintPath, booksProfile.label, booksProfile.id],
      [labItem, labPath, booksProfile.label, booksProfile.id],
      [
        sharedItem,
        articlesPath,
        suite.articlesProfile.label,
        suite.articlesProfile.id,
      ],
    ] as const) {
      const content = await readFile(join(e2eVaultPath, path), "utf-8");
      expect(content).toContain(`zotlit-profile: ${label} (${id})`);
      const note = await indexedNote(run.vaultId, item.itemID);
      expect(await hasOneIndexedNote(run.vaultId, note.indexedKey)).toBe(true);
      await cli([`vault=${run.vaultId}`, "delete", `path=${path}`]);
      expect(await hasIndexedNotes(run.vaultId, note.indexedKey, 0)).toBe(true);
    }
    await cli([
      `vault=${run.vaultId}`,
      "delete",
      `path=templates/${suite.articlesProfile.document}`,
    ]);
    await obRunUntil(
      run.vaultId,
      async ({ zotlit }, { articlesProfileId }) => {
        return !zotlit.services.profile.profiles.some(
          (p) => p.id === articlesProfileId,
        );
      },
      { articlesProfileId: suite.articlesProfile.id },
      { what: "the articles Profile to be removed from the Profile list" },
    );
    await suite.writeMatch(booksProfile, suite.bookMatch);
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
    await cli([`vault=${run.vaultId}`, "delete", `path=${seededPath}`]);
    expect(await hasIndexedNotes(run.vaultId, childItem.key, 0)).toBe(true);
    await suite.writeMatch(
      booksProfile,
      `collections.within(${JSON.stringify(parent.name)})`,
    );
    await suite.quickSwitchCreate(childItem);
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
    await cli([`vault=${run.vaultId}`, "delete", `path=${notePath}`]);
    expect(await hasIndexedNotes(run.vaultId, childItem.key, 0)).toBe(true);
    await suite.openMatchEditor();
    expect(
      await suite.conditionReady({
        kind: "collection",
        operator: "within",
        value: parent.name,
      }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async ({ page }, { filterOperator }) => {
        const { pick } = page;
        var editor = page.workbench()!.contentEl;
        await pick(
          editor.querySelector<HTMLSelectElement>(
            `[data-condition-row] select[aria-label=${JSON.stringify(
              filterOperator,
            )}]`,
          ),
          "contains",
          "Operator",
        );
      },
      { filterOperator: run.m.workbench_filter_operator() },
    );
    expect(
      await suite.conditionReady({
        kind: "collection",
        operator: "contains",
        value: parent.name,
      }),
    ).toBe(true);
    await suite.saveMatch({
      and: [`collections.contains(${JSON.stringify(parent.name)})`],
    });
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
      },
      undefined,
    );
    await suite.quickSwitchCreate(childItem);
    const fallback = await selectSuggestion(
      run.vaultId,
      run.m.modal_profile_preselected(),
    );
    expect(fallback).toContain(run.m.settings_profile_default_name());
    expect(fallback).toContain(`literatures/${childItem.citationKey}.md`);
    await pressPromptKey(run.vaultId, "Escape");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return !activeDocument.querySelector<HTMLElement>(".prompt");
      },
      undefined,
      {
        what: "the suggestion prompt to close after the Collection path match",
      },
    );
    expect(await hasIndexedNotes(run.vaultId, childItem.key, 0)).toBe(true);
    await suite.writeMatch(booksProfile, suite.bookMatch);
  });

  it("deletes Books into Default and applies Default on the next update", async () => {
    const profilePath = `templates/${booksProfile.document}`;
    const profileSource = await readFile(
      join(e2eVaultPath, profilePath),
      "utf-8",
    );
    const exterior = "My discussion stays outside the managed region.";
    await obRun(
      run.vaultId,
      async ({ app }, { booksNotePath, appendedContent }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        app.vault.setConfig("trashOption", "local");
        var file = app.vault.getFileByPath(booksNotePath)!;
        await app.vault.append(file, appendedContent);
      },
      { booksNotePath: run.booksNotePath, appendedContent: `\n${exterior}\n` },
    );
    await openProfilesSettings(run.vaultId, "settings_page_profiles");
    const profileNoteCount = await obRun(
      run.vaultId,
      async ({ app }, { profileLabelPrefix }) => {
        return app.vault
          .getMarkdownFiles()
          .filter((file) =>
            String(
              app.metadataCache.getFileCache(file)?.frontmatter?.[
                "zotlit-profile"
              ] ?? "",
            ).startsWith(profileLabelPrefix),
          ).length;
      },
      { profileLabelPrefix: `${booksProfile.label} (` },
    );
    expect(profileNoteCount).toBeGreaterThan(0);
    const beforeMove = await readFile(
      join(e2eVaultPath, run.booksNotePath),
      "utf-8",
    );
    // Profile management lives in the row's More actions menu.
    await obRunUntil(
      run.vaultId,
      async ({ app, page }, { booksProfileLabel, moreActionsLabel }) => {
        const { press } = page;
        var settings = app.setting.containerEl;
        var row = Array.from(
          settings.querySelectorAll<HTMLElement>(".setting-item"),
        ).find(
          (row) =>
            row.querySelector<HTMLElement>(".setting-item-name")
              ?.textContent === booksProfileLabel,
        );
        var button =
          row &&
          (Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => button!.getAttribute("aria-label") === moreActionsLabel,
          ) ??
            row.querySelector<HTMLElement>(".extra-setting-button"));
        if (!button) return false;
        press(button, "More actions");
        return true;
      },
      {
        booksProfileLabel: booksProfile.label,
        moreActionsLabel: run.m.workbench_more_actions(),
      },
      {
        what: "the Books Profile row's More actions button to be found and pressed",
      },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app, page }, { deleteTitleText }) => {
        const { press } = page;
        var doc = app.setting.containerEl.ownerDocument;
        var title = Array.from(
          doc.querySelectorAll<HTMLElement>(".menu-item-title"),
        ).find((title) => title.textContent.trim() === deleteTitleText);
        var item = title?.closest<HTMLElement>(".menu-item");
        if (!item) return false;
        press(item, "Delete");
        return true;
      },
      { deleteTitleText: run.m.settings_profile_delete() },
      { what: "the Delete entry in the open More actions menu to be pressed" },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return !!app.setting.containerEl.ownerDocument.querySelector<HTMLInputElement>(
          'input[name="zotlit-delete-profile-target"]:checked',
        );
      },
      undefined,
      {
        what: "a delete-target radio button to be checked in the delete Profile dialog",
      },
    );
    const target = await obRun(
      run.vaultId,
      async ({ app }) => {
        return app.setting.containerEl.ownerDocument
          .querySelector<HTMLInputElement>(
            'input[name="zotlit-delete-profile-target"]:checked',
          )!
          .closest("label")!.textContent;
      },
      undefined,
    );
    const movedPath = `literatures/${run.booksNotePath.slice(run.booksNotePath.lastIndexOf("/") + 1)}`;
    expect(target).toContain(run.m.settings_profile_default_name());
    expect(target).toContain(movedPath);
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { moveFilesLabel }) => {
          const { press } = page;
          var doc = app.setting.containerEl.ownerDocument;
          var label = Array.from(
            doc.querySelectorAll<HTMLElement>(".modal label"),
          ).find((label) => label.textContent === moveFilesLabel);
          var checkbox = label?.querySelector<HTMLInputElement>(
            "input[type=checkbox]",
          );
          if (!checkbox || checkbox.checked) return false;
          press(label!, "Move files");
          return checkbox.checked;
        },
        {
          moveFilesLabel: run.m.settings_profile_delete_move_files({
            folder: "literatures/",
          }),
        },
      ),
    ).toBe(true);
    const deletionDialog = await obRun(
      run.vaultId,
      async ({ app }) => {
        return Array.from(
          app.setting.containerEl.ownerDocument.querySelectorAll<HTMLElement>(
            ".modal",
          ),
        ).at(-1)!.textContent;
      },
      undefined,
    );
    expect(deletionDialog).toContain(
      run.m.settings_profile_delete_literature_count({
        count: profileNoteCount,
      }),
    );
    expect(deletionDialog).toContain(
      run.m.settings_profile_delete_imported_count({ count: 0 }),
    );
    expect(deletionDialog).toContain(
      run.m.settings_profile_delete_move_confirm({ count: profileNoteCount }),
    );
    expect(
      await clickModalButton(
        run.vaultId,
        run.m.settings_profile_delete_move_confirm({ count: profileNoteCount }),
        "settings",
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
      await readFile(join(e2eVaultPath, run.booksNotePath), "utf-8").catch(
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
    await obRun(
      run.vaultId,
      async ({ app }, { movedPath }) => {
        app.setting.close();
        var file = app.vault.getFileByPath(movedPath)!;
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.title = "Not the Zotero title";
        });
        await app.workspace.getLeaf(false).openFile(file);
      },
      { movedPath },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return app.commands.executeCommandById("zotlit:update-note");
      },
      undefined,
      { what: "the zotlit update-note command to run and report success" },
    );
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
    expect(managedRegion(updated)).toBe(
      [
        "%%zt-managed%%",
        "## Annotations",
        "",
        "```zotquery",
        "views:",
        "  - type: annotations",
        "    name: Annotations",
        "    from: annotations",
        "    filters: item == this.item",
        "    sort:",
        "      - property: attachment.dateAdded",
        "        direction: ASC",
        "      - property: sortIndex",
        "        direction: ASC",
        "```",
        "",
        "%%/zt-managed%%",
      ].join("\n"),
    );
    expect(noteBody(updated).replace(managedRegion(updated), "")).toBe(
      noteBody(afterMove).replace(managedRegion(afterMove), ""),
    );
    expect(updated).toContain(exterior);

    await obRunUntil(
      run.vaultId,
      async ({ zotlit }, { booksProfileId }) => {
        return !zotlit.services.profile.profiles.some(
          (p) => p.id === booksProfileId,
        );
      },
      { booksProfileId: booksProfile.id },
      {
        what: "the Books Profile to drop out of the Profile list after delete",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
      },
      undefined,
    );
  });

  it.skipIf(webWorkbenchEnabled)(
    "keeps desktop editing and Live Update available while web integration is off",
    async () => {
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(async () => {
        await obRun(
          run.vaultId,
          async ({ app }) => {
            app.setting.close();
          },
          undefined,
        );
      });
      await obRun(
        run.vaultId,
        async ({ app, zotlit }) => {
          app.saveLocalStorage("zotlit-workbench-launch-approved", "1");
          app.saveLocalStorage("zotlit-profile-customization", "web");
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update({
              "server.enabled": true,
              "server.live-update": true,
              "server.workbench": true,
            }),
          );
        },
        undefined,
      );
      await obRunUntil(
        run.vaultId,
        async ({ zotlit }) => {
          return (
            zotlit.services.bridge.runSync(
              zotlit.services.localServer.effectivePort,
            ) !== null
          );
        },
        undefined,
        { what: "the local server port to resolve through the bridge" },
      );
      const server = (await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          var services = zotlit.services;
          var settings = services.bridge.runSync(services.settings.current);
          return {
            port: services.bridge.runSync(services.localServer.effectivePort),
            sourceId: services.zoteroPref.sourceId,
            workbench: settings["server.workbench"],
          };
        },
        undefined,
      )) as { port: number; sourceId: string; workbench: boolean };
      expect(server.workbench).toBe(true);
      const headers = {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: server.sourceId,
      };
      const [bridge, liveUpdate] = await Promise.all([
        fetch(`http://127.0.0.1:${server.port}/v1/profile/selected`, {
          headers: { ...headers, Origin: "https://zotlit.aidenlx.site" },
        }),
        fetch(`http://127.0.0.1:${server.port}/literature-notes`, { headers }),
      ]);
      expect(bridge.status).toBe(403);
      expect(await bridge.json()).toMatchObject({
        error: { code: "bridge-disabled" },
      });
      expect(liveUpdate.status).toBe(200);

      await openProfilesSettings(run.vaultId, "settings_page_advanced");
      expect(
        await obRun(
          run.vaultId,
          async (
            { app },
            {
              localServerSettingName,
              workbenchSettingName,
              templateSettingName,
            },
          ) => {
            var names = Array.from(
              app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item-name",
              ),
              (el) => el.textContent,
            );
            return (
              names.includes(localServerSettingName) &&
              !names.includes(workbenchSettingName) &&
              !names.includes(templateSettingName) &&
              !app.commands.commands["zotlit:open-profile-web-workbench"]
            );
          },
          {
            localServerSettingName: run.m.settings_local_server_enabled_name(),
            workbenchSettingName: run.m.settings_local_server_workbench_name(),
            templateSettingName: run.m.template_workbench_preference_name(),
          },
        ),
      ).toBe(true);

      // Live updates answer the Companion, so their switch sits on the Zotero
      // page beside it rather than with the server that carries them.
      await openProfilesSettings(run.vaultId, "settings_page_zotero");
      expect(
        await obRun(
          run.vaultId,
          async ({ app }, { liveUpdatesSettingName, advancedHeadingText }) => {
            var names = Array.from(
              app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item-name",
              ),
              (el) => el.textContent,
            );
            return (
              names.includes(liveUpdatesSettingName) &&
              names.includes(advancedHeadingText)
            );
          },
          {
            liveUpdatesSettingName: run.m.settings_live_updates_enabled_name(),
            advancedHeadingText: run.m.settings_advanced_local_server_heading(),
          },
        ),
      ).toBe(true);

      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      await obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return (
            app.workspace.activeLeaf?.view.getViewType() ===
              "zotlit-template-workbench" &&
            !document.querySelector<HTMLInputElement>(
              'input[name="zotlit-customize-destination"]',
            )
          );
        },
        undefined,
        {
          what: "the Template Workbench to be the active leaf with no destination radio",
        },
      );
      await obRun(
        run.vaultId,
        async ({ app, zotlit }) => {
          app.saveLocalStorage("zotlit-workbench-launch-approved", null);
          app.saveLocalStorage("zotlit-profile-customization", "ask");
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update({ "server.workbench": false }),
          );
        },
        undefined,
      );
    },
  );
});
