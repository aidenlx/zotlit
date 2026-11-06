import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  booksProfile,
  booksProfileTargetItem,
  createTargetItem,
  e2eVaultPath,
  reachable,
  targetItem,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { CodeMirrorElement } from "./page-notes-types.ts";
import { withWorkbenchSurfaces } from "./workbench-surfaces.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("keeps each Properties row's example value through Move down while the preview renders again", async () => {
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
          ])
            app.workspace.detachLeavesOfType(type);
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });

    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:open-template-workbench-view");
      },
      { path: `templates/${booksProfile.document}` },
    );
    // The Properties tab of the Books Profile, showing a real Item's values.
    await withWorkbenchSurfaces(
      run.vaultId,
      obRunUntil(
        run.vaultId,
        async ({ page }, { path, key, tabLabel }) => {
          const view = page.workbench({ path });
          if (!view) return false;
          if (view.getState().itemIndexedKey !== key)
            await view.setState(
              { ...view.getState(), itemIndexedKey: key },
              { history: false },
            );
          const tab = Array.from(
            view.contentEl.querySelectorAll<HTMLElement>("[role=tab]"),
          ).find((tab) => tab.textContent.trim() === tabLabel);
          if (!tab) return false;
          if (tab.getAttribute("aria-selected") !== "true")
            page.press(tab, "Properties tab");
          return tab.getAttribute("aria-selected") === "true";
        },
        {
          path: `templates/${booksProfile.document}`,
          key: targetItem.key,
          tabLabel: run.m.workbench_tab_properties(),
        },
        { what: "the Books Profile's Properties tab with the target Item" },
      ),
    );
    /** Each row as the reader reads it: name, then example value. */
    const rowsShown = async () =>
      obRunUntil(
        run.vaultId,
        ({ page }, { path }) => {
          const el = page.workbench({ path })!.contentEl;
          // The Properties list the reader sees; the editor keeps others hidden.
          const list = Array.from(
            el.querySelectorAll<HTMLElement>('[data-part="rows"]'),
          ).find((list) => list.checkVisibility());
          const rows = Array.from(
            list?.querySelectorAll<HTMLElement>('[data-part="row-toggle"]') ??
              [],
          );
          // A row shows its rule as code until the example reaches it.
          const settled =
            rows.length >= 2 &&
            rows.every((row) => !row.querySelector("code")) &&
            !el.querySelector('[data-part="actions"] [role="status"]');
          return settled ? rows.map((row) => row.innerText) : null;
        },
        { path: `templates/${booksProfile.document}` },
        {
          what: "every Properties row to show its example value",
          ready: (rows) => rows !== null,
        },
      );
    const before = (await rowsShown())!;

    // Every state the rows pass through from the press until the render that
    // follows it has landed.
    const seen = await obRun(
      run.vaultId,
      async ({ page }, { path, moveDown }) => {
        const el = page.workbench({ path })!.contentEl;
        const list = Array.from(
          el.querySelectorAll<HTMLElement>('[data-part="rows"]'),
        ).find((list) => list.checkVisibility())!;
        const read = () =>
          JSON.stringify({
            rows: Array.from(
              list.querySelectorAll<HTMLElement>('[data-part="row-toggle"]'),
            ).map((row) => row.innerText),
            rules: list.querySelectorAll('[data-part="row-toggle"] code')
              .length,
            status:
              el.querySelector<HTMLElement>(
                '[data-part="actions"] [role="status"]',
              )?.innerText ?? null,
          });
        const first = read();
        const states: string[] = [];
        const observer = new MutationObserver(() => {
          const state = read();
          if (state !== (states.at(-1) ?? first)) states.push(state);
        });
        observer.observe(el, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        const button = Array.from(
          list.querySelectorAll<HTMLButtonElement>(
            '[data-part="row"] button[aria-label]',
          ),
        ).find((button) => button.getAttribute("aria-label") === moveDown);
        page.press(button, "Move down on the first row");
        // The live refresh waits 300 ms after the edit, then renders.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        observer.disconnect();
        return states;
      },
      {
        path: `templates/${booksProfile.document}`,
        moveDown: run.m.workbench_properties_move_down(),
      },
    );

    const [title, second, ...rest] = before;
    // One change: the two rows trade places, each with its own value. No frame
    // shows a rule in place of a value or asks for a run.
    expect(seen.map((state) => JSON.parse(state) as unknown)).toEqual([
      { rows: [second, title, ...rest], rules: 0, status: null },
    ]);
    expect(await rowsShown()).toEqual([second, title, ...rest]);
  });

  // #1945, #1943: Fields and Preview are panels of the one view, so the Item
  // the editor's tabs read, the Item the Fields panel lists and the Item the
  // Preview renders are one choice, whichever of the three choosers made it.
  it("names one Item in every surface after a choice from each of the three choosers", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) => {
          for (const type of [
            "zotlit-template-workbench",
            "zotlit-template-data-explorer",
          ])
            app.workspace.detachLeavesOfType(type);
        },
        undefined,
      ),
    );
    // Wide enough that the panels stand beside the editor as columns.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, showPreview, showFields }) => {
        // A tab of the editor area's own, as wide as the window lets it be.
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        // The reader shows both panels from their view actions.
        for (const label of [showPreview, showFields])
          leaf.view.containerEl
            .querySelector<HTMLElement>(`.view-action[aria-label="${label}"]`)
            ?.click();
      },
      {
        path,
        showPreview: run.m.workbench_show_preview(),
        showFields: run.m.workbench_show_fields(),
      },
    );

    /** Opens a chooser from `from`, searches `query`, and picks `title`. */
    const choose = async (
      from: "editor" | "preview" | "fields",
      title: string,
    ) => {
      await obRunUntil(
        run.vaultId,
        ({ page }, { path, from, label }) => {
          const view = page.workbench({ path });
          const trigger =
            from === "editor"
              ? view?.containerEl.querySelector<HTMLElement>(
                  `.view-actions .view-action[aria-label="${label}"]`,
                )
              : Array.from(
                  (from === "preview"
                    ? page.previewPanel(view)
                    : page.fieldsPanel(view)
                  )?.querySelectorAll("button") ?? [],
                ).find((button) => button.textContent.trim() === label);
          if (!trigger) return false;
          page.press(trigger, `Choose item in the ${from}`);
          return true;
        },
        { path, from, label: run.m.workbench_choose_item() },
        { what: `the ${from}'s Choose item trigger` },
      );
      await obRunUntil(
        run.vaultId,
        ({ page }, { query, title }) => {
          const input =
            document.querySelector<HTMLInputElement>(".prompt input");
          if (!input) return false;
          if (input.value !== query) {
            input.value = query;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const row = Array.from(
            document.querySelectorAll<HTMLElement>(".prompt .suggestion-item"),
          ).find(
            (row) =>
              !row.closest("[aria-busy]") && row.textContent.includes(title),
          );
          if (!row) return false;
          row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
          page.press(row, "search result");
          return true;
        },
        { query: title, title },
        {
          what: `the "${title}" row in Choose item`,
        },
      );
    };

    /** Waits for the surface `where` to name `text`, opening its tab first. */
    const names = (where: string, text: string) =>
      withWorkbenchSurfaces(
        run.vaultId,
        obRunUntil(
          run.vaultId,
          ({ page }, { path, where, text, preview, fields }) => {
            const view = page.workbench({ path });
            if (!view) return false;
            if (where === preview)
              return !!page.previewPanel(view)?.innerText.includes(text);
            if (where === fields)
              return !!page.fieldsPanel(view)?.innerText.includes(text);
            const tab = Array.from(
              view.contentEl.querySelectorAll<HTMLElement>("[role=tab]"),
            ).find((tab) => tab.textContent.trim() === where);
            if (!tab) return false;
            if (tab.getAttribute("aria-selected") !== "true") {
              page.press(tab, where);
              return false;
            }
            return !!view.contentEl
              .querySelector<HTMLElement>("[role=tabpanel]:not([hidden])")
              ?.innerText.includes(text);
          },
          { path, where, text, preview: "Preview", fields: "Fields" },
          { what: `${where} to name "${text}"` },
        ),
      );

    for (const [from, item] of [
      ["editor", targetItem],
      ["preview", booksProfileTargetItem],
      ["fields", targetItem],
    ] as const) {
      await choose(from, item.title);
      await names("Preview", `Book profile: ${item.title}`);
      await names("Fields", item.title);
      await names(run.m.workbench_tab_properties(), item.title);
      await names(
        run.m.workbench_tab_name_and_folder(),
        `books-${item.citationKey}`,
      );
      await names("Preview", `Book profile: ${item.title}`);
    }
  });

  // #1937: Obsidian opens a modal in the window that last took focus, and a
  // pop-out the reader works in can leave that on the main window. A chooser
  // opens in the window of the view that asked for it.
  it("opens Choose item in the pop-out window of its workbench", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) =>
          app.workspace.detachLeavesOfType("zotlit-template-workbench"),
        undefined,
      ),
    );
    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.openPopoutLeaf();
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path },
          active: true,
        });
        // Focus last named the main window.
        activeWindow = window;
        activeDocument = document;
      },
      { path },
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path, label }) => {
        const trigger = page
          .workbench({ path })
          ?.containerEl.querySelector<HTMLElement>(
            `.view-actions .view-action[aria-label="${label}"]`,
          );
        if (!trigger || trigger.doc === document) return false;
        page.press(trigger, "Choose item in the pop-out");
        return true;
      },
      { path, label: run.m.workbench_choose_item() },
      { what: "the pop-out workbench's Choose item action" },
    );
    const opened = await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const own = page.workbench({ path })?.containerEl.doc;
        const doc = page
          .windowDocuments()
          .find((doc) => doc.querySelector(".prompt"));
        if (!own || !doc) return null;
        return doc === own ? "its own window" : "another window";
      },
      { path },
      {
        what: "the Choose item chooser",
        ready: (where) => where !== null,
      },
    );
    expect(opened).toBe("its own window");
  });

  // #1943: the standalone Template Data Explorer keeps its own Item. The
  // `explore` action opens it beside an editor on another Item, and a choice
  // in either one leaves the other where it was.
  it("opens the standalone explorer from the explore action, independent of an open editor", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) => {
          for (const type of [
            "zotlit-template-workbench",
            "zotlit-template-data-explorer",
          ])
            app.workspace.detachLeavesOfType(type);
        },
        undefined,
      ),
    );
    // Wide enough that the panels stand beside the editor as columns.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, item }) => {
        // A tab of the editor area's own, as wide as the window lets it be.
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: {
            file: path,
            itemIndexedKey: item,
            panels: { fields: { shown: true, width: 400 } },
          },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
      },
      { path, item: targetItem.key },
    );
    const fieldsName = (title: string) =>
      obRunUntil(
        run.vaultId,
        ({ page }, { path, title }) =>
          !!page
            .fieldsPanel(page.workbench({ path }))
            ?.innerText.includes(title),
        { path, title },
        { what: `the Fields panel to name "${title}"` },
      );
    await fieldsName(targetItem.title);

    // The Companion's `explore` link, as Obsidian hands it to the plugin.
    await obRun(
      run.vaultId,
      ({ app, zotlit }, { item }) => {
        const services = zotlit.services;
        const sourceId = services.bridge.runSync(
          services.zoteroPref.current,
        ).sourceId;
        (
          app.workspace as unknown as {
            protocolHandler: { dispatch(data: Record<string, string>): void };
          }
        ).protocolHandler.dispatch({
          action: "zotlit/explore",
          item,
          "source-id": sourceId ?? "",
        });
      },
      { item: String(booksProfileTargetItem.itemID) },
    );
    const explorer = () =>
      obRunUntil(
        run.vaultId,
        ({ page }, { title }) => {
          const leaf = page.leavesOfType("zotlit-template-data-explorer")[0];
          if (!leaf?.view.contentEl.innerText.includes(title)) return null;
          return JSON.stringify(leaf.view.getState());
        },
        { title: booksProfileTargetItem.title },
        {
          what: `the standalone explorer to show "${booksProfileTargetItem.title}"`,
          ready: (value) => value !== null,
        },
      );
    const opened = JSON.parse((await explorer())!) as Record<string, unknown>;
    expect(opened.itemIndexedKey).toEqual(
      expect.stringContaining(booksProfileTargetItem.key),
    );
    // The editor keeps its own Item.
    await fieldsName(targetItem.title);
    expect(
      await obRun(
        run.vaultId,
        ({ page }, { path }) =>
          page
            .workbench({ path })!
            .registry.get(page.workbench({ path })!.model.view).item?.id ??
          null,
        { path },
      ),
    ).toBe(targetItem.key);

    // A new choice in the editor leaves the explorer on its Item.
    await obRun(
      run.vaultId,
      ({ page }, { path, item, title }) => {
        page.workbench({ path })!.setItem({ id: item, title });
      },
      { path, item: createTargetItem.key, title: createTargetItem.title },
    );
    await fieldsName(createTargetItem.title);
    expect(JSON.parse((await explorer())!)).toEqual(opened);
  });

  // #1945: the panels are part of the view's saved state, and each edge
  // reports the width the view draws: a panel takes at most 40% of the view,
  // and never more than 960 px.
  it("restores the Fields and Preview panels and their widths with the workspace", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) =>
          app.workspace.detachLeavesOfType("zotlit-template-workbench"),
        undefined,
      ),
    );
    // Wide enough that the panels stand beside the editor, not under it.
    await suite.wideWindow(cleanup);
    interface Edge {
      readonly drawn: number;
      readonly container: number;
      readonly now: string | null;
      readonly max: string | null;
    }
    const read = async (state: string) => {
      await obRun(
        run.vaultId,
        async ({ app }, { path, state }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          const leaf = app.workspace.createLeafInParent(
            app.workspace.rootSplit,
            0,
          );
          await leaf.setViewState({
            type: "zotlit-template-workbench",
            state: { ...(JSON.parse(state) as object), file: path },
            active: true,
          });
          // The leaf takes most of the window beside the tab group already
          // there, so both panels stand as columns (#1955).
          type Sized = { setDimension(share: number): void };
          for (const child of (
            app.workspace.rootSplit as unknown as { children: unknown[] }
          ).children)
            (child as Sized).setDimension(child === leaf ? 90 : 10);
        },
        { path, state },
      );
      const read = await obRunUntil(
        run.vaultId,
        ({ page }, { path, labels }) => {
          const view = page.workbench({ path });
          if (!view) return null;
          const edges: Record<string, Edge> = {};
          for (const [side, label] of Object.entries(labels)) {
            const panel =
              side === "fields"
                ? page.fieldsPanel(view)
                : page.previewPanel(view);
            const handle = Array.from(
              view.contentEl.querySelectorAll<HTMLElement>("[role=separator]"),
            ).find((element) => element.getAttribute("aria-label") === label);
            if (!panel?.parentElement || !handle) return null;
            const now = handle.getAttribute("aria-valuenow");
            edges[side] = {
              drawn: panel.offsetWidth,
              container: panel.parentElement.clientWidth,
              now,
              max: handle.getAttribute("aria-valuemax"),
            };
          }
          return JSON.stringify({ edges, saved: view.getState().panels });
        },
        {
          path,
          labels: {
            fields: run.m.workbench_fields_resize(),
            preview: run.m.workbench_preview_resize(),
          },
        },
        {
          what: "both panels restored, each edge naming its drawn width",
          // The edge has described its panel once it names the drawn width.
          ready: (value) =>
            value !== null &&
            Object.values(
              (JSON.parse(value) as { edges: Record<string, Edge> }).edges,
            ).every(({ now, drawn }) => now === String(drawn)),
        },
      );
      return JSON.parse(read!) as {
        edges: Record<"fields" | "preview", Edge>;
        saved: unknown;
      };
    };
    /** The widest the view draws a panel beside the editor. */
    const limit = (container: number) =>
      Math.min(960, Math.floor(container * 0.4));
    const panels = {
      fields: { shown: true, width: 260 },
      // Wider than 40% of any window the run opens.
      preview: { shown: true, width: 960 },
    };
    const first = await read(JSON.stringify({ panels }));
    expect(first.edges.fields.now).toBe("260");
    const { preview } = first.edges;
    expect(preview.max).toBe(String(limit(preview.container)));
    expect(preview.drawn).toBe(limit(preview.container));
    // The Fields column grows only as far as keeps it a column beside the
    // Preview and an editor of 360 px (#1956).
    const { container } = first.edges.fields;
    expect(first.edges.fields.max).toBe(
      String(Math.min(limit(container), container - preview.drawn - 360)),
    );
    // The saved state of that leaf restores both panels in a new leaf.
    const saved = await obRun(
      run.vaultId,
      ({ page }, { path }) =>
        JSON.stringify(page.workbench({ path })!.getState()),
      { path },
    );
    const second = await read(saved);
    expect(second.edges.fields.now).toBe("260");
    expect(second.edges.preview.now).toBe(String(preview.drawn));
    // A state that names no Preview height leaves the leaf's own, 40%.
    expect(second.saved).toEqual({
      ...panels,
      preview: { ...panels.preview, height: 40 },
    });
  });

  // #1954: the leaf's width places the Preview: under the editor in a narrow
  // leaf, at the right in a wide one. A resize never changes what the reader
  // chose to show, and the Preview's height under the editor is saved state.
  it("puts the Preview under the editor in a narrow leaf, back at the right in a wide one, and restores its height", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
        },
        undefined,
      ),
    );
    await suite.wideWindow(cleanup);
    const panels = {
      fields: { shown: false, width: 400 },
      preview: { shown: true, width: 400, height: 40 },
    };
    /**
     * Opens the editor in the leftmost tab group with `state`, and gives that
     * group `share` percent of the window beside an empty tab, or the whole
     * window when `share` is null.
     */
    const open = (state: string, share: number | null) =>
      obRun(
        run.vaultId,
        async ({ app }, { path, state, share }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
          const leaf = app.workspace.createLeafInParent(
            app.workspace.rootSplit,
            0,
          );
          await leaf.setViewState({
            type: "zotlit-template-workbench",
            state: { ...(JSON.parse(state) as object), file: path },
            active: true,
          });
          if (share === null) return;
          const other = app.workspace.createLeafBySplit(leaf, "vertical");
          await other.setViewState({ type: "empty" });
          // A tab group's share of the split, as dragging its edge sets it.
          type Sized = { setDimension(share: number): void };
          (leaf.parent as unknown as Sized).setDimension(share);
          (other.parent as unknown as Sized).setDimension(100 - share);
        },
        { path, state, share },
      );
    interface Layout {
      readonly width: number;
      readonly height: number;
      readonly orientation: string | null;
      readonly share: string | null;
      /** Where the Preview stands against the editor. */
      readonly preview: "below" | "right" | "other";
      readonly previewHeight: number;
      readonly saved: unknown;
    }
    /** Waits for the layout `ready` accepts, and reads it. */
    const layout = async (what: string, ready: (layout: Layout) => boolean) =>
      JSON.parse(
        (await obRunUntil(
          run.vaultId,
          ({ page }, { path, label }) => {
            const view = page.workbench({ path });
            const panel = page.previewPanel(view);
            const editor = view?.contentEl.querySelector<HTMLElement>(
              '[data-part="editor"]',
            );
            const handle = Array.from(
              view?.contentEl.querySelectorAll<HTMLElement>(
                "[role=separator]",
              ) ?? [],
            ).find((element) => element.getAttribute("aria-label") === label);
            if (!view || !panel || !editor || !handle) return null;
            const box = panel.getBoundingClientRect();
            const source = editor.getBoundingClientRect();
            return JSON.stringify({
              width: view.contentEl.clientWidth,
              height: view.contentEl.clientHeight,
              orientation: handle.getAttribute("aria-orientation"),
              share: handle.getAttribute("aria-valuenow"),
              preview:
                box.top >= source.bottom
                  ? "below"
                  : box.left >= source.right
                    ? "right"
                    : "other",
              previewHeight: Math.round(box.height),
              saved: view.getState().panels,
            } satisfies Layout);
          },
          { path, label: run.m.workbench_preview_resize() },
          {
            what,
            ready: (value) =>
              value !== null && ready(JSON.parse(value) as Layout),
          },
        ))!,
      ) as Layout;

    // A narrow leaf: 600 px less a 240 px Preview leaves the editor under
    // 360 px, so the Preview goes under the editor at 40% of the height.
    await open(JSON.stringify({ panels }), 30);
    const narrow = await layout(
      "the Preview under the editor of a narrow leaf",
      (layout) => layout.preview === "below",
    );
    expect(narrow.width).toBeLessThan(600);
    expect(narrow.orientation).toBe("horizontal");
    expect(narrow.share).toBe("40");
    expect(narrow.previewHeight).toBe(Math.round(narrow.height * 0.4));

    // The arrows set its height: two presses up make it 50% of the leaf.
    await obRun(
      run.vaultId,
      ({ page }, { path, label }) => {
        const view = page.workbench({ path })!;
        const handle = Array.from(
          view.contentEl.querySelectorAll<HTMLElement>("[role=separator]"),
        ).find((element) => element.getAttribute("aria-label") === label)!;
        for (let press = 0; press < 2; press++)
          handle.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
          );
      },
      { path, label: run.m.workbench_preview_resize() },
    );
    const taller = await layout(
      "the Preview at half the leaf's height",
      (layout) => layout.share === "50",
    );
    expect(taller.previewHeight).toBe(Math.round(taller.height * 0.5));
    const chosen = {
      ...panels,
      preview: { ...panels.preview, height: 50 },
    };
    expect(taller.saved).toEqual(chosen);

    // Widening the leaf puts the Preview back at the right, at its width,
    // and leaves what the reader chose as it was.
    await obRun(
      run.vaultId,
      ({ app }) => app.workspace.detachLeavesOfType("empty"),
      undefined,
    );
    const wide = await layout(
      "the Preview at the right of a wide leaf",
      (layout) => layout.preview === "right",
    );
    expect(wide.orientation).toBe("vertical");
    expect(wide.share).toBe("400");
    expect(wide.saved).toEqual(chosen);

    // The workspace restores the height in a new narrow leaf.
    const saved = await obRun(
      run.vaultId,
      ({ page }, { path }) =>
        JSON.stringify(page.workbench({ path })!.getState()),
      { path },
    );
    await open(saved, 30);
    const restored = await layout(
      "the restored Preview under the editor",
      (layout) => layout.preview === "below",
    );
    expect(restored.share).toBe("50");
    expect(restored.previewHeight).toBe(Math.round(restored.height * 0.5));
    expect(restored.saved).toEqual(chosen);
  });

  // #1956: a reader who cannot drag sizes every handle from the pane menu
  // alone, and the sizes the menu sets are saved like dragged ones.
  it("sizes and resets the panels through the pane menu alone, and restores the sizes", async () => {
    const path = `templates/${booksProfile.document}`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        ({ app }) => {
          for (const menu of activeDocument.body.querySelectorAll(".menu"))
            menu.remove();
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
        },
        undefined,
      ),
    );
    await suite.wideWindow(cleanup);
    /**
     * Opens the editor at the leading side of the window with `state`, and
     * gives it `share` percent of the window beside an empty tab, or the
     * whole window when `share` is null.
     */
    const open = (state: object, share: number | null) =>
      obRun(
        run.vaultId,
        async ({ app }, { path, state, share }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
          const leaf = app.workspace.createLeafInParent(
            app.workspace.rootSplit,
            0,
          );
          await leaf.setViewState({
            type: "zotlit-template-workbench",
            state: { ...(JSON.parse(state) as object), file: path },
            active: true,
          });
          if (share === null) return;
          const other = app.workspace.createLeafBySplit(leaf, "vertical");
          await other.setViewState({ type: "empty" });
          // The share of the root split, as dragging the edge between sets
          // it, on whichever item sits in the root split.
          type Sized = { setDimension(share: number): void; parent: unknown };
          const item = (sized: Sized) =>
            sized.parent === app.workspace.rootSplit
              ? sized
              : (sized.parent as Sized);
          item(leaf as unknown as Sized).setDimension(share);
          item(other as unknown as Sized).setDimension(100 - share);
        },
        { path, state: JSON.stringify(state), share },
      );
    interface Handles {
      /** Each handle's value, by its name and orientation. */
      readonly now: Record<string, string | null>;
      readonly saved: unknown;
    }
    /** Waits for the handles `ready` accepts, and reads them. */
    const handles = async (
      what: string,
      ready: (now: Handles["now"]) => boolean,
    ) =>
      JSON.parse(
        (await obRunUntil(
          run.vaultId,
          ({ page }, { path }) => {
            const view = page.workbench({ path });
            if (!view) return null;
            const now = Object.fromEntries(
              Array.from(
                view.contentEl.querySelectorAll<HTMLElement>(
                  "[role=separator]",
                ),
                (handle) => [
                  `${handle.getAttribute("aria-label")} ${handle.getAttribute("aria-orientation")}`,
                  handle.getAttribute("aria-valuenow"),
                ],
              ),
            );
            return JSON.stringify({
              now,
              saved: view.getState().panels,
            } satisfies Handles);
          },
          { path },
          {
            what,
            ready: (value) =>
              value !== null && ready((JSON.parse(value) as Handles).now),
          },
        ))!,
      ) as Handles;
    /**
     * Opens the pane menu from the view's More options action, the last of
     * its actions, then the submenu `group` in it, and returns the
     * submenu's entries; a disabled entry reads in parentheses.
     */
    const submenu = (group: string) =>
      obRunUntil(
        run.vaultId,
        ({ page }, { path, group }) => {
          const view = page.workbench({ path })!;
          const doc = view.containerEl.doc;
          const title = (item: Element) =>
            item.querySelector(".menu-item-title")?.textContent ?? "";
          const [menu, sub] = Array.from(doc.body.querySelectorAll(".menu"));
          if (!menu) {
            const actions = view.containerEl.querySelectorAll<HTMLElement>(
              ".view-actions .view-action",
            );
            actions[actions.length - 1]!.click();
            return null;
          }
          if (!sub) {
            const parent = Array.from(
              menu.querySelectorAll<HTMLElement>(".menu-item"),
            ).find((item) => title(item) === group);
            parent?.dispatchEvent(
              new MouseEvent("mouseover", { bubbles: true }),
            );
            parent?.click();
            return null;
          }
          return Array.from(sub.querySelectorAll(".menu-item"), (item) =>
            item.classList.contains("is-disabled")
              ? `(${title(item)})`
              : title(item),
          ).join("|");
        },
        { path, group },
        { what: `the ${group} submenu`, ready: (value) => value !== null },
      );
    /** Selects `entry` in the open submenu, as a click does, and closes the menu. */
    const pick = async (entry: string) => {
      await obRun(run.vaultId, ({ page }) => page.menuReady(), undefined);
      await obRun(
        run.vaultId,
        ({ page }, { path, entry }) => {
          const doc = page.workbench({ path })!.containerEl.doc;
          const sub = doc.body.querySelectorAll(".menu")[1]!;
          Array.from(sub.querySelectorAll<HTMLElement>(".menu-item"))
            .find(
              (item) =>
                item.querySelector(".menu-item-title")?.textContent === entry,
            )!
            .click();
          for (const menu of doc.body.querySelectorAll(".menu")) menu.remove();
        },
        { path, entry },
      );
    };
    const { m } = run;
    const fields = `${m.workbench_fields_resize()} vertical`;
    const preview = `${m.workbench_preview_resize()} vertical`;
    const split = `${m.workbench_preview_resize()} horizontal`;

    // A wide leaf: both columns, each sized from its own submenu.
    await open(
      {
        panels: {
          fields: { shown: true, width: 400 },
          preview: { shown: true, width: 400, height: 40 },
        },
      },
      null,
    );
    await handles("both columns", (now) => now[fields] === "400");
    expect(await submenu(m.workbench_fields_resize())).toBe(
      [
        m.workbench_panel_wider(),
        m.workbench_panel_narrower(),
        `(${m.workbench_panel_reset_width()})`,
      ].join("|"),
    );
    await pick(m.workbench_panel_narrower());
    await submenu(m.workbench_preview_resize());
    await pick(m.workbench_panel_wider());
    const sized = await handles(
      "the Fields narrower and the Preview wider",
      (now) => now[fields] === "336" && now[preview] === "464",
    );
    expect(sized.saved).toEqual({
      fields: { shown: true, width: 336 },
      preview: { shown: true, width: 464, height: 40 },
    });
    expect(await submenu(m.workbench_fields_resize())).toContain(
      `|${m.workbench_panel_reset_width()}`,
    );
    await pick(m.workbench_panel_reset_width());
    await handles(
      "the Fields at its default width",
      (now) => now[fields] === "400",
    );

    // A narrow leaf: the Preview under the editor, sized by its height.
    const state = (path: string) =>
      obRun(
        run.vaultId,
        ({ page }, { path }) =>
          JSON.stringify(page.workbench({ path })!.getState()),
        { path },
      );
    await open(JSON.parse(await state(path)) as object, 30);
    await handles("the Preview under the editor", (now) => now[split] === "40");
    expect(await submenu(m.workbench_preview_resize())).toBe(
      [
        m.workbench_panel_taller(),
        m.workbench_panel_shorter(),
        `(${m.workbench_panel_reset_height()})`,
      ].join("|"),
    );
    await pick(m.workbench_panel_taller());
    const chosen = {
      fields: { shown: true, width: 400 },
      preview: { shown: true, width: 464, height: 50 },
    };
    const taller = await handles(
      "the Preview taller",
      (now) => now[split] === "50",
    );
    expect(taller.saved).toEqual(chosen);

    // The workspace restores the sizes the menu set.
    const saved = JSON.parse(await state(path)) as object;
    await open(saved, 30);
    const restored = await handles(
      "the restored Preview under the editor",
      (now) => now[split] === "50",
    );
    expect(restored.saved).toEqual(chosen);
    await open(saved, null);
    await handles(
      "the restored Preview at the right",
      (now) => now[preview] === "464",
    );
  });

  // #1955: where the Fields column does not fit, Fields opens its picker.
  it("inserts a field from the Fields picker of a narrow leaf with the keyboard, and closes it on Escape", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    // The Fields shown, in a leaf too narrow for their column beside an
    // editor of 360 px.
    await obRun(
      run.vaultId,
      async ({ app }, { path, key }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        app.workspace.detachLeavesOfType("empty");
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: {
            file: path,
            itemIndexedKey: key,
            panels: { fields: { shown: true, width: 400 } },
          },
          active: true,
        });
        const other = app.workspace.createLeafBySplit(leaf, "vertical");
        await other.setViewState({ type: "empty" });
        // Each part's share of the split, as dragging its edge sets it.
        type Sized = { setDimension(share: number): void };
        for (const child of (
          app.workspace.rootSplit as unknown as { children: unknown[] }
        ).children)
          (child as Sized).setDimension(
            child === leaf || child === leaf.parent ? 30 : 70,
          );
      },
      { path, key: targetItem.key },
    );
    const narrow = JSON.parse(
      (await obRunUntil(
        run.vaultId,
        ({ page }, { path, label }) => {
          const view = page.workbench({ path });
          const action = view?.containerEl.querySelector<HTMLElement>(
            `.view-action[aria-label="${label}"]`,
          );
          if (!view || !action || action.getAttribute("aria-expanded") === null)
            return null;
          return JSON.stringify({
            width: view.contentEl.clientWidth,
            column: page.fieldsPanel(view) !== null,
            expanded: action.getAttribute("aria-expanded"),
            pressed: action.getAttribute("aria-pressed"),
            shown: view.getState().panels,
          });
        },
        { path, label: run.m.workbench_show_fields() },
        {
          what: "a narrow leaf whose Fields action opens the picker",
          ready: (value) => value !== null,
        },
      ))!,
    ) as Record<string, unknown>;
    // Narrowing left the picker closed and kept the Fields shown.
    expect(narrow).toMatchObject({
      column: false,
      expanded: "false",
      pressed: null,
      shown: { fields: { shown: true } },
    });
    expect(narrow.width).toBeLessThan(600);

    const walk = await obRun(
      run.vaultId,
      async ({ page }, { path, label }) => {
        const { until, trusted } = page;
        const view = page.workbench({ path })!;
        const el = view.contentEl;
        const input = trusted(el.win);
        const contents = (
          el.win as Window & {
            electronWindow: { webContents: import("electron").WebContents };
          }
        ).electronWindow.webContents;
        contents.focus();
        await until("the window takes keys", () => el.doc.hasFocus());
        const action = view.containerEl.querySelector<HTMLElement>(
          `.view-action[aria-label="${label}"]`,
        )!;
        // The cursor at the end of the note body.
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        await input.click(content);
        editor.dispatch({ selection: { anchor: editor.state.doc.length } });
        const search = () =>
          el.doc.querySelector<HTMLInputElement>(
            '[role="dialog"] [role="combobox"]',
          );
        const activeRow = () =>
          el.doc.getElementById(
            search()?.getAttribute("aria-activedescendant") ?? "",
          );
        const detail = () =>
          el.doc.getElementById(
            search()?.getAttribute("aria-describedby") ?? "",
          )?.textContent ?? "";
        await input.click(action);
        await until(
          "focus in the picker's search field",
          () => search() !== null && el.doc.activeElement === search(),
        );
        const surface = search()!.closest(".popover")!;
        const opened = {
          expanded: action.getAttribute("aria-expanded"),
          onBody: surface.parentElement === el.doc.body,
          menuLayer:
            getComputedStyle(surface).zIndex ===
            getComputedStyle(el.doc.body)
              .getPropertyValue("--layer-menu")
              .trim(),
        };
        await contents.insertText("doi");
        await until("the search keeps the DOI", () =>
          (activeRow()?.textContent ?? "").startsWith("DOI"),
        );
        const first = { row: activeRow()!.id, detail: detail() };
        await input.key("Down");
        const moved =
          activeRow()!.id !== first.row && detail() !== first.detail;
        await input.key("Up");
        const back = activeRow()!.id === first.row;
        await input.key("Enter");
        await until(
          "the field at the cursor, the picker closed and the editor focused",
          () =>
            search() === null &&
            editor.state.doc.toString().endsWith("{{ zt.DOI }}") &&
            editor.hasFocus,
        );
        const inserted = {
          status: el.querySelector('[data-part="status"]')?.textContent ?? null,
          editorFocused: editor.hasFocus,
          expanded: action.getAttribute("aria-expanded"),
        };
        // Escape closes the next opening and hands focus to the action.
        await input.click(action);
        await until(
          "the picker again",
          () => el.doc.activeElement === search(),
        );
        const fresh = search()!.value;
        await input.key("Escape");
        await until("the picker closed", () => search() === null);
        const escaped = el.doc.activeElement === action;
        // From the action, a printable key opens the picker searching for
        // it, and End and Home reach the last and the first row.
        await input.key("d");
        await until(
          "the picker on the typed key",
          () => search()?.value === "d",
        );
        const rows = () =>
          el.doc.querySelectorAll('[role="dialog"] [role="option"]');
        await input.key("End");
        const end = activeRow() === rows()[rows().length - 1];
        await input.key("Home");
        const home = activeRow() === rows()[0];
        // A picker opened again at once after an insertion keeps focus when
        // the editor takes the focus the insertion asked for (#1955).
        await contents.insertText("oi");
        await until("the DOI again", () =>
          (activeRow()?.textContent ?? "").startsWith("DOI"),
        );
        await input.key("Enter");
        await until(
          "the picker closed by the insertion",
          () => search() === null,
        );
        await input.click(action);
        await until(
          "the picker reopened",
          () => el.doc.activeElement === search(),
        );
        await until(
          "the editor took the inserted text's focus and handed it back",
          () =>
            editor.state.doc.toString().endsWith("{{ zt.DOI }}{{ zt.DOI }}"),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        const reopened = el.doc.activeElement === search();
        await input.key("Escape");
        await until("the picker closed", () => search() === null);
        return JSON.stringify({
          opened,
          moved,
          back,
          inserted,
          fresh,
          escaped,
          end,
          home,
          reopened,
        });
      },
      { path, label: run.m.workbench_show_fields() },
    );
    expect(JSON.parse(walk)).toEqual({
      opened: { expanded: "true", onBody: true, menuLayer: true },
      moved: true,
      back: true,
      inserted: {
        status: run.m.workbench_fields_inserted({ field: "DOI" }),
        editorFocused: true,
        expanded: "false",
      },
      fresh: "",
      escaped: true,
      end: true,
      home: true,
      reopened: true,
    });

    // Widening the leaf shows the column again.
    await obRun(
      run.vaultId,
      ({ app }) => app.workspace.detachLeavesOfType("empty"),
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) =>
        page.fieldsPanel(page.workbench({ path })) !== null,
      { path },
      { what: "the Fields column in the widened leaf" },
    );
  });

  // #1957: the Preview's Show problem is the shared repair command, so the
  // problem round trip is the same in a narrow and a wide leaf.
  it("reveals the call from the Preview's Show problem in a narrow and a wide leaf, closing the Fields picker and keeping the Preview in place", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    const call = '{% render "missing-partial" %}';
    const panels = {
      fields: { shown: true, width: 400 },
      preview: { shown: true, width: 400, height: 40 },
    };
    /**
     * Opens the editor with both panels in `share` percent of the window, or
     * the whole window when `share` is null, with the call to a partial no
     * vault holds in the note body and the cursor at its start.
     */
    const open = async (share: number | null) => {
      await obRun(
        run.vaultId,
        async ({ app }, { path, key, panels, share }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
          app.workspace.detachLeavesOfType("empty");
          const leaf = app.workspace.createLeafInParent(
            app.workspace.rootSplit,
            0,
          );
          await leaf.setViewState({
            type: "zotlit-template-workbench",
            state: { file: path, itemIndexedKey: key, panels },
            active: true,
          });
          if (share === null) return;
          const other = app.workspace.createLeafBySplit(leaf, "vertical");
          await other.setViewState({ type: "empty" });
          // Each part's share of the split, as dragging its edge sets it.
          type Sized = { setDimension(share: number): void };
          for (const child of (
            app.workspace.rootSplit as unknown as { children: unknown[] }
          ).children)
            (child as Sized).setDimension(
              child === leaf || child === leaf.parent ? share : 100 - share,
            );
        },
        { path, key: targetItem.key, panels, share },
      );
      await obRunUntil(
        run.vaultId,
        ({ page }, { path, call }) => {
          const view = page.workbench({ path });
          const editor = Array.from(
            view?.contentEl.querySelectorAll<CodeMirrorElement>(
              ".cm-content",
            ) ?? [],
          )
            .map((content) => content.cmTile?.root.view)
            .find((editor) =>
              /\{% render "(book-details|missing-partial)"/.test(
                editor?.state.doc.toString() ?? "",
              ),
            );
          if (!view || !editor) return false;
          // The edit is made once, on the poll that first finds the editor.
          const text = editor.state.doc.toString();
          const from = text.indexOf('{% render "book-details"');
          if (from >= 0)
            editor.dispatch({
              changes: {
                from,
                to: text.indexOf("%}", from) + 2,
                insert: call,
              },
              userEvent: "input.type",
            });
          editor.dispatch({ selection: { anchor: 0 } });
          return true;
        },
        { path, call },
        { what: "the note editor, with the call to a missing partial" },
      );
      await obRunUntil(
        run.vaultId,
        ({ page }, { path }) =>
          page
            .previewPanel(page.workbench({ path }))
            ?.querySelector('[data-part="problem-open"]') != null,
        { path },
        { what: "the Preview's Show problem on the missing partial" },
      );
    };
    /** Opens the picker when the column does not fit, then presses Show problem. */
    const showProblem = async () =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ page }, { path, call, label }) => {
            const { until } = page;
            const view = page.workbench({ path })!;
            const el = view.contentEl;
            const search = () =>
              el.doc.querySelector('[role="dialog"] [role="combobox"]');
            const action = view.containerEl.querySelector<HTMLElement>(
              `.view-action[aria-label="${label}"]`,
            )!;
            const popover = action.getAttribute("aria-expanded") !== null;
            if (popover) {
              action.click();
              await until("the Fields picker", () => search() !== null);
            }
            const panel = page.previewPanel(view)!;
            const box = () => {
              const { left, top, width, height } =
                panel.getBoundingClientRect();
              return [left, top, width, height].map(Math.round);
            };
            const before = box();
            panel
              .querySelector<HTMLElement>('[data-part="problem-open"]')!
              .click();
            const editor = Array.from(
              el.querySelectorAll<CodeMirrorElement>(".cm-content"),
            )
              .map((content) => content.cmTile!.root.view)
              .find((editor) => editor.state.doc.toString().includes(call))!;
            const selected = () => {
              const { from, to } = editor.state.selection.main;
              return editor.state.sliceDoc(from, to);
            };
            await until(
              "the call selected in the editor",
              () => selected() === call,
            );
            return JSON.stringify({
              popover,
              picker: search() !== null,
              problems:
                el.querySelector('[data-part="problems-open"]') !== null,
              samePreview:
                panel.isConnected &&
                JSON.stringify(box()) === JSON.stringify(before),
              saved: view.getState().panels,
            });
          },
          { path, call, label: run.m.workbench_show_fields() },
        ),
      ) as Record<string, unknown>;

    // A narrow leaf: the Preview under the editor, the Fields picker open.
    await open(30);
    expect(await showProblem()).toEqual({
      popover: true,
      picker: false,
      problems: true,
      samePreview: true,
      saved: panels,
    });
    // A wide leaf: three columns, the same round trip.
    await open(null);
    expect(await showProblem()).toEqual({
      popover: false,
      picker: false,
      problems: true,
      samePreview: true,
      saved: panels,
    });
  });
});
