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
import { obRun, obRunUntil } from "./obsidian-cli.ts";
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
    await obRun(
      run.vaultId,
      async ({ app }, { path, showPreview, showFields }) => {
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
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
    await obRun(
      run.vaultId,
      async ({ app }, { path, item }) => {
        const leaf = app.workspace.createLeafInParent(
          app.workspace.rootSplit,
          0,
        );
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
        page.workbench({ path })!.pickItem({ id: item, title });
      },
      { path, item: createTargetItem.key, title: createTargetItem.title },
    );
    await fieldsName(createTargetItem.title);
    expect(JSON.parse((await explorer())!)).toEqual(opened);
  });

  // #1945: the panels are part of the view's saved state.
  it("restores the Preview panel and its width with the workspace", async () => {
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
        },
        { path, state },
      );
      return obRunUntil(
        run.vaultId,
        ({ page }, { path, resize }) => {
          const view = page.workbench({ path });
          const handle = Array.from(
            view?.contentEl.querySelectorAll<HTMLElement>("[role=separator]") ??
              [],
          ).find((element) => element.getAttribute("aria-label") === resize);
          if (!view || !handle || !page.previewPanel(view)) return null;
          return JSON.stringify({
            width: handle.getAttribute("aria-valuenow"),
            saved: view.getState().panels,
          });
        },
        { path, resize: run.m.workbench_preview_resize() },
        {
          what: "the Preview panel restored with its width",
          ready: (value) => value !== null,
        },
      );
    };
    const first = JSON.parse(
      (await read(
        JSON.stringify({ panels: { preview: { shown: true, width: 260 } } }),
      ))!,
    ) as { width: string; saved: unknown };
    expect(first.width).toBe("260");
    // The saved state of that leaf restores the panel in a new leaf.
    const saved = await obRun(
      run.vaultId,
      ({ page }, { path }) =>
        JSON.stringify(page.workbench({ path })!.getState()),
      { path },
    );
    const second = JSON.parse((await read(saved))!) as {
      width: string;
      saved: unknown;
    };
    expect(second.width).toBe("260");
    expect(second.saved).toEqual({
      fields: { shown: false, width: 400 },
      preview: { shown: true, width: 260 },
    });
  });
});
