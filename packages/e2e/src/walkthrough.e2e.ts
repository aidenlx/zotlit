import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MarkdownView } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { SearchHit } from "@/services/item-lookup/service";

import { prepareRunWindow } from "./background-throttling.ts";
import { useListingProfile } from "./listing-profile.ts";
import { cliCommand, obRun, obRunUntil } from "./obsidian-cli.ts";
import type {
  WalkthroughApp,
  WalkthroughCitationSuggest,
  WalkthroughRemote,
} from "./page-walkthrough-types.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const fixture = join(root, ".scratch/e2e-walkthrough-fixture");
const path = e2eVaultDir(root, "walkthrough-vault");
const run = vaultScript(root, fixture);
const reachable = await isObsidianReachable(root);

describe.skipIf(!reachable)("Walkthrough regressions", () => {
  let vaultId = "";
  beforeAll(async () => {
    await clearVault(run, path);
    const opened = await run(["open", path, "--vault-case", "demo"]);
    vaultId = opened.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
  }, 180_000);

  afterAll(async () => {
    await run(["remove", path, "--purge"]);
    await rm(fixture, { recursive: true, force: true });
  }, 120_000);

  it("starts the demo with Sync disabled", async () => {
    expect(
      await obRun(
        vaultId,
        async ({ app: host }) => {
          const app = host as WalkthroughApp;

          return String(String(app.internalPlugins.plugins.sync.enabled));
        },
        undefined,
      ),
    ).toBe("false");
    expect(
      await obRun(
        vaultId,
        async (_context) => {
          return String(
            String(
              Array.from(
                document.querySelectorAll<HTMLElement>(
                  ".status-bar [aria-label]",
                ),
              ).some((el) => el.getAttribute("aria-label") === "Uninitialized"),
            ),
          );
        },
        undefined,
      ),
    ).toBe("false");
  });

  it("shows Cited by counts only while following a literature note", async () => {
    const m = await import("@obsidian-messages");
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, page }, { emptyMessage, openNoteMessage }) => {
          const app = host as WalkthroughApp;

          const { waitFor } = page;
          await using cleanup = new AsyncDisposableStack();
          // Ioannidis is cited only in this Fixture chapter; other walkthroughs cite Rougier.
          const chapter = app.vault.getFileByPath(
            "Thesis/Chapter 3 - Presenting the results.md",
          )!;
          const original = await app.vault.read(chapter);
          cleanup.defer(() => app.vault.modify(chapter, original));
          await app.vault.modify(chapter, "A chapter without citations.");
          const literature = cleanup.adopt(
            await app.vault.create(
              "Uncited literature.md",
              "---\nzotero-key: DMIANART\n---\nA literature note.",
            ),
            (file) => app.vault.delete(file),
          );
          const plain = cleanup.adopt(
            await app.vault.create("Ordinary note.md", "An ordinary note."),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(literature);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:show-cited-by");
          const content = () =>
            page.leavesOfType("zotlit-cited-by")[0]?.view.contentEl;
          const empty = () =>
            content()?.querySelector<HTMLElement>("[data-cited-by-empty]")
              ?.textContent;
          const stats = () =>
            content()?.querySelector<HTMLElement>("[data-cited-by-stats]")
              ?.textContent ?? null;
          await waitFor(empty, emptyMessage, "Uncited literature note");
          const before = stats();
          await leaf.openFile(plain);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await waitFor(empty, openNoteMessage, "Ordinary note");
          const withoutTarget = stats();
          await leaf.openFile(literature);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await waitFor(empty, emptyMessage, "Restored literature target");
          return String(
            JSON.stringify({ before, withoutTarget, after: stats() }),
          );
        },
        {
          emptyMessage: m.cited_by_empty(),
          openNoteMessage: m.cited_by_open_literature_note(),
        },
      ),
    );
    const zeroCounts = `${m.cited_by_note_count({ count: 0 })} · ${m.cited_by_occurrence_count({ count: 0 })}`;
    expect(result).toEqual({
      before: zeroCounts,
      withoutTarget: null,
      after: zeroCounts,
    });
  });

  it("materializes the CSL style selected by a note through the CLI (#1793)", async () => {
    const styleId = "http://www.zotero.org/styles/chinese-gb7714-1987-numeric";
    const note = "CSL CLI regression.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId,
        async ({ app: host }, { note }) => {
          const app = host as WalkthroughApp;

          const file = app.vault.getFileByPath(note)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { note },
      );
    });
    await obRun(
      vaultId,
      async ({ app: host }, { note, fileContent }) => {
        const app = host as WalkthroughApp;

        await app.vault.create(note, fileContent);
        return String(true);
      },
      { note, fileContent: `---\nzotlit-csl: ${styleId}\n---\nA draft.\n` },
    );
    const selected = JSON.parse(
      await cliCommand(vaultId, "zotlit:csl", { args: { style: styleId } }),
    );
    expect(selected).toMatchObject({
      command: "zotlit:csl",
      styleId,
      path: expect.any(String),
    });
    await obRunUntil(
      vaultId,
      async ({ app: host }, { note }) => {
        const app = host as WalkthroughApp;

        return await app.metadataCache.getFileCache(
          app.vault.getFileByPath(note)!,
        )?.frontmatter?.["zotlit-csl"];
      },
      { note },
      { ready: (value) => value === styleId, what: "walkthrough.e2e.ts:135" },
    ).then(
      () => true,
      () => false,
    );
    const document = JSON.parse(
      await cliCommand(vaultId, "zotlit:csl", {
        args: { file: join(path, note) },
      }),
    );
    expect(document).toMatchObject({
      command: "zotlit:csl",
      styleId,
      path: selected.path,
      source: { kind: "note" },
    });
    expect(await readFile(document.path, "utf8")).toContain(
      `<id>${styleId}</id>`,
    );
    const missing = JSON.parse(
      await cliCommand(vaultId, "zotlit:csl", {
        args: { style: "https://example.invalid/missing-style" },
      }),
    );
    expect(missing).toMatchObject({ errors: [{ code: "style-missing" }] });
  });

  it("shows export destinations within the named vault when the format changes", async () => {
    const m = await import("@obsidian-messages");
    const vault = basename(path);
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, page }) => {
          const app = host as WalkthroughApp;

          const { waitFor } = page;
          await using cleanup = new AsyncDisposableStack();
          const file = cleanup.adopt(
            await app.vault.create("Export display.md", "A draft."),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const doc = (leaf.view as MarkdownView).containerEl.ownerDocument;
          const dialog = () =>
            [...doc.querySelectorAll<HTMLElement>(".modal")].find(
              (el) =>
                el.querySelector<HTMLElement>(".modal-title")?.textContent ===
                "Export with citations",
            );
          // Teardown dismisses whatever dialog is left, not a reader's press.
          cleanup.defer(() =>
            dialog()
              ?.parentElement!.querySelector<HTMLElement>(".modal-bg")
              ?.click(),
          );
          app.commands.executeCommandById("zotlit:pandoc-export");
          await waitFor(() => !!dialog(), true, "Export dialog");
          const modal = dialog();
          const row = [
            ...modal!.querySelectorAll<HTMLElement>(".setting-item"),
          ].find(
            (el) =>
              el.querySelector<HTMLElement>(".setting-item-name")
                ?.textContent === "Save to",
          );
          const word = row!.querySelector<HTMLElement>(
            ".setting-item-description",
          )!.textContent;
          const format = modal!.querySelector<HTMLSelectElement>("select");
          format!.value = "html";
          format!.dispatchEvent(
            new format!.ownerDocument.defaultView!.Event("change", {
              bubbles: true,
            }),
          );
          return String(
            JSON.stringify({
              word,
              html: row!.querySelector<HTMLElement>(
                ".setting-item-description",
              )!.textContent,
              vault: app.vault.getName(),
              absolutePathShown: modal!.textContent.includes(
                app.vault.adapter.getBasePath(),
              ),
            }),
          );
        },
        undefined,
      ),
    );
    expect(result.word).toBe(
      m.pandoc_export_destination_in_vault({
        path: "Export display.docx",
        vault,
      }),
    );
    expect(result.html).toBe(
      m.pandoc_export_destination_in_vault({
        path: "Export display.html",
        vault,
      }),
    );
    expect(result.absolutePathShown).toBe(false);
  });

  it("opens the Library View with the Welcome View beside the active note and reuses its tab", async () => {
    const notePath = "Welcome navigation.md";
    const noteId = await obRun(
      vaultId,
      async ({ app: host }, { notePath }) => {
        const app = host as WalkthroughApp;

        for (const leaf of app.workspace.getLeavesOfType("zotlit-library"))
          leaf.detach();
        const file = await app.vault.create(notePath, "Keep this note open.");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:open-welcome-view");
        return String(await leaf.id);
      },
      { notePath },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId,
        async ({ app: host }, { noteId, notePath }) => {
          const app = host as WalkthroughApp;

          const leaf = app.workspace.getLeafById(noteId);
          leaf?.detach();
          const file = app.vault.getFileByPath(notePath)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { noteId, notePath },
      );
    });
    await obRunUntil(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return (
          app.workspace.activeLeaf?.view.getViewType() === "zotlit-library"
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:224" },
    );
    expect(
      await obRun(
        vaultId,
        async ({ app: host }, { noteId }) => {
          const app = host as WalkthroughApp;

          return String(
            await ((app.workspace.getLeafById(noteId)!.view as MarkdownView)
              .file?.path ?? "<no file>"),
          );
        },
        { noteId },
      ),
    ).toBe(notePath);
    const welcomeId = await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return String(await app.workspace.activeLeaf!.id);
      },
      undefined,
    );
    await obRun(
      vaultId,
      async ({ app: host }, { noteId }) => {
        const app = host as WalkthroughApp;

        app.workspace.setActiveLeaf(app.workspace.getLeafById(noteId)!, {
          focus: true,
        });
        app.commands.executeCommandById("zotlit:open-welcome-view");
        return String(true);
      },
      { noteId },
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return await app.workspace.activeLeaf?.id;
      },
      undefined,
      { ready: (value) => value === welcomeId, what: "walkthrough.e2e.ts:242" },
    );
    expect(
      await obRun(
        vaultId,
        async ({ app: host }) => {
          const app = host as WalkthroughApp;

          return String(
            String(app.workspace.getLeavesOfType("zotlit-library").length),
          );
        },
        undefined,
      ),
    ).toBe("1");
  });

  it("reuses an open literature note when searching from Welcome", async () => {
    const notePath = "Search existing note.md";
    const leafId = await obRun(
      vaultId,
      async ({ app: host }, { notePath }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create(
          notePath,
          "---\nzotero-key: DMRGRART\n---\nExisting literature note",
        );
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        const welcome =
          app.workspace.getLeavesOfType("zotlit-library")[0] ??
          app.workspace.getLeaf("tab");
        await welcome.setViewState({ type: "zotlit-library", active: true });
        app.workspace.setActiveLeaf(welcome, { focus: true });
        return String(await leaf.id);
      },
      { notePath },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId,
        async ({ app: host, page }, { notePath }) => {
          const app = host as WalkthroughApp;

          for (const leaf of page.leavesOfType("markdown"))
            if ((leaf.view as MarkdownView).file?.path === notePath)
              leaf.detach();
          const file = app.vault.getFileByPath(notePath)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { notePath },
      );
    });
    await obRunUntil(
      vaultId,
      async ({ zotlit }, { notePath }) => {
        return zotlit.services.noteIndex
          .getNotesByItemKey("DMRGRART")
          .some((file) => file.path === notePath);
      },
      { notePath },
      { what: "walkthrough.e2e.ts:274" },
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.commands.executeCommandById("zotlit:note-quick-switcher");
        const input =
          activeDocument.querySelector<HTMLInputElement>(".prompt-input");
        input!.value = "ten simple";
        input!.dispatchEvent(
          new input!.ownerDocument.defaultView!.Event("input", {
            bubbles: true,
          }),
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async (_context) => {
        return activeDocument
          .querySelector<HTMLElement>(".prompt-results")
          ?.textContent.includes("Ten Simple Rules for Better Figures");
      },
      undefined,
      { what: "walkthrough.e2e.ts:285" },
    );
    await obRun(
      vaultId,
      async ({ page }) => {
        const { pressKey } = page;
        const debugger_ = (
          (activeWindow as Window & { require: NodeJS.Require }).require(
            "@electron/remote",
          ) as WalkthroughRemote
        ).getCurrentWebContents().debugger;
        await pressKey(debugger_, "Enter", 13);
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }, { notePath }) => {
        const app = host as WalkthroughApp;

        return (
          (app.workspace.activeLeaf?.view as MarkdownView | undefined)?.file
            ?.path === notePath
        );
      },
      { notePath },
      { what: "walkthrough.e2e.ts:299" },
    );
    expect(
      JSON.parse(
        await obRun(
          vaultId,
          async ({ app: host, page }, { notePath }) => {
            const app = host as WalkthroughApp;

            return String(
              JSON.stringify({
                count: page
                  .leavesOfType("markdown")
                  .filter((leaf) => leaf.view.file?.path === notePath).length,
                active: app.workspace.activeLeaf!.id,
              }),
            );
          },
          { notePath },
        ),
      ),
    ).toEqual({ count: 1, active: leafId });
  });

  it("recovers a failed citation render after cooldown while keeping the displayed text", async () => {
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, zotlit }) => {
          const app = host as WalkthroughApp;

          await using cleanup = new AsyncDisposableStack();
          const services = zotlit.services;
          const file = cleanup.adopt(
            await app.vault.create(
              "Held read recovery.md",
              "Before [@rougier2014].\n\nEnd",
            ),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          if (!app.metadataCache.getFileCache(file))
            await new Promise<void>((resolve) => {
              const event = app.metadataCache.on("changed", (changed) => {
                if (changed.path === file.path) {
                  app.metadataCache.offref(event);
                  resolve();
                }
              });
              cleanup.defer(() => app.metadataCache.offref(event));
            });
          await leaf.openFile(file);
          (leaf.view as MarkdownView).editor.setCursor({ line: 2, ch: 3 });
          const first = await services.citationText.read(file.path);
          if (!first?.formatted.size)
            throw new Error("Initial citations were not formatted");
          const engine = await services.pandocEngine.runPromise(
            services.pandocEngine.binary.getEngine,
          );
          const original = engine!.renderCitations;
          cleanup.defer(() => {
            engine!.renderCitations = original;
          });
          let fail = true,
            reads = 0;
          engine!.renderCitations = new Proxy(original, {
            apply(
              target,
              receiver: NonNullable<typeof engine>,
              args: Parameters<typeof original>,
            ) {
              reads++;
              return fail
                ? Promise.reject(new Error("Simulated render failure"))
                : Reflect.apply(target, receiver, args);
            },
          });
          services.queryClient.invalidate(["citation-render"]);
          services.queryClient.invalidate(["citation-text", file.path]);
          const failed = await services.citationText.read(file.path);
          const failedStatus = services.citationText.peek(file.path)?.status;
          fail = false;
          await services.citationText.read(file.path);
          const duringCooldown = reads;
          // oxlint-disable-next-line no-restricted-globals -- Preserve the native cooldown-clock regression probe.
          const now = Date.now;
          // oxlint-disable-next-line effecttsgo/global-date -- This test advances the native clock consumed by the cooldown.
          const afterCooldown = now() + 6000;
          // oxlint-disable-next-line no-restricted-globals -- Preserve the native cooldown-clock regression probe.
          Date.now = () => afterCooldown;
          cleanup.defer(() => {
            // oxlint-disable-next-line no-restricted-globals -- Restore the native clock after the probe.
            Date.now = now;
          });
          const recovered = await services.citationText.read(file.path);
          const status = services.citationText.peek(file.path)?.status;
          await new Promise((resolve) =>
            (leaf.view as MarkdownView).editor.cm.requestMeasure({
              read: () => null,
              write: resolve,
            }),
          );
          return String(
            JSON.stringify({
              failedStatus,
              keptText: failed === first,
              duringCooldown,
              reads,
              recovered: recovered === first,
              status,
              widget: !!(
                leaf.view as MarkdownView
              ).contentEl.querySelector<HTMLElement>(".zt-citation"),
            }),
          );
        },
        undefined,
      ),
    );
    expect(result).toEqual({
      failedStatus: "failed",
      keptText: true,
      duringCooldown: 1,
      reads: 2,
      recovered: true,
      status: "fresh",
      widget: true,
    });
  });

  it("places a plain-click caret inside a formatted citation and keeps selections", async () => {
    const source = "Before [@rougier2014, p. 1] after\n\nEnd";
    await obRun(
      vaultId,
      async ({ app: host }, { source }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create("Citation click.md", source);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        window.focus();
        (leaf.view as MarkdownView).editor.setCursor({ line: 2, ch: 3 });
        (leaf.view as MarkdownView).editor.focus();
        return String(true);
      },
      { source },
    );

    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return !!page
          .leavesOfType("markdown")
          .find((leaf) => leaf.view.file?.path === "Citation click.md")!
          .view.contentEl.querySelector<HTMLElement>(".zt-citation");
      },
      undefined,
      { what: "walkthrough.e2e.ts:385" },
    );
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ page }) => {
          const { measure, waitFor } = page;
          const view = page
              .leavesOfType("markdown")
              .find(
                (leaf) => leaf.view.file?.path === "Citation click.md",
              )!.view,
            editor = view.editor;
          const debugger_ = (
            require("@electron/remote") as WalkthroughRemote
          ).getCurrentWebContents().debugger;
          const gesture = async (kind: "plain" | "drag" | "extend") => {
            editor.setCursor({ line: 2, ch: 3 });
            editor.focus();
            await waitFor(
              () =>
                editor.cm.hasFocus &&
                !!view.contentEl.querySelector<HTMLElement>(".zt-citation"),
              true,
              "Citation widget",
            );
            await measure(editor.cm);
            const element =
              view.contentEl.querySelector<HTMLElement>(".zt-citation");
            const box = element!.getBoundingClientRect();
            const start = {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            };
            const end =
              kind === "drag" ? { x: box.right + 35, y: start.y } : start;
            const modifiers = kind === "extend" ? 8 : 0;
            await debugger_.sendCommand("Input.dispatchMouseEvent", {
              type: "mousePressed",
              ...start,
              button: "left",
              clickCount: 1,
              modifiers,
            });
            if (kind === "drag")
              await debugger_.sendCommand("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                ...end,
                button: "left",
                buttons: 1,
              });
            await debugger_.sendCommand("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              ...end,
              button: "left",
              clickCount: 1,
              modifiers,
            });
            await measure(editor.cm);
            return {
              cursor: editor.getCursor(),
              selection: editor.getSelection(),
              source: editor.getValue(),
              formatted:
                !!view.contentEl.querySelector<HTMLElement>(".zt-citation"),
            };
          };
          return String(
            JSON.stringify({
              plain: await gesture("plain"),
              drag: await gesture("drag"),
              extend: await gesture("extend"),
            }),
          );
        },
        undefined,
      ),
    );
    expect(result.plain.cursor.line).toBe(0);
    expect(result.plain.cursor.ch).toBeGreaterThan(source.indexOf("["));
    expect(result.plain.cursor.ch).toBeLessThan(source.indexOf("]") + 1);
    expect(result.plain.selection).toBe("");
    expect(result.plain.formatted).toBe(false);
    expect(result.drag.selection.length).toBeGreaterThan(0);
    expect(result.extend.selection.length).toBeGreaterThan(0);
    for (const gesture of [result.plain, result.drag, result.extend]) {
      expect(gesture.source).toBe(source);
    }
    // The stub records the open and hands the bridge an Effect that changes
    // nothing (`navigationEnabled`), so no note opens.
    const navigation = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, zotlit, page }) => {
          const app = host as WalkthroughApp;

          const { measure, waitFor } = page;
          const view = page
            .leavesOfType("markdown")
            .find((leaf) => leaf.view.file?.path === "Citation click.md")!.view;
          const debugger_ = (
            require("@electron/remote") as WalkthroughRemote
          ).getCurrentWebContents().debugger;
          const service = zotlit.services.citekeyEditor;
          const tab = app.plugins.plugins.zotlit.settingTab;
          const previous = tab.getControlValue("citation.open-as-links");
          const original = service.openCitekey,
            requests: Parameters<typeof service.openCitekey>[] = [];
          await using restore = new AsyncDisposableStack();
          restore.defer(async () => {
            service.openCitekey = original;
            await tab.setControlValue("citation.open-as-links", previous);
          });
          service.openCitekey = (...args) => {
            requests.push(args);
            return service.navigationEnabled;
          };
          for (const openAsLinks of [false, true]) {
            await tab.setControlValue("citation.open-as-links", openAsLinks);
            view.editor.setCursor({ line: 2, ch: 3 });
            view.editor.focus();
            await waitFor(
              () =>
                view.editor.cm.hasFocus &&
                !!view.contentEl.querySelector<HTMLElement>(".zt-citation"),
              true,
              "Citation navigation widget",
            );
            await measure(view.editor.cm);
            const box = view.contentEl
              .querySelector<HTMLElement>(".zt-citation")!
              .getBoundingClientRect();
            const modifiers = openAsLinks
              ? 0
              : process.platform === "darwin"
                ? 4
                : 2;
            for (const type of ["mousePressed", "mouseReleased"])
              await debugger_.sendCommand("Input.dispatchMouseEvent", {
                type,
                x: box.x + box.width / 2,
                y: box.y + box.height / 2,
                button: "left",
                clickCount: 1,
                modifiers,
              });
          }
          return String(JSON.stringify(requests));
        },
        undefined,
      ),
    );
    expect(navigation).toEqual([
      ["rougier2014", "tab"],
      ["rougier2014", false],
    ]);
  });

  it("keeps citation suggestions when a word reaches eight letters", async () => {
    await obRunUntil(
      vaultId,
      async ({ zotlit }) => {
        return (
          await zotlit.services.itemLookup.search("researc", {
            limit: 5,
          })
        ).some((hit) => hit.item.key === "DMIANART");
      },
      undefined,
      { what: "walkthrough.e2e.ts:464" },
    );
    const results = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, zotlit, page }) => {
          const app = host as WalkthroughApp;

          const { waitFor } = page;
          await using cleanup = new AsyncDisposableStack();
          const previousLeaf = app.workspace.activeLeaf;
          cleanup.defer(() => {
            if (previousLeaf)
              app.workspace.setActiveLeaf(previousLeaf, { focus: true });
          });
          const file = cleanup.adopt(
            await app.vault.create("Citation full words.md", ""),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          (leaf.view as MarkdownView).editor.focus();
          const suggest = app.workspace.editorSuggest.suggests.find(
            (s) => s.constructor.name === "CitationEditorSuggest",
          ) as WalkthroughCitationSuggest;
          cleanup.defer(() => suggest!.close());
          const editor = (leaf.view as MarkdownView).editor,
            results = [];
          for (const query of ["researc", "research", "finding", "findings"]) {
            const hits = await zotlit.services.itemLookup.search(query, {
              limit: 5,
            });
            const text = `[@${query}`;
            editor.cm.dispatch({
              changes: {
                from: 0,
                to: editor.cm.state.doc.length,
                insert: text,
              },
              selection: { anchor: text.length },
              userEvent: "input.type",
            });
            await waitFor(
              () =>
                suggest!.isOpen &&
                suggest!.context?.query === query &&
                suggest!.suggestEl.textContent.includes(
                  "Why Most Published Research Findings Are False",
                ),
              true,
              `Citation suggestions for ${query}`,
            );
            results.push({
              query,
              found: hits.some((hit) => hit.item.key === "DMIANART"),
            });
          }
          await (leaf.view as MarkdownView).save();
          return String(JSON.stringify(results));
        },
        undefined,
      ),
    );
    expect(results).toEqual(
      ["researc", "research", "finding", "findings"].map((query) => ({
        query,
        found: true,
      })),
    );
  });

  it("keeps the citation suggester closed while entering a page locator", async () => {
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create("Citation locator.md", "");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        window.focus();
        (leaf.view as MarkdownView).editor.focus();
        await (require("@electron/remote") as WalkthroughRemote)
          .getCurrentWebContents()
          .debugger.sendCommand("Input.insertText", { text: "[@ten" });
        return String(true);
      },
      undefined,
    );

    await obRunUntil(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return (
          (app.workspace.editorSuggest.suggests.find(
            (suggest) => suggest.constructor.name === "CitationEditorSuggest",
          ) as WalkthroughCitationSuggest)!.isOpen &&
          app.workspace.editorSuggest.suggests
            .find(
              (suggest) => suggest.constructor.name === "CitationEditorSuggest",
            )!
            .suggestEl.textContent.includes(
              "Ten Simple Rules for Better Figures",
            )
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:519" },
    );
    await obRun(
      vaultId,
      async ({ page }) => {
        const { pressKey } = page;
        const debugger_ = (
          (activeWindow as Window & { require: NodeJS.Require }).require(
            "@electron/remote",
          ) as WalkthroughRemote
        ).getCurrentWebContents().debugger;
        await pressKey(debugger_, "Enter", 13);
        return String(true);
      },
      undefined,
    );

    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return await page
          .leavesOfType("markdown")
          .find((leaf) => leaf.view.file?.path === "Citation locator.md")!
          .view.editor.getValue();
      },
      undefined,
      {
        ready: (value) => value === "[@rougier2014]",
        what: "walkthrough.e2e.ts:535",
      },
    );
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, page }) => {
          const app = host as WalkthroughApp;

          const { pressKey } = page;
          const debugger_ = (
            require("@electron/remote") as WalkthroughRemote
          ).getCurrentWebContents().debugger;
          const editor = page
              .leavesOfType("markdown")
              .find((leaf) => leaf.view.file?.path === "Citation locator.md")!
              .view.editor,
            suggest = app.workspace.editorSuggest.suggests.find(
              (suggest) => suggest.constructor.name === "CitationEditorSuggest",
            ) as WalkthroughCitationSuggest,
            manager = app.workspace.editorSuggest;
          const originalTrigger = manager.trigger,
            originalShow = suggest!.showSuggestions,
            originalClose = suggest!.close;
          const updated = Promise.withResolvers<void>();
          using hooks = new DisposableStack();
          hooks.defer(() => {
            manager.trigger = originalTrigger;
            suggest!.showSuggestions = originalShow;
            suggest!.close = originalClose;
          });
          hooks.adopt(
            setTimeout(
              () =>
                updated.reject(
                  new Error("Native citation suggestion update did not finish"),
                ),
              5000,
            ),
            clearTimeout,
          );
          let triggering = false,
            shown = false;
          const entered = () =>
            editor.getValue() === "[@rougier2014, p]" &&
            editor.getCursor().ch === 16;
          manager.trigger = new Proxy(originalTrigger, {
            apply(
              target,
              receiver: NonNullable<typeof manager>,
              args: Parameters<typeof originalTrigger>,
            ) {
              const relevant = args[0] === editor && entered();
              if (relevant) triggering = true;
              const result = Reflect.apply(target, receiver, args);
              if (relevant) {
                triggering = false;
                if (suggest!.context === null || shown) updated.resolve();
              }
              return result;
            },
          });
          suggest!.close = new Proxy(originalClose, {
            apply(
              target,
              receiver: NonNullable<typeof suggest>,
              args: Parameters<typeof originalClose>,
            ) {
              const result = Reflect.apply(target, receiver, args);
              if (entered()) updated.resolve();
              return result;
            },
          });
          suggest!.showSuggestions = new Proxy(originalShow, {
            apply(
              target,
              receiver: NonNullable<typeof suggest>,
              args: Parameters<typeof originalShow>,
            ) {
              const result = Reflect.apply(target, receiver, args);
              if (entered() && suggest!.context?.query === "rougier2014, p") {
                shown = true;
                if (!triggering) updated.resolve();
              }
              return result;
            },
          });
          await pressKey(debugger_, "ArrowLeft", 37);
          await debugger_.sendCommand("Input.insertText", { text: ", p" });
          await updated.promise;
          const open = suggest!.isOpen,
            before = editor.getValue();
          await pressKey(debugger_, "Enter", 13);
          return String(
            JSON.stringify({ open, before, after: editor.getValue() }),
          );
        },
        undefined,
      ),
    );
    expect(result.before).toBe("[@rougier2014, p]");
    expect(result.open).toBe(false);
    expect(result.after).toContain(", p");
  });

  it("refreshes and closes citation settings without cleanup errors", async () => {
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, page }) => {
          const app = host as WalkthroughApp;

          const { press, waitFor } = page;
          app.setting.close();
          const tab = app.plugins.plugins.zotlit.settingTab;
          const controls = [
            ["Pandoc citations", "citation.pandoc-citations"],
            ["Wikilink citations", "citation.wikilink-citations"],
          ] as const;
          const previous = controls.map(([, key]) => tab.getControlValue(key!));
          const popout = app.vault.getConfig("settingsPopoutWindow");
          const originalError = console.error;
          const errors: string[] = [];
          await using restore = new AsyncDisposableStack();
          restore.defer(async () => {
            app.setting.close();
            console.error = originalError;
            for (let i = 0; i < controls.length; i++)
              await tab.setControlValue(controls[i]![1]!, previous[i]);
            app.vault.setConfig("settingsPopoutWindow", popout);
          });
          console.error = (...args) => {
            errors.push(
              args
                .map((value) =>
                  value instanceof Error ? value.message : String(value),
                )
                .join(" "),
            );
            originalError(...args);
          };
          app.vault.setConfig("settingsPopoutWindow", false);
          app.setting.open();
          app.setting.openTabById("zotlit");
          const row = (name: string) =>
            Array.from(
              app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item",
              ),
            ).find(
              (el) =>
                el.querySelector<HTMLElement>(".setting-item-name")
                  ?.textContent === name,
            );
          press(row("Citations"), "Citations");
          const tutorial = !!row(
            "Pandoc citation tutorial",
          )?.querySelector<HTMLButtonElement>("button");
          const changed = [];
          for (const [name, key] of controls) {
            const initial = tab.getControlValue(key!);
            for (const expected of [!initial, initial]) {
              const tutorialButton = row(
                "Pandoc citation tutorial",
              )!.querySelector<HTMLButtonElement>("button");
              press(
                row(name)!.querySelector<HTMLElement>(".checkbox-container"),
                name!,
              );
              await waitFor(
                () => ({
                  value: tab.getControlValue(key!),
                  refreshed:
                    row(
                      "Pandoc citation tutorial",
                    )!.querySelector<HTMLButtonElement>("button") !==
                    tutorialButton,
                }),
                { value: expected, refreshed: true },
                "Citation settings refresh",
              );
              changed.push(tab.getControlValue(key!) === expected);
            }
          }
          app.setting.close();
          return String(JSON.stringify({ tutorial, changed, errors }));
        },
        undefined,
      ),
    );
    expect(result.tutorial).toBe(true);
    expect(result.changed).toEqual([true, true, true, true]);
    expect(result.errors).toEqual([]);
  });

  it("updates the active literature note from its editor, title, and Properties", async () => {
    const initial =
      "---\nzotero-key: DMRGRART\n---\n%%zt-managed%%\nstale\n%%/zt-managed%%";
    await obRun(
      vaultId,
      async ({ app: host }, { initial }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create("Focus update.md", initial);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file, { state: { mode: "source", source: false } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { initial },
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return (
          app.metadataCache.getFileCache(
            app.vault.getFileByPath("Focus update.md")!,
          )?.frontmatter?.["zotero-key"] === "DMRGRART"
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:644" },
    );
    for (const selector of [
      ".cm-content",
      ".inline-title",
      ".metadata-property-key-input",
    ]) {
      const result = JSON.parse(
        await obRun(
          vaultId,
          async ({ app: host, page }, { selector }) => {
            const app = host as WalkthroughApp;

            const { waitFor } = page;
            const view = app.workspace.getActiveFileView() as MarkdownView,
              editor = view!.editor;
            editor.setValue(
              editor
                .getValue()
                .replace(
                  "%%zt-managed%%",
                  "%%zt-managed%%\nFOCUS_UPDATE_SENTINEL",
                ),
            );
            const target =
              view!.containerEl.querySelector<HTMLElement>(selector);
            if (!target) throw Error("Missing focus target");
            target.focus();
            const focused = target === target.ownerDocument.activeElement;
            const accepted =
              app.commands.executeCommandById("zotlit:update-note");
            await waitFor(
              () => editor.getValue().includes("FOCUS_UPDATE_SENTINEL"),
              false,
              "Literature note update",
            );
            return String(
              JSON.stringify({
                focused,
                accepted,
                updated: !editor.getValue().includes("FOCUS_UPDATE_SENTINEL"),
              }),
            );
          },
          { selector },
        ),
      );
      expect(result, selector).toEqual({
        focused: true,
        accepted: true,
        updated: true,
      });
    }
  });

  it("keeps the viewport and unsaved writing when an update replaces multiple callouts", async () => {
    // The default Profile shows Annotations in a Query Block; a default
    // document that lists them puts one callout per Annotation in the note.
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          await zotlit.services.profile.restoreDefault();
          return String(true);
        },
        undefined,
      );
    });
    await useListingProfile(vaultId, { restore: true });
    const notePath = "Scroll update.md";
    const source =
      "---\nzotero-key: DMRGRART\n---\n%%zt-managed%%\nstale\n%%/zt-managed%%\n";
    await obRun(
      vaultId,
      async ({ app: host }, { notePath, fileContent }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create(notePath, fileContent);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file, { state: { mode: "source", source: false } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        window.focus();
        return String(true);
      },
      { notePath, fileContent: source },
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }, { notePath }) => {
        const app = host as WalkthroughApp;

        return (
          app.metadataCache.getFileCache(app.vault.getFileByPath(notePath)!)
            ?.frontmatter?.["zotero-key"] === "DMRGRART"
        );
      },
      { notePath },
      { what: "walkthrough.e2e.ts:703" },
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.commands.executeCommandById("zotlit:update-note");
        return String(true);
      },
      undefined,
    );

    await obRunUntil(
      vaultId,
      async ({ page }, { notePath }) => {
        return (
          page
            .leavesOfType("markdown")
            .find((leaf) => leaf.view.file?.path === notePath)!
            .view.editor.getValue()
            .split("[!note]").length > 2
        );
      },
      { notePath },
      { what: "walkthrough.e2e.ts:715" },
    );
    const result = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, page }, { notePath }) => {
          const app = host as WalkthroughApp;

          const { measure, waitFor } = page;
          const view = page
              .leavesOfType("markdown")
              .find((leaf) => leaf.view.file?.path === notePath)!.view,
            editor = view.editor,
            cm = editor.cm;
          let changed = 0;
          const edited = `${editor.getValue().replaceAll("[!note]", () => (++changed <= 2 ? "[!quote]" : "[!note]"))}\nUnsaved researcher text.`;
          editor.setValue(edited);
          editor.setCursor({ line: 7, ch: 0 });
          await measure(cm);
          editor.scrollTo(null, 600);
          await measure(cm);
          const before = {
            top: cm.scrollDOM.scrollTop,
            height: cm.scrollDOM.scrollHeight,
            cursor: editor.getCursor(),
          };
          const accepted =
            app.commands.executeCommandById("zotlit:update-note");
          await waitFor(
            () => editor.getValue().includes("[!quote]"),
            false,
            "Updated callouts",
          );
          await measure(cm);
          const after = {
            top: cm.scrollDOM.scrollTop,
            height: cm.scrollDOM.scrollHeight,
            cursor: editor.getCursor(),
          };
          const updated = editor.getValue();
          editor.undo();
          const undoMatches = editor.getValue() === edited;
          editor.redo();
          const redoMatches = editor.getValue() === updated;
          return String(
            JSON.stringify({
              accepted,
              before,
              after,
              undoMatches,
              redoMatches,
              updated: !updated.includes("[!quote]"),
              unsaved: updated.includes("Unsaved researcher text."),
            }),
          );
        },
        { notePath },
      ),
    );
    expect(result.accepted).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.unsaved).toBe(true);
    expect(result.undoMatches).toBe(true);
    expect(result.redoMatches).toBe(true);
    expect(result.before.top).toBe(600);
    expect(result.after.cursor).toEqual(result.before.cursor);
    expect(result.after.height).toBe(result.before.height);
    expect(Math.abs(result.after.top - result.before.top)).toBeLessThan(2);
    await obRunUntil(
      vaultId,
      async ({ app: host }, { notePath }) => {
        const app = host as WalkthroughApp;

        return (
          await app.vault.read(app.vault.getFileByPath(notePath)!)
        ).includes("Unsaved researcher text.");
      },
      { notePath },
      { what: "walkthrough.e2e.ts:752" },
    );
  });

  it.each(["built-in", "customized"])(
    "opens the %s template in its popout without displaying a main-window Workbench tab",
    async (kind) => {
      const notePath = `Popout ${kind}.md`;
      await obRun(
        vaultId,
        async ({ app: host, zotlit }, { kind, notePath }) => {
          const app = host as WalkthroughApp;

          for (const type of [
            "zotlit-template-workbench",
            "zotlit-template-data-explorer",
            "zotlit-note-preview",
          ])
            for (const leaf of app.workspace.getLeavesOfType(type))
              leaf.detach();
          const profile = zotlit.services.profile;
          if (kind === "built-in") await profile.restoreDefault();
          else await profile.materializeDefault();
          const file = await app.vault.create(
            notePath,
            "---\nzotero-key: DMRGRART\n---\n# Popout",
          );
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return String(true);
        },
        { kind, notePath },
      );
      await obRunUntil(
        vaultId,
        async ({ app: host }, { notePath }) => {
          const app = host as WalkthroughApp;

          return (
            app.metadataCache.getFileCache(app.vault.getFileByPath(notePath)!)
              ?.frontmatter?.["zotero-key"] === "DMRGRART"
          );
        },
        { notePath },
        { what: "walkthrough.e2e.ts:777" },
      );
      const result = JSON.parse(
        await obRun(
          vaultId,
          async ({ app: host, zotlit, page }) => {
            const app = host as WalkthroughApp;

            const { waitFor } = page;
            const editors = () =>
              page.leavesOfType("zotlit-template-workbench");
            let mainSamples = 0;
            const sample = () => {
              for (const leaf of editors()) {
                const el = leaf.view.containerEl;
                if (
                  el.ownerDocument === document &&
                  el.isConnected &&
                  el.getBoundingClientRect().width > 0
                )
                  mainSamples++;
              }
            };
            using resources = new DisposableStack();
            const observer = resources.adopt(
              new MutationObserver(sample),
              (value) => value.disconnect(),
            );
            observer.observe(document.body, { childList: true, subtree: true });
            resources.adopt(setInterval(sample, 10), clearInterval);
            const accepted = app.commands.executeCommandById(
              "zotlit:customize-note-template",
            );
            const ready = () =>
              editors().some(
                (leaf) =>
                  leaf.view.file &&
                  leaf.view.containerEl.ownerDocument !== document,
              ) &&
              page.leavesOfType("zotlit-note-preview").length > 0 &&
              page.leavesOfType("zotlit-template-data-explorer").length > 0;
            await waitFor(
              ready,
              true,
              "Template Workbench and companion views",
            );
            sample();
            return String(
              JSON.stringify({
                accepted,
                ready: ready(),
                mainSamples,
                customized: !!app.vault.getFileByPath(
                  zotlit.services.profile.defaultDocumentPath,
                )!,
              }),
            );
          },
          undefined,
        ),
      );
      expect(result).toEqual({
        accepted: true,
        ready: true,
        mainSamples: 0,
        customized: true,
      });
      // The template's Query Block shows a placeholder in the note preview.
      await obRunUntil(
        vaultId,
        async ({ page }) => {
          const el = page.leavesOfType("zotlit-note-preview")[0]?.view
            .contentEl;
          return (
            !!el?.querySelector<HTMLElement>(
              "[data-zotlit-draft] [data-query-placeholder]",
            ) &&
            !el.querySelector<HTMLElement>(
              '[data-zotlit-draft] [role="toolbar"]',
            )
          );
        },
        undefined,
        { what: "walkthrough.e2e.ts:817" },
      );
    },
  );

  it("finds a paper in Choose item and previews its callouts with native paragraph styling", async () => {
    const m = await import("@obsidian-messages");
    // The default Profile shows Annotations in a Query Block; a default
    // document that lists them puts one callout per Annotation in the note.
    const original = await obRun(
      vaultId,
      async ({ app: host, zotlit }) => {
        const app = host as WalkthroughApp;

        const profile = zotlit.services.profile;
        await profile.materializeDefault();
        return String(
          await app.vault.read(
            app.vault.getFileByPath(profile.defaultDocumentPath)!,
          ),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId,
        async ({ app: host, zotlit }, { original }) => {
          const app = host as WalkthroughApp;

          const profile = zotlit.services.profile;
          await app.vault.modify(
            app.vault.getFileByPath(profile.defaultDocumentPath)!,
            original,
          );
          return String(true);
        },
        { original },
      );
    });
    await obRun(
      vaultId,
      async ({ app: host, zotlit, page }) => {
        const app = host as WalkthroughApp;

        const profile = zotlit.services.profile;
        const file = app.vault.getFileByPath(profile.defaultDocumentPath)!;
        const source = await app.vault.read(file);
        const listed = page.listAnnotations(source);
        await app.vault.modify(file, listed);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(
          app.vault.getFileByPath(profile.defaultDocumentPath)!,
        );
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:customize-profile");
        return String(true);
      },
      undefined,
    );

    // Opening the layout can move and reload the editor. Use the button only
    // after its companion panes arrive in the same popout document.
    await obRunUntil(
      vaultId,
      async ({ zotlit, page }, { actionSelector }) => {
        const { press } = page;
        const view = page
          .leavesOfType("zotlit-template-workbench")
          .find(
            (leaf) =>
              leaf.view.file?.path ===
              zotlit.services.profile.defaultDocumentPath,
          )?.view;
        const doc = view?.contentEl?.ownerDocument;
        const ready =
          doc &&
          doc !== document &&
          (
            ["zotlit-template-data-explorer", "zotlit-note-preview"] as const
          ).every((type) =>
            page
              .leavesOfType(type)
              .some((leaf) => leaf.view.contentEl?.ownerDocument === doc),
          );
        // A main-area pane shows the view header, so the reader presses its
        // Choose item action; the in-pane trigger is for a sidebar alone.
        const trigger =
          ready && view.containerEl.querySelector<HTMLElement>(actionSelector);
        if (!trigger) return "false";
        press(trigger, "Choose item");
        return "true";
      },
      {
        actionSelector: `.view-actions .view-action[aria-label="${m.workbench_choose_item()}"]`,
      },
      { ready: (value) => value === "true", what: "walkthrough.e2e.ts:862" },
    );

    await obRunUntil(
      vaultId,
      async ({ zotlit, page }) => {
        const input = page
          .leavesOfType("zotlit-template-workbench")
          .find(
            (leaf) =>
              leaf.view.file?.path ===
              zotlit.services.profile.defaultDocumentPath,
          )
          ?.view?.contentEl?.ownerDocument.querySelector<HTMLElement>(".prompt")
          ?.querySelector<HTMLInputElement>("input");
        if (!input) return "false";
        input.value = "rougier";
        input.dispatchEvent(
          new input.ownerDocument.defaultView!.Event("input", {
            bubbles: true,
          }),
        );
        return "true";
      },
      undefined,
      { ready: (value) => value === "true", what: "walkthrough.e2e.ts:880" },
    );
    // The results are `aria-busy` while they answer an earlier query.

    await obRunUntil(
      vaultId,
      async ({ zotlit, page }) => {
        const { press } = page;
        const row = Array.from(
          page
            .leavesOfType("zotlit-template-workbench")
            .find(
              (leaf) =>
                leaf.view.file?.path ===
                zotlit.services.profile.defaultDocumentPath,
            )
            ?.view?.contentEl?.ownerDocument.querySelector<HTMLElement>(
              ".prompt",
            )
            ?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [],
        ).find(
          (row) =>
            !row.closest("[aria-busy]") &&
            row.textContent.includes("Ten Simple Rules for Better Figures"),
        );
        if (!row) return "false";
        row.dispatchEvent(
          new row.ownerDocument.defaultView!.MouseEvent("mousemove", {
            bubbles: true,
          }),
        );
        press(row, "search result");
        return "true";
      },
      undefined,
      { ready: (value) => value === "true", what: "walkthrough.e2e.ts:889" },
    );

    await obRunUntil(
      vaultId,
      async ({ zotlit, page }) => {
        return (
          page
            .leavesOfType("zotlit-note-preview")
            .find(
              (leaf) =>
                leaf.view.contentEl?.ownerDocument ===
                page
                  .leavesOfType("zotlit-template-workbench")
                  .find(
                    (leaf) =>
                      leaf.view.file?.path ===
                      zotlit.services.profile.defaultDocumentPath,
                  )?.view?.contentEl?.ownerDocument,
            )
            ?.view.contentEl?.querySelectorAll<HTMLElement>(".callout")
            .length! > 0 &&
          !(page
            .leavesOfType("zotlit-note-preview")
            .find(
              (leaf) =>
                leaf.view.contentEl?.ownerDocument ===
                page
                  .leavesOfType("zotlit-template-workbench")
                  .find(
                    (leaf) =>
                      leaf.view.file?.path ===
                      zotlit.services.profile.defaultDocumentPath,
                  )?.view?.contentEl?.ownerDocument,
            )?.view.contentEl)!.querySelector<HTMLElement>(
            "[data-zotlit-preview-pending]",
          )
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:897" },
    );
    expect(
      await obRun(
        vaultId,
        async ({ zotlit, page }) => {
          return String(
            String(
              Array.from(
                (page
                  .leavesOfType("zotlit-note-preview")
                  .find(
                    (leaf) =>
                      leaf.view.contentEl?.ownerDocument ===
                      page
                        .leavesOfType("zotlit-template-workbench")
                        .find(
                          (leaf) =>
                            leaf.view.file?.path ===
                            zotlit.services.profile.defaultDocumentPath,
                        )?.view?.contentEl?.ownerDocument,
                  )?.view.contentEl)!.querySelectorAll<HTMLElement>(
                  ".callout p",
                ),
              ).some((p) => p.classList.contains("zt:bg-accent")),
            ),
          );
        },
        undefined,
      ),
    ).toBe("false");
  });
  it("stores a typed property rule and note name that YAML has to quote as the text the reader typed", async () => {
    const m = await import("@obsidian-messages");
    const rule = 'zt.creators | map: "fullName"';
    const name = "{{ zt.title | replace: ':', '-' }}";
    const result = JSON.parse(
      await obRun(
        vaultId,
        async (
          { app: host, zotlit, page },
          {
            propertiesTab,
            ruleText,
            storedRule,
            nameAndFolderTab,
            filenameLabel,
            nameText,
            storedName,
            invalidMessage,
          },
        ) => {
          const app = host as WalkthroughApp;

          const { press, until, waitFor } = page;
          await using cleanup = new AsyncDisposableStack();
          const profile = zotlit.services.profile;
          await profile.materializeDefault();
          const file = app.vault.getFileByPath(profile.defaultDocumentPath)!;
          const original = await app.vault.read(file);
          cleanup.defer(async () => {
            for (const type of [
              "zotlit-template-workbench",
              "zotlit-template-data-explorer",
              "zotlit-note-preview",
            ])
              for (const leaf of app.workspace.getLeavesOfType(type))
                leaf.detach();
            await app.vault.modify(file, original);
          });
          // The built-in Profile writes its note name as a block scalar, which
          // YAML holds as written; a hand-written Profile quotes it.
          const lines = original.split("\n");
          const at = lines.indexOf("filename: |");
          if (at < 0) throw new Error("Block note name");
          lines.splice(
            at,
            2,
            `filename: '${lines[at + 1]!.trim().replaceAll("'", "''")}'`,
          );
          await app.vault.modify(file, lines.join("\n"));
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:customize-profile");
          const view = () =>
            page.leavesOfType("zotlit-template-workbench")[0]?.view;
          await waitFor(
            () =>
              !!view()?.contentEl.querySelector<HTMLElement>('[role="tab"]'),
            true,
            "Profile Editor",
          );
          const el = view()!.contentEl;
          // The layout can still be moving the editor into its popout; press a
          // tab once the reader can see it.
          const open = async (label: string) =>
            press(
              await until(
                `${label} tab shown`,
                () =>
                  Array.from(
                    el.querySelectorAll<HTMLElement>('[role="tab"]'),
                  ).find(
                    (tab) => tab.textContent === label && tab.checkVisibility(),
                  ),
                5000,
              ),
              label,
            );
          const type = (
            content: HTMLElement | undefined | null,
            text: string,
          ) => {
            const cm = (
              content as HTMLElement & {
                cmTile: { view: MarkdownView["editor"]["cm"] };
              }
            ).cmTile.view;
            cm.focus();
            cm.dispatch({
              changes: { from: 0, to: cm.state.doc.length, insert: text },
              selection: { anchor: text.length },
              userEvent: "input.type",
            });
            return () => cm.state.doc.toString();
          };
          await open(propertiesTab);
          const toggleOf = () =>
            Array.from(
              el.querySelectorAll<HTMLButtonElement>(
                "button[aria-controls][aria-expanded]",
              ),
            ).find((button) =>
              button.closest("li")?.innerText.startsWith("title\n"),
            );
          await waitFor(() => !!toggleOf(), true, "Title property row");
          const toggle = toggleOf();
          press(toggle, "title property");
          const ruleEditor = () =>
            el.ownerDocument
              .getElementById(toggle!.getAttribute("aria-controls")!)
              ?.querySelector<HTMLElement>(".cm-content");
          await waitFor(() => !!ruleEditor(), true, "Title rule editor");
          const ruleShown = type(ruleEditor(), ruleText);
          await waitFor(
            () => view()!.data.includes(storedRule),
            true,
            "Stored rule",
          );
          await open(nameAndFolderTab);
          const nameEditor = () =>
            Array.from(el.querySelectorAll<HTMLElement>(".cm-content")).find(
              (content) =>
                el.ownerDocument.getElementById(
                  content.getAttribute("aria-labelledby")!,
                )?.textContent === filenameLabel,
            );
          await waitFor(() => !!nameEditor(), true, "Note name editor");
          const nameShown = type(nameEditor(), nameText);
          await waitFor(
            () => view()!.data.includes(storedName),
            true,
            "Stored note name",
          );
          return String(
            JSON.stringify({
              rule: ruleShown(),
              name: nameShown(),
              invalid: el.textContent.includes(invalidMessage),
            }),
          );
        },
        {
          propertiesTab: m.workbench_tab_properties(),
          ruleText: rule,
          storedRule: `expr: '${rule}'`,
          nameAndFolderTab: m.workbench_tab_name_and_folder(),
          filenameLabel: m.workbench_name_filename_label(),
          nameText: name,
          storedName: `filename: '${name.replaceAll("'", "''")}'`,
          invalidMessage: m.workbench_problem_invalid_manifest(),
        },
      ),
    );
    expect(result).toEqual({ rule, name, invalid: false });
  });

  it("previews the full note path in the Profile editor and creates the note there", async () => {
    const m = await import("@obsidian-messages");
    // A paper no other walkthrough keeps a note for, so creation is not refused.
    const title = "Why Most Published Research Findings Are False";
    const result = JSON.parse(
      await obRun(
        vaultId,
        async (
          { app: host, zotlit, page },
          {
            noteTitle,
            tabLabel,
            filenameLabel,
            expectedPreviewPath,
            folderLabel,
            previewed,
          },
        ) => {
          const app = host as WalkthroughApp;

          const { press, until, waitFor } = page;
          await using cleanup = new AsyncDisposableStack();
          const services = zotlit.services;
          const types = [
            "zotlit-template-workbench",
            "zotlit-template-data-explorer",
            "zotlit-note-preview",
          ];
          const detach = () => {
            for (const type of types)
              for (const leaf of app.workspace.getLeavesOfType(type))
                leaf.detach();
          };
          detach();
          // The paper is searchable once the item index answers.
          let hits: SearchHit[] = [];
          const hit = await until(
            "Paper not found",
            async () => {
              hits = await services.itemLookup.search("ioannidis", {
                limit: 20,
              });
              return hits.find(
                (candidate) => candidate.item.key === "DMIANART",
              );
            },
            10000,
          ).catch(() => {
            throw new Error(
              `Paper not found: ${JSON.stringify(hits.map((candidate) => candidate.item.key))}`,
            );
          });
          const profile = await services.profile.create({
            label: "Path preview",
            bindings: { folder: "path-notes" },
          });
          cleanup.defer(async () => {
            detach();
            await services.profile.delete(profile.id, "default");
          });
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(app.vault.getFileByPath(profile.path)!);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:customize-profile");
          const view = () =>
            page.leavesOfType("zotlit-template-workbench")[0]?.view;
          await waitFor(
            () =>
              !!view()?.contentEl.querySelector<HTMLElement>('[role="tab"]'),
            true,
            "Profile editor",
          );
          const el = view()!.contentEl;
          // Choose item has its own walkthrough; this one starts from the paper.
          if (
            !(await view()!.selectItem({
              id: hit.item.indexedKey,
              title: noteTitle,
            }))
          )
            throw new Error("Profile item was not selected");
          press(
            Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')).find(
              (tab) => tab.textContent === tabLabel,
            ),
            "Name and folder",
          );
          const preview = () =>
            el.querySelector<HTMLElement>('[data-part="filename-output"]')
              ?.textContent;
          await waitFor(
            () => /^path-notes\/[^/]+\.md$/.test(preview() ?? ""),
            true,
            "Preview under the Profile folder",
          );
          // A slash in the note name makes a subfolder under the folder.
          const nameEditor = () =>
            Array.from(el.querySelectorAll<HTMLElement>(".cm-content")).find(
              (content) =>
                el.ownerDocument.getElementById(
                  content.getAttribute("aria-labelledby")!,
                )?.textContent === filenameLabel,
            );
          await waitFor(() => !!nameEditor(), true, "Note name editor");
          const cm = (
            nameEditor()! as HTMLElement & {
              cmTile: { view: MarkdownView["editor"]["cm"] };
            }
          ).cmTile.view;
          const name = "Findings/{{ zt.title }}";
          cm.focus();
          cm.dispatch({
            changes: { from: 0, to: cm.state.doc.length, insert: name },
            selection: { anchor: name.length },
            userEvent: "input.type",
          });
          await waitFor(
            preview,
            expectedPreviewPath,
            "Preview with a subfolder",
          );
          // A folder override moves the whole preview.
          const label = Array.from(
            el.querySelectorAll<HTMLLabelElement>("label[for]"),
          ).find((label) => label.textContent === folderLabel);
          const folder = el.ownerDocument.getElementById(
            label!.htmlFor,
          ) as HTMLInputElement;
          folder!.focus();
          folder!.value = "Reading list";
          folder!.dispatchEvent(
            new folder!.ownerDocument.defaultView!.Event("input", {
              bubbles: true,
            }),
          );
          folder!.dispatchEvent(
            new folder!.ownerDocument.defaultView!.FocusEvent("focusout", {
              bubbles: true,
            }),
          );
          await waitFor(
            preview,
            previewed,
            "Preview under the overridden folder",
          );
          await view()!.save();
          // The Profile takes the saved document once the template recompiles.
          await waitFor(
            () =>
              services.profile.resolveProfile(profile.id)?.bindings[
                "note.literature-folder"
              ],
            "Reading list",
            "Saved folder",
          );
          const created = await services.noteFeature.createNote(hit.item, {
            profile: profile.id,
          });
          if (created.outcome !== "created")
            throw new Error(`Note refused: ${created.diagnostic?.code}`);
          const path = created.file.path;
          cleanup.defer(async () => {
            for (const leaf of page.leavesOfType("markdown"))
              if ((leaf.view as MarkdownView).file?.path === path)
                leaf.detach();
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          });
          return String(
            JSON.stringify({ previewed: preview(), created: path }),
          );
        },
        {
          noteTitle: title,
          tabLabel: m.workbench_tab_name_and_folder(),
          filenameLabel: m.workbench_name_filename_label(),
          expectedPreviewPath: `path-notes/Findings/${title}.md`,
          folderLabel: m.workbench_name_binding_folder(),
          previewed: `Reading list/Findings/${title}.md`,
        },
      ),
    );
    expect(result).toEqual({
      previewed: `Reading list/Findings/${title}.md`,
      created: `Reading list/Findings/${title}.md`,
    });
  });

  it("keeps Annotation fields and preview when Customize reopens its workbench", async () => {
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        const file = await app.vault.create(
          "Reopen workbench.md",
          "---\nzotero-key: DMRGRART\n---\n# Workbench context",
        );
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return (
          app.metadataCache.getFileCache(
            app.vault.getFileByPath("Reopen workbench.md")!,
          )?.frontmatter?.["zotero-key"] === "DMRGRART"
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:1064" },
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.commands.executeCommandById("zotlit:customize-note-template");
        return String(true);
      },
      undefined,
    );

    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return !!page
          .leavesOfType("zotlit-template-workbench")[0]
          ?.view?.contentEl.querySelector<HTMLElement>('[role="tab"]');
      },
      undefined,
      { what: "walkthrough.e2e.ts:1077" },
    );
    await obRun(
      vaultId,
      async ({ page }) => {
        const { press } = page;
        press(
          Array.from(
            (page.leavesOfType("zotlit-template-workbench")[0]
              ?.view)!.contentEl.querySelectorAll<HTMLElement>('[role="tab"]'),
          ).find((tab) => tab.textContent === "Annotation"),
          "Annotation",
        );
        return String(true);
      },
      undefined,
    );

    const expected = {
      tab: "annotation",
      editor: "annotation",
      preview: "annotation",
      fields: "annotation",
    };
    await obRunUntil(
      vaultId,
      async ({ page }, { expectedJson }) => {
        return (
          JSON.stringify(
            (() => ({
              tab: (page.leavesOfType("zotlit-template-workbench")[0]
                ?.view)!.store.getState().tab,
              editor: (page.leavesOfType("zotlit-template-workbench")[0]
                ?.view)!.store.getState().root,
              preview: page
                .leavesOfType("zotlit-note-preview")[0]
                ?.view.getState().root,
              fields: page
                .leavesOfType("zotlit-template-data-explorer")[0]
                ?.view.getState().root,
            }))(),
          ) === expectedJson
        );
      },
      { expectedJson: JSON.stringify(expected) },
      { what: "walkthrough.e2e.ts:1100" },
    );
    await obRun(
      vaultId,
      async ({ app: host, page }) => {
        const app = host as WalkthroughApp;

        const note = page
          .leavesOfType("markdown")
          .find((leaf) => leaf.view.file?.path === "Reopen workbench.md");
        await app.workspace.revealLeaf(note!);
        app.workspace.setActiveLeaf(note!, { focus: true });
        return String(
          await app.commands.executeCommandById(
            "zotlit:customize-note-template",
          ),
        );
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async ({ app: host, page }) => {
        const app = host as WalkthroughApp;

        return (
          app.workspace.activeLeaf ===
          (page.leavesOfType("zotlit-template-workbench")[0]?.view)!.leaf
        );
      },
      undefined,
      { what: "walkthrough.e2e.ts:1115" },
    );
    expect(
      JSON.parse(
        await obRun(
          vaultId,
          async ({ page }) => {
            return String(
              JSON.stringify(
                (() => ({
                  tab: (page.leavesOfType("zotlit-template-workbench")[0]
                    ?.view)!.store.getState().tab,
                  editor: (page.leavesOfType("zotlit-template-workbench")[0]
                    ?.view)!.store.getState().root,
                  preview: page
                    .leavesOfType("zotlit-note-preview")[0]
                    ?.view.getState().root,
                  fields: page
                    .leavesOfType("zotlit-template-data-explorer")[0]
                    ?.view.getState().root,
                }))(),
              ),
            );
          },
          undefined,
        ),
      ),
    ).toEqual(expected);
  });

  it("keeps a switched note's subfolder under the target Profile's folder", async () => {
    const created = JSON.parse(
      await obRun(
        vaultId,
        async ({ app: host, zotlit }) => {
          const app = host as WalkthroughApp;

          const { profile } = zotlit.services;
          const books = await profile.create({
            label: "Books",
            bindings: { folder: "books" },
          });
          const folder = profile
            .resolveProfile("default")!
            .bindings["note.literature-folder"].replaceAll(/^\/+|\/+$/g, "");
          const dir = `${folder ? `${folder}/` : ""}2024`;
          if (!app.vault.getAbstractFileByPath(dir))
            await app.vault.createFolder(dir);
          const file = await app.vault.create(
            `${dir}/Subfolder move.md`,
            "---\nzotero-key: DMRGRART\n---\nMy reading notes\n",
          );
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return String(JSON.stringify({ id: books.id, path: file.path }));
        },
        undefined,
      ),
    ) as { id: string; path: string };
    await obRunUntil(
      vaultId,
      async ({ app: host }, { createdPath }) => {
        const app = host as WalkthroughApp;

        return (
          app.metadataCache.getFileCache(app.vault.getFileByPath(createdPath)!)
            ?.frontmatter?.["zotero-key"] === "DMRGRART"
        );
      },
      { createdPath: created.path },
      { what: "walkthrough.e2e.ts:1145" },
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        return String(
          await app.commands.executeCommandById(
            "zotlit:switch-literature-note-profile",
          ),
        );
      },
      undefined,
    );
    const target = "books/2024/Subfolder move.md";

    await obRunUntil(
      vaultId,
      async (_context, { target }) => {
        return !!Array.from(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".prompt"))
            .at(-1)
            ?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [],
        ).find((el) => el.textContent.includes(target));
      },
      { target },
      { what: "walkthrough.e2e.ts:1158" },
    );
    await obRun(
      vaultId,
      async ({ page }, { target }) => {
        const { press } = page;
        press(
          Array.from(
            Array.from(activeDocument.querySelectorAll<HTMLElement>(".prompt"))
              .at(-1)
              ?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [],
          ).find((el) => el.textContent.includes(target)),
          "Profile row",
        );
        return String(true);
      },
      { target },
    );

    await obRunUntil(
      vaultId,
      async (_context) => {
        return !!(() => {
          const modal = Array.from(
            activeDocument.querySelectorAll<HTMLElement>(".modal"),
          ).at(-1);
          return Array.from(
            modal?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ??
              [],
          ).find((input) => {
            for (
              let el = input.parentElement;
              el && el !== modal;
              el = el.parentElement
            ) {
              if (
                el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")
                  .length > 1
              )
                return false;
              if (el.textContent.includes("Move to books/2024/")) return true;
            }
            return false;
          });
        })();
      },
      undefined,
      { what: "walkthrough.e2e.ts:1166" },
    );
    await obRun(
      vaultId,
      async ({ page }) => {
        const { press } = page;
        press(
          (() => {
            const modal = Array.from(
              activeDocument.querySelectorAll<HTMLElement>(".modal"),
            ).at(-1);
            return Array.from(
              modal?.querySelectorAll<HTMLInputElement>(
                "input[type=checkbox]",
              ) ?? [],
            ).find((input) => {
              for (
                let el = input.parentElement;
                el && el !== modal;
                el = el.parentElement
              ) {
                if (
                  el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")
                    .length > 1
                )
                  return false;
                if (el.textContent.includes("Move to books/2024/")) return true;
              }
              return false;
            });
          })(),
          "Move to books/2024/",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async ({ page }) => {
        const { press } = page;
        const modal = Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal"),
        ).at(-1);
        const button = Array.from(
          modal?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((el) => el.textContent.trim() === "Switch to “Books”");
        if (!button) return false;
        press(button, "Switch to Books");
        return true;
      },
      undefined,
      { what: "walkthrough.e2e.ts:1173" },
    );
    await obRunUntil(
      vaultId,
      async ({ app: host }, { target }) => {
        const app = host as WalkthroughApp;

        return (
          app.metadataCache.getFileCache(app.vault.getFileByPath(target)!)
            ?.frontmatter?.["zotlit-profile"] ?? ""
        );
      },
      { target },
      {
        ready: (value) => value === `Books (${created.id})`,
        what: "walkthrough.e2e.ts:1180",
      },
    );
    expect(
      await obRun(
        vaultId,
        async ({ app: host, zotlit }, { target, createdPath, createdId }) => {
          const app = host as WalkthroughApp;

          const moved = app.vault.getFileByPath(target)!;
          const body = await app.vault.read(moved);
          const left = !!app.vault.getAbstractFileByPath(createdPath);
          await app.vault.delete(moved);
          const { profile } = zotlit.services;
          await app.vault.delete(
            app.vault.getFileByPath(
              profile.profiles.find((p) => p.id === createdId)!.path,
            )!,
          );
          app.workspace.detachLeavesOfType("empty");
          return String(String(!left && body.includes("My reading notes")));
        },
        { target, createdPath: created.path, createdId: created.id },
      ),
    ).toBe("true");
  });

  it("creates a Profile from a name alone in Add profile and opens it on Name and folder", async () => {
    const m = await import("@obsidian-messages");
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.vault.setConfig("settingsPopoutWindow", false);
        app.setting.open();
        return String(true);
      },
      undefined,
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.setting.openTabById("zotlit");
        return String(true);
      },
      undefined,
    );
    await obRun(
      vaultId,
      async ({ app: host }) => {
        const app = host as WalkthroughApp;

        app.setting.navigateToSearchResult({
          tab: app.setting.activeTab!,
          pagePath: ["settings_page_profiles"],
        });
        return String(true);
      },
      undefined,
    );

    await obRunUntil(
      vaultId,
      async ({ app: host }, { addProfileLabel }) => {
        const app = host as WalkthroughApp;

        return !!app.setting.containerEl.querySelector<HTMLElement>(
          `[aria-label=${JSON.stringify(addProfileLabel)}]`,
        );
      },
      { addProfileLabel: m.settings_profile_add() },
      { what: "walkthrough.e2e.ts:1216" },
    );
    await obRun(
      vaultId,
      async ({ app: host, page }, { addProfileLabel }) => {
        const app = host as WalkthroughApp;

        const { press } = page;
        press(
          app.setting.containerEl.querySelector<HTMLElement>(
            `[aria-label=${JSON.stringify(addProfileLabel)}]`,
          ),
          "Add profile",
        );
        return String(true);
      },
      { addProfileLabel: m.settings_profile_add() },
    );

    await obRunUntil(
      vaultId,
      async (_context, { addProfileLabel }) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(".modal"),
        )
          .find(
            (el) =>
              el.querySelector<HTMLElement>(".modal-title")?.textContent ===
              addProfileLabel,
          )
          ?.querySelector<HTMLElement>('p[role="status"]')?.textContent;
      },
      { addProfileLabel: m.settings_profile_add() },
      {
        ready: (value) => value === m.settings_profile_name_invalid(),
        what: "walkthrough.e2e.ts:1225",
      },
    );
    expect(
      await obRun(
        vaultId,
        async (_context, { addProfileLabel }) => {
          return String(
            String(
              (Array.from(
                activeDocument.querySelectorAll<HTMLElement>(".modal"),
              )
                .find(
                  (el) =>
                    el.querySelector<HTMLElement>(".modal-title")
                      ?.textContent === addProfileLabel,
                )
                ?.querySelector<HTMLElement>(
                  'p[role="status"]',
                ))!.classList.contains("zt:text-(--text-error)"),
            ),
          );
        },
        { addProfileLabel: m.settings_profile_add() },
      ),
    ).toBe("false");

    expect(
      await obRun(
        vaultId,
        async (_context, { addProfileLabel }) => {
          return String(
            String(
              Array.from(
                Array.from(
                  activeDocument.querySelectorAll<HTMLElement>(".modal"),
                )
                  .find(
                    (el) =>
                      el.querySelector<HTMLElement>(".modal-title")
                        ?.textContent === addProfileLabel,
                  )!
                  .querySelectorAll<HTMLButtonElement>(
                    ".modal-button-container button",
                  ),
              ).find((el) => el.textContent === addProfileLabel)!.disabled,
            ),
          );
        },
        { addProfileLabel: m.settings_profile_add() },
      ),
    ).toBe("true");
    await obRun(
      vaultId,
      async (_context, { addProfileLabel, profileNameText }) => {
        const input = Array.from(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .find(
              (el) =>
                el.querySelector<HTMLElement>(".modal-title")?.textContent ===
                addProfileLabel,
            )!
            .querySelectorAll<HTMLLabelElement>("label"),
        )
          .find((el) => el.firstChild?.textContent === profileNameText)!
          .querySelector<HTMLInputElement>("input");
        input!.value = "Reading group";
        input!.dispatchEvent(
          new input!.ownerDocument.defaultView!.Event("input", {
            bubbles: true,
          }),
        );
        return String(true);
      },
      {
        addProfileLabel: m.settings_profile_add(),
        profileNameText: m.settings_profile_name_name(),
      },
    );
    await obRunUntil(
      vaultId,
      async (_context, { addProfileLabel }) => {
        return Array.from(
          Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
            .find(
              (el) =>
                el.querySelector<HTMLElement>(".modal-title")?.textContent ===
                addProfileLabel,
            )!
            .querySelectorAll<HTMLButtonElement>(
              ".modal-button-container button",
            ),
        ).find((el) => el.textContent === addProfileLabel)!.disabled;
      },
      { addProfileLabel: m.settings_profile_add() },
      { ready: (value) => value === false, what: "walkthrough.e2e.ts:1242" },
    );
    await obRun(
      vaultId,
      async ({ page }, { addProfileLabel }) => {
        const { press } = page;
        press(
          Array.from(
            Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal"))
              .find(
                (el) =>
                  el.querySelector<HTMLElement>(".modal-title")?.textContent ===
                  addProfileLabel,
              )!
              .querySelectorAll<HTMLButtonElement>(
                ".modal-button-container button",
              ),
          ).find((el) => el.textContent === addProfileLabel),
          "Add",
        );
        return String(true);
      },
      { addProfileLabel: m.settings_profile_add() },
    );

    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return page
          .leavesOfType("zotlit-template-workbench")
          .map((leaf) => leaf.view)
          .find((view) => view.file?.name === "zotlit-profile.reading-group.md")
          ?.store.getState().tab;
      },
      undefined,
      { ready: (value) => value === "name", what: "walkthrough.e2e.ts:1252" },
    );
    expect(
      await obRun(
        vaultId,
        async ({ app: host, page }) => {
          const app = host as WalkthroughApp;

          return String(
            await app.vault
              .read(
                page
                  .leavesOfType("zotlit-template-workbench")
                  .map((leaf) => leaf.view)
                  .find(
                    (view) =>
                      view.file?.name === "zotlit-profile.reading-group.md",
                  )!.file!,
              )
              .then((text) => String(/^folder:/m.test(text))),
          );
        },
        undefined,
      ),
    ).toBe("false");
  });
});
