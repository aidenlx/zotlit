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
  // Preview renders are one choice. #1952: the view names that Item once, in
  // the item row above the panels, beside its one chooser.
  it("names one Item in every surface after each choice from the item row", async () => {
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
    // Wide enough that the Preview stands beside the editor as a column.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, showPreview }) => {
        // A tab of the editor area's own, as wide as the window lets it be.
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        // The reader shows the Preview from its view action.
        leaf.view.containerEl
          .querySelector<HTMLElement>(
            `.view-action[aria-label="${showPreview}"]`,
          )
          ?.click();
      },
      { path, showPreview: run.m.workbench_show_preview() },
    );

    // The item row holds the view's one Choose item; no panel and no view
    // action repeats it.
    const choosers = await obRunUntil(
      run.vaultId,
      ({ page }, { path, label }) => {
        const view = page.workbench({ path });
        const named = (root: Element | null | undefined) =>
          Array.from(root?.querySelectorAll("button") ?? []).filter(
            (button) => button.textContent.trim() === label,
          ).length;
        if (!page.previewPanel(view)) return null;
        return {
          row: named(page.itemRow(view)),
          view: named(view?.contentEl),
          actions: view?.containerEl.querySelectorAll(
            `.view-actions .view-action[aria-label="${label}"]`,
          ).length,
          strip: page.tabStripInsets(view),
        };
      },
      { path, label: run.m.workbench_choose_item() },
      { what: "the Preview", ready: (found) => found !== null },
    );
    const { strip, ...counts } = choosers!;
    expect(counts).toEqual({ row: 1, view: 1, actions: 0 });
    // The editor's tab strip keeps the same room above its tabs, under the
    // item row's rule, as below them, above its own rule.
    expect(strip?.above).toBeGreaterThan(0);
    expect(strip?.above).toBe(strip?.below);

    // #1962: Obsidian draws an element's `aria-label` as its hover tooltip.
    // The Preview and the view's other containers name themselves through
    // `aria-labelledby`, so the pointer passes over them with no tooltip.
    const quiet = await obRun(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path });
        const preview = page.previewPanel(view);
        const nameId = preview?.getAttribute("aria-labelledby");
        return {
          previewLabel: preview?.getAttribute("aria-label") ?? null,
          previewName: nameId
            ? (preview?.ownerDocument.getElementById(nameId)?.textContent ??
              null)
            : null,
          labelledContainers: [
            ...(view?.contentEl.querySelectorAll<HTMLElement>(
              ":is([role=region], [role=group], [role=radiogroup], [role=toolbar], [role=tablist], [role=listbox], [role=tree], section, dl, .cm-content)[aria-label]",
            ) ?? []),
          ].map((element) => element.getAttribute("aria-label")),
        };
      },
      { path },
    );
    expect(quiet).toEqual({
      previewLabel: null,
      previewName: run.m.workbench_view_preview(),
      labelledContainers: [],
    });

    /** Opens Choose item from the item row, searches `title`, and picks it. */
    const choose = async (title: string) => {
      await obRunUntil(
        run.vaultId,
        ({ page }, { path, label }) => {
          const trigger = Array.from(
            page
              .itemRow(page.workbench({ path }))
              ?.querySelectorAll("button") ?? [],
          ).find((button) => button.textContent.trim() === label);
          if (!trigger) return false;
          page.press(trigger, "Choose item in the item row");
          return true;
        },
        { path, label: run.m.workbench_choose_item() },
        { what: "the item row's Choose item" },
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
          (
            { page },
            { path, where, text, preview, fields, row, fieldsLabel },
          ) => {
            const view = page.workbench({ path });
            if (!view) return false;
            // The Fields popover floats over the Preview while it is open:
            // it opens for its own check and closes for the rest.
            const popover = page.fieldsPopover(view);
            const action = view.containerEl.querySelector<HTMLElement>(
              `.view-action[aria-label="${fieldsLabel}"]`,
            );
            if (where === fields) {
              if (!popover) {
                if (action) page.press(action, "the Fields action");
                return false;
              }
              return popover.innerText.includes(text);
            }
            if (popover && where !== row) {
              if (action) page.press(action, "the Fields action");
              return false;
            }
            if (where === preview)
              return !!page.previewPanel(view)?.innerText.includes(text);
            if (where === row)
              return !!page.itemRow(view)?.innerText.includes(text);
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
          {
            path,
            where,
            text,
            preview: "Preview",
            fields: "Fields",
            row: "Item row",
            fieldsLabel: run.m.workbench_view_fields(),
          },
          { what: `${where} to name "${text}"` },
        ),
      );

    for (const item of [targetItem, booksProfileTargetItem, targetItem]) {
      await choose(item.title);
      await names("Item row", item.title);
      await names("Preview", `Book profile: ${item.title}`);
      await names("Fields", item.title);
      await names(run.m.workbench_tab_properties(), item.title);
      await names(
        run.m.workbench_tab_name_and_folder(),
        `books-${item.citationKey}`,
      );
      await names("Preview", `Book profile: ${item.title}`);
    }

    // #1962: in the wide view, Choose item follows the Item's name rather
    // than the far edge of the row, and a name too long for a narrow row
    // ends in an ellipsis while Choose item stays beside it on its line.
    const layout = await obRun(
      run.vaultId,
      async ({ page }, { path, label }) => {
        const view = page.workbench({ path })!;
        const row = page.itemRow(view)!;
        const name = row.querySelector<HTMLElement>("p")!;
        const trigger = Array.from(row.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === label,
        )!;
        // The name's text, not its box: a box that stretches across the row
        // leaves its text at the start, a row away from the chooser.
        const text = name.ownerDocument.createRange();
        text.selectNodeContents(name);
        const measure = () => {
          const box = name.getBoundingClientRect();
          const button = trigger.getBoundingClientRect();
          return {
            gap: Math.round(button.left - text.getBoundingClientRect().right),
            sameLine:
              Math.abs(
                button.top + button.height / 2 - (box.top + box.height / 2),
              ) < 2,
            cut: name.scrollWidth > name.clientWidth,
            room: Math.round(row.getBoundingClientRect().right - button.right),
          };
        };
        const wide = measure();
        row.style.width = "320px";
        await page.until("the narrow row", () => row.offsetWidth === 320);
        const narrow = measure();
        row.style.width = "";
        return { wide, narrow };
      },
      { path, label: run.m.workbench_choose_item() },
    );
    expect(layout.wide).toMatchObject({ sameLine: true, cut: false });
    expect(layout.wide.gap).toBeLessThanOrEqual(8);
    expect(layout.wide.room).toBeGreaterThan(200);
    expect(layout.narrow).toMatchObject({ sameLine: true, cut: true });
    expect(layout.narrow.room).toBeGreaterThanOrEqual(0);
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
        const trigger = Array.from(
          page.itemRow(page.workbench({ path }))?.querySelectorAll("button") ??
            [],
        ).find((button) => button.textContent.trim() === label);
        if (!trigger || trigger.doc === document) return false;
        page.press(trigger, "Choose item in the pop-out");
        return true;
      },
      { path, label: run.m.workbench_choose_item() },
      { what: "the pop-out workbench's Choose item" },
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
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, item, fields }) => {
        // A tab of the editor area's own, as wide as the window lets it be.
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: item },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        // The reader opens the Fields popover from its view action.
        leaf.view.containerEl
          .querySelector<HTMLElement>(`.view-action[aria-label="${fields}"]`)
          ?.click();
      },
      { path, item: targetItem.key, fields: run.m.workbench_view_fields() },
    );
    const fieldsName = (title: string) =>
      obRunUntil(
        run.vaultId,
        ({ page }, { path, title }) =>
          !!page
            .fieldsPopover(page.workbench({ path }))
            ?.innerText.includes(title),
        { path, title },
        { what: `the Fields popover to name "${title}"` },
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

  // #1945: the Preview is part of the view's saved state, and its edge
  // reports the width the view draws: the Preview column grows until the
  // editor keeps its 360 px. The Fields popover is never saved (#1964).
  it("restores the Preview and its width with the workspace, and the Fields popover closed", async () => {
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
          // there, so the Preview stands as a column (#1955).
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
            const panel = page.previewPanel(view);
            const handle = Array.from(
              view.contentEl.querySelectorAll<HTMLElement>("[role=separator]"),
            ).find((element) => element.getAttribute("aria-label") === label);
            // The panels' own container, which the share is of; the Preview
            // stands in the editor's stack inside it.
            const container = panel?.closest<HTMLElement>(
              '[data-part="panels"]',
            );
            if (!panel || !container || !handle) return null;
            const now = handle.getAttribute("aria-valuenow");
            edges[side] = {
              drawn: panel.offsetWidth,
              container: container.clientWidth,
              now,
              max: handle.getAttribute("aria-valuemax"),
            };
          }
          return JSON.stringify({
            edges,
            saved: view.getState().panels,
            popover: page.fieldsPopover(view) !== null,
          });
        },
        {
          path,
          labels: { preview: run.m.workbench_preview_resize() },
        },
        {
          what: "the Preview restored, its edge naming its drawn width",
          // The edge has described its panel once it names the drawn width.
          ready: (value) =>
            value !== null &&
            Object.values(
              (JSON.parse(value) as { edges: Record<string, Edge> }).edges,
            ).every(({ now, drawn }) => now === String(drawn)),
        },
      );
      return JSON.parse(read!) as {
        edges: Record<"preview", Edge>;
        saved: unknown;
        popover: boolean;
      };
    };
    const panels = {
      // Wider than 40% of the leaf: the Preview column has no share cap.
      preview: { shown: true, width: 700 },
    };
    // A Fields column an older build saved has no place to restore to.
    const first = await read(
      JSON.stringify({
        panels: { ...panels, fields: { shown: true, width: 260 } },
      }),
    );
    const { preview } = first.edges;
    expect(preview.drawn).toBe(700);
    expect(preview.drawn).toBeGreaterThan(preview.container * 0.4);
    // The Preview grows until the editor keeps only its 360 px beside the
    // column and its handle's 1 px line (#1952).
    expect(preview.max).toBe(String(preview.container - 360 - 1));
    expect(first.popover).toBe(false);
    // The reader opens the Fields popover; the saved state leaves it out.
    const saved = await obRun(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path })!;
        view.registry.set(view.workbench.fieldsPanel, "open");
        return JSON.stringify(view.getState());
      },
      { path },
    );
    // The saved state of that leaf restores the Preview in a new leaf, with
    // the Fields popover closed.
    const second = await read(saved);
    expect(second.edges.preview.now).toBe(String(preview.drawn));
    expect(second.popover).toBe(false);
    // A state that names no Preview height leaves the leaf's own, 40%; the
    // Fields Panel was never pinned.
    expect(second.saved).toEqual({
      fields: { pinned: false, hidden: false, width: 320 },
      preview: { ...panels.preview, height: 40 },
    });
  });

  // The panel dividers look as Obsidian's own divider does, and take no room
  // beyond its 1 px line, so each column keeps the width the reader set.
  it("draws the panel dividers as Obsidian's pane divider, at the panels' set widths", async () => {
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
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: {
            file: path,
            panels: {
              fields: { pinned: true, hidden: false, width: 300 },
              preview: { shown: true, width: 360, height: 40 },
            },
          },
          active: true,
        });
      },
      { path },
    );
    const read = await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path });
        const container = view?.contentEl.querySelector<HTMLElement>(
          '[data-part="panels"]',
        );
        const edges = Array.from(
          container?.querySelectorAll<HTMLElement>('[data-part="edge"]') ?? [],
        );
        const own = view?.contentEl.ownerDocument.querySelector<HTMLElement>(
          ".workspace-split.mod-left-split > .workspace-leaf-resize-handle",
        );
        if (!view || !container || edges.length !== 2 || !own) return null;
        // The divider's look, its line on whichever side it stands.
        const look = (element: HTMLElement) => {
          const style = getComputedStyle(element);
          const sides = ["Top", "Right", "Bottom", "Left"] as const;
          const line = sides.find(
            (side) => style.getPropertyValue(`border-${side}-width`) !== "0px",
          )!;
          return {
            // The style's width, which a collapsed sidebar's divider keeps.
            thickness: style.width,
            line: style.getPropertyValue(`border-${line}-width`),
            color: style.getPropertyValue(`border-${line}-color`),
            background: style.backgroundColor,
            transition: style.transition,
            cursor: style.cursor,
          };
        };
        const width = (selector: string) =>
          container.querySelector(selector)!.getBoundingClientRect().width;
        return JSON.stringify({
          own: look(own),
          edges: edges.map(look),
          fields: width('[data-panel="fields"]'),
          preview: width('[data-panel="preview"]'),
          editor: width('[data-part="editor"]'),
          container: container.getBoundingClientRect().width,
        });
      },
      { path },
      {
        what: "the docked Fields Panel and the Preview beside the editor",
        ready: (value) => value !== null,
      },
    );
    const { own, edges, fields, preview, editor, container } = JSON.parse(
      read!,
    ) as {
      own: unknown;
      edges: unknown[];
      fields: number;
      preview: number;
      editor: number;
      container: number;
    };
    expect(edges).toEqual([own, own]);
    expect([fields, preview]).toEqual([300, 360]);
    // Each divider's 1 px line is all the room it takes from the editor.
    expect(fields + 1 + editor + 1 + preview).toBeCloseTo(container, 1);
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
      // The Fields Panel was never pinned.
      fields: { pinned: false, hidden: false, width: 320 },
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
            // The box under the item row, which the panels and the editor share.
            const shared = view?.contentEl.querySelector<HTMLElement>(
              "[data-workbench-panels]",
            );
            if (!view || !panel || !editor || !handle || !shared) return null;
            const box = panel.getBoundingClientRect();
            const source = editor.getBoundingClientRect();
            return JSON.stringify({
              width: shared.clientWidth,
              height: shared.clientHeight,
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

    // A leaf narrower than 56rem (896 px) puts the Preview under the editor,
    // at 40% of the height.
    await open(JSON.stringify({ panels }), 30);
    const narrow = await layout(
      "the Preview under the editor of a narrow leaf",
      (layout) => layout.preview === "below",
    );
    expect(narrow.width).toBeLessThan(896);
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

  // #1952: 56rem (896 px) of view width is where the Preview moves between
  // the editor's side and under it, whatever room the editor would keep.
  it("puts the Preview under the editor below a 56rem view and beside it from 56rem", async () => {
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
    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
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
            // A narrow Preview: the editor keeps its 360 px beside it either side
            // of the boundary, so the width alone moves it.
            panels: {
              preview: { shown: true, width: 240, height: 40 },
            },
          },
          active: true,
        });
        const other = app.workspace.createLeafBySplit(leaf, "vertical");
        await other.setViewState({ type: "empty" });
      },
      { path },
    );
    interface Placed {
      readonly width: number;
      readonly preview: "below" | "right" | "other";
    }
    /**
     * Gives the editor's tab group the share of the window that makes the
     * panels' box about `target` px wide, and reads where the Preview stands
     * once the box has that width.
     */
    const placeAt = async (target: number) => {
      const resize = (share: number) =>
        obRun(
          run.vaultId,
          ({ app, page }, { path, share }) => {
            const leaf = page.workbench({ path })!.leaf;
            const other = app.workspace.getLeavesOfType("empty")[0]!;
            // The share of the root split, on whichever item sits in it.
            type Sized = { setDimension(share: number): void; parent: unknown };
            const item = (sized: Sized) =>
              sized.parent === app.workspace.rootSplit
                ? sized
                : (sized.parent as Sized);
            item(leaf as unknown as Sized).setDimension(share);
            item(other as unknown as Sized).setDimension(100 - share);
          },
          { path, share },
        );
      const read = (what: string, ready: (placed: Placed) => boolean) =>
        obRunUntil(
          run.vaultId,
          ({ page }, { path }) => {
            const view = page.workbench({ path });
            const shared = view?.contentEl.querySelector<HTMLElement>(
              "[data-workbench-panels]",
            );
            const panel = page.previewPanel(view);
            const editor = view?.contentEl.querySelector<HTMLElement>(
              '[data-part="editor"]',
            );
            if (!shared || !panel || !editor) return null;
            const box = panel.getBoundingClientRect();
            const source = editor.getBoundingClientRect();
            return {
              width: shared.clientWidth,
              preview:
                box.top >= source.bottom
                  ? "below"
                  : box.left >= source.right
                    ? "right"
                    : "other",
            } satisfies Placed;
          },
          { path },
          {
            what,
            ready: (placed) => placed !== null && ready(placed),
          },
        );
      const total = await obRun(
        run.vaultId,
        ({ app }) =>
          (app.workspace.rootSplit as unknown as { containerEl: HTMLElement })
            .containerEl.clientWidth,
        undefined,
      );
      // One correction for the dividers the split draws between the groups.
      const first = (target / total) * 100;
      await resize(first);
      const measured = await read(
        `the panels' box near ${target} px`,
        ({ width }) => Math.abs(width - target) < 80,
      );
      await resize((first * target) / measured!.width);
      // The placement follows the box's own width.
      return (await read(
        `the Preview placed for a box near ${target} px`,
        ({ width, preview }) =>
          Math.abs(width - target) < 24 &&
          preview === (width >= 896 ? "right" : "below"),
      ))!;
    };
    const narrow = await placeAt(870);
    expect(narrow.width).toBeLessThan(896);
    expect(narrow.preview).toBe("below");
    const wide = await placeAt(925);
    expect(wide.width).toBeGreaterThanOrEqual(896);
    expect(wide.preview).toBe("right");
  });

  // #1952: Help is a view action of its own, and opens the docs menu at the
  // button.
  it("opens the docs from the Help view action", async () => {
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
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
      },
      { path },
    );
    // The menu closes whatever the case finds, before the leaf goes.
    cleanup.defer(() =>
      obRun(
        run.vaultId,
        () => {
          for (const menu of document.body.querySelectorAll(".menu"))
            menu.remove();
        },
        undefined,
      ),
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path, label }) => {
        const trigger = page
          .workbench({ path })
          ?.containerEl.querySelector<HTMLElement>(
            `.view-actions .view-action[aria-label="${label}"]`,
          );
        if (!trigger) return false;
        page.press(trigger, "Help");
        return true;
      },
      { path, label: run.m.workbench_help() },
      { what: "the Help view action" },
    );
    const menu = await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const trigger = page
          .workbench({ path })
          ?.containerEl.querySelector<HTMLElement>(
            ".view-action.has-active-menu",
          );
        const titles = Array.from(
          document.querySelectorAll<HTMLElement>(
            "body > .menu .menu-item-title",
          ),
          (title) => title.textContent,
        );
        return trigger && titles.length > 0 ? titles : null;
      },
      { path },
      {
        what: "the Help menu at its action",
        ready: (titles) => titles !== null,
      },
    );
    expect(menu).toEqual([
      run.m.workbench_docs_guide(),
      run.m.workbench_docs_note(),
      run.m.workbench_docs_data(),
      run.m.workbench_problems_community(),
    ]);
  });

  // #1956: a reader who cannot drag sizes every handle from the pane menu
  // alone, and the sizes the menu sets are saved like dragged ones.
  it("sizes and resets the Preview through the pane menu alone, and restores the sizes", async () => {
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
     * its actions, then each submenu of `groups` in turn, and returns the
     * last submenu's entries; a disabled entry reads in parentheses.
     */
    const submenu = (...groups: string[]) =>
      obRunUntil(
        run.vaultId,
        ({ page }, { path, groups }) => {
          const view = page.workbench({ path })!;
          const doc = view.containerEl.doc;
          const title = (item: Element) =>
            item.querySelector(".menu-item-title")?.textContent ?? "";
          const menus = Array.from(doc.body.querySelectorAll(".menu"));
          if (menus.length === 0) {
            const actions = view.containerEl.querySelectorAll<HTMLElement>(
              ".view-actions .view-action",
            );
            actions[actions.length - 1]!.click();
            return null;
          }
          const last = menus[menus.length - 1]!;
          if (menus.length <= groups.length) {
            const parent = Array.from(
              last.querySelectorAll<HTMLElement>(".menu-item"),
            ).find((item) => title(item) === groups[menus.length - 1]);
            parent?.dispatchEvent(
              new MouseEvent("mouseover", { bubbles: true }),
            );
            parent?.click();
            return null;
          }
          return Array.from(last.querySelectorAll(".menu-item"), (item) =>
            item.classList.contains("is-disabled")
              ? `(${title(item)})`
              : title(item),
          ).join("|");
        },
        { path, groups },
        {
          what: `the ${groups.join(" → ")} submenu`,
          ready: (value) => value !== null,
        },
      );
    /** Selects `entry` in the open submenu, as a click does, and closes the menu. */
    const pick = async (entry: string) => {
      await obRun(run.vaultId, ({ page }) => page.menuReady(), undefined);
      await obRun(
        run.vaultId,
        ({ page }, { path, entry }) => {
          const doc = page.workbench({ path })!.containerEl.doc;
          const menus = doc.body.querySelectorAll(".menu");
          const sub = menus[menus.length - 1]!;
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
    // The sizes wait in More workbench options (#1962).
    const more = m.template_workbench_more_options();
    const preview = `${m.workbench_preview_resize()} vertical`;
    const split = `${m.workbench_preview_resize()} horizontal`;

    // A wide leaf: the Preview column, sized from its submenu. The Fields
    // popover has no edge, so the pane menu sizes the Preview alone.
    await open(
      { panels: { preview: { shown: true, width: 400, height: 40 } } },
      null,
    );
    await handles("the Preview column", (now) => now[preview] === "400");
    expect(await submenu(more, m.workbench_preview_resize())).toBe(
      [
        m.workbench_panel_wider(),
        m.workbench_panel_narrower(),
        `(${m.workbench_panel_reset_width()})`,
      ].join("|"),
    );
    await pick(m.workbench_panel_narrower());
    await handles("the Preview narrower", (now) => now[preview] === "336");
    expect(await submenu(more, m.workbench_preview_resize())).toContain(
      `|${m.workbench_panel_reset_width()}`,
    );
    await pick(m.workbench_panel_reset_width());
    await handles(
      "the Preview at its default width",
      (now) => now[preview] === "400",
    );
    await submenu(more, m.workbench_preview_resize());
    await pick(m.workbench_panel_wider());
    const sized = await handles(
      "the Preview wider",
      (now) => now[preview] === "464",
    );
    expect(sized.saved).toEqual({
      // The Fields Panel was never pinned.
      fields: { pinned: false, hidden: false, width: 320 },
      preview: { shown: true, width: 464, height: 40 },
    });

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
    expect(await submenu(more, m.workbench_preview_resize())).toBe(
      [
        m.workbench_panel_taller(),
        m.workbench_panel_shorter(),
        `(${m.workbench_panel_reset_height()})`,
      ].join("|"),
    );
    await pick(m.workbench_panel_taller());
    const chosen = {
      // The Fields Panel was never pinned.
      fields: { pinned: false, hidden: false, width: 320 },
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

  // #1964: the Fields action opens the Fields popover at every width.
  it("inserts a field from the Fields popover of a narrow leaf with the keyboard, and closes it on Escape, a press outside and the action", async () => {
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
    // A leaf too narrow for a side panel beside an editor of 360 px.
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
          state: { file: path, itemIndexedKey: key },
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
          if (!view || !action || view.contentEl.clientWidth >= 600)
            return null;
          return JSON.stringify({
            popover: page.fieldsPopover(view) !== null,
            haspopup: action.getAttribute("aria-haspopup"),
            expanded: action.getAttribute("aria-expanded"),
          });
        },
        { path, label: run.m.workbench_view_fields() },
        {
          what: "a narrow leaf with its Fields action",
          ready: (value) => value !== null,
        },
      ))!,
    ) as Record<string, unknown>;
    // Narrowing opened no popover.
    expect(narrow).toEqual({
      popover: false,
      haspopup: "dialog",
      expanded: "false",
    });

    const walk = await obRun(
      run.vaultId,
      async ({ page }, { path, label, insert }) => {
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
        const popover = () => page.fieldsPopover(view);
        const search = () =>
          popover()?.querySelector<HTMLInputElement>('input[type="search"]') ??
          null;
        const doiInsert = () =>
          popover()?.querySelector<HTMLElement>(
            `[data-workbench-field="DOI"] [role="button"][aria-label="${insert}"]`,
          ) ?? null;
        /** Tabs from the search field to the DOI row's Insert button. */
        const tabToDoi = async () => {
          for (let step = 0; step < 12; step++) {
            if (el.doc.activeElement === doiInsert()) return true;
            await input.key("Tab");
          }
          return el.doc.activeElement === doiInsert();
        };
        await input.click(action);
        await until(
          "focus in the popover's search field",
          () => search() !== null && el.doc.activeElement === search(),
        );
        const dialog = popover()!;
        // The popover stands inset at the view's right edge, as tall as the
        // view less Obsidian's gap on the top, right and bottom.
        const gap = Number.parseFloat(
          el.win.getComputedStyle(el).getPropertyValue("--size-4-2"),
        );
        const shell = dialog.closest<HTMLElement>(".zt-pinned-popover")!;
        const box = el.getBoundingClientRect();
        const at = shell.getBoundingClientRect();
        const near = (a: number, b: number) => Math.abs(a - b) <= 1;
        const opened = {
          expanded: action.getAttribute("aria-expanded"),
          controls: action.getAttribute("aria-controls") === dialog.id,
          modal: dialog.getAttribute("aria-modal"),
          inset:
            gap > 0 &&
            near(at.top - box.top, gap) &&
            near(box.right - at.right, gap) &&
            near(box.bottom - at.bottom, gap),
          // Not modal: nothing under it turns inert.
          inert: el.querySelector("[inert]") !== null,
        };
        await contents.insertText("doi");
        await until("the search finds the DOI", () => doiInsert() !== null);
        const reached = await tabToDoi();
        await input.key("Enter");
        await until(
          "the field at the cursor, the popover closed and the editor focused",
          () =>
            popover() === null &&
            editor.state.doc.toString().endsWith("{{ zt.DOI }}") &&
            editor.hasFocus,
        );
        const { head } = editor.state.selection.main;
        const inserted = {
          // The cursor stands after the inserted field.
          cursorAfter: head === editor.state.doc.length,
          expanded: action.getAttribute("aria-expanded"),
        };
        // Shift+Enter inserts and keeps the popover open for the next field.
        await input.click(action);
        await until(
          "the popover again",
          () => el.doc.activeElement === search(),
        );
        if (search()!.value !== "doi") {
          search()!.select();
          await contents.insertText("doi");
        }
        await until("the DOI again", () => doiInsert() !== null);
        await tabToDoi();
        await input.key("Enter", ["shift"]);
        await until("the second DOI", () =>
          editor.state.doc.toString().endsWith("{{ zt.DOI }}{{ zt.DOI }}"),
        );
        const kept = popover() !== null;
        // Focus stays on the row's Insert button for the next field.
        await new Promise((resolve) => el.win.setTimeout(resolve, 300));
        const keptFocus = el.doc.activeElement === doiInsert();
        // Escape clears the search first (#1967), then closes the popover
        // and hands focus to the action.
        await input.key("Escape");
        await until(
          "the search cleared by Escape",
          () => popover() !== null && search()!.value === "",
        );
        await input.key("Escape");
        await until("the popover closed by Escape", () => popover() === null);
        const escaped = el.doc.activeElement === action;
        // A press on the editor, left of the popover that covers most of
        // the narrow leaf, closes it.
        await input.click(action);
        await until(
          "the popover for the outside press",
          () => popover() !== null,
        );
        await input.click(content, { x: 8, y: 8 });
        await until(
          "the popover closed by the outside press",
          () => popover() === null,
        );
        const outside = action.getAttribute("aria-expanded");
        // A press on a place that takes no focus, the item row's label,
        // closes it and hands focus back to the action (walkthrough F2).
        await input.click(action);
        await until(
          "the popover for the press on the label",
          () => popover() !== null,
        );
        await input.click(
          el.querySelector<HTMLElement>(
            "[data-workbench-item-row] > [data-part=label]",
          )!,
          { x: 4, y: 6 },
        );
        await until(
          "focus on the action after the press on the label",
          () => popover() === null && el.doc.activeElement === action,
        );
        // A second press on the action closes it.
        await input.click(action);
        await until("the popover for the press", () => popover() !== null);
        await input.click(action);
        await until(
          "the popover closed by the press",
          () => popover() === null,
        );
        return JSON.stringify({
          opened,
          reached,
          inserted,
          kept,
          keptFocus,
          escaped,
          outside,
          pressed: action.getAttribute("aria-expanded"),
        });
      },
      {
        path,
        label: run.m.workbench_view_fields(),
        insert: run.m.workbench_fields_put_in_note(),
      },
    );
    expect(JSON.parse(walk)).toEqual({
      opened: {
        expanded: "true",
        controls: true,
        modal: null,
        inset: true,
        inert: false,
      },
      reached: true,
      inserted: { cursorAfter: true, expanded: "false" },
      kept: true,
      keptFocus: true,
      escaped: true,
      outside: "false",
      pressed: "false",
    });

    // Widening the leaf opens no popover.
    await obRun(
      run.vaultId,
      ({ app }) => app.workspace.detachLeavesOfType("empty"),
      undefined,
    );
    expect(
      await obRunUntil(
        run.vaultId,
        ({ page }, { path }) => {
          const view = page.workbench({ path });
          return view && view.contentEl.clientWidth >= 600
            ? page.fieldsPopover(view) === null
            : null;
        },
        { path },
        {
          what: "the widened leaf",
          ready: (value) => value !== null,
        },
      ),
    ).toBe(true);
  });

  // #1967: a click on a row, or Enter on the row ↑/↓ selected, shows its
  // details; never a hover. A wide leaf shows them beside the Fields
  // popover, a narrow one in a bar at its foot.
  it("shows a field's details beside the Fields popover in a wide leaf and in a bar in a narrow one, and closes them on Copy, Insert, a press outside and Escape", async () => {
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
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
      },
      { path, key: targetItem.key },
    );

    /** One walk over the open leaf; `wide` says which details it expects. */
    const walk = (wide: boolean) =>
      obRun(
        run.vaultId,
        async ({ page }, { path, label, wide }) => {
          const { until, trusted } = page;
          const view = page.workbench({ path })!;
          const el = view.contentEl;
          const win = el.win;
          const input = trusted(win);
          const contents = (
            win as Window & {
              electronWindow: { webContents: import("electron").WebContents };
            }
          ).electronWindow.webContents;
          contents.focus();
          await until("the window takes keys", () => el.doc.hasFocus());
          await until(
            "the leaf at its width",
            () => el.clientWidth >= 600 === wide,
          );
          const action = view.containerEl.querySelector<HTMLElement>(
            `.view-action[aria-label="${label}"]`,
          )!;
          const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
          const editor = content.cmTile!.root.view;
          await input.click(content);
          editor.dispatch({ selection: { anchor: editor.state.doc.length } });
          const popover = () => page.fieldsPopover(view);
          const search = () =>
            popover()?.querySelector<HTMLInputElement>(
              'input[type="search"]',
            ) ?? null;
          const row = (key: string) =>
            [
              ...(popover()?.querySelectorAll<HTMLElement>(
                "[data-workbench-field]",
              ) ?? []),
            ]
              .find((item) => item.dataset.workbenchField === key)
              ?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
          const details = () =>
            el.doc.querySelector<HTMLElement>("[data-part=details]");
          const tops = () =>
            [
              ...popover()!.querySelectorAll<HTMLElement>(
                "[data-workbench-field] > [data-part=row]",
              ),
            ].map((element) => Math.round(element.getBoundingClientRect().top));
          const notices = () =>
            [...el.doc.querySelectorAll(".notice")].map(
              (notice) => notice.textContent,
            );
          await input.click(action);
          await until("the Fields popover", () => search() !== null);
          const title = row("title")!;
          const where = title.getBoundingClientRect();
          // Hover opens nothing and moves no row.
          const before = tops();
          contents.sendInputEvent({
            type: "mouseMove",
            x: Math.round(where.left + 20),
            y: Math.round(where.top + where.height / 2),
          });
          await new Promise((resolve) => win.setTimeout(resolve, 300));
          const hover = {
            details: details() !== null,
            moved: tops().some((top, at) => top !== before[at]),
          };
          // A click on the row shows them, and focus stays in the search.
          await input.click(title, { x: 40, y: where.height / 2 });
          await until("the details", () => details() !== null);
          const shown = details()!;
          const box = shown.getBoundingClientRect();
          const panel = popover()!.getBoundingClientRect();
          const opened = {
            state: shown.dataset.state,
            inPopover: popover()!.contains(shown),
            beside: wide
              ? box.right <= panel.left &&
                Math.abs(box.top - title.getBoundingClientRect().top) <= 1
              : (() => {
                  // The bar of fixed height at the popover's foot.
                  const bar = shown
                    .closest("[data-part=details-bar]")!
                    .getBoundingClientRect();
                  return (
                    bar.bottom <= panel.bottom &&
                    bar.left >= panel.left &&
                    bar.height > 0
                  );
                })(),
            focusInSearch: el.doc.activeElement === search(),
            rowsMoved: wide && tops().some((top, at) => top !== before[at]),
          };
          // Copy closes them and keeps the popover.
          await input.click(shown.querySelector("[data-part=copy]")!);
          await until("the details closed by Copy", () => details() === null);
          const copied = {
            popover: popover() !== null,
            focusInSearch: el.doc.activeElement === search(),
            notice: await until(
              "the copy notice",
              () => notices().at(-1) === "Copied Title." && "Copied Title.",
            ),
          };
          // A press outside them and their row closes them.
          await input.click(title, { x: 40, y: where.height / 2 });
          await until("the details again", () => details() !== null);
          await input.click(search()!);
          await until(
            "the details closed by a press",
            () => details() === null,
          );
          // Escape: the details, then the search text, then the popover.
          await contents.insertText("ti");
          await until("the search", () => row("title") !== null);
          await input.click(row("title")!, { x: 40, y: 8 });
          await until("the details for Escape", () => details() !== null);
          await input.key("Escape");
          await until("the details closed by Escape", () => details() === null);
          const first = { query: search()!.value, popover: popover() !== null };
          await input.key("Escape");
          await until("the search cleared", () => search()!.value === "");
          const second = popover() !== null;
          await input.key("Escape");
          await until("the popover closed", () => popover() === null);
          const third = el.doc.activeElement === action;
          // Enter on the row ↑/↓ selected shows them; Mod+Enter inserts it.
          await input.click(content);
          editor.dispatch({ selection: { anchor: editor.state.doc.length } });
          await input.click(action);
          await until("the popover for the keys", () => search() !== null);
          await contents.insertText("doi");
          await until("the DOI", () => row("DOI") !== null);
          await input.key("Down");
          await input.key("Return");
          await until("the DOI's details", () => details() !== null);
          const keyed =
            details()!.querySelector("[data-part=title]")?.textContent;
          await input.key("Return", [
            process.platform === "darwin" ? "meta" : "control",
          ]);
          await until(
            "the DOI inserted with the popover closed",
            () =>
              popover() === null &&
              editor.state.doc.toString().endsWith("{{ zt.DOI }}") &&
              editor.hasFocus,
          );
          const inserted = {
            editorFocus: editor.hasFocus,
            notice: await until(
              "the insert notice",
              () => notices().at(-1) === "Inserted DOI." && "Inserted DOI.",
            ),
          };
          // Insert in the details closes them and the popover.
          await input.click(action);
          await until("the popover for Insert", () => search() !== null);
          if (search()!.value) {
            await input.key("Escape");
            await until("the search empty", () => search()!.value === "");
          }
          await input.click(row("title")!, { x: 40, y: 8 });
          await until("the details for Insert", () => details() !== null);
          await input.click(details()!.querySelector("[data-part=insert]")!);
          await until(
            "the title inserted with the popover closed",
            () =>
              popover() === null &&
              details() === null &&
              editor.state.doc.toString().endsWith("{{ zt.title }}"),
          );
          return JSON.stringify({
            hover,
            opened,
            copied,
            escape: { first, second, third },
            keyed,
            inserted,
          });
        },
        { path, label: run.m.workbench_view_fields(), wide },
      );

    const expected = (wide: boolean) => ({
      hover: { details: false, moved: false },
      opened: {
        state: wide ? "popover" : "bar",
        inPopover: !wide,
        beside: true,
        focusInSearch: true,
        rowsMoved: false,
      },
      copied: { popover: true, focusInSearch: true, notice: "Copied Title." },
      escape: {
        first: { query: "ti", popover: true },
        second: true,
        third: true,
      },
      keyed: "DOI",
      inserted: { editorFocus: true, notice: "Inserted DOI." },
    });
    expect(JSON.parse(await walk(true))).toEqual(expected(true));

    // A leaf too narrow for the details beside the popover.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        const leaf = app.workspace.getLeavesOfType(
          "zotlit-template-workbench",
        )[0]!;
        const other = app.workspace.createLeafBySplit(leaf, "vertical");
        await other.setViewState({ type: "empty" });
        type Sized = { setDimension(share: number): void };
        for (const child of (
          app.workspace.rootSplit as unknown as { children: unknown[] }
        ).children)
          (child as Sized).setDimension(
            child === leaf || child === leaf.parent ? 30 : 70,
          );
      },
      undefined,
    );
    expect(JSON.parse(await walk(false))).toEqual(expected(false));

    // Walkthrough of spec #1962 (F5): at 200% zoom the narrow leaf is short.
    // The bar gives way, so the list keeps the field's whole row under its
    // sticky section header, and the bar opens on its snippet.
    const zoomed = await obRun(
      run.vaultId,
      async ({ page }, { path, label }) => {
        const { until, trusted } = page;
        const view = page.workbench({ path })!;
        const el = view.contentEl;
        const { webFrame } = require("electron") as typeof import("electron");
        webFrame.setZoomFactor(2);
        try {
          const input = trusted(el.win);
          await until("the zoomed leaf", () => el.clientHeight < 500);
          const popover = () => page.fieldsPopover(view);
          const action = view.containerEl.querySelector<HTMLElement>(
            `.view-action[aria-label="${label}"]`,
          )!;
          if (!popover()) await input.click(action);
          await until("the popover", () => popover() !== null);
          const title = () =>
            popover()!.querySelector<HTMLElement>(
              '[data-workbench-field="title"] > [data-part=row]',
            );
          await until("the title row", () => title() !== null);
          await input.click(title()!, { x: 20, y: 8 });
          const bar = await until("the bar", () =>
            el.doc.querySelector<HTMLElement>("[data-part=details-bar]"),
          );
          await new Promise((resolve) => el.win.setTimeout(resolve, 300));
          const list = popover()!
            .querySelector<HTMLElement>(
              "[data-part=explorer] > [data-part=body]",
            )!
            .getBoundingClientRect();
          const header = [
            ...popover()!.querySelectorAll<HTMLElement>(
              "[data-part=section-heading]",
            ),
          ]
            .map((heading) => heading.getBoundingClientRect())
            .find((box) => box.top <= list.top + 1 && box.bottom > list.top);
          const row = title()!.getBoundingClientRect();
          const box = bar.getBoundingClientRect();
          const snippet = bar
            .querySelector<HTMLElement>("[data-part=snippet]")!
            .getBoundingClientRect();
          const actions = bar
            .querySelector<HTMLElement>("[data-part=actions]")!
            .getBoundingClientRect();
          return {
            short: el.clientHeight < 500,
            wholeRow:
              row.top >= (header?.bottom ?? list.top) - 0.5 &&
              row.bottom <= list.bottom + 0.5,
            snippetShown:
              snippet.top >= box.top - 0.5 &&
              snippet.bottom <= actions.top + 0.5,
          };
        } finally {
          webFrame.setZoomFactor(1);
        }
      },
      { path, label: run.m.workbench_view_fields() },
    );
    expect(zoomed).toEqual({ short: true, wholeRow: true, snippetShown: true });
  });

  /** The creators of "Alpha of the personal library", from the Fixture Spec. */
  const ALPHA_CREATORS = [
    "Ada Personal",
    "Erin Editor",
    "ZotLit Research Collective",
  ];

  // #1969: a list goes into the note for every item. Chosen as "Each item"
  // in its details, it writes one Markdown list line per item, which the
  // Preview shows as one list item each.
  it("inserts a list in the Each item form, and the Preview shows one list line per item", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, key, showPreview }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        leaf.view.containerEl
          .querySelector<HTMLElement>(
            `.view-action[aria-label="${showPreview}"]`,
          )
          ?.click();
      },
      {
        path,
        key: targetItem.key,
        showPreview: run.m.workbench_show_preview(),
      },
    );

    const result = await obRun(
      run.vaultId,
      async ({ page }, { path, label, eachItem, names }) => {
        const { until, trusted } = page;
        const view = page.workbench({ path })!;
        const el = view.contentEl;
        const win = el.win;
        const input = trusted(win);
        const contents = (
          win as Window & {
            electronWindow: { webContents: import("electron").WebContents };
          }
        ).electronWindow.webContents;
        contents.focus();
        await until("the window takes keys", () => el.doc.hasFocus());
        await until("the Preview", () => page.previewPanel(view) !== null);
        const action = view.containerEl.querySelector<HTMLElement>(
          `.view-action[aria-label="${label}"]`,
        )!;
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        await input.click(content);
        // A list line of its own, under the note's text.
        const end = editor.state.doc.length;
        editor.dispatch({
          changes: { from: end, insert: "\n\n" },
          selection: { anchor: end + 2 },
        });
        const popover = () => page.fieldsPopover(view);
        const row = (key: string) =>
          [
            ...(popover()?.querySelectorAll<HTMLElement>(
              "[data-workbench-field]",
            ) ?? []),
          ]
            .find((item) => item.dataset.workbenchField === key)
            ?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
        const details = () =>
          el.doc.querySelector<HTMLElement>("[data-part=details]");
        await input.click(action);
        await until("the creators row", () => row("creators") !== null);
        const creators = row("creators")!;
        // The row: its count and every item, and no row for one item.
        const line = creators.textContent;
        const indexRows = [
          ...popover()!.querySelectorAll<HTMLElement>("[data-workbench-field]"),
        ].filter((item) => /\[\d+\]/.test(item.dataset.workbenchField!)).length;
        await input.click(creators, { x: 40, y: 8 });
        await until("the details", () => details() !== null);
        const values = [
          ...details()!.querySelectorAll<HTMLElement>(
            "[data-part=values-text]",
          ),
        ].map((value) => value.textContent);
        const radio = [
          ...details()!.querySelectorAll<HTMLInputElement>("input[type=radio]"),
        ].find((input) => input.closest("label")!.textContent === eachItem)!;
        await input.click(radio);
        await until("the Each item form", () => radio.checked);
        const snippet = details()!.querySelector(
          "[data-part=snippet]",
        )!.textContent;
        await input.click(details()!.querySelector("[data-part=insert]")!);
        await until(
          "the loop inserted with the popover closed",
          () =>
            popover() === null && editor.state.doc.toString().endsWith(snippet),
        );
        // The Preview renders the loop as one list item per creator.
        const items = await until("the Preview's list items", () => {
          const texts = [
            ...page.previewPanel(view)!.querySelectorAll("li"),
          ].map((item) => item.textContent.trim());
          return names.every((name) => texts.includes(name)) && texts;
        });
        return { line, indexRows, values, snippet, items };
      },
      {
        path,
        label: run.m.workbench_view_fields(),
        eachItem: run.m.workbench_fields_details_form_loop(),
        names: ALPHA_CREATORS,
      },
    );
    expect(result.indexRows).toBe(0);
    expect(result.line).toContain(
      "(3) Ada Personal, Erin Editor, ZotLit Research Collective",
    );
    expect(result.values).toEqual(ALPHA_CREATORS);
    expect(result.snippet).toBe(
      "{% for creator in zt.creators %}\n- {{ creator }}{% endfor %}",
    );
    expect(result.items).toEqual(expect.arrayContaining(ALPHA_CREATORS));
  });

  // Walkthrough of spec #1962 (F3): ZotLit Research Collective is a one-field
  // name, with no family name. The details list all three creators and mark
  // that one; both forms pass over it, and the Preview shows what each form's
  // result says.
  it("passes over a creator with no family name in the details' results and in the Preview", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) => {
          app.workspace.detachLeavesOfType("zotlit-template-workbench");
        },
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, key, showPreview }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
        await app.workspace.revealLeaf(leaf);
        leaf.view.containerEl
          .querySelector<HTMLElement>(
            `.view-action[aria-label="${showPreview}"]`,
          )
          ?.click();
      },
      {
        path,
        key: targetItem.key,
        showPreview: run.m.workbench_show_preview(),
      },
    );

    const result = await obRun(
      run.vaultId,
      async ({ page }, { path, label, eachItem, names }) => {
        const { until, trusted } = page;
        const view = page.workbench({ path })!;
        const el = view.contentEl;
        const win = el.win;
        const input = trusted(win);
        const contents = (
          win as Window & {
            electronWindow: { webContents: import("electron").WebContents };
          }
        ).electronWindow.webContents;
        contents.focus();
        await until("the window takes keys", () => el.doc.hasFocus());
        await until("the Preview", () => page.previewPanel(view) !== null);
        const action = view.containerEl.querySelector<HTMLElement>(
          `.view-action[aria-label="${label}"]`,
        )!;
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        await input.click(content);
        const end = editor.state.doc.length;
        editor.dispatch({
          changes: { from: end, insert: "\n\n" },
          selection: { anchor: end + 2 },
        });
        const popover = () => page.fieldsPopover(view);
        const row = (key: string) =>
          [
            ...(popover()?.querySelectorAll<HTMLElement>(
              "[data-workbench-field]",
            ) ?? []),
          ]
            .find((item) => item.dataset.workbenchField === key)
            ?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
        const details = () =>
          el.doc.querySelector<HTMLElement>("[data-part=details]");
        const text = (part: string) =>
          details()!.querySelector(`[data-part=${part}]`)!.textContent;
        /** Opens the family details, in the form named `form` when given. */
        const openFamily = async (form?: string) => {
          // The insert's notice stands over the view actions of a wide
          // leaf; a press dismisses it, as a reader's would.
          for (const notice of el.doc.querySelectorAll(".notice"))
            await input.click(notice);
          await until(
            "the notices dismissed",
            () => el.doc.querySelector(".notice") === null,
          );
          await input.click(action);
          await until("the creators row", () => row("creators") !== null);
          if (row("creators[].family") === null) {
            await input.click(
              row("creators")!.querySelector<HTMLElement>(
                '[aria-label="Toggle node"]',
              )!,
            );
            await until(
              "the family row",
              () => row("creators[].family") !== null,
            );
          }
          await input.click(row("creators[].family")!, { x: 40, y: 8 });
          await until("the family details", () => details() !== null);
          if (!form) return;
          const radio = [
            ...details()!.querySelectorAll<HTMLInputElement>(
              "input[type=radio]",
            ),
          ].find((input) => input.closest("label")!.textContent === form)!;
          await input.click(radio);
          await until("the form", () => radio.checked);
        };
        const preview = () => page.previewPanel(view)!;
        await openFamily();
        const values = [
          ...details()!.querySelectorAll<HTMLElement>(
            "[data-part=values-text]",
          ),
        ].map((value) => value.textContent);
        const joined = { snippet: text("snippet"), result: text("result") };
        await input.click(details()!.querySelector("[data-part=insert]")!);
        // The Preview renders the edit after a moment; a family name alone,
        // not a full name, marks the render of the inserted snippet.
        const line = await until("the joined family names in the Preview", () =>
          [...preview().querySelectorAll("p")]
            .map((p) => p.textContent.trim())
            .find((p) => p.startsWith(joined.result)),
        );
        const listed = (texts: string[]) =>
          texts.includes("Personal") && texts.includes("Editor");
        await openFamily(eachItem);
        const loop = { snippet: text("snippet"), result: text("result") };
        await input.click(details()!.querySelector("[data-part=insert]")!);
        const items = await until("the family names as list items", () => {
          const texts = [...preview().querySelectorAll("li")].map((item) =>
            item.textContent.trim(),
          );
          return listed(texts) && texts;
        });
        // A Preview of an earlier case's loop may still list the full names;
        // what stays are the lines this case's loop wrote.
        return {
          values,
          joined,
          line,
          loop,
          items: items.filter((item) => !names.includes(item)),
        };
      },
      {
        path,
        label: run.m.workbench_view_fields(),
        eachItem: run.m.workbench_fields_details_form_loop(),
        names: ALPHA_CREATORS,
      },
    );
    expect(result).toEqual({
      values: ["Personal", "Editor", run.m.workbench_fields_empty()],
      joined: {
        snippet:
          '{{ zt.creators | map: "family" | where_exp: "value", "value != blank" | join: ", " }}',
        result: "Personal, Editor",
      },
      // No separator after the last name.
      line: "Personal, Editor",
      loop: {
        snippet:
          "{% for creator in zt.creators %}{% if creator.family != blank %}\n- {{ creator.family }}{% endif %}{% endfor %}",
        result: "- Personal\n- Editor",
      },
      // No empty list item for the third creator.
      items: ["Personal", "Editor"],
    });
  });

  // #1966: pinned in a wide leaf, the Fields Panel docks at the leading edge
  // beside the editor. It stays while the reader inserts, the action hides
  // and shows it without unpinning it, and the workspace keeps the pin, the
  // hidden state and the width.
  it("pins the Fields Panel in a wide leaf, inserts while docked, hides and shows it, and restores the pin and width with the workspace", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) =>
          app.workspace.detachLeavesOfType("zotlit-template-workbench"),
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    /** Opens the Profile in a leaf that takes most of the window, from `state`. */
    const openLeaf = (state: string) =>
      obRun(
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
          type Sized = { setDimension(share: number): void };
          for (const child of (
            app.workspace.rootSplit as unknown as { children: unknown[] }
          ).children)
            (child as Sized).setDimension(child === leaf ? 90 : 10);
        },
        { path, state },
      );
    await openLeaf(JSON.stringify({ itemIndexedKey: targetItem.key }));
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path });
        return (
          view !== undefined &&
          view.contentEl.clientWidth >= 1000 &&
          view.contentEl.querySelector(".cm-content") !== null
        );
      },
      { path },
      { what: "a wide leaf with its editor" },
    );

    const walk = await obRun(
      run.vaultId,
      async ({ page }, { path, label, insert, resize }) => {
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
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        const editorPart = content.closest<HTMLElement>(
          '[data-part="editor"]',
        )!;
        const editorWidth = editorPart.offsetWidth;
        const dock = () => page.fieldsDock(view);
        const search = (surface: HTMLElement | null) =>
          surface?.querySelector<HTMLInputElement>('input[type="search"]') ??
          null;
        const pinOf = (surface: HTMLElement | null) =>
          surface?.querySelector<HTMLElement>('[data-part="pin"]') ?? null;
        // The reader opens the Fields popover and pins it.
        await input.click(action);
        await until(
          "the Fields popover",
          () => search(page.fieldsPopover(view)) === el.doc.activeElement,
        );
        const offered = pinOf(page.fieldsPopover(view))?.getAttribute(
          "aria-label",
        );
        await input.click(pinOf(page.fieldsPopover(view))!);
        await until(
          "the docked panel with focus in its search",
          () =>
            page.fieldsPopover(view) === null &&
            dock() !== null &&
            el.doc.activeElement === search(dock()),
        );
        const docked = dock()!;
        const pinned = {
          offered,
          label: pinOf(docked)?.getAttribute("aria-label"),
          state: pinOf(docked)?.dataset.state,
          expanded: action.getAttribute("aria-expanded"),
          // The docked panel stands at the leading edge, before the editor,
          // and the editor gives it the room.
          leading:
            docked.getBoundingClientRect().right <=
            editorPart.getBoundingClientRect().left,
          narrower: editorPart.offsetWidth < editorWidth,
          inert: el.querySelector("[inert]") !== null,
          // Beside the docked panel, the tab strip keeps its room above
          // the tabs, as it has without the panel.
          strip: page.tabStripInsets(view),
        };
        // An insert while docked keeps the panel and hands the editor focus.
        await input.click(content);
        editor.dispatch({ selection: { anchor: editor.state.doc.length } });
        search(dock())!.focus();
        await contents.insertText("doi");
        const doiInsert = () =>
          dock()?.querySelector<HTMLElement>(
            `[data-workbench-field="DOI"] [role="button"][aria-label="${insert}"]`,
          ) ?? null;
        await until("the search finds the DOI", () => doiInsert() !== null);
        await input.click(doiInsert()!);
        await until(
          "the field at the cursor and the editor focused",
          () =>
            editor.state.doc.toString().endsWith("{{ zt.DOI }}") &&
            editor.hasFocus,
        );
        // The reader types on, beside the docked panel.
        await contents.insertText(" ");
        const inserted = {
          docked: dock() !== null,
          typed: editor.state.doc.toString().endsWith("{{ zt.DOI }} "),
        };
        // Its edge widens it from the keyboard: two steps of 16 px.
        const edge = Array.from(
          el.querySelectorAll<HTMLElement>("[role=separator]"),
        ).find((handle) => handle.getAttribute("aria-label") === resize)!;
        edge.focus();
        for (let step = 0; step < 2; step++)
          edge.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
          );
        await until(
          "the wider docked panel",
          () => edge.getAttribute("aria-valuenow") === "352",
        );
        const width = dock()!.offsetWidth;
        // The action hides the docked panel and keeps its pin.
        await input.click(action);
        await until("the hidden panel", () => dock() === null);
        const hidden = {
          expanded: action.getAttribute("aria-expanded"),
          popover: page.fieldsPopover(view) !== null,
          saved: view.getState().panels,
        };
        await input.click(action);
        await until(
          "the panel shown again with focus in its search",
          () => dock() !== null && el.doc.activeElement === search(dock()),
        );
        return JSON.stringify({
          pinned,
          inserted,
          width,
          hidden,
          shown: action.getAttribute("aria-expanded"),
          state: JSON.stringify(view.getState()),
        });
      },
      {
        path,
        label: run.m.workbench_view_fields(),
        insert: run.m.workbench_fields_put_in_note(),
        resize: run.m.workbench_fields_resize(),
      },
    );
    const result = JSON.parse(walk) as {
      width: number;
      state: string;
    } & Record<string, unknown>;
    expect(result).toMatchObject({
      pinned: {
        offered: run.m.workbench_fields_pin(),
        label: run.m.workbench_fields_unpin(),
        state: "pinned",
        expanded: "true",
        leading: true,
        narrower: true,
        inert: false,
      },
      inserted: { docked: true, typed: true },
      width: 352,
      hidden: {
        expanded: "false",
        popover: false,
        saved: { fields: { pinned: true, hidden: true, width: 352 } },
      },
      shown: "true",
    });
    const { strip } = result.pinned as {
      strip: { above: number; below: number } | null;
    };
    expect(strip?.above).toBeGreaterThan(0);
    expect(strip?.above).toBe(strip?.below);

    // The saved state restores the docked panel at its width in a new leaf.
    await openLeaf(result.state);
    const restored = await obRunUntil(
      run.vaultId,
      ({ page }, { path, resize }) => {
        const view = page.workbench({ path });
        const dock = page.fieldsDock(view);
        const edge = Array.from(
          view?.contentEl.querySelectorAll<HTMLElement>("[role=separator]") ??
            [],
        ).find((handle) => handle.getAttribute("aria-label") === resize);
        if (!view || !dock || !edge) return null;
        return JSON.stringify({
          width: dock.offsetWidth,
          now: edge.getAttribute("aria-valuenow"),
          saved: view.getState().panels,
        });
      },
      { path, resize: run.m.workbench_fields_resize() },
      {
        what: "the docked Fields Panel restored with its width",
        ready: (value) => value !== null,
      },
    );
    expect(JSON.parse(restored!)).toMatchObject({
      width: 352,
      now: "352",
      saved: { fields: { pinned: true, hidden: false, width: 352 } },
    });
  });

  // #1967 in the docked panel (#1966). No Scope of the panel's holds its keys
  // there, and none is needed: a reader's hotkey on Mod+Enter, live in the
  // editor, does not run while focus is in the panel's search.
  it("shows a field's details beside the docked Fields Panel with the focus in them, inserts with Mod+Enter and stays docked, and stops Escape after the search", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) =>
          app.workspace.detachLeavesOfType("zotlit-template-workbench"),
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, key }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
        type Sized = { setDimension(share: number): void };
        for (const child of (
          app.workspace.rootSplit as unknown as { children: unknown[] }
        ).children)
          (child as Sized).setDimension(child === leaf ? 90 : 10);
      },
      { path, key: targetItem.key },
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path });
        return (
          view !== undefined &&
          view.contentEl.clientWidth >= 1000 &&
          view.contentEl.querySelector(".cm-content") !== null
        );
      },
      { path },
      { what: "a wide leaf with its editor" },
    );

    const walk = await obRun(
      run.vaultId,
      async ({ app, page }, { path, label }) => {
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
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        const dock = () => page.fieldsDock(view);
        const search = () =>
          dock()?.querySelector<HTMLInputElement>('input[type="search"]') ??
          null;
        const details = () =>
          el.doc.querySelector<HTMLElement>("[data-part=details]");
        const row = (key: string) =>
          [
            ...(dock()?.querySelectorAll<HTMLElement>(
              "[data-workbench-field]",
            ) ?? []),
          ]
            .find((item) => item.dataset.workbenchField === key)
            ?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
        // The reader pins the panel from the Fields popover.
        await input.click(content);
        editor.dispatch({ selection: { anchor: editor.state.doc.length } });
        await input.click(action);
        await until("the Fields popover", () => page.fieldsPopover(view));
        await input.click(
          page
            .fieldsPopover(view)!
            .querySelector<HTMLElement>('[data-part="pin"]')!,
        );
        await until(
          "the docked panel with focus in its search",
          () => dock() !== null && el.doc.activeElement === search(),
        );
        // A reader's own hotkey on Mod+Enter, live outside the panel: in the
        // editor it toggles the left sidebar.
        const hotkeys = (
          app as unknown as {
            hotkeyManager: {
              getHotkeys(id: string): unknown;
              setHotkeys(id: string, keys: unknown): void;
              removeHotkeys(id: string): void;
            };
          }
        ).hotkeyManager;
        const command = "app:toggle-left-sidebar";
        const saved = hotkeys.getHotkeys(command);
        hotkeys.setHotkeys(command, [{ modifiers: ["Mod"], key: "Enter" }]);
        const mod = process.platform === "darwin" ? "meta" : "control";
        const sidebar = () => app.workspace.leftSplit.collapsed;
        await input.click(content);
        await until("the editor focused", () => editor.hasFocus);
        const editorBefore = sidebar();
        await input.key("Return", [mod]);
        await new Promise((resolve) => el.win.setTimeout(resolve, 300));
        const liveInEditor = sidebar() !== editorBefore;
        if (liveInEditor) app.commands.executeCommandById(command);
        await until("the sidebar as it was", () => sidebar() === editorBefore);
        editor.dispatch({ selection: { anchor: editor.state.doc.length } });
        await input.click(search()!);
        await until(
          "the search focused",
          () => el.doc.activeElement === search(),
        );
        // Enter on the row the arrows select shows its details, beside the
        // column on its trailing side, level with the row.
        await contents.insertText("doi");
        await until("the DOI", () => row("DOI") !== null);
        await input.key("Down");
        await input.key("Return");
        await until("the DOI's details", () => details() !== null);
        const box = details()!.getBoundingClientRect();
        const column = dock()!.getBoundingClientRect();
        const opened = {
          state: details()!.dataset.state,
          trailing: box.left >= column.right,
          level:
            Math.abs(box.top - row("DOI")!.getBoundingClientRect().top) <= 1,
          focus: details()!.contains(el.doc.activeElement)
            ? (el.doc.activeElement as HTMLElement).dataset.part
            : "elsewhere",
        };
        // Escape closes them and hands the focus back to the search; Enter
        // opens them again on the same row.
        await input.key("Escape");
        await until("the details closed", () => details() === null);
        const back = {
          focusInSearch: el.doc.activeElement === search(),
          selected: el.doc.querySelector<HTMLElement>(
            "[role=treeitem][aria-selected=true]",
          )?.dataset.workbenchField,
        };
        await input.key("Return");
        await until("the DOI's details again", () => details() !== null);
        // Mod+Enter in the details inserts the selected field, the panel
        // stays docked, and the reader's hotkey does not run.
        const panelBefore = sidebar();
        await input.key("Return", [mod]);
        await new Promise((resolve) => el.win.setTimeout(resolve, 400));
        const inserted = {
          field: editor.state.doc.toString().endsWith("{{ zt.DOI }}"),
          docked: dock() !== null,
          details: details(),
          hotkeyRan: sidebar() !== panelBefore,
        };
        if (inserted.hotkeyRan) app.commands.executeCommandById(command);
        if (saved) hotkeys.setHotkeys(command, saved);
        else hotkeys.removeHotkeys(command);
        // Escape: the details, then the search, then nothing more.
        search()!.focus();
        await until(
          "the search focused",
          () => el.doc.activeElement === search(),
        );
        search()!.select();
        await contents.insertText("ti");
        await until("the Title row", () => row("title") !== null);
        await input.click(row("title")!, { x: 40, y: 8 });
        await until("the Title's details", () => details() !== null);
        await input.key("Escape");
        await until("the details closed", () => details() === null);
        const first = { query: search()!.value, docked: dock() !== null };
        await input.key("Escape");
        await until("the search cleared", () => search()!.value === "");
        const second = dock() !== null;
        await input.key("Escape");
        await new Promise((resolve) => el.win.setTimeout(resolve, 200));
        const third = {
          docked: dock() !== null,
          focusInSearch: el.doc.activeElement === search(),
        };
        return JSON.stringify({
          opened,
          back,
          liveInEditor,
          inserted: {
            field: inserted.field,
            docked: inserted.docked,
            details: inserted.details === null,
            hotkeyRan: inserted.hotkeyRan,
          },
          escape: { first, second, third },
        });
      },
      { path, label: run.m.workbench_view_fields() },
    );
    expect(JSON.parse(walk)).toEqual({
      opened: {
        state: "popover",
        trailing: true,
        level: true,
        focus: "insert",
      },
      back: { focusInSearch: true, selected: "DOI" },
      liveInEditor: true,
      inserted: { field: true, docked: true, details: true, hotkeyRan: false },
      escape: {
        first: { query: "ti", docked: true },
        second: true,
        third: { docked: true, focusInSearch: true },
      },
    });
  });

  // #1962: with no place in the template to put a field, the Fields popover
  // says so in its keys hint, beside a disabled Insert and in a notice for
  // Mod+Enter; its search finds a field by the path the template writes.
  it("names the missing place before an insert, and finds a field by its template path", async () => {
    const path = `templates/${booksProfile.document}`;
    const documentPath = join(e2eVaultPath, path);
    const original = await readFile(documentPath, "utf-8");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        ({ app }) =>
          app.workspace.detachLeavesOfType("zotlit-template-workbench"),
        undefined,
      );
      await writeFile(documentPath, original);
    });
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, key }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
      },
      { path, key: targetItem.key },
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) =>
        page.workbench({ path })?.contentEl.querySelector(".cm-content") !=
        null,
      { path },
      { what: "the workbench with its editor" },
    );

    const walk = await obRun(
      run.vaultId,
      async ({ page }, { path, label, choose }) => {
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
        const content = el.querySelector<CodeMirrorElement>(".cm-content")!;
        const editor = content.cmTile!.root.view;
        const source = editor.state.doc.toString();
        const popover = () => page.fieldsPopover(view);
        const search = () =>
          popover()?.querySelector<HTMLInputElement>('input[type="search"]') ??
          null;
        const details = () =>
          el.doc.querySelector<HTMLElement>("[data-part=details]");
        const keys = () =>
          [
            ...(popover()?.querySelectorAll<HTMLElement>(
              "[data-workbench-field]",
            ) ?? []),
          ]
            .filter((item) => item.checkVisibility())
            .map((item) => item.dataset.workbenchField);
        const notices = () =>
          [...el.doc.querySelectorAll(".notice")].map(
            (notice) => notice.textContent,
          );
        // The reader opens the popover before placing the cursor anywhere.
        await input.click(
          view.containerEl.querySelector<HTMLElement>(
            `.view-action[aria-label="${label}"]`,
          )!,
        );
        await until("the Fields popover", () => search() !== null);
        const hint =
          popover()!.querySelector("[data-part=keys-hint]")?.textContent ?? "";
        await input.click(
          popover()!.querySelector<HTMLElement>(
            '[data-workbench-field="title"] > [data-part=row]',
          )!,
          { x: 40, y: 8 },
        );
        await until("the details", () => details() !== null);
        const insert =
          details()!.querySelector<HTMLButtonElement>("[data-part=insert]")!;
        const reasonId = insert.getAttribute("aria-describedby");
        const reason = {
          disabled: insert.disabled,
          text: reasonId
            ? el.doc.getElementById(reasonId)?.textContent
            : undefined,
        };
        await input.key("Escape");
        await until("the details closed", () => details() === null);
        await input.key("Down");
        await input.key("Return", [
          process.platform === "darwin" ? "meta" : "control",
        ]);
        const notice = await until(
          "the notice that names the place",
          () => notices().includes(choose) && choose,
        );
        // The search takes the path the template writes.
        const found: Record<string, unknown> = {};
        for (const query of ["zt.title", "authors.family"]) {
          search()!.select();
          await contents.insertText(query);
          await until(`the rows for ${query}`, () =>
            keys().length > 0 && search()!.value === query ? true : undefined,
          );
          found[query] = keys();
        }
        return JSON.stringify({
          hintNamesPlace: hint.includes(choose),
          reason,
          notice,
          unchanged: editor.state.doc.toString() === source,
          found,
        });
      },
      {
        path,
        label: run.m.workbench_view_fields(),
        choose: run.m.workbench_fields_choose_place(),
      },
    );
    expect(JSON.parse(walk)).toEqual({
      hintNamesPlace: true,
      reason: { disabled: true, text: run.m.workbench_fields_choose_place() },
      notice: run.m.workbench_fields_choose_place(),
      unchanged: true,
      found: {
        "zt.title": ["title"],
        "authors.family": ["authors", "authors[].family"],
      },
    });
  });

  // #1962: a collapse or an expand keeps the section header the reader
  // pressed where it stood in the list. A stuck header stays in view as its
  // section closes, and an expand never scrolls to a selection it shows
  // again.
  it("keeps a pressed section header in place in the Fields popover as its section collapses and expands", async () => {
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
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app }, { path, key }) => {
        app.workspace.detachLeavesOfType("zotlit-template-workbench");
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
        await leaf.setViewState({
          type: "zotlit-template-workbench",
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
      },
      { path, key: targetItem.key },
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) =>
        page.workbench({ path })?.contentEl.querySelector(".cm-content") !=
        null,
      { path },
      { what: "the workbench with its editor" },
    );

    const walk = await obRun(
      run.vaultId,
      async ({ page }, { path, label }) => {
        const { until, trusted } = page;
        const view = page.workbench({ path })!;
        const el = view.contentEl;
        const input = trusted(el.win);
        const popover = () => page.fieldsPopover(view);
        const action = view.containerEl.querySelector<HTMLElement>(
          `.view-action[aria-label="${label}"]`,
        )!;
        if (!popover()) await input.click(action);
        await until("the popover", () => popover() !== null);
        const list = () =>
          popover()!.querySelector<HTMLElement>(
            "[data-part=explorer] > [data-part=body]",
          )!;
        const section = (id: string) =>
          list().querySelector<HTMLElement>(
            `[data-workbench-section="${id}"]`,
          )!;
        const header = (id: string) =>
          section(id).querySelector<HTMLElement>(
            ":scope > [data-part=section-heading] > button",
          )!;
        const expanded = (id: string) =>
          header(id).getAttribute("aria-expanded") === "true";
        const at = (id: string) =>
          Math.round(
            header(id).getBoundingClientRect().top -
              list().getBoundingClientRect().top,
          );
        const settle = () =>
          new Promise((resolve) => el.win.setTimeout(resolve, 300));
        await until("the sections", () =>
          list()?.querySelector("[data-workbench-section=reference]")
            ? true
            : undefined,
        );
        // Every section open, as a reader who has opened them all.
        for (const id of ["common", "reference", "identifiers"]) {
          if (!expanded(id)) header(id).click();
          await until(`${id} open`, () => (expanded(id) ? true : undefined));
        }
        /** Presses the header of `id` and says how far it moved. */
        const toggle = async (id: string) => {
          const before = at(id);
          const was = expanded(id);
          await input.click(header(id), { x: 40, y: 10 });
          await until(`${id} toggled`, () =>
            expanded(id) !== was ? true : undefined,
          );
          await settle();
          return { moved: at(id) - before, expanded: expanded(id) };
        };

        // Common fields scrolled until its header sticks to the top.
        list().scrollTop = 0;
        list().scrollTop = at("common") + 120;
        await settle();
        const stuck = at("common");
        const collapseStuck = await toggle("common");
        // A header the collapse moved out of view takes no second press.
        const expandAgain =
          at("common") >= 0 ? await toggle("common") : "out of view";

        // The last Reference row selected, then hidden by a collapse. With
        // Common fields open above, that row stands below the list's end once
        // Reference opens again.
        if (!expanded("common")) header("common").click();
        await until("Common fields open", () =>
          expanded("common") ? true : undefined,
        );
        // The section draws its rows again as it opens, so each read finds
        // the row anew.
        const lastRow = () =>
          [
            ...section("reference").querySelectorAll<HTMLElement>(
              ":scope > [role=tree] > [data-workbench-field] > [data-part=row]",
            ),
          ].at(-1)!;
        const last = lastRow();
        last.scrollIntoView({ block: "center" });
        await settle();
        await input.click(last, { x: 20, y: 8 });
        await until("the row selected", () =>
          last.parentElement!.getAttribute("aria-selected") === "true"
            ? true
            : undefined,
        );
        await input.key("Escape");
        await settle();
        header("reference").click();
        await until("Reference collapsed", () =>
          expanded("reference") ? undefined : true,
        );
        list().scrollTop = 0;
        await settle();
        const expandHidden = await toggle("reference");
        const expandHiddenAfter = {
          ...expandHidden,
          top: list().scrollTop,
          selectedBelow:
            lastRow().getBoundingClientRect().bottom >
            list().getBoundingClientRect().bottom,
        };

        // At the end of the list, the section whose header is stuck at the
        // top collapses with its header in place, though the list then
        // needs room past its end. Scrolling back up gives that room back.
        const ids = [
          ...list().querySelectorAll<HTMLElement>("[data-workbench-section]"),
        ].map((element) => element.dataset.workbenchSection!);
        const toEnd = async () => {
          list().scrollTop = list().scrollHeight;
          await settle();
        };
        /** The space under the last section with the list at its end. */
        const endSpace = () =>
          Math.round(
            list().getBoundingClientRect().bottom -
              section(ids.at(-1)!).getBoundingClientRect().bottom,
          );
        await toEnd();
        const spaceBefore = endSpace();
        const atTop = ids.find((id) => {
          const box = section(id).getBoundingClientRect();
          const top = list().getBoundingClientRect().top;
          return box.top <= top && box.bottom > top + 60;
        })!;
        const collapseAtEnd = await toggle(atTop);
        await toggle(atTop);
        list().scrollTop = 0;
        await settle();
        await toEnd();
        return JSON.stringify({
          stuck,
          collapseStuck,
          expandAgain,
          expandHidden: expandHiddenAfter,
          collapseAtEnd,
          roomGivenBack: endSpace() === spaceBefore,
        });
      },
      { path, label: run.m.workbench_view_fields() },
    );
    expect(JSON.parse(walk)).toEqual({
      stuck: 0,
      collapseStuck: { moved: 0, expanded: false },
      expandAgain: { moved: 0, expanded: true },
      expandHidden: { moved: 0, expanded: true, top: 0, selectedBelow: true },
      collapseAtEnd: { moved: 0, expanded: false },
      roomGivenBack: true,
    });
  });

  // #1962: a workbench in the right-hand leaf of a split keeps a field's
  // details inside its own leaf, from the Fields popover and from the
  // docked Fields Panel, so they never cover the note beside it.
  it("keeps a field's details inside a workbench leaf on the right of a split, popover and docked", async () => {
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
          state: { file: path, itemIndexedKey: key },
          active: true,
        });
        // A leaf before it, so the workbench is the right-hand leaf.
        const before = app.workspace.createLeafBySplit(leaf, "vertical", true);
        await before.setViewState({ type: "empty" });
        type Sized = { setDimension(share: number): void };
        const total = (
          app.workspace.rootSplit as unknown as { containerEl: HTMLElement }
        ).containerEl.clientWidth;
        const share = (615 / total) * 100;
        for (const child of (
          app.workspace.rootSplit as unknown as { children: unknown[] }
        ).children)
          (child as Sized).setDimension(
            child === leaf || child === leaf.parent ? share : 100 - share,
          );
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path, key: targetItem.key },
    );
    await obRunUntil(
      run.vaultId,
      ({ page }, { path }) => {
        const view = page.workbench({ path });
        return (
          view !== undefined &&
          view.contentEl.clientWidth >= 600 &&
          view.contentEl.clientWidth <= 640 &&
          view.contentEl.querySelector(".cm-content") !== null
        );
      },
      { path },
      { what: "a workbench leaf of about 615 pixels on the right" },
    );

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
        const details = () =>
          el.doc.querySelector<HTMLElement>("[data-part=details]");
        const inside = (surface: () => HTMLElement | null) => async () => {
          await input.click(
            surface()!.querySelector<HTMLElement>(
              '[data-workbench-field="title"] > [data-part=row]',
            )!,
            { x: 40, y: 8 },
          );
          await until("the details", () => details() !== null);
          const box = details()!.getBoundingClientRect();
          const leaf = el.getBoundingClientRect();
          return {
            state: details()!.dataset.state,
            inside:
              box.left >= leaf.left - 0.5 && box.right <= leaf.right + 0.5,
          };
        };
        await input.click(
          view.containerEl.querySelector<HTMLElement>(
            `.view-action[aria-label="${label}"]`,
          )!,
        );
        await until("the Fields popover", () => page.fieldsPopover(view));
        const popover = await inside(() => page.fieldsPopover(view))();
        await input.key("Escape");
        await until("the details closed", () => details() === null);
        await input.click(
          page
            .fieldsPopover(view)!
            .querySelector<HTMLElement>('[data-part="pin"]')!,
        );
        await until("the docked panel", () => page.fieldsDock(view));
        const docked = await inside(() => page.fieldsDock(view))();
        return JSON.stringify({ popover, docked });
      },
      { path, label: run.m.workbench_view_fields() },
    );
    expect(JSON.parse(walk)).toEqual({
      popover: { state: "popover", inside: true },
      docked: { state: "popover", inside: true },
    });
  });

  // #1957: the Preview's Show problem is the shared repair command, so the
  // problem round trip is the same in a narrow and a wide leaf.
  it("reveals the call from the Preview's Show problem in a narrow and a wide leaf, keeping the Preview in place", async () => {
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
      // The Fields Panel was never pinned.
      fields: { pinned: false, hidden: false, width: 320 },
      preview: { shown: true, width: 400, height: 40 },
    };
    /**
     * Opens the editor with the Preview in `share` percent of the window, or
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
    /** Presses Show problem in the Preview. */
    const showProblem = async () =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ page }, { path, call }) => {
            const { until } = page;
            const view = page.workbench({ path })!;
            const el = view.contentEl;
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
            // The reveal scrolls the call into the edit region's view, at the
            // editor's height floor too (#1952).
            const region = el.querySelector<HTMLElement>(
              '[data-workbench-scroll="editor"]',
            )!;
            const inView = await until("the call in view", () => {
              const at = editor.coordsAtPos(editor.state.selection.main.from);
              const box = region.getBoundingClientRect();
              return (
                at !== null && at.top >= box.top && at.bottom <= box.bottom
              );
            });
            // Focus is on the call, so the area's status says why it fails.
            const announced =
              el.querySelector('[data-part="problems-announcement"]')
                ?.textContent ?? "";
            return JSON.stringify({
              inView,
              announced: announced.includes("missing-partial"),
              problems:
                el.querySelector('[data-part="problems-open"]') !== null,
              samePreview:
                panel.isConnected &&
                JSON.stringify(box()) === JSON.stringify(before),
              saved: view.getState().panels,
            });
          },
          { path, call },
        ),
      ) as Record<string, unknown>;

    // A narrow leaf: the Preview under the editor.
    await open(30);
    expect(await showProblem()).toEqual({
      inView: true,
      announced: true,
      problems: true,
      samePreview: true,
      saved: panels,
    });
    // A wide leaf: the Preview beside the editor, the same round trip.
    await open(null);
    expect(await showProblem()).toEqual({
      inView: true,
      announced: true,
      problems: true,
      samePreview: true,
      saved: panels,
    });
  });

  // #1965: the Preview's header row stays at the top of the panel while the
  // preview scrolls, beside the editor and under it, and the editor's tabs
  // stand above the template source only.
  it("keeps the Preview's header row in view while the preview scrolls, beside and under the editor", async () => {
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
    /**
     * Opens the editor with the Preview shown in `share` percent of the
     * window, or the whole window when `share` is null, scrolls the preview
     * to its end, and reads where its header row and the editor's tabs stand.
     */
    const scrolled = async (share: number | null) => {
      await obRun(
        run.vaultId,
        async ({ app }, { path, key, share }) => {
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
              panels: {
                preview: { shown: true, width: 400, height: 30 },
              },
            },
            active: true,
          });
          if (share === null) return;
          const other = app.workspace.createLeafBySplit(leaf, "vertical");
          await other.setViewState({ type: "empty" });
          type Sized = { setDimension(share: number): void };
          for (const child of (
            app.workspace.rootSplit as unknown as { children: unknown[] }
          ).children)
            (child as Sized).setDimension(
              child === leaf || child === leaf.parent ? share : 100 - share,
            );
        },
        { path, key: targetItem.key, share },
      );
      return await obRunUntil(
        run.vaultId,
        ({ page }, { path, filename }) => {
          const view = page.workbench({ path });
          const panel = page.previewPanel(view);
          const scroller = panel?.querySelector<HTMLElement>(
            '[data-workbench-scroll="preview"]',
          );
          const header = scroller?.querySelector<HTMLElement>(
            "[data-workbench-preview-header]",
          );
          const tabs =
            view?.contentEl.querySelector<HTMLElement>('[role="tablist"]');
          const editor = view?.contentEl.querySelector<HTMLElement>(
            '[data-part="editor"]',
          );
          const shared = view?.contentEl.querySelector<HTMLElement>(
            "[data-workbench-panels]",
          );
          if (!panel || !scroller || !header || !tabs || !editor || !shared)
            return null;
          if (!header.textContent.includes(`${filename}:`)) return null;
          scroller.scrollTop = scroller.scrollHeight;
          const box = panel.getBoundingClientRect();
          const source = editor.getBoundingClientRect();
          const row = header.getBoundingClientRect();
          const tabRow = tabs.getBoundingClientRect();
          const top = scroller.getBoundingClientRect().top;
          return {
            below: box.top >= source.bottom - 1,
            scrolled: scroller.scrollTop > 0,
            // The header row sits at the top of the scroll area, painted over
            // the note that scrolled under it.
            pinned:
              Math.abs(row.top - top) <= 1 &&
              header.contains(
                header.ownerDocument.elementFromPoint(
                  row.left + row.width / 2,
                  row.top + row.height / 2,
                ),
              ),
            // The tabs stand inside the editor's column, so the Preview
            // beside it starts at the top of the panels' box.
            tabsInEditor:
              tabRow.left >= source.left - 1 &&
              tabRow.right <= source.right + 1 &&
              tabRow.top >= source.top - 1,
            fullHeight:
              box.top >= source.bottom - 1 ||
              Math.abs(box.top - shared.getBoundingClientRect().top) <= 1,
          };
        },
        { path, filename: run.m.workbench_result_filename() },
        {
          what: "the Preview scrolled to its end under its header row",
          ready: (read) => read !== null && read.scrolled,
        },
      );
    };
    // A wide leaf: the Preview beside the editor, the full panels' height.
    expect(await scrolled(null)).toEqual({
      below: false,
      scrolled: true,
      pinned: true,
      tabsInEditor: true,
      fullHeight: true,
    });
    // A narrow leaf: the Preview under the editor and its tabs.
    expect(await scrolled(30)).toEqual({
      below: true,
      scrolled: true,
      pinned: true,
      tabsInEditor: true,
      fullHeight: true,
    });
  });
});
