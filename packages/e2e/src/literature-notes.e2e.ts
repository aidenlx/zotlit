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

  it("sets Citation Presentation and dismisses pending changes on cancel and unload (#1858)", async () => {
    const result = await obRun(
      run.vaultId,
      async ({ app, page }, { title, confirmLabel, cancelLabel }) => {
        const { until, press } = page;
        await using cleanup = new AsyncDisposableStack();
        const file = app.vault.getFileByPath("citation-only-test.md")!;
        const original = await app.vault.read(file);
        cleanup.defer(() => app.vault.modify(file, original));
        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
          leaf.detach(),
        );
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const view = leaf.view as import("obsidian").MarkdownView;
        const doc = view.containerEl.ownerDocument;
        const dialog = () =>
          [...doc.querySelectorAll<HTMLElement>(".modal")].find(
            (el) =>
              el.querySelector<HTMLElement>(".modal-title")?.textContent ===
              title,
          );
        cleanup.defer(() =>
          dialog()
            ?.parentElement?.querySelector<HTMLElement>(".modal-bg")
            ?.click(),
        );
        const open = async () => {
          app.commands.executeCommandById("zotlit:set-citation-presentation");
          return await until("Citation Presentation dialog", dialog);
        };
        const language = (modal: HTMLElement) =>
          modal.querySelector<HTMLInputElement>("input[type=text]")!;
        const button = (modal: HTMLElement, label: string) =>
          [...modal.querySelectorAll<HTMLButtonElement>("button")].find(
            (el) => el.textContent === label,
          );
        const setLanguage = (modal: HTMLElement, value: string) => {
          const input = language(modal);
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        let modal = await open();
        setLanguage(modal, "de-DE");
        press(button(modal, confirmLabel), "Confirm");
        await until(
          "language written",
          () =>
            app.metadataCache.getFileCache(file)?.frontmatter?.lang === "de-DE",
        );
        const confirmed = view.getViewData();
        modal = await open();
        const reopened = language(modal).value;
        setLanguage(modal, "fr-FR");
        press(button(modal, cancelLabel), "Cancel");
        const cancelled = view.getViewData() === confirmed;
        modal = await open();
        setLanguage(modal, "fr-FR");
        cleanup.defer(() => app.plugins.enablePlugin("zotlit"));
        await app.plugins.disablePlugin("zotlit");
        await until("dialog closes after unload", () => !dialog(), 10000);
        const closed = !dialog();
        const unchanged = view.getViewData() === confirmed;
        return { reopened, cancelled, closed, unchanged };
      },
      {
        title: run.m.citation_presentation_title(),
        confirmLabel: run.m.citation_presentation_confirm(),
        cancelLabel: run.m.modal_cancel(),
      },
    );
    expect(result).toEqual({
      reopened: "de-DE",
      cancelled: true,
      closed: true,
      unchanged: true,
    });
  });

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
        return String(true);
      },
      undefined,
    );
    expect(
      await obRun(
        freshId,
        async ({ zotlit }) => {
          return String(
            String(
              zotlit.services.bridge.runSync(
                zotlit.services.profileService.profiles,
              ).length,
            ),
          );
        },
        undefined,
      ),
    ).toBe("0");
    // A default Profile that lists the Annotations in the note puts one
    // callout for each of them in the body, where the customized callout
    // must arrive.
    await useListingProfile(freshId);
    await suite.quickSwitchCreate(annotatedItem, freshId);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app, zotlit }) => {
            return String(
              String(
                !!app.workspace.getActiveFile() &&
                  zotlit.services.bridge.runSync(
                    zotlit.services.noteIndex.getNotesByItemKey("RUGIER24"),
                  ).length === 1,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:100",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const note = await indexedNote(freshId, annotatedItem.itemID);
    expect(note.path).not.toBeNull();
    const personal = "\nMy own research question stays here.\n";
    // Customize is offered only on a note whose metadata cache names a paper.
    // Obsidian drops a note's cache when a write lands and restores it once
    // the worker has parsed the new content, so the command waits for that
    // `changed` event rather than racing the parse.
    await obRun(
      freshId,
      async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        const file = app.vault.getFileByPath(__typedArg0)!;
        const indexed = new Promise<void>((resolve) => {
          const ref = app.metadataCache.on("changed", (changed, data) => {
            if (changed !== file || !data.includes(__typedArg1)) return;
            app.metadataCache.offref(ref);
            resolve();
          });
        });
        await app.vault.append(file, __typedArg2);
        await indexed;
        await app.workspace.getLeaf(false).openFile(file);
        return String(true);
      },
      { __typedArg0: note.path!, __typedArg1: personal, __typedArg2: personal },
    );
    const before = await readFile(join(freshPath, note.path!), "utf-8");
    expect(before.split("[!note]").length - 1).toBe(annotationKeys.length);
    expect(
      await obRun(
        freshId,
        async ({ app }) => {
          return String(
            app.commands.executeCommandById("zotlit:customize-note-template"),
          );
        },
        undefined,
      ),
    ).toBe("true");

    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0 }) => {
            return String(
              String(
                !!(function () {
                  var leaves = app.workspace.getLeavesOfType(
                    "zotlit-template-workbench",
                  ) as (import("obsidian").WorkspaceLeaf & {
                    view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                  })[];
                  return (
                    leaves.find(
                      (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                    ) ?? leaves[0]
                  )?.view;
                })()?.file,
              ),
            );
          },
          { __typedArg0: note.path! },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:127",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
        tries: 80,
      }),
    ).toBe(true);
    // The Default document already exists, so the workbench shows its file
    // before Customize sets the note it came from.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            return String(
              String(
                view.contentEl.textContent.includes(__typedArg1) &&
                  view.store.getState().item?.id === "RUGIER24",
              ),
            );
          },
          {
            __typedArg0: note.path!,
            __typedArg1: run.m.template_workbench_shared_template({
              name: run.m.settings_profile_default_name(),
            }),
          },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:135",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await changeNativeAnnotationCallout(freshId, {
      view: { originatingNote: note.path! },
      vaultPath: freshPath,
      tabLabel: run.m.workbench_tab_annotation(),
      beforeEdit: async () => {
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              freshId,
              async ({ app }, { __typedArg0, __typedArg1 }) => {
                const view = (function () {
                  var leaves = app.workspace.getLeavesOfType(
                    "zotlit-template-workbench",
                  ) as (import("obsidian").WorkspaceLeaf & {
                    view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                  })[];
                  return (
                    leaves.find(
                      (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                    ) ?? leaves[0]
                  )?.view;
                })()!;
                const help = view.contentEl.querySelector<HTMLElement>(
                  `button[aria-label=${JSON.stringify(__typedArg1)}]`,
                );
                if (!help) return String(false);
                view.leaf.getContainer().focus();
                help!.focus();
                return String(
                  String(
                    help === view.contentEl.ownerDocument.activeElement &&
                      help!.getAttribute("aria-expanded") === "false",
                  ),
                );
              },
              { __typedArg0: note.path!, __typedArg1: run.m.workbench_help() },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "literature.ts:147",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
        await obRun(
          freshId,
          async ({ app, page }, { __typedArg0, __typedArg1 }) => {
            const { press } = page;
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            press(
              view.contentEl.querySelector<HTMLElement>(
                `button[aria-label=${JSON.stringify(__typedArg1)}]`,
              ),
              "Help",
            );
            return String(true);
          },
          { __typedArg0: note.path!, __typedArg1: run.m.workbench_help() },
        );
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              freshId,
              async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
                const view = (function () {
                  var leaves = app.workspace.getLeavesOfType(
                    "zotlit-template-workbench",
                  ) as (import("obsidian").WorkspaceLeaf & {
                    view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                  })[];
                  return (
                    leaves.find(
                      (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                    ) ?? leaves[0]
                  )?.view;
                })()!;
                const guide = view.contentEl.querySelector<HTMLElement>(
                  `section[aria-label=${JSON.stringify(__typedArg1)}]`,
                );
                const source = Array.from(
                  view.contentEl.querySelectorAll<CodeMirrorElement>(
                    ".cm-content",
                  ),
                ).find((element) => element.textContent.includes("[!note]"));
                return String(
                  String(
                    !!guide &&
                      guide.textContent.includes("[!quote]") &&
                      guide.textContent.includes(__typedArg2) &&
                      guide!.getBoundingClientRect().height > 0 &&
                      source!.getBoundingClientRect().height > 0,
                  ),
                );
              },
              {
                __typedArg0: note.path!,
                __typedArg1: run.m.workbench_annotation_help_title(),
                __typedArg2: run.m.template_workbench_update_this_note(),
              },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "literature.ts:158",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
        await obRun(
          freshId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const guide = view.contentEl.querySelector<HTMLElement>(
              `section[aria-label=${JSON.stringify(__typedArg1)}]`,
            );
            guide!.focus();
            guide!.dispatchEvent(
              new view.contentEl.ownerDocument.defaultView!.KeyboardEvent(
                "keydown",
                { key: "Escape", bubbles: true },
              ),
            );
            return String(true);
          },
          {
            __typedArg0: note.path!,
            __typedArg1: run.m.workbench_annotation_help_title(),
          },
        );
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              freshId,
              async ({ app }, { __typedArg0, __typedArg1 }) => {
                const view = (function () {
                  var leaves = app.workspace.getLeavesOfType(
                    "zotlit-template-workbench",
                  ) as (import("obsidian").WorkspaceLeaf & {
                    view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                  })[];
                  return (
                    leaves.find(
                      (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                    ) ?? leaves[0]
                  )?.view;
                })()!;
                const help = view.contentEl.querySelector<HTMLElement>(
                  `button[aria-label=${JSON.stringify(__typedArg1)}]`,
                );
                return String(
                  String(
                    help!.getAttribute("aria-expanded") === "false" &&
                      help === view.contentEl.ownerDocument.activeElement &&
                      Array.from(
                        view.contentEl.querySelectorAll<CodeMirrorElement>(
                          ".cm-content",
                        ),
                      ).some((element) =>
                        element.textContent.includes("[!note]"),
                      ),
                  ),
                );
              },
              { __typedArg0: note.path!, __typedArg1: run.m.workbench_help() },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "literature.ts:169",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
      },
    });
    // The linked Preview belongs to the editor's native window, which can differ from the CLI window.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0 }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            return String(
              String(
                !!view.contentEl.ownerDocument.querySelector<HTMLElement>(
                  '.callout[data-callout="quote"]',
                ),
              ),
            );
          },
          { __typedArg0: note.path! },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:179",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(await readFile(join(freshPath, note.path!), "utf-8")).toBe(before);
    const other = await createFixtureNote(freshId, createTargetItem.itemID);
    expect(other.outcome).toBe("created");
    if (other.outcome !== "created")
      throw new Error("Second note was not created");
    const otherBefore = await readFile(join(freshPath, other.path), "utf-8");
    await obRun(
      freshId,
      async ({ app }, { __typedArg0 }) => {
        await app.workspace
          .getLeaf("tab")
          .openFile(app.vault.getFileByPath(__typedArg0)!);
        app.workspace.rootSplit.focus();
        return String(true);
      },
      { __typedArg0: other.path },
    );
    await obRun(
      freshId,
      async ({ app }, { __typedArg0 }) => {
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === __typedArg0,
            ) ?? leaves[0]
          )?.view;
        })()!;
        await app.workspace.revealLeaf(view.leaf);
        view.contentEl.ownerDocument.defaultView!.focus();
        app.workspace.setActiveLeaf(view.leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: note.path! },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0 }) => {
            return String(
              String(
                activeWindow ===
                  (function () {
                    var leaves = app.workspace.getLeavesOfType(
                      "zotlit-template-workbench",
                    ) as (import("obsidian").WorkspaceLeaf & {
                      view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                    })[];
                    return (
                      leaves.find(
                        (leaf) =>
                          leaf.view.originatingNote?.path === __typedArg0,
                      ) ?? leaves[0]
                    )?.view;
                  })()!.contentEl.ownerDocument.defaultView,
              ),
            );
          },
          { __typedArg0: note.path! },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:200",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            const button = Array.from(
              view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
            ).find((button) => button.innerText.trim() === __typedArg1);
            button!.focus();
            return String(
              String(
                view.contentEl.ownerDocument.activeElement === button &&
                  !button.disabled,
              ),
            );
          },
          {
            __typedArg0: note.path!,
            __typedArg1: run.m.template_workbench_update_this_note(),
          },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:207",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    // The first click after an edit writes the Managed Frontmatter with the
    // body: a managed Property removed now comes back with this one update.
    await obRun(
      freshId,
      async ({ app }, { __typedArg0 }) => {
        await app.fileManager.processFrontMatter(
          app.vault.getFileByPath(__typedArg0)!,
          (fm) => {
            delete fm.collections;
          },
        );
        return String(true);
      },
      { __typedArg0: note.path! },
    );
    await obRun(
      freshId,
      async ({ app, page }, { __typedArg0, __typedArg1 }) => {
        const { press } = page;
        const view = (function () {
          var leaves = app.workspace.getLeavesOfType(
            "zotlit-template-workbench",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
          })[];
          return (
            leaves.find(
              (leaf) => leaf.view.originatingNote?.path === __typedArg0,
            ) ?? leaves[0]
          )?.view;
        })()!;
        press(
          Array.from(
            view.contentEl.querySelectorAll<HTMLButtonElement>("button"),
          ).find((button) => button.innerText.trim() === __typedArg1),
          "Update this note",
        );
        return String(true);
      },
      {
        __typedArg0: note.path!,
        __typedArg1: run.m.template_workbench_update_this_note(),
      },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0 }) => {
            return String(
              String(
                !(function () {
                  var leaves = app.workspace.getLeavesOfType(
                    "zotlit-template-workbench",
                  ) as (import("obsidian").WorkspaceLeaf & {
                    view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
                  })[];
                  return (
                    leaves.find(
                      (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                    ) ?? leaves[0]
                  )?.view;
                })()!.updatingNote,
              ),
            );
          },
          { __typedArg0: note.path! },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:224",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
      }),
    ).toBe(true);
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
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          freshId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            const view = (function () {
              var leaves = app.workspace.getLeavesOfType(
                "zotlit-template-workbench",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
              })[];
              return (
                leaves.find(
                  (leaf) => leaf.view.originatingNote?.path === __typedArg0,
                ) ?? leaves[0]
              )?.view;
            })()!;
            return String(
              String(
                [view.contentEl.ownerDocument, document].some((doc) =>
                  Array.from(doc.querySelectorAll<HTMLElement>(".notice")).some(
                    (notice) => notice.textContent.includes(__typedArg1),
                  ),
                ),
              ),
            );
          },
          { __typedArg0: note.path!, __typedArg1: updated },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:253",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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

    const removedFromIndex = await ((options: {
      expected: string;
      tries?: number;
    }) =>
      obRunUntil(
        run.vaultId,
        async ({ zotlit }, { __typedArg0 }) => {
          return String(
            String(
              zotlit.services.bridge.runSync(
                zotlit.services.noteIndex.getNotesByItemKey(__typedArg0),
              ).length,
            ),
          );
        },
        { __typedArg0: createTargetItem.key },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "literature.ts:280",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "0" });
    expect(removedFromIndex).toBe(true);

    const first = await createFixtureNote(run.vaultId, createTargetItem.itemID);
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") {
      throw new Error("The first create did not create a Literature Note");
    }

    const indexed = await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ zotlit }, { __typedArg0 }) => {
          return String(
            String(
              zotlit.services.bridge.runSync(
                zotlit.services.noteIndex.getNotesByItemKey(__typedArg0),
              ).length,
            ),
          );
        },
        { __typedArg0: createTargetItem.key },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "literature.ts:293",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "1" });
    expect(indexed).toBe(true);

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

    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              String(
                zotlit.services.bridge.runSync(
                  zotlit.services.profileService.resolveProfile("default"),
                )?.document === undefined,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:323",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    // Set the Item's seeded notes aside, so the default Profile writes a new
    // one; the cleanup puts them back.
    await using cleanup = new AsyncDisposableStack();
    const seeded = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { __typedArg0 }) => {
          await zotlit.services.bridge.runPromise(
            zotlit.services.noteIndex.whenIndexed,
          );
          const notes = [];
          for (const note of zotlit.services.bridge.runSync(
            zotlit.services.noteIndex.getNotesByItemKey(__typedArg0),
          )) {
            const file = app.vault.getFileByPath(note.path)!;
            notes.push({ path: note.path, text: await app.vault.read(file) });
            await app.vault.delete(file);
          }
          return String(JSON.stringify(notes));
        },
        { __typedArg0: item.key },
      ),
    ) as { path: string; text: string }[];
    let created = "";
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          const created = app.vault.getFileByPath(__typedArg0)!;
          if (created) await app.vault.delete(created);
          for (const { path, text } of __typedArg1)
            await app.vault.create(path, text);
          return String(true);
        },
        { __typedArg0: created, __typedArg1: seeded },
      );
    });
    expect(await hasIndexedNotes(run.vaultId, item.key, 0)).toBe(true);
    const markdownFiles = () =>
      obRun(
        run.vaultId,
        async ({ app }) => {
          return String(String(app.vault.getMarkdownFiles().length));
        },
        undefined,
      );
    const filesBefore = await markdownFiles();
    const importedNotes = () =>
      obRun(
        run.vaultId,
        async ({ zotlit }, { __typedArg0 }) => {
          return String(
            String(
              zotlit.services.bridge.runSync(
                zotlit.services.noteIndex.getImportedNoteByNoteKey(__typedArg0),
              ).length,
            ),
          );
        },
        { __typedArg0: childNoteKey },
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
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        await app.vault.append(
          app.vault.getFileByPath(__typedArg0)!,
          __typedArg1,
        );
        return String(true);
      },
      { __typedArg0: created, __typedArg1: personal },
    );
    const before = await readFile(join(e2eVaultPath, created), "utf-8");
    const update = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { __typedArg0, __typedArg1 }) => {
          const result = await zotlit.services.noteFeature.updateNote(
            app.vault.getFileByPath(__typedArg0)!,
            { indexedKey: __typedArg1, scope: "full" },
          );
          return String(
            JSON.stringify({
              bodyUpdated: result.bodyUpdated,
              diagnostic: result.diagnostic ?? null,
            }),
          );
        },
        { __typedArg0: created, __typedArg1: item.key },
      ),
    ) as { bodyUpdated: boolean; diagnostic: unknown };
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
      async ({ app, zotlit }, { __typedArg0 }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.update({
            "citation.pandoc-citations": true,
            "citation.open-as-links": true,
          }),
        );
        var file = await app.vault.create(
          "Profile flow source.md",
          __typedArg0,
        );
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setCursor({
          line: 0,
          ch: 5,
        });
        return String(true);
      },
      { __typedArg0: `[@${booksProfileTargetItem.citationKey}]\n` },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              app.commands.executeCommandById("zotlit:open-citekey"),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:406",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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
      async (_context, { __typedArg0 }) => {
        var input =
          activeDocument.querySelector<HTMLInputElement>(".prompt input");
        input!.value = __typedArg0;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: booksProfile.label },
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
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.metadataCache.getFileCache(
            app.vault.getFileByPath(__typedArg0)!,
          )!.frontmatter!["zotero-key"],
        );
      },
      { __typedArg0: run.booksNotePath },
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
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        var file = app.vault.getFileByPath(__typedArg0)!;
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setValue(
          __typedArg1,
        );
        return String(app.commands.executeCommandById("zotlit:update-note"));
      },
      { __typedArg0: run.booksNotePath, __typedArg1: edited },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ page }, { __typedArg0 }) => {
            return String(
              String(
                page
                  .windowDocuments()
                  .some((doc) =>
                    Array.from(
                      doc.querySelectorAll<HTMLElement>(".notice"),
                    ).some((notice) =>
                      notice.textContent.includes(__typedArg0),
                    ),
                  ),
              ),
            );
          },
          { __typedArg0: run.m.notice_literature_note_profile_changed() },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:492",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            String(
              (
                app.workspace.getActiveFileView() as import("obsidian").MarkdownView
              )?.getViewData() === __typedArg0,
            ),
          );
        },
        { __typedArg0: edited },
      ),
    ).toBe("true");
    // Put the stamp back, so the scenarios below find the note as it was.
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        var view =
          app.workspace.getActiveFileView() as import("obsidian").MarkdownView;
        view.editor.setValue(__typedArg0);
        await view.save();
        return String(true);
      },
      { __typedArg0: original },
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

    const staleFieldSeeded = await ((options: {
      expected: string;
      tries?: number;
    }) =>
      obRunUntil(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          var file = app.vault.getFileByPath(__typedArg0)!;
          if (!file || file.extension !== "md") {
            return String("missing");
          }
          await app.fileManager.processFrontMatter(
            file,
            function (frontmatter) {
              frontmatter["fixture-obsolete"] = "stale";
              frontmatter["fixture-spread-title"] = "stale";
              frontmatter["fixture-spread-kind"] = "stale";
              frontmatter["fixture-manual"] = "mine";
            },
          );
          return String("seeded");
        },
        { __typedArg0: run.booksNotePath },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "literature.ts:529",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "seeded" });
    expect(staleFieldSeeded).toBe(true);
    // The batch reads each note's Profile stamp from the metadata cache, and
    // the write above sends the Books note back through the parser. Until the
    // cache holds the rewritten frontmatter, the note reads as unstamped.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }, { __typedArg0 }) => {
            return String(
              String(
                app.metadataCache.getFileCache(
                  app.vault.getFileByPath(__typedArg0)!,
                )?.frontmatter?.["fixture-manual"] === "mine",
              ),
            );
          },
          { __typedArg0: run.booksNotePath },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:539",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);

    await using notices = await observeNotices(run.vaultId);
    await using frames = await recordFrames(run.vaultId);
    const triggered = await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return String(
            app.commands.executeCommandById("zotlit:update-all-notes"),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "literature.ts:548",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true", tries: 20 });
    expect(triggered).toBe(true);

    // The Fixture's My Library carries more than one Literature Note, so
    // `runBatchUpdateAll` (apps/obsidian/src/services/note-feature/update-batch.ts)
    // takes its multi-item path: a confirmation `BatchModal`, not an
    // immediate write — the same modal a person clicking the command would
    // see. Confirming it is an ordinary user action, not a bypass; the modal
    // classifies items asynchronously, so this polls for the button first.
    expect(
      await clickModalButton(run.vaultId, run.m.batch_update_confirm_button()),
    ).toBe(true);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            return String(
              String(
                Array.from(
                  activeDocument.querySelectorAll<HTMLElement>(".modal button"),
                ).some((button) => button.textContent.trim() === __typedArg0),
              ),
            );
          },
          { __typedArg0: run.m.batch_update_close() },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:565",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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
        return String(
          activeDocument.querySelector<HTMLElement>(".modal")!.textContent,
        );
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
        async ({ app }, { __typedArg0 }) => {
          var file = app.vault.getFileByPath(__typedArg0)!;
          var frontmatter =
            file && app.metadataCache.getFileCache(file)?.frontmatter;
          return String(
            JSON.stringify({
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
            }),
          );
        },
        { __typedArg0: run.booksNotePath },
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
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            return String(
              String(
                Array.from(
                  app.setting.containerEl.querySelectorAll<HTMLElement>(
                    ".setting-item",
                  ),
                ).some(
                  (el) =>
                    el.querySelector<HTMLElement>(".setting-item-name")
                      ?.textContent === __typedArg0 &&
                    el
                      .querySelector<HTMLElement>(".setting-item-description")
                      ?.textContent?.includes(__typedArg1),
                ),
              ),
            );
          },
          { __typedArg0: booksProfile.label, __typedArg1: description },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:681",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
        return String(true);
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
          return String(
            String(!!activeDocument.querySelector<HTMLElement>(".prompt")),
          );
        },
        undefined,
      ),
    ).toBe("false");
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
      async ({ app, zotlit }, { __typedArg0 }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.update({
            "citation.pandoc-citations": true,
            "citation.open-as-links": true,
          }),
        );
        var file = await app.vault.create("Match flow source.md", __typedArg0);
        var leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source", source: true } });
        (leaf.view as import("obsidian").MarkdownView).editor.setCursor({
          line: 0,
          ch: 5,
        });
        return String(true);
      },
      { __typedArg0: `[@${bookItem.citationKey}]\n` },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              app.commands.executeCommandById("zotlit:open-citekey"),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:723",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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
          return String(
            String(!!activeDocument.querySelector<HTMLElement>(".prompt")),
          );
        },
        undefined,
      ),
    ).toBe("false");
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
          return String(true);
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
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            const view = app.workspace.activeLeaf!
              .view as import("../../../apps/obsidian/src/views/template-workbench/view.tsx").TemplateWorkbenchView;
            if (view.getState().itemIndexedKey !== __typedArg0)
              await view.setState(
                { ...view.getState(), itemIndexedKey: __typedArg1 },
                { history: false },
              );
            const result = view.contentEl.querySelector<HTMLElement>(
              '[data-part="result"]',
            );
            return String(
              result?.getAttribute("data-state") === "loading"
                ? "loading"
                : (result?.textContent ?? "loading"),
            );
          },
          { __typedArg0: key, __typedArg1: key },
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
        rows = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ page }) => {
              return String(
                JSON.stringify(
                  Array.from(
                    page
                      .workbench()
                      ?.contentEl?.querySelectorAll<HTMLElement>(
                        "[data-condition-row]",
                      ) ?? [],
                  ).map(
                    (row) =>
                      row.querySelector<HTMLElement>("[role=alert]")
                        ?.textContent ?? null,
                  ),
                ),
              );
            },
            undefined,
          ),
        ) as (string | null)[];
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
        marks = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ page }) => {
              return String(
                JSON.stringify(
                  Array.from(
                    page
                      .workbench()
                      ?.contentEl?.querySelectorAll<HTMLElement>(
                        "[data-condition-row]",
                      ) ?? [],
                  ).map((row) =>
                    Array.from(
                      row.querySelectorAll<HTMLElement>(".cm-lintRange-error"),
                    ).map((n) => n.textContent),
                  ),
                ),
              );
            },
            undefined,
          ),
        ) as string[][];
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
          return String(String(kept));
        },
        undefined,
      ),
    ).toBe("true");
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
    const server = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          var services = zotlit.services;
          var settings = services.bridge.runSync(services.settings.current);
          return String(
            JSON.stringify({
              hostname: settings["server.hostname"],
              port: services.bridge.runSync(services.localServer.effectivePort),
              sourceId: services.bridge.runSync(
                services.zoteroPrefService.current,
              ).sourceId,
            }),
          );
        },
        undefined,
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
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            return String(
              String(
                Array.from(
                  Array.from(
                    activeDocument.querySelectorAll<HTMLElement>(".modal"),
                  )
                    .at(-1)
                    ?.querySelectorAll<HTMLButtonElement>("button") ?? [],
                ).some((button) => button.textContent.trim() === __typedArg0),
              ),
            );
          },
          { __typedArg0: run.m.batch_update_confirm_button() },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:916",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const bookPath = `books/books-${bookItem.citationKey}.md`;
    const articlesPath = `articles/articles-${sharedItem.citationKey}.md`;
    const preprintPath = `books/books-${preprintItem.citationKey}.md`;
    const labPath = `books/books-${labItem.citationKey}.md`;
    const confirmation = await obRun(
      run.vaultId,
      async (_context) => {
        return String(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal")).at(
            -1,
          )!.textContent,
        );
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
            String(
              Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
                .at(-1)!
                .querySelectorAll<HTMLElement>(
                  `[data-profile-choice-scope=${scope}]`,
                ).length,
            ),
          { scope },
        ),
      ).toBe("1");
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
        return String(true);
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
      async (_context, { __typedArg0 }) => {
        var input = Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".prompt"),
        )
          .at(-1)!
          .querySelector<HTMLInputElement>("input");
        input!.value = __typedArg0;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: booksProfile.label },
    );
    await selectSuggestion(run.vaultId, preprintPath);
    await pressPromptKey(run.vaultId, "Enter");
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            return String(
              String(
                Array.from(
                  activeDocument.querySelectorAll<HTMLElement>(".modal"),
                )
                  .at(-1)
                  ?.querySelector<HTMLElement>(
                    "[data-profile-choice-scope=unresolved] [data-profile-choice]",
                  )
                  ?.getAttribute("aria-label") === __typedArg0,
              ),
            );
          },
          {
            __typedArg0: run.m.batch_profile_unresolved_destination({
              count: 2,
              label: booksProfile.label,
            }),
          },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:967",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const chosen = await obRun(
      run.vaultId,
      async (_context) => {
        return String(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal")).at(
            -1,
          )!.textContent,
        );
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
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            return String(
              String(
                Array.from(
                  Array.from(
                    activeDocument.querySelectorAll<HTMLElement>(".modal"),
                  )
                    .at(-1)
                    ?.querySelectorAll<HTMLButtonElement>("button") ?? [],
                ).some((button) => button.textContent.trim() === __typedArg0),
              ),
            );
          },
          { __typedArg0: run.m.batch_update_close() },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:992",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const summary = await obRun(
      run.vaultId,
      async (_context) => {
        return String(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal")).at(
            -1,
          )!.textContent,
        );
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
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }, { __typedArg0 }) => {
            return String(
              String(
                !zotlit.services.bridge
                  .runSync(zotlit.services.profileService.profiles)
                  .some((p) => p.id === __typedArg0),
              ),
            );
          },
          { __typedArg0: suite.articlesProfile.id },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1046",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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
      async ({ page }, { __typedArg0 }) => {
        const { pick } = page;
        var editor = page.workbench()!.contentEl;
        await pick(
          editor.querySelector<HTMLSelectElement>(
            `[data-condition-row] select[aria-label=${JSON.stringify(
              __typedArg0,
            )}]`,
          ),
          "contains",
          "Operator",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_filter_operator() },
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
        return String(true);
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
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context) => {
            return String(
              String(!activeDocument.querySelector<HTMLElement>(".prompt")),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1115",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
      }),
    ).toBe(true);
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
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        app.vault.setConfig("trashOption", "local");
        var file = app.vault.getFileByPath(__typedArg0)!;
        await app.vault.append(file, __typedArg1);
        return String(true);
      },
      { __typedArg0: run.booksNotePath, __typedArg1: `\n${exterior}\n` },
    );
    await openProfilesSettings(run.vaultId, "settings_page_profiles");
    const profileNoteCount = Number(
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            String(
              app.vault
                .getMarkdownFiles()
                .filter((file) =>
                  String(
                    app.metadataCache.getFileCache(file)?.frontmatter?.[
                      "zotlit-profile"
                    ] ?? "",
                  ).startsWith(__typedArg0),
                ).length,
            ),
          );
        },
        { __typedArg0: `${booksProfile.label} (` },
      ),
    );
    expect(profileNoteCount).toBeGreaterThan(0);
    const beforeMove = await readFile(
      join(e2eVaultPath, run.booksNotePath),
      "utf-8",
    );
    // Profile management lives in the row's More actions menu.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app, page }, { __typedArg0, __typedArg1 }) => {
            const { press } = page;
            var settings = app.setting.containerEl;
            var row = Array.from(
              settings.querySelectorAll<HTMLElement>(".setting-item"),
            ).find(
              (row) =>
                row.querySelector<HTMLElement>(".setting-item-name")
                  ?.textContent === __typedArg0,
            );
            var button =
              row &&
              (Array.from(
                row.querySelectorAll<HTMLButtonElement>("button"),
              ).find(
                (button) => button!.getAttribute("aria-label") === __typedArg1,
              ) ??
                row.querySelector<HTMLElement>(".extra-setting-button"));
            if (!button) return String(false);
            press(button, "More actions");
            return String(true);
          },
          {
            __typedArg0: booksProfile.label,
            __typedArg1: run.m.workbench_more_actions(),
          },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1152",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app, page }, { __typedArg0 }) => {
            const { press } = page;
            var doc = app.setting.containerEl.ownerDocument;
            var title = Array.from(
              doc.querySelectorAll<HTMLElement>(".menu-item-title"),
            ).find((title) => title.textContent.trim() === __typedArg0);
            var item = title?.closest<HTMLElement>(".menu-item");
            if (!item) return String(false);
            press(item, "Delete");
            return String(true);
          },
          { __typedArg0: run.m.settings_profile_delete() },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1159",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              String(
                !!app.setting.containerEl.ownerDocument.querySelector<HTMLInputElement>(
                  'input[name="zotlit-delete-profile-target"]:checked',
                ),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1166",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const target = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(
          app.setting.containerEl.ownerDocument
            .querySelector<HTMLInputElement>(
              'input[name="zotlit-delete-profile-target"]:checked',
            )!
            .closest("label")!.textContent,
        );
      },
      undefined,
    );
    const movedPath = `literatures/${run.booksNotePath.slice(run.booksNotePath.lastIndexOf("/") + 1)}`;
    expect(target).toContain(run.m.settings_profile_default_name());
    expect(target).toContain(movedPath);
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { __typedArg0 }) => {
          const { press } = page;
          var doc = app.setting.containerEl.ownerDocument;
          var label = Array.from(
            doc.querySelectorAll<HTMLElement>(".modal label"),
          ).find((label) => label.textContent === __typedArg0);
          var checkbox = label?.querySelector<HTMLInputElement>(
            "input[type=checkbox]",
          );
          if (!checkbox || checkbox.checked) return String(false);
          press(label!, "Move files");
          return String(checkbox.checked);
        },
        {
          __typedArg0: run.m.settings_profile_delete_move_files({
            folder: "literatures/",
          }),
        },
      ),
    ).toBe("true");
    const deletionDialog = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(
          Array.from(
            app.setting.containerEl.ownerDocument.querySelectorAll<HTMLElement>(
              ".modal",
            ),
          ).at(-1)!.textContent,
        );
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
      async ({ app }, { __typedArg0 }) => {
        app.setting.close();
        var file = app.vault.getFileByPath(__typedArg0)!;
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.title = "Not the Zotero title";
        });
        await app.workspace.getLeaf(false).openFile(file);
        return String(true);
      },
      { __typedArg0: movedPath },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              app.commands.executeCommandById("zotlit:update-note"),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1248",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
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

    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }, { __typedArg0 }) => {
            return String(
              String(
                !zotlit.services.bridge
                  .runSync(zotlit.services.profileService.profiles)
                  .some((p) => p.id === __typedArg0),
              ),
            );
          },
          { __typedArg0: booksProfile.id },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "literature.ts:1294",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
        return String(true);
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
            return String(true);
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
          return String(true);
        },
        undefined,
      );
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ zotlit }) => {
              return String(
                String(
                  zotlit.services.bridge.runSync(
                    zotlit.services.localServer.effectivePort,
                  ) !== null,
                ),
              );
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "literature.ts:1315",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      const server = JSON.parse(
        await obRun(
          run.vaultId,
          async ({ zotlit }) => {
            var services = zotlit.services;
            var settings = services.bridge.runSync(services.settings.current);
            return String(
              JSON.stringify({
                port: services.bridge.runSync(
                  services.localServer.effectivePort,
                ),
                sourceId: services.bridge.runSync(
                  services.zoteroPrefService.current,
                ).sourceId,
                workbench: settings["server.workbench"],
              }),
            );
          },
          undefined,
        ),
      ) as { port: number; sourceId: string; workbench: boolean };
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
          async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
            var names = Array.from(
              app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item-name",
              ),
              (el) => el.textContent,
            );
            return String(
              String(
                names.includes(__typedArg0) &&
                  !names.includes(__typedArg1) &&
                  !names.includes(__typedArg2) &&
                  !app.commands.commands["zotlit:open-profile-web-workbench"],
              ),
            );
          },
          {
            __typedArg0: run.m.settings_local_server_enabled_name(),
            __typedArg1: run.m.settings_local_server_workbench_name(),
            __typedArg2: run.m.template_workbench_preference_name(),
          },
        ),
      ).toBe("true");

      // Live updates answer the Companion, so their switch sits on the Zotero
      // page beside it rather than with the server that carries them.
      await openProfilesSettings(run.vaultId, "settings_page_zotero");
      expect(
        await obRun(
          run.vaultId,
          async ({ app }, { __typedArg0, __typedArg1 }) => {
            var names = Array.from(
              app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item-name",
              ),
              (el) => el.textContent,
            );
            return String(
              String(
                names.includes(__typedArg0) && names.includes(__typedArg1),
              ),
            );
          },
          {
            __typedArg0: run.m.settings_live_updates_enabled_name(),
            __typedArg1: run.m.settings_advanced_local_server_heading(),
          },
        ),
      ).toBe("true");

      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ app }) => {
              return String(
                String(
                  app.workspace.activeLeaf?.view.getViewType() ===
                    "zotlit-template-workbench" &&
                    !document.querySelector<HTMLInputElement>(
                      'input[name="zotlit-customize-destination"]',
                    ),
                ),
              );
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "literature.ts:1365",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      await obRun(
        run.vaultId,
        async ({ app, zotlit }) => {
          app.saveLocalStorage("zotlit-workbench-launch-approved", null);
          app.saveLocalStorage("zotlit-profile-customization", "ask");
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update({ "server.workbench": false }),
          );
          return String(true);
        },
        undefined,
      );
    },
  );
});
