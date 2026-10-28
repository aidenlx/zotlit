// Uses observed through real note navigation, Recent, empty search and Query CLI.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceLeaf, MarkdownView } from "obsidian";
import { expect } from "vitest";

import type { LibraryView } from "@/views/library/view";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { cli, cliCommand } from "./obsidian-cli.ts";
import type { LinkMarkdownView } from "./page-library-types.ts";
import type {} from "./page-library-types.ts";
import type { FileExplorerView } from "./page-notes-types.ts";

const target = "AAAAAAAA";
const targetPath = "literatures/AAAAAAAA.md";
const sourcePath = "Use navigation.md";
const targetTitle = "Alpha of the personal library";
const targetCitekey = "personalAlpha2024";
const sourceText = "[[literatures/AAAAAAAA]]\n\n[@personalAlpha2024]\n";

/** Failure modes: a route misses a Use, browsing records one, or restore reorders. */
export async function verifyRecentUses(
  vaultId: string,
  vaultPath: string,
  reloadWindow: () => Promise<void>,
) {
  const m = await import("@obsidian-messages");

  const originalNote = await readFile(join(vaultPath, targetPath), "utf8");
  const saved = await obRun(
    vaultId,
    async ({ app, zotlit }) => {
      return JSON.stringify({
        layout: app.workspace.getLayout(),
        settings: zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        ),
        ledger: app.loadLocalStorage("zotlit-use-ledger") ?? null,
      });
    },
    undefined,
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    const restored = await obRun(
      vaultId,
      async ({ app, zotlit }, { saved }) => {
        app.workspace.requestActiveLeafEvents.run();
        const oldServices = zotlit.services;
        await app.plugins.disablePlugin("zotlit");
        const stillOpen = () =>
          !oldServices.bridge.closed() ||
          oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings)
            .length > 0;
        for (let i = 0; i < 200 && stillOpen(); i++)
          await new Promise((r) => setTimeout(r, 25));
        if (stillOpen()) throw new Error("The ZotLit services did not close");
        app.saveLocalStorage("zotlit-use-ledger", JSON.parse(saved).ledger);
        await app.plugins.enablePlugin("zotlit");
        return JSON.stringify(
          Object.fromEntries(
            Object.entries(
              zotlit.services.bridge.runSync(zotlit.services.useLedger.current),
            ).map(([key, use]) => [
              key,
              {
                kind: use.kind,
                instant: Temporal.Instant.fromEpochMilliseconds(
                  use.instant.epochMilliseconds,
                ).toString(),
              },
            ]),
          ),
        );
      },
      { saved: saved },
    );
    expect(JSON.parse(restored)).toEqual(JSON.parse(saved).ledger ?? {});
  });
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async (
        { app, zotlit },
        { targetpath, originalnote, savedInput, sourcepath },
      ) => {
        const s = zotlit.services;
        await app.vault.modify(
          app.vault.getFileByPath(`${targetpath}`)!,
          originalnote,
        );
        const saved = JSON.parse(savedInput);
        s.bridge.runSync(
          s.settings.update({
            "library.document": saved.settings["library.document"] ?? null,
            "citation.pandoc-citations":
              saved.settings["citation.pandoc-citations"],
            "citation.open-as-links": saved.settings["citation.open-as-links"],
          }),
        );
        await s.bridge.runPromise(s.settings.flush);
        await app.workspace.changeLayout(saved.layout);
        const file = app.vault.getFileByPath(sourcepath);
        if (file) await app.vault.delete(file);
      },
      {
        targetpath: targetPath,
        originalnote: originalNote,
        savedInput: saved,
        sourcepath: sourcePath,
      },
    );
  });
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { sourcepath, sourcetext }) => {
      const { until } = page;
      const s = zotlit.services;
      (
        app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
          view: LibraryView;
        })[]
      ).forEach((l) => l.detach());
      s.bridge.runSync(
        s.settings.update({
          "library.document": null,
          "citation.pandoc-citations": true,
          "citation.open-as-links": true,
        }),
      );
      await s.bridge.runPromise(s.settings.flush);
      await app.vault.create(sourcepath, sourcetext);
      app.commands.executeCommandById("zotlit:open-library-view");
      await until(
        "Recent view",
        () =>
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view.query,
      );
    },
    { sourcepath: sourcePath, sourcetext: sourceText },
  );

  const timeline = async () => {
    const envelope = JSON.parse(
      await cliCommand(vaultId, "zotlit:query", {
        args: {
          from: "items",
          fields: "indexedKey,lastActivity",
          sort: "-lastActivity",
          limit: "all",
        },
      }),
    ) as {
      ok: boolean;
      rows: { indexedKey: string; values: { lastActivity: string | null } }[];
    };
    expect(envelope.ok).toBe(true);
    return envelope.rows;
  };

  const first = async (key: string, reason = "opened") => {
    await obRunUntil(
      vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return [];
        await view.query.settled;
        return [
          ...view.contentEl.querySelectorAll<HTMLElement>(
            "[data-query-papers-row]",
          ),
        ].map((n) => n.getAttribute("data-query-papers-row")!);
      },
      undefined,
      {
        what: `Recent to put ${key} first`,
        ready: (value) => value !== null && ((rows) => rows[0] === key)(value),
      },
    );
    expect(
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return (
            await zotlit.services.itemLookup.search("", { limit: 1 })
          ).map((h) => h.item.indexedKey);
        },
        undefined,
      ),
    ).toEqual([key]);
    expect((await timeline())[0]?.indexedKey).toBe(key);
    const metadata = await obRun(
      vaultId,
      async ({ app }, { key }) => {
        const row = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          `[data-query-papers-row="${key}"]`,
        );
        return row!.querySelector<HTMLElement>("[data-query-papers-title]")!
          .parentElement!.lastElementChild!.textContent;
      },
      { key: key },
    );
    expect(metadata).toContain(`${reason} `);
    expect(metadata.endsWith("in Obsidian")).toBe(true);
  };
  const quick = async (choose: boolean, alt = false) => {
    await obRun(
      vaultId,
      async ({ app, page }, { choose, choice, choiceInput, alt }) => {
        const { until } = page;

        app.commands.executeCommandById("zotlit:note-quick-switcher");
        const input = await until("quick switcher", () =>
          activeDocument.querySelector<HTMLElement>(".prompt input"),
        );
        if (choose) {
          (input as HTMLInputElement).value = "Alpha of the personal library";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
        }
        const row = await until("Alpha suggestion", () =>
          [
            ...activeDocument.querySelectorAll<HTMLElement>(
              ".prompt .suggestion-item",
            ),
          ].find((n) =>
            n.textContent.includes("Alpha of the personal library"),
          ),
        );
        if (choose) {
          row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        } else {
          if (
            row !==
            activeDocument.querySelector<HTMLElement>(
              ".prompt .suggestion-item",
            )
          )
            throw Error("Empty quick switcher did not put Alpha first");
        }
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: `${choice}`,
            code: `${choice}`,
            keyCode: choiceInput,
            which: choiceInput,
            altKey: alt,
            bubbles: true,
          }),
        );
        await until(
          "switcher closes",
          () => !activeDocument.querySelector<HTMLElement>(".prompt"),
        );
      },
      {
        choose: choose,
        choice: choose ? "Enter" : "Escape",
        choiceInput: choose ? 13 : 27,
        alt: alt,
      },
    );
  };
  /** Open an empty Citation Suggester and assert its first paper. */

  for (const route of [
    "quick switcher",
    "Library row",
    "wikilink",
    "file explorer",
    "citekey",
  ] as const) {
    await obRun(
      vaultId,
      async ({ app }) => {
        await app.workspace.openLinkText("literatures/CCCC3333.md", "");
        app.workspace.requestActiveLeafEvents.run();
      },
      undefined,
    );
    await first("CCCC3333");
    await obRun(
      vaultId,
      async ({ app }, { sourcepath, choice, condition }) => {
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
          state: { mode: choice, source: condition },
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.workspace.requestActiveLeafEvents.run();
      },
      {
        sourcepath: sourcePath,
        choice: route === "wikilink" ? "preview" : "source",
        condition: (route === "wikilink" ? "preview" : "source") === "source",
      },
    );
    if (route === "quick switcher") await quick(true);
    if (route === "Library row")
      await obRun(
        vaultId,
        async ({ app, page }) => {
          const { until } = page;

          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const row = await until("Alpha row", () =>
            leaf!.view.contentEl.querySelector<HTMLElement>(
              '[data-query-item-row="AAAAAAAA"]',
            ),
          );
          row.click();
          row.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        },
        undefined,
      );
    if (route === "wikilink")
      await obRun(
        vaultId,
        async ({ app, page }) => {
          const { until } = page;

          const link = await until("wikilink", () =>
            app.workspace.activeLeaf!.view.containerEl.querySelector<HTMLElement>(
              'a.internal-link[data-href="literatures/AAAAAAAA"]',
            ),
          );
          link.click();
        },
        undefined,
      );
    if (route === "file explorer")
      await obRun(
        vaultId,
        async ({ app, page }, { targetpath }) => {
          const { until } = page;

          const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
          app.workspace.leftSplit.expand();
          await app.workspace.revealLeaf(leaf!);
          (leaf!.view as FileExplorerView).revealInFolder(
            app.vault.getFileByPath(`${targetpath}`)!,
          );
          const row = await until(
            "explorer file row",
            () =>
              (leaf!.view as FileExplorerView).fileItems[`${targetpath}`]!
                .selfEl.isConnected &&
              (leaf!.view as FileExplorerView).fileItems[`${targetpath}`]!
                .selfEl,
          );
          row.dispatchEvent(
            new MouseEvent("click", { bubbles: true, detail: 1 }),
          );
        },
        { targetpath: targetPath },
      );
    if (route === "citekey")
      await obRun(
        vaultId,
        async ({ app }) => {
          (app.workspace.activeLeaf!.view as MarkdownView).editor.setCursor({
            line: 2,
            ch: 8,
          });
          app.commands.executeCommandById("zotlit:open-citekey");
        },
        undefined,
      );
    await first(target);
    await quick(false);
  }

  // The tab stays open while another note is used, then becomes active again.
  await obRun(
    vaultId,
    async ({ app }, { targetpath }) => {
      const target = (
        app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
          view: MarkdownView;
        })[]
      ).find((l) => l.view.file?.path === `${targetpath}`);
      const other = app.workspace.getLeaf("tab");
      await other.openFile(app.vault.getFileByPath("literatures/CCCC3333.md")!);
      app.workspace.requestActiveLeafEvents.run();
      await app.workspace.revealLeaf(target!);
      app.workspace.setActiveLeaf(target!, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { targetpath: targetPath },
  );
  await first(target);
  const beforeReload = await timeline();
  const ledger = await obRun(
    vaultId,
    async ({ zotlit }) => {
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(
            zotlit.services.bridge.runSync(zotlit.services.useLedger.current),
          ).map(([key, use]) => [
            key,
            {
              kind: use.kind,
              instant: Temporal.Instant.fromEpochMilliseconds(
                use.instant.epochMilliseconds,
              ).toString(),
            },
          ]),
        ),
      );
    },
    undefined,
  );
  const local = await obRun(
    vaultId,
    async ({ app }) => {
      return app.loadLocalStorage("zotlit-use-ledger");
    },
    undefined,
  );
  expect(local).toMatchObject({ AAAAAAAA: { kind: "opened" } });
  const pluginData = await readFile(
    join(vaultPath, ".obsidian/plugins/zotlit/data.json"),
    "utf8",
  );
  expect(pluginData).not.toContain("zotlit-use-ledger");
  for (const use of Object.values(JSON.parse(ledger)) as { instant: string }[])
    expect(pluginData).not.toContain(use.instant);
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  await obRunUntil(
    vaultId,
    async ({ zotlit }) => {
      return !!zotlit.services;
    },
    undefined,
    { what: "the zotlit plugin services to be available" },
  );
  expect(await timeline()).toEqual(beforeReload);
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return JSON.stringify(
          Object.fromEntries(
            Object.entries(
              zotlit.services.bridge.runSync(zotlit.services.useLedger.current),
            ).map(([key, use]) => [
              key,
              {
                kind: use.kind,
                instant: Temporal.Instant.fromEpochMilliseconds(
                  use.instant.epochMilliseconds,
                ).toString(),
              },
            ]),
          ),
        );
      },
      undefined,
    ),
  ).toBe(ledger);
  await reloadWindow();
  expect(await timeline()).toEqual(beforeReload);
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return JSON.stringify(
          Object.fromEntries(
            Object.entries(
              zotlit.services.bridge.runSync(zotlit.services.useLedger.current),
            ).map(([key, use]) => [
              key,
              {
                kind: use.kind,
                instant: Temporal.Instant.fromEpochMilliseconds(
                  use.instant.epochMilliseconds,
                ).toString(),
              },
            ]),
          ),
        );
      },
      undefined,
    ),
  ).toBe(ledger);
  await obRun(
    vaultId,
    async ({ app }) => {
      const leaf = (
        app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
          view: LibraryView;
        })[]
      )[0];
      await app.workspace.revealLeaf(leaf!);
      app.workspace.setActiveLeaf(leaf!, { focus: true });
    },
    undefined,
  );
  await first(target);

  // Selecting a Citation Suggester result records the cited paper after the
  // editor accepts its text. Recent and the next empty suggester both agree.
  await obRun(
    vaultId,
    async ({ app }) => {
      await app.workspace.openLinkText("literatures/CCCC3333.md", "");
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  await first("CCCC3333");
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, sourceInput, enabled }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: sourceInput, source: enabled },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { sourcepath: sourcePath, sourceInput: "source", enabled: true },
  );
  await obRun(
    vaultId,
    async ({ app, page }, { value, targettitle, valueInput }) => {
      const { until } = page;

      const leaf = app.workspace.activeLeaf;
      const editor = (leaf!.view as MarkdownView).editor;
      editor.setValue("");
      editor.focus();
      const cm = editor.cm;
      for (const ch of value) {
        cm.dispatch(cm.state.replaceSelection(ch), { userEvent: "input.type" });
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      const popup = await until("Citation Suggester", () =>
        [
          ...activeDocument.querySelectorAll<HTMLElement>(
            ".suggestion-container",
          ),
        ].at(-1),
      );
      const row = await until("Alpha citation", () =>
        [...popup.querySelectorAll<HTMLElement>(".suggestion-item")].find(
          (n) =>
            !n.closest<HTMLElement>("[aria-busy]") &&
            n.textContent.includes(targettitle),
        ),
      );
      row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await until("citation inserted", () => editor.getValue() === valueInput);
    },
    {
      value: `[@${targetTitle}`,
      targettitle: targetTitle,
      valueInput: `[@${targetCitekey}]`,
    },
  );
  await first(target, "cited");
  await obRun(
    vaultId,
    async (
      { app, zotlit, page },
      {
        sourcepath,
        choice,
        target,
        enabled,
        targettitle,
        mCitation_suggester_cited_in_noteResult,
      },
    ) => {
      const { until } = page;
      const s = zotlit.services;
      const leaf = (
        app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
          view: MarkdownView;
        })[]
      ).find((l) => l.view.file?.path === sourcepath);
      await app.workspace.revealLeaf(leaf!);
      app.workspace.setActiveLeaf(leaf!, { focus: true });
      const editor = leaf!.view.editor;
      editor.setValue(choice);
      await leaf!.view.save();
      if (enabled) {
        await until("document citations", async () =>
          (
            await s.bridge.runPromise(
              s.citationIndex.getDocumentCitationSet(leaf!.view.file!),
            )
          ).citations.some((c) => c.indexedKey === `${target}`),
        );
      } else {
      }
      editor.setCursor(editor.offsetToPos(editor.getValue().length));
      editor.focus();
      const cm = editor.cm;
      cm.dispatch(cm.state.replaceSelection("[@"), { userEvent: "input.type" });
      const popup = await until("Citation Suggester", () =>
        [
          ...activeDocument.querySelectorAll<HTMLElement>(
            ".suggestion-container",
          ),
        ].at(-1),
      );
      const row = await until("first citation", () =>
        popup.querySelector<HTMLElement>(".suggestion-item"),
      );
      if (!row.textContent.includes(targettitle))
        throw Error(
          `Empty Citation Suggester did not put Alpha first: ${row.textContent}`,
        );
      if (enabled) {
        if (
          ![
            ...row.querySelectorAll<HTMLElement>(
              ".zt-suggestion-flair-inline,.zt-suggestion-flair-text",
            ),
          ].some(
            (el) =>
              el.checkVisibility() &&
              el.textContent === mCitation_suggester_cited_in_noteResult,
          )
        )
          throw Error("Cited paper has no visible label");
      } else {
      }
      activeWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
        }),
      );
      await until("Citation Suggester closes", () => !popup.isConnected);
    },
    {
      sourcepath: sourcePath,
      choice: "",
      target: target,
      enabled: false,
      targettitle: targetTitle,
      mCitation_suggester_cited_in_noteResult:
        m.citation_suggester_cited_in_note(),
    },
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      await app.workspace.openLinkText("literatures/CCCC3333.md", "");
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  await first("CCCC3333");
  // A paper the note cites leads the empty suggester over a newer paper.
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, sourceInput, enabled }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: sourceInput, source: enabled },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { sourcepath: sourcePath, sourceInput: "source", enabled: true },
  );
  await obRun(
    vaultId,
    async (
      { app, zotlit, page },
      {
        sourcepath,
        choice,
        target,
        enabled,
        targettitle,
        mCitation_suggester_cited_in_noteResult,
      },
    ) => {
      const { until } = page;
      const s = zotlit.services;
      const leaf = (
        app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
          view: MarkdownView;
        })[]
      ).find((l) => l.view.file?.path === sourcepath);
      await app.workspace.revealLeaf(leaf!);
      app.workspace.setActiveLeaf(leaf!, { focus: true });
      const editor = leaf!.view.editor;
      editor.setValue(choice);
      await leaf!.view.save();
      if (enabled) {
        await until("document citations", async () =>
          (
            await s.bridge.runPromise(
              s.citationIndex.getDocumentCitationSet(leaf!.view.file!),
            )
          ).citations.some((c) => c.indexedKey === `${target}`),
        );
      } else {
      }
      editor.setCursor(editor.offsetToPos(editor.getValue().length));
      editor.focus();
      const cm = editor.cm;
      cm.dispatch(cm.state.replaceSelection("[@"), { userEvent: "input.type" });
      const popup = await until("Citation Suggester", () =>
        [
          ...activeDocument.querySelectorAll<HTMLElement>(
            ".suggestion-container",
          ),
        ].at(-1),
      );
      const row = await until("first citation", () =>
        popup.querySelector<HTMLElement>(".suggestion-item"),
      );
      if (!row.textContent.includes(targettitle))
        throw Error(
          `Empty Citation Suggester did not put Alpha first: ${row.textContent}`,
        );
      if (enabled) {
        if (
          ![
            ...row.querySelectorAll<HTMLElement>(
              ".zt-suggestion-flair-inline,.zt-suggestion-flair-text",
            ),
          ].some(
            (el) =>
              el.checkVisibility() &&
              el.textContent === mCitation_suggester_cited_in_noteResult,
          )
        )
          throw Error("Cited paper has no visible label");
      } else {
      }
      activeWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
        }),
      );
      await until("Citation Suggester closes", () => !popup.isConnected);
    },
    {
      sourcepath: sourcePath,
      choice: `[@${targetCitekey}]\n\n`,
      target: target,
      enabled: true,
      targettitle: targetTitle,
      mCitation_suggester_cited_in_noteResult:
        m.citation_suggester_cited_in_note(),
    },
  );

  // Dragging a Library row into the note runs the same successful insert
  // decision. The Use is visible through Recent and an empty suggester.
  await obRun(
    vaultId,
    async ({ app }) => {
      await app.workspace.openLinkText("literatures/CCCC3333.md", "");
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  await first("CCCC3333");
  await obRun(
    vaultId,
    async ({ app, page }, { sourcepath, target, value }) => {
      const { until } = page;

      const note = app.workspace.getLeaf("split");
      await note.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: "source", source: true },
      });
      const editor = (note.view as MarkdownView).editor;
      editor.setValue("");
      const cm = editor.cm;
      const library = (
        app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
          view: LibraryView;
        })[]
      )[0];
      await app.workspace.revealLeaf(library!);
      await library!.view.query.settled;
      const row = await until("Alpha row", () =>
        library!.view.contentEl.querySelector<HTMLElement>(
          `[data-query-item-row="${target}"]`,
        ),
      );
      row.scrollIntoView({ block: "center", behavior: "instant" });
      const transfer = new DataTransfer();
      row.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
      const at = cm.coordsAtPos(0);
      if (!at) throw Error("Citation destination is not visible");
      cm.contentDOM.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: Math.floor(at.left + 1),
          clientY: Math.floor((at.top + at.bottom) / 2),
        }),
      );
      row.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
      await until(
        "dragged citation inserted",
        () => editor.getValue() === value,
      );
    },
    { sourcepath: sourcePath, target: target, value: `[@${targetCitekey}]` },
  );
  await first(target, "cited");
  await obRun(
    vaultId,
    async (
      { app, zotlit, page },
      {
        sourcepath,
        choice,
        target,
        enabled,
        targettitle,
        mCitation_suggester_cited_in_noteResult,
      },
    ) => {
      const { until } = page;
      const s = zotlit.services;
      const leaf = (
        app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
          view: MarkdownView;
        })[]
      ).find((l) => l.view.file?.path === sourcepath);
      await app.workspace.revealLeaf(leaf!);
      app.workspace.setActiveLeaf(leaf!, { focus: true });
      const editor = leaf!.view.editor;
      editor.setValue(choice);
      await leaf!.view.save();
      if (enabled) {
        await until("document citations", async () =>
          (
            await s.bridge.runPromise(
              s.citationIndex.getDocumentCitationSet(leaf!.view.file!),
            )
          ).citations.some((c) => c.indexedKey === `${target}`),
        );
      } else {
      }
      editor.setCursor(editor.offsetToPos(editor.getValue().length));
      editor.focus();
      const cm = editor.cm;
      cm.dispatch(cm.state.replaceSelection("[@"), { userEvent: "input.type" });
      const popup = await until("Citation Suggester", () =>
        [
          ...activeDocument.querySelectorAll<HTMLElement>(
            ".suggestion-container",
          ),
        ].at(-1),
      );
      const row = await until("first citation", () =>
        popup.querySelector<HTMLElement>(".suggestion-item"),
      );
      if (!row.textContent.includes(targettitle))
        throw Error(
          `Empty Citation Suggester did not put Alpha first: ${row.textContent}`,
        );
      if (enabled) {
        if (
          ![
            ...row.querySelectorAll<HTMLElement>(
              ".zt-suggestion-flair-inline,.zt-suggestion-flair-text",
            ),
          ].some(
            (el) =>
              el.checkVisibility() &&
              el.textContent === mCitation_suggester_cited_in_noteResult,
          )
        )
          throw Error("Cited paper has no visible label");
      } else {
      }
      activeWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
        }),
      );
      await until("Citation Suggester closes", () => !popup.isConnected);
    },
    {
      sourcepath: sourcePath,
      choice: "",
      target: target,
      enabled: false,
      targettitle: targetTitle,
      mCitation_suggester_cited_in_noteResult:
        m.citation_suggester_cited_in_note(),
    },
  );
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, sourcetext }) => {
      const leaves = (
        app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
          view: MarkdownView;
        })[]
      ).filter((l) => l.view.file?.path === sourcepath);
      for (const leaf of leaves) leaf.view.editor.setValue(sourcetext);
      for (const leaf of leaves) await leaf.view.save();
    },
    { sourcepath: sourcePath, sourcetext: sourceText },
  );

  // Annotation follow, row selection and the Reading Card consume no Use.
  const beforeBrowse = await timeline();
  await obRun(
    vaultId,
    async ({ app, page }) => {
      const { until } = page;

      app.commands.executeCommandById("zotlit:open-annot-view");
      app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
      const leaf = (
        app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
          view: LibraryView;
        })[]
      )[0];
      await app.workspace.revealLeaf(leaf!);
      app.workspace.setActiveLeaf(leaf!, { focus: true });
      await leaf!.view.query.settled;
      leaf!.view.contentEl
        .querySelector<HTMLElement>('[data-query-item-row="CCCC3333"]')!
        .click();
      await until("Reading Card", () =>
        leaf!.view.contentEl
          .querySelector<HTMLElement>("[data-library-card]")
          ?.checkVisibility(),
      );
    },
    undefined,
  );
  expect(await timeline()).toEqual(beforeBrowse);
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, preview, enabled }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: preview, source: enabled },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { sourcepath: sourcePath, preview: "preview", enabled: false },
  );
  await obRun(
    vaultId,
    async ({ app, page }, { sourcepath }) => {
      const { until } = page;

      const leaf = app.workspace.activeLeaf;
      const targetEl = await until("preview link", () =>
        leaf!.view.containerEl.querySelector<HTMLElement>("a.internal-link"),
      );
      const rect = targetEl.getBoundingClientRect();
      app.workspace.trigger("hover-link", {
        event: new MouseEvent("mouseover", {
          clientX: rect.left + 5,
          clientY: rect.top + 5,
          ctrlKey: true,
          metaKey: true,
        }),
        source: "preview",
        hoverParent: leaf!.view,
        targetEl,
        linktext: "literatures/AAAAAAAA",
        sourcePath: `${sourcepath}`,
      });
      await until(
        "Literature Note preview",
        () =>
          activeDocument.querySelector<HTMLElement>(
            ".hover-popover .markdown-embed",
          ),
        10000,
      );
      const popover = (leaf!.view as LinkMarkdownView).hoverPopover;
      if (popover)
        if (typeof popover.hide === "function") popover.hide();
        else popover.unload();
    },
    { sourcepath: sourcePath },
  );
  expect(await timeline()).toEqual(beforeBrowse);
  await quick(true, true);
  expect(await timeline()).toEqual(beforeBrowse);

  // Call the registered handlers that receive the Companion's URI, keeping
  // its update navigation while excluding that operation's activation only.
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, sourceInput, enabled }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: sourceInput, source: enabled },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { sourcepath: sourcePath, sourceInput: "source", enabled: true },
  );
  const beforeUpdate = await timeline();
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { targetpath }) => {
      const { until } = page;
      const s = zotlit.services;
      const file = app.vault.getFileByPath(`${targetpath}`);
      const modified = file!.stat.mtime;
      app.workspace.protocolHandler.handlers.get("zotlit/update")!({
        action: "zotlit/update",
        item: "1",
        "source-id": s.bridge.runSync(s.zoteroPref.current).sourceId!,
        scope: "metadata",
      });
      await until(
        "Companion update",
        () => file!.stat.mtime !== modified,
        10000,
      );
    },
    { targetpath: targetPath },
  );
  expect(await timeline()).toEqual(beforeUpdate);
  await obRun(
    vaultId,
    async ({ app }, { sourcepath, sourceInput, enabled }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getFileByPath(sourcepath)!, {
        state: { mode: sourceInput, source: enabled },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.workspace.requestActiveLeafEvents.run();
    },
    { sourcepath: sourcePath, sourceInput: "source", enabled: true },
  );
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { targetpath }) => {
      const { until } = page;
      const s = zotlit.services;
      app.workspace.protocolHandler.handlers.get("zotlit/open")!({
        action: "zotlit/open",
        item: "1",
        "source-id": s.bridge.runSync(s.zoteroPref.current).sourceId!,
      });
      await until(
        "Companion open",
        () => app.workspace.getActiveFile()?.path === `${targetpath}`,
      );
      app.workspace.requestActiveLeafEvents.run();
    },
    { targetpath: targetPath },
  );
  const afterOpen = await timeline();
  expect(afterOpen[0]?.indexedKey).toBe(target);
  expect(afterOpen[0]?.values.lastActivity).not.toBe(
    beforeUpdate[0]?.values.lastActivity,
  );
}
