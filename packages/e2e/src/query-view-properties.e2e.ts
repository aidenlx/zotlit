import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import {
  BYTE_ORDER_MARK,
  annotationItem,
  positionDocumentItem,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { readQueryViewUntil, revealQueryView } from "./note-query-view.ts";
import { obRun } from "./obsidian-cli.ts";
import { obRunUntil } from "./obsidian-cli.ts";
import { cliCommand, waitFor } from "./obsidian-cli.ts";
import type { CodeMirrorContent } from "./page-query-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("chooses two properties in a Query File view, limits it, and exports those columns as CSV", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const path = "query-files/Shared figures.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    const filter = 'tags.contains("figure")';
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      {
        __typedArg0: path,
        __typedArg1: `views:\n  - type: annotations\n    name: Shared figures\n    from: annotations\n    filters: ${filter}\n    limit: 100\n`,
      },
    );
    /** What the tab shows once its query settled, and the file's saved text. */

    interface Tab {
      count: string | null;
      matched: string | null;
      countText: string | null;
      cards: number;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).save();
              const el = (view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify({
                  count:
                    el
                      .querySelector<HTMLElement>("[data-query-count]")
                      ?.getAttribute("data-query-count") ?? null,
                  matched:
                    el
                      .querySelector<HTMLElement>("[data-query-count]")
                      ?.getAttribute("data-query-matched") ?? null,
                  countText:
                    el.querySelector<HTMLElement>("[data-query-count]")
                      ?.textContent ?? null,
                  cards:
                    el.querySelectorAll<HTMLElement>(".zt-annot-card").length,
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    const queryRows = async (fields: string, limit: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { from: "annotations", filter, fields, limit },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };
    const figures = await queryRows("pageLabel", "100");
    expect(figures.length).toBeGreaterThan(2);
    await tabWhen((tab) => tab.count === String(figures.length));

    // The view has no order: the Properties popover ticks the default
    // properties the cards show, at the top of the list. "Hide all" clears
    // them; tick "pageLabel", then "colorName": the order of the ticks is the
    // order of the columns, and it saves.
    /** The default fields of the annotations dataset that give one cell each. */
    const defaultProperties = [
      "type",
      "text",
      "comment",
      "color",
      "colorName",
      "pageLabel",
      "pageIndex",
      "tags",
      "dateAdded",
      "dateModified",
      "hasExcerptImage",
      "item.title",
      "item.citationKey",
    ];
    const ticked = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          press(
            el.querySelector<HTMLElement>("[data-query-properties]")!,
            "Properties",
          );
          const popup = () =>
            activeDocument.querySelector<HTMLElement>(
              "[data-query-properties-popup]",
            )!;
          const rows = () => [
            ...popup()!.querySelectorAll<HTMLElement>("[data-query-property]"),
          ];
          const selected = () =>
            rows()
              .filter((n) => n.getAttribute("aria-selected") === "true")
              .map((n) => n.dataset.queryProperty);
          await until(
            "Properties popover opens",
            () => popup()?.matches(":popover-open") && rows().length > 0,
          );
          const defaults = selected();
          const leading = rows()
            .slice(0, defaults.length)
            .map((n) => n.dataset.queryProperty);
          press(
            popup()!.querySelector<HTMLElement>(
              '[data-query-properties-action="hide-all"]',
            )!,
            "Hide all",
          );
          await until(
            "Hide all clears the ticks",
            () => selected().length === 0,
          );
          const paths = () => rows().map((n) => n.dataset.queryProperty);
          const untouched = paths();
          for (const name of ["pageLabel", "colorName"]) {
            press(
              popup()!.querySelector<HTMLElement>(
                `[data-query-property="${name}"]`,
              )!,
              `property ${name}`,
            );
            await until(`ticks ${name}`, () => selected().includes(name));
          }
          const kept = paths();
          popup()!.hidePopover();
          await until(
            "Properties popover closes",
            () => !popup()?.matches(":popover-open"),
          );
          press(
            el.querySelector<HTMLElement>("[data-query-properties]")!,
            "Properties",
          );
          await until(
            "Properties popover opens again",
            () => popup()?.matches(":popover-open") && rows().length > 0,
          );
          const shown = rows()
            .slice(0, 3)
            .map((n) => [
              n.dataset.queryProperty,
              n.getAttribute("aria-selected"),
            ]);
          popup()!.hidePopover();
          return String(
            JSON.stringify({ defaults, leading, untouched, kept, shown }),
          );
        },
        undefined,
      ),
    ) as {
      defaults: string[];
      leading: string[];
      untouched: string[];
      kept: string[];
      shown: [string, string][];
    };
    expect(ticked.defaults).toEqual(defaultProperties);
    expect(ticked.leading).toEqual(defaultProperties);
    // A tick leaves every row in place, as in Bases; the popover sorts the
    // visible properties first when it opens again.
    expect(ticked.kept).toEqual(ticked.untouched);
    expect(ticked.shown.slice(0, 2)).toEqual([
      ["pageLabel", "true"],
      ["colorName", "true"],
    ]);
    expect(ticked.shown[2]?.[1]).toBe("false");
    const ordered = await tabWhen((tab) =>
      tab.text.includes("order:\n      - pageLabel\n      - colorName\n"),
    );
    expect(ordered.count).toBe(String(figures.length));

    // A limit of 2 from the Results menu saves to the file; the count still
    // names every match.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press, until } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        press(
          el.querySelector<HTMLElement>("[data-query-results]")!,
          "Results",
        );
        const input = await until("limit field", () =>
          activeDocument.querySelector<HTMLInputElement>(
            "[data-query-results-popup]:popover-open [data-query-limit]",
          )!,
        );
        input.value = "2";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return String(true);
      },
      undefined,
    );
    const limited = await tabWhen(
      (tab) => tab.text.includes("limit: 2\n") && tab.cards === 2,
    );
    expect(limited).toMatchObject({
      count: "2",
      matched: String(figures.length),
      countText: `2 of ${figures.length} results`,
    });

    // "Export CSV…" writes the rows on screen with the two columns in the
    // order they were ticked.
    const exported = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          const { press } = pageHelpers;
          const create = URL.createObjectURL;
          const click = HTMLAnchorElement.prototype.click;
          let blob: Blob | null = null,
            name: string | null = null;
          URL.createObjectURL = (b) => {
            blob = b as Blob;
            return create.call(URL, b);
          };
          HTMLAnchorElement.prototype.click = new Proxy(click, {
            apply(_target, receiver: HTMLAnchorElement) {
              name = receiver.download;
            },
          });
          try {
            press(
              activeDocument.querySelector<HTMLElement>(
                "[data-query-results-popup] [data-query-export]",
              )!,
              "Export CSV",
            );
          } finally {
            URL.createObjectURL = create;
            HTMLAnchorElement.prototype.click = click;
          }
          return String(
            JSON.stringify({
              name,
              type: (blob as Blob | null)?.type ?? null,
              text: blob
                ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                    await (blob as Blob).arrayBuffer(),
                  )
                : null,
            }),
          );
        },
        undefined,
      ),
    ) as { name: string | null; type: string | null; text: string | null };
    const rows = await queryRows("pageLabel,colorName", "2");
    const cell = (value: unknown) => {
      const text =
        value === null || value === undefined
          ? ""
          : String(value as string | number | boolean);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    expect(exported).toEqual({
      name: "Shared figures.csv",
      type: "text/csv",
      // A byte order mark first, so a spreadsheet reads UTF-8; CRLF after each line.
      text:
        BYTE_ORDER_MARK +
        [
          // The header names a property by its label where it has one.
          `pageLabel,${run.m.query_view_property_color()}`,
          ...rows.map(
            (row) =>
              `${cell(row.values.pageLabel)},${cell(row.values.colorName)}`,
          ),
        ]
          .map((line) => `${line}\r\n`)
          .join(""),
    });
    expect(rows.every((row) => row.values.colorName)).toBe(true);
  }, 180000);

  /** The open popover of the Query View toolbar that `selector` names. */

  /**
   * Opens a toolbar popover of the view that `tab` names, and waits until it
   * shows the element that `ready` names.
   */
  async function openToolbarPopup({
    button,
    popup,
    ready,
  }: {
    button: string;
    popup: string;
    ready: string;
  }): Promise<void> {
    expect(
      await obRunUntil(
        run.vaultId,
        ({ app, page }, { button, popup: selector, ready }) => {
          const popup = activeDocument.querySelector<HTMLElement>(
            `${selector}:popover-open`,
          )!;
          if (popup?.querySelector<HTMLElement>(ready)!) return true;
          if (!popup)
            page.press(
              (
                app.workspace.getMostRecentLeaf()!
                  .view as import("obsidian").ItemView
              ).contentEl.querySelector<HTMLElement>(button)!,
              button,
            );
          return false;
        },
        { button, popup, ready },
        { what: "Query View toolbar popover" },
      ).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
  }
  /** The open Properties popover. */

  /** Opens the Properties popover and waits for its property rows. */
  const openProperties = () =>
    openToolbarPopup({
      button: "[data-query-properties]",
      popup: "[data-query-properties-popup]",
      ready: "[data-query-property]",
    });
  /** The page open in the Properties popover. */

  /**
   * Opens the page of a property's row in the open Properties popover: its
   * chevron opens it, as a reader presses it.
   */
  const openPropertyPage = (property: string) =>
    obRun(
      run.vaultId,
      async (
        { page: pageHelpers },
        { __typedArg0, __typedArg1, __typedArg2, __typedArg3, __typedArg4 },
      ) => {
        const { press, until } = pageHelpers;
        const popup = activeDocument.querySelector<HTMLElement>(__typedArg0)!;
        press(
          popup!.querySelector<HTMLElement>(
            `[data-query-property-more="${__typedArg1}"]`,
          )!,
          `page of property ${__typedArg2}`,
        );
        await until(`page of property ${__typedArg3}`, () =>
          popup!.querySelector<HTMLElement>(
            `[data-query-property-page="${__typedArg4}"]`,
          )!,
        );
        return String(true);
      },
      {
        __typedArg0: `${"[data-query-properties-popup]"}:popover-open`,
        __typedArg1: property,
        __typedArg2: property,
        __typedArg3: property,
        __typedArg4: property,
      },
    );
  /** Runs an item of the "…" menu of the open property page. */
  const runPageMenuItem = (hook: string) =>
    obRun(
      run.vaultId,
      async (
        { page: pageHelpers },
        { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
      ) => {
        const { press, until } = pageHelpers;
        const page = activeDocument
          .querySelector<HTMLElement>(__typedArg0)
          ?.querySelector<HTMLElement>("[data-chooser-page]")!;
        press(
          page!.querySelector<HTMLElement>("[data-chooser-page-menu]")!,
          "More options",
        );
        const item = await until(`menu item ${__typedArg1}`, () =>
          page!.querySelector<HTMLElement>(
            `[role="menu"]:popover-open [data-chooser-page-menu-item="${__typedArg2}"]`,
          )!,
        );
        press(item, `menu item ${__typedArg3}`);
        return String(true);
      },
      {
        __typedArg0: `${"[data-query-properties-popup]"}:popover-open`,
        __typedArg1: hook,
        __typedArg2: hook,
        __typedArg3: hook,
      },
    );
  /** Closes the open Properties popover from its page's close button. */
  const closePropertyPage = () =>
    obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        press(
          activeDocument
            .querySelector<HTMLElement>(__typedArg0)
            ?.querySelector<HTMLElement>("[data-chooser-page]")!
            .querySelector<HTMLElement>("[data-chooser-page-close]")!,
          "Close",
        );
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
  /** Opens the results popover and waits for its "Export CSV…" action. */
  const openResults = () =>
    openToolbarPopup({
      button: "[data-query-results]",
      popup: "[data-query-results-popup]",
      ready: "[data-query-export]",
    });

  it("adds a Formula Property from the Properties popover, edits it, marks a wrong one at its row, and removes it, and an embed and a Query Block show its column", async () => {
    const path = "query-files/Formula items.zotquery";
    const notePath = "query-files/Formula note.md";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          for (const path of __typedArg1) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: [path, notePath] },
      );
    });
    const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source },
    );

    /** What the tab shows once its query settled, and the file's saved text. */

    interface Tab {
      columns: (string | null)[];
      headerIssue: string | null;
      /** Each Item row: its key, then the text of each cell. */
      rows: string[][];
      list: [string, string][];
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).save();
              const el = (view as import("obsidian").ItemView).contentEl;
              const columns = [
                ...el.querySelectorAll<HTMLTableCellElement>(
                  "[data-query-table] thead th",
                ),
              ].map((n) => n.getAttribute("data-query-column"));
              return String(
                JSON.stringify({
                  columns,
                  headerIssue:
                    el
                      .querySelector<HTMLElement>(
                        "[data-query-table] thead [data-query-formula-issue]",
                      )
                      ?.getAttribute("data-query-formula-issue") ?? null,
                  rows: [
                    ...el.querySelectorAll<HTMLTableRowElement>(
                      '[data-query-table-row="item"]',
                    ),
                  ].map((tr) => [
                    tr.getAttribute("data-query-key"),
                    ...[...tr.children].map((td) => td.textContent),
                  ]),
                  list: [
                    ...el.querySelectorAll<HTMLElement>(
                      '[data-query-layout="list"] [data-query-row]',
                    ),
                  ].map((li) => [
                    li.getAttribute("data-query-row"),
                    li.textContent,
                  ]),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** The value of each row's Formula, as ZotLit Query gives it. */
    const formulaValues = async (expression: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            from: "items",
            formulas: JSON.stringify({ year: expression }),
            fields: "title,formula.year",
            limit: "5",
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => [
        row.indexedKey,
        row.values["formula.year"] === null
          ? ""
          : String(row.values["formula.year"] as string | number),
      ]);
    };
    /** The key and the cell of one column of each Table row. */
    const column = (shown: Tab, property: string) => {
      // The first cell is the expander.
      const at = shown.columns.indexOf(property);
      return shown.rows.map((row) => [row[0], row[at + 1]]);
    };
    const shown = await tabWhen((tab) => tab.rows.length > 0);
    expect(shown.columns).toEqual([null, "title"]);

    // "Add formula" in the Properties popover opens its page.
    await openProperties();
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press } = pageHelpers;
        press(
          [
            ...activeDocument
              .querySelector<HTMLElement>(__typedArg0)!
              .querySelectorAll<HTMLElement>('[role="option"]'),
          ].find((n) => n.textContent === __typedArg1),
          "Add formula",
        );
        return String(true);
      },
      {
        __typedArg0: `${"[data-query-properties-popup]"}:popover-open`,
        __typedArg1: run.m.query_view_formula_add(),
      },
    );
    /**
     * Types into the formula's page, and reads what it says about the text.
     * The page draws the text in a microtask after the input event, so the
     * read in the next call sees it. A Formula's own page saves as it goes:
     * it has no Save button, and reads `save: null`.
     */
    const typeFormula = async (fields: {
      name?: string;
      expression: string;
    }) => {
      await obRun(
        run.vaultId,
        async (
          _context,
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          const page = activeDocument
            .querySelector<HTMLElement>(__typedArg0)
            ?.querySelector<HTMLElement>("[data-chooser-page]")!;
          const set = (el: HTMLInputElement, value: string) => {
            el.value = value;
            el.dispatchEvent(new InputEvent("input", { bubbles: true }));
          };
          if (__typedArg1) {
          } else {
            set(
              page!.querySelector<HTMLInputElement>(
                "[data-query-formula-name]",
              )!,
              __typedArg2!,
            );
          }
          const view = page!.querySelector<CodeMirrorContent>(
            "[data-query-formula-expression] .cm-content",
          )!.cmTile.root.view;
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: __typedArg3,
            },
            userEvent: "input.type",
          });
          return String(true);
        },
        {
          __typedArg0: `${"[data-query-properties-popup]"}:popover-open`,
          __typedArg1: fields.name === undefined,
          __typedArg2: fields.name,
          __typedArg3: fields.expression,
        },
      );
      return JSON.parse(
        await obRun(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const page = activeDocument
              .querySelector<HTMLElement>(__typedArg0)
              ?.querySelector<HTMLElement>("[data-chooser-page]")!;
            const save = page!.querySelector<HTMLButtonElement>(
              "[data-query-formula-save]",
            )!;
            return String(
              JSON.stringify({
                syntax:
                  page!
                    .querySelector<HTMLElement>("[data-query-formula-syntax]")
                    ?.getAttribute("data-query-formula-syntax") ?? null,
                save: save ? !save.disabled : null,
              }),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
        ),
      ) as { syntax: string; save: boolean | null };
    };
    /**
     * Saves the formula's page: "Add formula" by its Save button, which
     * turns the page into the Formula's own; then the close button, which
     * saves the text of a Formula's own page as the popover closes.
     */
    const saveFormula = () =>
      obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const popup = activeDocument.querySelector<HTMLElement>(__typedArg0)!;
          const save = popup!.querySelector<HTMLButtonElement>(
            "[data-chooser-page] [data-query-formula-save]",
          )!;
          if (save) {
            press(save, "Save");
            await until("page of the Formula", () =>
              popup!.querySelector<HTMLElement>("[data-query-property-page]")!,
            );
          }
          press(
            popup!.querySelector<HTMLElement>("[data-chooser-page-close]")!,
            "Close",
          );
          return String(true);
        },
        { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
      );
    /**
     * The text the Formula field underlines, once the field shows
     * `expected`, and how: the line style of each underline, and whether
     * the field draws a gutter. The editor sets its underlines a frame
     * after the page draws the text, and then, from the same draw, its
     * `aria-invalid`; so where `expected` is empty, the field that was
     * invalid is settled once `aria-invalid` reads false, and no underline
     * of the text can come after that.
     */
    const formulaUnderlines = async (expected: string[]) =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
            const { until } = pageHelpers;
            const field = activeDocument
              .querySelector<HTMLElement>(__typedArg0)
              ?.querySelector<HTMLElement>("[data-chooser-page]")
              ?.querySelector<HTMLElement>("[data-query-formula-expression]")!;
            const content =
              field?.querySelector<CodeMirrorContent>(".cm-content")!;
            if (!content) throw new Error("Missing: the Formula field");
            const marks = () => [
              ...field!.querySelectorAll<HTMLElement>(".cm-lintRange-error"),
            ];
            const texts = () =>
              JSON.stringify(marks().map((n) => n.textContent));
            const expected = __typedArg1;
            await until("underlines", () =>
              expected === "[]"
                ? content.getAttribute("aria-invalid") === "false"
                : texts() === expected,
            ).catch((error) => {
              throw new Error(
                `${error.message}: ${texts()}, aria-invalid ${content.getAttribute("aria-invalid")}`,
              );
            });
            return String(
              JSON.stringify({
                marks: marks().map((n) => n.textContent),
                styles: marks().map(
                  (n) => getComputedStyle(n).textDecorationStyle,
                ),
                gutter:
                  field!.querySelector<HTMLElement>(".cm-gutters")! != null,
              }),
            );
          },
          {
            __typedArg0: `${"[data-query-properties-popup]"}:popover-open`,
            __typedArg1: JSON.stringify(expected),
          },
        ),
      ) as { marks: string[]; styles: string[]; gutter: boolean };
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            return String(
              String(
                !!activeDocument
                  .querySelector<HTMLElement>(__typedArg0)
                  ?.querySelector<HTMLElement>("[data-chooser-page]")!,
              ),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-view-properties.e2e.ts:348",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
      }),
    ).toBe(true);
    // The Formula field looks and focuses as the text input above it: the
    // same border, radius, fill and focus ring, its text at the same inset,
    // and no focus outline of the editor's own.
    interface InputLook {
      border: string;
      radius: string;
      fill: string;
      ring: string;
    }
    const fieldLook = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { until } = pageHelpers;
          const page = activeDocument
            .querySelector<HTMLElement>(__typedArg0)
            ?.querySelector<HTMLElement>("[data-chooser-page]")!;
          const input = page!.querySelector<HTMLInputElement>(
            "[data-query-formula-name]",
          )!;
          const field = page!.querySelector<HTMLElement>(
            "[data-query-formula-expression]",
          )!;
          const editor = field!.querySelector<HTMLElement>(".cm-editor")!;
          const line = field!.querySelector<HTMLElement>(".cm-line")!;
          // The box and focus ring that show: the shadows that have a spread.
          const ringOf = (shadow: string) =>
            shadow
              .split(/,\s*(?![^(]*\))/)
              .filter((one: string) => !one.endsWith("0px 0px 0px 0px"))
              .join(", ");
          const look = (el: HTMLElement) => {
            const c = getComputedStyle(el);
            return {
              border: [
                c.borderTopWidth,
                c.borderTopStyle,
                c.borderTopColor,
              ].join(" "),
              radius: c.borderTopLeftRadius,
              fill: c.backgroundColor,
              ring: ringOf(c.boxShadow),
            };
          };
          const inputStyle = getComputedStyle(input!);
          const inset = {
            input:
              Number.parseFloat(inputStyle.borderLeftWidth) +
              Number.parseFloat(inputStyle.paddingLeft),
            field:
              line!.getBoundingClientRect().left +
              Number.parseFloat(getComputedStyle(line!).paddingLeft) -
              field!.getBoundingClientRect().left,
          };
          // The page focuses the Name input when it opens; rest is the look with no focus.
          (activeDocument.activeElement as HTMLElement | null)?.blur();
          await until(
            "no focus on the page",
            () =>
              !editor!.classList.contains("cm-focused") &&
              activeDocument.activeElement !== input,
          );
          const rest = { input: look(input), field: look(field) };
          input!.focus();
          await until(
            "focus on the Name input",
            () => activeDocument.activeElement === input,
          );
          const inputFocused = look(input);
          field!.querySelector<CodeMirrorContent>(".cm-content")!.focus();
          await until("focus in the Formula field", () =>
            editor!.classList.contains("cm-focused"),
          );
          return String(
            JSON.stringify({
              rest,
              focused: { input: inputFocused, field: look(field) },
              inset,
              editor: {
                focused: editor!.classList.contains("cm-focused"),
                outline: getComputedStyle(editor!).outlineStyle,
              },
            }),
          );
        },
        { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
      ),
    ) as {
      rest: { input: InputLook; field: InputLook };
      focused: { input: InputLook; field: InputLook };
      inset: { input: number; field: number };
      editor: { focused: boolean; outline: string };
    };
    expect(fieldLook.rest.field).toEqual(fieldLook.rest.input);
    expect(fieldLook.focused.field).toEqual(fieldLook.focused.input);
    expect(fieldLook.inset.field).toBeCloseTo(fieldLook.inset.input);
    expect(fieldLook.editor).toEqual({ focused: true, outline: "none" });
    // The parse-only check marks a text that does not parse, and keeps it
    // from being saved.
    expect(
      await typeFormula({ name: "year", expression: "date.year +" }),
    ).toEqual({
      syntax: "invalid",
      save: false,
    });
    // The Syntax Fault is underlined as it is typed, in a wavy line and with
    // no gutter beside the text.
    expect(await formulaUnderlines(["+"])).toEqual({
      marks: ["+"],
      styles: ["wavy"],
      gutter: false,
    });
    expect(await typeFormula({ expression: "date.year" })).toEqual({
      syntax: "valid",
      save: true,
    });
    expect((await formulaUnderlines([])).marks).toEqual([]);
    await saveFormula();

    // The Formula saves under formulas, shows after the view's properties,
    // and each row shows the value ZotLit Query gives.
    const years = await formulaValues("date.year");
    expect(years.some(([, year]) => year !== "")).toBe(true);
    const added = await tabWhen((tab) => tab.columns.includes("formula.year"));
    expect(added.text).toContain("formulas:\n  year: date.year\nviews:");
    expect(added.text).toContain(
      "    order:\n      - title\n      - formula.year\n",
    );
    expect(column(added, "formula.year")).toEqual(years);

    // An embed and a Query Block of the same text show the same column.
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        const file = await app.vault.create(
          __typedArg0,
          `${__typedArg1 + __typedArg2}\`\`\`\n`,
        );
        const leaf = app.workspace.getLeaf("split");
        await leaf.openFile(file, { state: { mode: "preview" } });
        return String(true);
      },
      {
        __typedArg0: notePath,
        __typedArg1: `![[Formula items.zotquery]]\n\n\`\`\`zotquery\n`,
        __typedArg2: added.text,
      },
    );
    const formulaEmbed = await revealQueryView(run.vaultId, notePath, {
      embed: "Formula items.zotquery",
    });
    const formulaBlock = await revealQueryView(run.vaultId, notePath, {
      block: 0,
    });

    await readQueryViewUntil(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const embed = await pageHelpers.revealQueryView(__typedArg0);
        const block = await pageHelpers.revealQueryView(__typedArg1);
        const read = (root: HTMLElement) => {
          const columns = [
            ...root.querySelectorAll<HTMLTableCellElement>(
              "[data-query-table] thead th",
            ),
          ].map((n) => n.getAttribute("data-query-column"));
          const at = columns.indexOf("formula.year");
          return [
            ...root.querySelectorAll<HTMLTableRowElement>(
              '[data-query-table-row="item"]',
            ),
          ].map((tr) => [
            tr.getAttribute("data-query-key"),
            tr.children[at]?.textContent ?? null,
          ]);
        };
        return { embed: read(embed), block: read(block) };
      },
      { __typedArg0: formulaEmbed, __typedArg1: formulaBlock },
      {
        ready: (columns) =>
          JSON.stringify(columns) ===
          JSON.stringify({ embed: years, block: years }),
        what: "formula.year in the embed and the Query Block",
        tries: 120,
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const leaf = app.workspace
          .getLeavesOfType("zotlit-query-file")
          .find(
            (l) =>
              (l.view as import("obsidian").FileView).file?.path ===
              __typedArg0,
          );
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        return String(true);
      },
      { __typedArg0: path },
    );

    // The List shows the same values.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getMostRecentLeaf()!
            .view as import("@/views/query-view/file-view").QueryFileView
        ).query.document.setViewLayout(0, "list");
        return String(true);
      },
      undefined,
    );
    const listed = await tabWhen((tab) => tab.list.length > 0);
    expect(listed.list.map(([key]) => key)).toEqual(years.map(([key]) => key));
    for (const [index, [, year]] of years.entries())
      expect(listed.list[index]![1].endsWith(year!)).toBe(true);
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getMostRecentLeaf()!
            .view as import("@/views/query-view/file-view").QueryFileView
        ).query.document.setViewLayout(0, "table");
        return String(true);
      },
      undefined,
    );
    await tabWhen((tab) => tab.columns.includes("formula.year"));

    // The Formula row's chevron opens its page for editing.
    const editFormula = async () => {
      await openProperties();
      await openPropertyPage("formula.year");
    };
    await editFormula();
    await typeFormula({ expression: "date.year + 1" });
    await saveFormula();
    const next = await formulaValues("date.year + 1");
    const edited = await tabWhen((tab) =>
      tab.text.includes("  year: date.year + 1\n"),
    );
    expect(column(await tabWhen(() => true), "formula.year")).toEqual(next);
    expect(edited.columns).toContain("title");

    // A Formula ZotLit Query names as wrong shows its message at its row and
    // its column; the other columns still show their values.
    await editFormula();
    expect(await typeFormula({ expression: "title.nope()" })).toEqual({
      syntax: "valid",
      save: null,
    });
    await saveFormula();
    const wrong = await tabWhen((tab) => tab.headerIssue !== null);
    expect(wrong.headerIssue).toContain("formula.year");
    expect(column(wrong, "formula.year").every(([, cell]) => cell === "")).toBe(
      true,
    );
    expect(column(wrong, "title")).toEqual(column(added, "title"));
    await openProperties();
    const rowIssue = await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        const popup = activeDocument.querySelector<HTMLElement>(__typedArg0)!;
        const issue =
          popup!
            .querySelector<HTMLElement>(
              '[data-query-property="formula.year"] [data-query-formula-issue]',
            )
            ?.getAttribute("data-query-formula-issue") ?? null;
        popup!.hidePopover();
        return String(String(issue));
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    expect(rowIssue).toBe(wrong.headerIssue);

    // The Formula's page underlines the name the run found wrong, and shows
    // no tooltip over it, not even an empty one, well past CodeMirror's
    // hover delay.
    await editFormula();
    expect((await formulaUnderlines(["nope"])).marks).toEqual(["nope"]);
    const hovered = JSON.parse(
      await obRun(
        run.vaultId,
        async (_context, { __typedArg0 }) => {
          const field = activeDocument
            .querySelector<HTMLElement>(__typedArg0)
            ?.querySelector<HTMLElement>("[data-chooser-page]")!
            .querySelector<HTMLElement>("[data-query-formula-expression]")!;
          const mark = field!.querySelector<HTMLElement>(
            ".cm-lintRange-error",
          )!;
          const r = mark!.getBoundingClientRect();
          mark!.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
            }),
          );
          await new Promise((r) => setTimeout(r, 800));
          return String(
            JSON.stringify(
              [
                ...mark!.ownerDocument.querySelectorAll<HTMLElement>(
                  ".cm-tooltip-hover, .cm-tooltip-lint",
                ),
              ].map((n) => n.className),
            ),
          );
        },
        { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
      ),
    ) as string[];
    expect(hovered).toEqual([]);
    // A text other than the saved one shows no underline of the run's Fault.
    await typeFormula({ expression: "title.nope( )" });
    expect((await formulaUnderlines([])).marks).toEqual([]);
    await saveFormula();
    await tabWhen((tab) => tab.text.includes("  year: title.nope( )\n"));

    // Remove, in the page's menu, leaves the file without the Formula and
    // its property, and steps back to the rows.
    await editFormula();
    await runPageMenuItem("remove-formula");
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popup =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            return String(
              String(
                !!popup &&
                  !popup.querySelector<HTMLElement>("[data-chooser-page]")! &&
                  !!popup.querySelector<HTMLElement>("[data-query-property]")!,
              ),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-view-properties.e2e.ts:535",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        activeDocument.querySelector<HTMLElement>(__typedArg0)!.hidePopover();
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    const removed = await tabWhen(
      (tab) =>
        !tab.text.includes("formula") && !tab.columns.includes("formula.year"),
    );
    expect(removed.text).toBe(source);
    expect(removed.headerIssue).toBeNull();
  }, 240000);

  it("filters a Query View by a Formula, shows a Formula that reads another, and marks a wrong Formula with the Formulas and the condition that read it in one run", async () => {
    const path = "query-files/Dependent formulas.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    const formulas = {
      year: "date.year",
      next: "formula.year + 1",
      recent: "date.year >= 2020",
    };
    // A Formula that only another view of the file reads.
    const shared = "title";
    const source = (
      edits: { year?: string; filter?: string } = {},
    ) => `formulas:
  year: ${edits.year ?? formulas.year}
  next: ${formulas.next}
  recent: ${formulas.recent}
  shared: ${shared}
views:
  - type: table
    name: Recent
    from: items
    order:
      - title
      - formula.year
      - formula.next
    filters: ${edits.filter ?? "formula.recent"}
    limit: 100
`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source() },
    );

    interface Tab {
      /** The Query View runs of ZotLit Query since the plugin loaded. */
      runs: number;
      warnings: string[];
      text: string;
      columns: (string | null)[];
      headerIssues: Record<string, string | null>;
      /** Each Item row: its key, then the text of each cell. */
      rows: string[][];
      diagnostic: string | null;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let shown: Tab | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, zotlit }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify({
                  runs: zotlit.services.query.viewRuns,
                  warnings: [
                    ...el.querySelectorAll<HTMLElement>("[data-query-warning]"),
                  ].map((n) => n.getAttribute("data-query-warning")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] thead th",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  headerIssues: Object.fromEntries(
                    [
                      ...el.querySelectorAll<HTMLTableCellElement>(
                        "[data-query-table] thead [data-query-column]",
                      ),
                    ].map((n) => [
                      n.getAttribute("data-query-column"),
                      n.getAttribute("data-query-formula-issue"),
                    ]),
                  ),
                  rows: [
                    ...el.querySelectorAll<HTMLTableRowElement>(
                      '[data-query-table-row="item"]',
                    ),
                  ].map((tr) => [
                    tr.getAttribute("data-query-key"),
                    ...[...tr.children].map((td) => td.textContent),
                  ]),
                  diagnostic:
                    el
                      .querySelector<HTMLElement>("[data-query-diagnostic]")
                      ?.getAttribute("data-query-diagnostic") ?? null,
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Tab | null;
        return shown !== null && ready(shown);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /** Edits the file as text in its tab. */
    const write = (text: string) =>
      obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          const view = app.workspace.getMostRecentLeaf()!.view;
          (
            view as import("@/views/query-view/file-view").QueryFileView
          ).setViewData(__typedArg0);
          await (
            view as import("@/views/query-view/file-view").QueryFileView
          ).save();
          return String(true);
        },
        { __typedArg0: text },
      );
    /** The Query View runs of ZotLit Query so far, as the dev build counts them. */
    const countRuns = async () =>
      Number(
        await obRun(
          run.vaultId,
          async ({ zotlit }) => {
            return String(String(zotlit.services.query.viewRuns));
          },
          undefined,
        ),
      );
    /** The key and the cell of one column of each Table row. */
    const column = (shown: Tab, property: string) => {
      // The first cell is the expander.
      const at = shown.columns.indexOf(property);
      return shown.rows.map((row) => [row[0], row[at + 1]]);
    };
    /** The issue at each Formula's row in the Properties popover. */
    const rowIssues = async () => {
      await openProperties();
      return JSON.parse(
        await obRun(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popup =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            const issues = Object.fromEntries(
              ["year", "next", "recent"].map((name) => [
                name,
                popup!
                  .querySelector<HTMLElement>(
                    `[data-query-property="formula.${name}"] [data-query-formula-issue]`,
                  )
                  ?.getAttribute("data-query-formula-issue") ?? null,
              ]),
            );
            popup!.hidePopover();
            return String(JSON.stringify(issues));
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
        ),
      ) as Record<string, string | null>;
    };
    /** The issue at each condition of the view's filters, in the Filter popover. */
    const conditionIssues = async () => {
      await openToolbarPopup({
        button: '[data-query-toolbar="filter"]',
        popup: '[data-query-popover="filter"]',
        ready: '[data-filter-section="view"] [data-condition-row]',
      });
      return JSON.parse(
        await obRun(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popover =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            const issues = [
              ...popover!.querySelectorAll<HTMLElement>(
                '[data-filter-section="view"] [data-condition-row]',
              ),
            ].map(
              (n) =>
                n.querySelector<HTMLElement>('[role="alert"]')?.textContent ??
                null,
            );
            popover!.hidePopover();
            return String(JSON.stringify(issues));
          },
          { __typedArg0: `${'[data-query-popover="filter"]'}:popover-open` },
        ),
      ) as (string | null)[];
    };

    // The view shows the rows ZotLit Query gives for the same filter, and a
    // Formula that reads another shows its value.
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          from: "items",
          formulas: JSON.stringify(formulas),
          filter: "formula.recent",
          fields: "title,formula.year,formula.next",
          limit: "100",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    expect(report.rows!.length).toBeGreaterThan(1);
    const expected = report.rows!.map((row) => [
      row.indexedKey,
      String(row.values["formula.next"]),
    ]);
    for (const row of report.rows!)
      expect(row.values["formula.next"]).toBe(
        Number(row.values["formula.year"]) + 1,
      );
    const shown = await tabWhen((t) => t.rows.length > 0);
    expect(shown.columns).toEqual([
      null,
      "title",
      "formula.year",
      "formula.next",
    ]);
    expect(column(shown, "formula.next")).toEqual(expected);
    expect(shown.warnings).toEqual([]);

    // A wrong Formula marks itself and the Formula that reads it, each with
    // its own reason, from one run; the view still shows its rows and its
    // other columns.
    const reads = "formula.next reads formula.year, which has a mistake.";
    let runs = await countRuns();
    await write(source({ year: "dat.year" }));
    const wrong = await tabWhen(
      (t) =>
        (t.headerIssues["formula.next"]?.startsWith(reads) ?? false) &&
        t.rows.length > 0,
    );
    expect(wrong.runs - runs).toBe(1);
    expect(wrong.headerIssues["formula.year"]).toContain("In formula.year");
    expect(wrong.diagnostic).toBeNull();
    expect(column(wrong, "title")).toEqual(column(shown, "title"));
    for (const property of ["formula.year", "formula.next"])
      expect(column(wrong, property).every(([, cell]) => cell === "")).toBe(
        true,
      );
    expect(await rowIssues()).toEqual({
      year: wrong.headerIssues["formula.year"],
      next: wrong.headerIssues["formula.next"],
      recent: null,
    });

    // A condition that reads the wrong Formula says so, and the view shows
    // no rows until the Formula is fixed.
    runs = await countRuns();
    await write(source({ year: "dat.year", filter: "formula.next > 2020" }));
    const filtered = await tabWhen(
      (t) => t.rows.length === 0 && t.diagnostic !== null,
    );
    expect(filtered.runs - runs).toBe(1);
    expect(await rowIssues()).toMatchObject({
      next: wrong.headerIssues["formula.next"],
    });
    expect(await conditionIssues()).toEqual([
      expect.stringContaining(
        "The filter reads formula.next, which has a mistake.",
      ),
    ]);
    await write(source({ filter: "formula.next > 2020" }));
    const fixed = await tabWhen((t) => t.rows.length > 0);
    expect(fixed.diagnostic).toBeNull();
    expect(fixed.headerIssues["formula.next"]).toBeNull();
    expect(
      column(fixed, "formula.next").every(([, cell]) => Number(cell) > 2020),
    ).toBe(true);
    expect(await conditionIssues()).toEqual([null]);

    // Removing a Formula that the filters still name leaves the condition,
    // and ZotLit Query's message shows at it.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getMostRecentLeaf()!
            .view as import("@/views/query-view/file-view").QueryFileView
        ).query.document.removeFormula("next");
        return String(true);
      },
      undefined,
    );
    const removed = await tabWhen((t) => !t.text.includes("formula.next\n"));
    expect(removed.text).toContain("filters: formula.next > 2020\n");
    let issues: (string | null)[] = [];
    expect(
      await waitFor(async () => {
        issues = await conditionIssues();
        return issues[0] !== null;
      }, 60),
    ).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("next");
  }, 240000);

  it("shows an Error Value of a Formula as a warning icon in the Table, the List and the Cards, and copies and exports it as its message", async () => {
    const path = "query-files/Formula errors.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    // The Formula cannot read the title of one Item as a number; the other
    // Item gives its year.
    const formula = `if(indexedKey == "${annotationItem.key}", number(title), date.year)`;
    const filter = `indexedKey == "${annotationItem.key}" || indexedKey == "${positionDocumentItem.key}"`;
    const view = (type: string, name: string) =>
      `  - type: ${type}\n    name: ${name}\n    from: items\n    filters: ${JSON.stringify(filter)}\n    order:\n      - title\n      - formula.n\n`;
    const source = `formulas:\n  n: ${JSON.stringify(formula)}\nviews:\n${view("table", "Table")}${view("list", "List")}${view("cards", "Cards")}`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source },
    );

    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          from: "items",
          filter,
          formulas: JSON.stringify({ n: formula }),
          fields: "title,formula.n",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const rows = report.rows!;
    const failed = rows.filter((row) => row.indexedKey === annotationItem.key);
    expect(failed.length).toBeGreaterThan(0);
    for (const row of failed)
      expect(row.values["formula.n"]).toEqual({
        kind: "error",
        code: "unparseable-text",
        message: `number() cannot read ${JSON.stringify(annotationItem.title)} as a number.`,
      });
    const computed = rows.filter(
      (row) => row.indexedKey === positionDocumentItem.key,
    );
    expect(computed.length).toBeGreaterThan(0);
    for (const row of computed)
      expect(row.values["formula.n"]).toBe(
        Number(positionDocumentItem.date.slice(0, 4)),
      );
    const message = (failed[0]!.values["formula.n"] as { message: string })
      .message;

    // Each row's key, the text of each cell, and the Error Value marks.

    interface Shown {
      key: string;
      text: string;
      errors: [string, string, boolean][];
    }
    const showView = async (name: string, selector: string) => {
      let shown: Shown[] | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async (
              { app },
              { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
            ) => {
              const leaf = app.workspace.getMostRecentLeaf()!;
              if (
                leaf!.view.getViewType() !== "zotlit-query-file" ||
                (leaf!.view as import("obsidian").FileView).file?.path !==
                  __typedArg0
              )
                return String("null");
              if (leaf!.getViewState().state!.view !== __typedArg1)
                await leaf!.setViewState({
                  ...leaf!.getViewState(),
                  state: { ...leaf!.getViewState().state, view: __typedArg2 },
                });
              await (
                leaf!
                  .view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (leaf!.view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify(
                  [...el.querySelectorAll<HTMLElement>(__typedArg3)].map(
                    (row) => ({
                      key:
                        row.getAttribute("data-query-key") ??
                        row.getAttribute("data-query-row"),
                      text: row.textContent,
                      errors: [
                        ...row.querySelectorAll<HTMLElement>(
                          "[data-query-error]",
                        ),
                      ].map((n) => [
                        n.getAttribute("data-query-error"),
                        n.getAttribute("aria-label"),
                        !!n.querySelector<SVGSVGElement>("svg")!,
                      ]),
                    }),
                  ),
                ),
              );
            },
            {
              __typedArg0: path,
              __typedArg1: name,
              __typedArg2: name,
              __typedArg3: selector,
            },
          ),
        ) as Shown[] | null;
        return shown !== null && shown.length === rows.length;
      }, 120);
      if (!settled) throw new Error(`${name} view: ${JSON.stringify(shown)}`);
      return shown!;
    };
    // The Annotation's row carries the mark and no "Error" text; every
    // other row shows its year and no mark.
    const marked = {
      errors: [["unparseable-text", message, true]],
      text: expect.not.stringContaining("Error"),
    };
    const unmarked = {
      errors: [],
      text: expect.stringContaining(positionDocumentItem.date.slice(0, 4)),
    };
    const expectMarks = (shown: Shown[]) => {
      expect(shown).toEqual(
        shown.map((row) => ({
          key: row.key,
          ...(row.key === annotationItem.key ? marked : unmarked),
        })),
      );
    };
    expectMarks(await showView("Table", '[data-query-table-row="item"]'));
    expectMarks(
      await showView("List", '[data-query-layout="list"] [data-query-row]'),
    );
    expectMarks(
      await showView("Cards", '[data-query-layout="cards"] [data-query-row]'),
    );

    // "Copy to clipboard" and "Export CSV…" write the Formula column after
    // the title, as the view's order has it, and the Error Value as its
    // message.
    const cell = (value: unknown) => {
      const text =
        value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? `Error: ${(value as { message: string }).message}`
            : String(value as string | number);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const lines = (separator: string, newline: string) =>
      [
        // The header names a field by its label, a Formula by its path.
        ["Title", "formula.n"].join(separator),
        ...rows.map((row) =>
          [cell(row.values.title), cell(row.values["formula.n"])].join(
            separator,
          ),
        ),
      ]
        .map((line) => `${line}${newline}`)
        .join("");

    await openResults();
    // The clipboard write has no time the test can name: poll for it, and
    // fail when it does not come.
    // JSON keeps the final newline, which the CLI reply would trim.
    const copied = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          let copied: string | null = null;
          const write = navigator.clipboard.write;
          navigator.clipboard.write = async (items) => {
            copied = await (await items[0]!.getType("text/plain")).text();
          };
          try {
            press(
              activeDocument
                .querySelector<HTMLElement>(__typedArg0)!
                .querySelector<HTMLElement>("[data-query-copy]")!,
              "Copy to clipboard",
            );
            await until("clipboard write", () => copied !== null, 5000).catch(
              () => {},
            );
          } finally {
            navigator.clipboard.write = write;
          }
          if (copied === null)
            throw new Error('"Copy to clipboard" wrote nothing');
          return String(JSON.stringify(copied));
        },
        { __typedArg0: `${"[data-query-results-popup]"}:popover-open` },
      ),
    ) as string;
    await openResults();
    const exportedCsv = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { press } = pageHelpers;
          const create = URL.createObjectURL;
          const click = HTMLAnchorElement.prototype.click;
          let blob: Blob | null = null,
            name: string | null = null;
          URL.createObjectURL = (b) => {
            blob = b as Blob;
            return create.call(URL, b);
          };
          HTMLAnchorElement.prototype.click = new Proxy(click, {
            apply(_target, receiver: HTMLAnchorElement) {
              name = receiver.download;
            },
          });
          try {
            press(
              activeDocument
                .querySelector<HTMLElement>(__typedArg0)!
                .querySelector<HTMLElement>("[data-query-export]")!,
              "Export CSV",
            );
          } finally {
            URL.createObjectURL = create;
            HTMLAnchorElement.prototype.click = click;
          }
          return String(
            JSON.stringify({
              name,
              type: (blob as Blob | null)?.type ?? null,
              text: blob
                ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                    await (blob as Blob).arrayBuffer(),
                  )
                : null,
            }),
          );
        },
        { __typedArg0: `${"[data-query-results-popup]"}:popover-open` },
      ),
    ) as { name: string | null; type: string | null; text: string | null };
    const written = { copied, ...exportedCsv } as {
      copied: string | null;
      name: string | null;
      type: string | null;
      text: string | null;
    };
    expect(written).toEqual({
      // TSV on the clipboard puts LF between lines, none after the last; the
      // CSV file starts with a byte order mark and ends each line with CRLF.
      copied: lines("\t", "\n").slice(0, -1),
      name: "Cards.csv",
      type: "text/csv",
      text: BYTE_ORDER_MARK + lines(",", "\r\n"),
    });
    expect(written.text).toContain(`"Error: ${message.replaceAll('"', '""')}"`);
  }, 240000);

  it("renames a field and a Formula from the Properties popover, and the Table header, the popover and the CSV header row show their Display Names", async () => {
    const path = "query-files/Named columns.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    const source = `formulas:\n  year: date.year\nviews:\n  - type: table\n    name: Named columns\n    from: items\n    order:\n      - title\n      - formula.year\n    limit: 3\n`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source },
    );

    /** The Table header, each popover row's Display Name, and the file's saved text. */

    interface Tab {
      header: [string, string][];
      names: [string, string][];
      rows: number;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        await openProperties();
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0, __typedArg1 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).save();
              const el = (view as import("obsidian").ItemView).contentEl;
              const header = [
                ...el.querySelectorAll<HTMLTableCellElement>(
                  "[data-query-table] thead th[data-query-column]",
                ),
              ].map((n) => [
                n.getAttribute("data-query-column"),
                n.textContent,
              ]);
              const popup =
                activeDocument.querySelector<HTMLElement>(__typedArg1)!;
              if (!popup) return String("null");
              const names = ["title", "formula.year"]
                .map((property) =>
                  popup.querySelector<HTMLElement>(
                    `[data-query-property="${property}"]`,
                  )!,
                )
                .filter((n) =>
                  n?.querySelector<HTMLElement>("[data-query-property-name]")!,
                )
                .map((n) => [
                  n!.dataset.queryProperty,
                  n!.querySelector<HTMLElement>("[data-query-property-name]")!
                    .textContent,
                ]);
              popup.hidePopover();
              return String(
                JSON.stringify({
                  header,
                  names,
                  rows: el.querySelectorAll<HTMLTableRowElement>(
                    '[data-query-table-row="item"]',
                  ).length,
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            {
              __typedArg0: path,
              __typedArg1: `${"[data-query-properties-popup]"}:popover-open`,
            },
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    const shown = await tabWhen((tab) => tab.rows > 0 && tab.header.length > 0);
    // Without a Display Name, a field shows its label and a Formula its path,
    // in the Table header and in the Properties popover.
    expect(shown.header).toEqual([
      ["title", "Title"],
      ["formula.year", "formula.year"],
    ]);
    expect(shown.names).toEqual([
      ["title", "Title"],
      ["formula.year", "formula.year"],
    ]);

    // The title row's chevron opens its page. Escape there steps back to the
    // rows, with focus in the search field, and saves the name typed.
    await openProperties();
    await openPropertyPage("title");
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        const input = activeDocument
          .querySelector<HTMLElement>(__typedArg0)
          ?.querySelector<HTMLElement>("[data-chooser-page]")!
          .querySelector<HTMLInputElement>("[data-query-display-name]")!;
        input!.value = "Work";
        input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popup =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            return String(
              String(
                !!popup &&
                  !popup.querySelector<HTMLElement>("[data-chooser-page]")! &&
                  popup.ownerDocument.activeElement?.getAttribute("role") ===
                    "combobox",
              ),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-view-properties.e2e.ts:987",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        activeDocument.querySelector<HTMLElement>(__typedArg0)!.hidePopover();
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    const field = await tabWhen((tab) => tab.text.includes("displayName"));
    expect(field.text).toBe(
      source.replace(
        "views:",
        "properties:\n  title:\n    displayName: Work\nviews:",
      ),
    );

    // The Formula's page holds the Formula's Display Name.
    /** Opens the page of `formula.year`. */
    const editYear = async () => {
      await openProperties();
      await openPropertyPage("formula.year");
    };
    await editYear();
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        const input = activeDocument
          .querySelector<HTMLElement>(__typedArg0)
          ?.querySelector<HTMLElement>("[data-chooser-page]")!
          .querySelector<HTMLInputElement>("[data-query-display-name]")!;
        input!.value = "Year of source";
        input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    await closePropertyPage();
    const named = await tabWhen((tab) => tab.text.includes("Year of source"));
    expect(named.text).toBe(
      source.replace(
        "views:",
        "properties:\n  title:\n    displayName: Work\n  formula.year:\n    displayName: Year of source\nviews:",
      ),
    );
    expect(named.header).toEqual([
      ["title", "Work"],
      ["formula.year", "Year of source"],
    ]);
    expect(named.names).toEqual([
      ["title", "Work"],
      ["formula.year", "Year of source"],
    ]);

    // The popover search finds a property by its Display Name.
    await openProperties();
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        const input = activeDocument
          .querySelector<HTMLElement>(__typedArg0)!
          .querySelector<HTMLInputElement>('input[role="combobox"]')!;
        input!.value = "Year of source";
        input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    const found = JSON.parse(
      await obRun(
        run.vaultId,
        async (_context, { __typedArg0 }) => {
          const popup = activeDocument.querySelector<HTMLElement>(__typedArg0)!;
          const rows = [
            ...popup!.querySelectorAll<HTMLElement>("[data-query-property]"),
          ].map((n) => n.dataset.queryProperty);
          popup!.hidePopover();
          return String(JSON.stringify(rows));
        },
        { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
      ),
    ) as string[];
    expect(found).toContain("formula.year");
    expect(found).not.toContain("title");
    // The popover opens again with an empty search and every property, so
    // the next typed text replaces the last search instead of adding to it.
    await openProperties();
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popup =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            const rows = [
              ...popup!.querySelectorAll<HTMLElement>("[data-query-property]"),
            ].map((n) => n.dataset.queryProperty);
            return String(
              JSON.stringify({
                search: popup!.querySelector<HTMLInputElement>(
                  'input[role="combobox"]',
                )!.value,
                title: rows.includes("title"),
                year: rows.includes("formula.year"),
              }),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-view-properties.e2e.ts:1051",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: JSON.stringify({ search: "", title: true, year: true }),
      }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        activeDocument.querySelector<HTMLElement>(__typedArg0)!.hidePopover();
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );

    // "Export CSV…" names the columns by their Display Names.
    await openResults();
    const exported = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { press } = pageHelpers;
          const create = URL.createObjectURL;
          const click = HTMLAnchorElement.prototype.click;
          let blob: Blob | null = null;
          URL.createObjectURL = (b) => {
            blob = b as Blob;
            return create.call(URL, b);
          };
          HTMLAnchorElement.prototype.click = function () {};
          try {
            press(
              activeDocument
                .querySelector<HTMLElement>(__typedArg0)!
                .querySelector<HTMLElement>("[data-query-export]")!,
              "Export CSV",
            );
          } finally {
            URL.createObjectURL = create;
            HTMLAnchorElement.prototype.click = click;
          }
          return String(
            JSON.stringify({
              text: blob
                ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                    await (blob as Blob).arrayBuffer(),
                  )
                : null,
            }),
          );
        },
        { __typedArg0: `${"[data-query-results-popup]"}:popover-open` },
      ),
    ) as { text: string | null };
    expect(exported.text?.split("\r\n")[0]).toBe(
      `${BYTE_ORDER_MARK}Work,Year of source`,
    );

    // Removing the Formula also removes its Display Name; the field keeps its own.
    await editYear();
    await runPageMenuItem("remove-formula");
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { __typedArg0 }) => {
            const popup =
              activeDocument.querySelector<HTMLElement>(__typedArg0)!;
            return String(
              String(
                !!popup &&
                  !popup.querySelector<HTMLElement>("[data-chooser-page]")! &&
                  !!popup.querySelector<HTMLElement>("[data-query-property]")!,
              ),
            );
          },
          { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "query-view-properties.e2e.ts:1078",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      run.vaultId,
      async (_context, { __typedArg0 }) => {
        activeDocument.querySelector<HTMLElement>(__typedArg0)!.hidePopover();
        return String(true);
      },
      { __typedArg0: `${"[data-query-properties-popup]"}:popover-open` },
    );
    const removed = await tabWhen((tab) => !tab.text.includes("formula"));
    expect(removed.text).toBe(
      "properties:\n  title:\n    displayName: Work\nviews:\n  - type: table\n    name: Named columns\n    from: items\n    order:\n      - title\n    limit: 3\n",
    );
    expect(removed.header).toEqual([["title", "Work"]]);
  }, 240000);

  it("moves a Table column by its header and sets its width by its edge, saves both in the Query File view, and a double click sets the width back", async () => {
    const path = "query-files/Column widths.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          document.body.classList.remove(
            "is-grabbing",
            "zt-is-resizing-column",
          );
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    const source = `views:\n  - type: table\n    name: Column widths\n    from: items\n    order:\n      - title\n      - firstAuthor\n      - date\n    limit: 3\n`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source },
    );
    /**
     * Runs `steps` against the open Query File tab once its Table shows, with
     * `th(path)`, `edge(path)`, `fire(target, type, x)`, a drag event at
     * the client x `x`, and `pointer(target, type, x)`, a pointer event there;
     * then saves and reads the header and the file text.
     */

    interface Read {
      columns: string[];
      text: string;
    }

    // A header dragged over a column after it drops after that column, and
    // the drop line stands at that column's end edge while the drag is on.
    const moved = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const transfer = new DataTransfer();
              const fire = (target: HTMLElement, type: string, x: number) => {
                const r = target.getBoundingClientRect();
                const event = new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const frame = () =>
                new Promise<void>((r) => requestAnimationFrame(() => r()));

              const out = await (async () => {
                const date = th("date")!.getBoundingClientRect();
                fire(
                  th("title"),
                  "dragstart",
                  th("title")!.getBoundingClientRect().left + 5,
                );
                fire(th("date"), "dragover", date.left + 5);
                const line = el.querySelector<HTMLElement>(
                  ".table-drag-target.mod-col",
                )!;
                const at = line
                  ? Math.round(line.getBoundingClientRect().left)
                  : null;
                const layer = line ? getComputedStyle(line).zIndex : null;
                const header = getComputedStyle(th("title")!).zIndex;
                fire(th("date"), "drop", date.left + 5);
                fire(th("title"), "dragend", 0);
                await frame();
                return {
                  line: at,
                  edge: Math.round(date.right),
                  layer,
                  header,
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        line: number;
        edge: number;
        layer: string;
        header: string;
      }
    >();
    expect(moved.line).toBe(moved.edge);
    // The line stands over the sticky header, not under it.
    expect(moved.layer).toBe(moved.header);
    expect(moved.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(moved.text).toContain(
      "    order:\n      - firstAuthor\n      - date\n      - title\n",
    );

    // A drag on a column's edge sets its width as it goes, with the resize
    // cursor over the whole page, and saves it when the pointer lets go; the
    // header does not move and its menu does not open.
    const resized = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const pointer = (
                target: HTMLElement,
                type: string,
                x: number,
              ) => {
                const r = target.getBoundingClientRect();
                const event = new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  isPrimary: true,
                  button: 0,
                  buttons: type === "pointerup" ? 0 : 1,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };
              const frame = () =>
                new Promise<void>((r) => requestAnimationFrame(() => r()));
              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const before = width("date");
                const x = edge("date")!.getBoundingClientRect().left + 2;
                pointer(edge("date"), "pointerdown", x);
                pointer(el, "pointermove", x + 80);
                await until("live width", () => width("date") !== before);
                const live = width("date");
                const cursor = getComputedStyle(th("title")!).cursor;
                pointer(th("date"), "pointerup", x + 80);
                th("date")!.dispatchEvent(
                  new MouseEvent("click", { bubbles: true, cancelable: true }),
                );
                await frame();
                const menu =
                  !!activeDocument.querySelector<HTMLElement>(".menu")!;
                return {
                  before,
                  live,
                  after: width("date"),
                  cursor,
                  cursorAfter: getComputedStyle(th("title")!).cursor,
                  menu,
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        before: number;
        live: number;
        after: number;
        cursor: string;
        cursorAfter: string;
        menu: boolean;
      }
    >();
    expect(resized.cursor).toBe("col-resize");
    expect(resized.cursorAfter).toBe("grab");
    expect(resized.menu).toBe(false);
    expect(resized.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(resized.live).toBe(resized.before + 80);
    expect(resized.after).toBe(resized.before + 80);
    expect(resized.text).toContain(
      `    columnSize:\n      date: ${resized.before + 80}\n`,
    );

    // Escape ends a drag on an edge: the width goes back and nothing saves.
    const cancelled = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const pointer = (
                target: HTMLElement,
                type: string,
                x: number,
              ) => {
                const r = target.getBoundingClientRect();
                const event = new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  isPrimary: true,
                  button: 0,
                  buttons: type === "pointerup" ? 0 : 1,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };
              const frame = () =>
                new Promise<void>((r) => requestAnimationFrame(() => r()));
              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const before = width("title");
                const x = edge("title")!.getBoundingClientRect().left + 2;
                pointer(edge("title"), "pointerdown", x);
                pointer(el, "pointermove", x + 60);
                await until("live width", () => width("title") !== before);
                const live = width("title");
                activeDocument.body.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Escape",
                    bubbles: true,
                    cancelable: true,
                  }),
                );
                pointer(el, "pointerup", x + 60);
                await frame();
                return { before, live, after: width("title") };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        before: number;
        live: number;
        after: number;
      }
    >();
    expect(cancelled.live).toBe(cancelled.before + 60);
    expect(cancelled.after).toBe(cancelled.before);
    expect(cancelled.text).toBe(resized.text);

    // A double click on the edge sets the column back to its auto width and
    // removes the key with its last width.
    const reset = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                edge("date")!.dispatchEvent(
                  new MouseEvent("dblclick", {
                    bubbles: true,
                    cancelable: true,
                  }),
                );
                await until(
                  "auto width",
                  () => !("sized" in th("date")!.dataset),
                );
                return { after: width("date") };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        after: number;
      }
    >();
    expect(reset.after).toBe(resized.before);
    expect(reset.text).not.toContain("columnSize");
    expect(reset.columns).toEqual(["firstAuthor", "date", "title"]);

    // A column can be narrower than its longest word: it stops at the
    // narrowest Bases width, and its cells clip what does not fit — the
    // cell itself, or the line inside it that truncates its text.
    const narrowed = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const pointer = (
                target: HTMLElement,
                type: string,
                x: number,
              ) => {
                const r = target.getBoundingClientRect();
                const event = new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  isPrimary: true,
                  button: 0,
                  buttons: type === "pointerup" ? 0 : 1,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const min = Number.parseFloat(
                  getComputedStyle(th("firstAuthor")!).getPropertyValue(
                    "--bases-table-column-min-width",
                  ),
                );
                const before = width("firstAuthor");
                const x = edge("firstAuthor")!.getBoundingClientRect().left + 2;
                pointer(edge("firstAuthor"), "pointerdown", x);
                pointer(el, "pointermove", x - before);
                pointer(el, "pointerup", x - before);
                await until("narrow width", () => width("firstAuthor") === min);
                const at = th("firstAuthor")!.cellIndex;
                const cells = [
                  ...el.querySelectorAll<HTMLTableRowElement>(
                    '[data-query-table-row="item"]',
                  ),
                ].map((row) => row.cells[at]);
                const label =
                  th("firstAuthor")!.firstElementChild!.lastElementChild;
                return {
                  min,
                  auto: before,
                  after: width("firstAuthor"),
                  clipped: cells.some((cell) =>
                    [cell, ...cell!.querySelectorAll<HTMLElement>("*")].some(
                      (box) => box!.scrollWidth > box!.clientWidth,
                    ),
                  ),
                  label: label!.scrollWidth > label!.clientWidth,
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        min: number;
        auto: number;
        after: number;
        clipped: boolean;
        label: boolean;
      }
    >();
    expect(narrowed.after).toBe(narrowed.min);
    expect(narrowed.clipped).toBe(true);
    expect(narrowed.label).toBe(true);
    expect(narrowed.text).toContain(
      `    columnSize:\n      firstAuthor: ${narrowed.min}\n`,
    );

    // A right click on a header opens its menu whatever the column's
    // state: an entry with nothing to do shows disabled, and Reset column
    // width on a resized column sets it back to its auto width.
    const menuReset = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { press, until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const items = () =>
                  [...activeDocument.querySelectorAll<HTMLElement>(".menu")]
                    .at(-1)!
                    .querySelectorAll<HTMLElement>(".menu-item");
                const read = () =>
                  [...items()].map(
                    (n) =>
                      n.textContent.trim() +
                      (n.classList.contains("is-disabled")
                        ? " (disabled)"
                        : ""),
                  );
                const open = async (p: string) => {
                  const r = th(p)!.getBoundingClientRect();
                  th(p)!.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: true,
                      clientX: r.left + 5,
                      clientY: r.top + 5,
                    }),
                  );
                  await until("header menu", () =>
                    activeDocument.querySelector<HTMLElement>(
                      ".menu .menu-item",
                    )!,
                  );
                };
                await open("date");
                const auto = read();
                await pageHelpers.menuReady();
                activeDocument.body.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Escape",
                    bubbles: true,
                  }),
                );
                await until(
                  "first menu closes",
                  () => !activeDocument.querySelector<HTMLElement>(".menu")!,
                );
                await open("firstAuthor");
                const sized = read();
                press(
                  [...items()].find(
                    (n) => n.textContent.trim() === "Reset column width",
                  ),
                  "Reset column width",
                );
                await until(
                  "auto width",
                  () => !("sized" in th("firstAuthor")!.dataset),
                );
                await until(
                  "second menu closes",
                  () => !activeDocument.querySelector<HTMLElement>(".menu")!,
                );
                return { auto, sized, after: width("firstAuthor") };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        auto: string[];
        sized: string[];
        after: number;
      }
    >();
    expect(menuReset.auto).toEqual([
      "Move left",
      "Move right",
      "Reset column width (disabled)",
    ]);
    expect(menuReset.sized).toEqual([
      "Move left (disabled)",
      "Move right",
      "Reset column width",
    ]);
    expect(menuReset.after).toBe(narrowed.auto);
    expect(menuReset.text).not.toContain("columnSize");

    // A pointer the system takes away ends a drag on an edge: the live width
    // goes back, the resize cursor goes, and nothing saves.
    const ended = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const pointer = (
                target: HTMLElement,
                type: string,
                x: number,
              ) => {
                const r = target.getBoundingClientRect();
                const event = new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  isPrimary: true,
                  button: 0,
                  buttons: type === "pointerup" ? 0 : 1,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };
              const frame = () =>
                new Promise<void>((r) => requestAnimationFrame(() => r()));
              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const before = width("date");
                const x = edge("date")!.getBoundingClientRect().left + 2;
                pointer(edge("date"), "pointerdown", x);
                pointer(el, "pointermove", x + 50);
                await until("live width", () => width("date") !== before);
                const live = width("date");
                pointer(el, "pointercancel", x + 50);
                await frame();
                return {
                  before,
                  live,
                  after: width("date"),
                  resizing: activeDocument.body.classList.contains(
                    "zt-is-resizing-column",
                  ),
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        before: number;
        live: number;
        after: number;
        resizing: boolean;
      }
    >();
    expect(ended.live).toBe(ended.before + 50);
    expect(ended.after).toBe(ended.before);
    expect(ended.resizing).toBe(false);
    expect(ended.text).toBe(menuReset.text);

    // A header dropped outside the table moves nothing, and the drag leaves
    // no drop line and no grabbing cursor.
    const outside = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const transfer = new DataTransfer();
              const fire = (target: HTMLElement, type: string, x: number) => {
                const r = target.getBoundingClientRect();
                const event = new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const out = await (async () => {
                const date = th("date")!.getBoundingClientRect();
                fire(
                  th("title"),
                  "dragstart",
                  th("title")!.getBoundingClientRect().left + 5,
                );
                fire(th("date"), "dragover", date.left + 5);
                const away =
                  view.containerEl.querySelector<HTMLElement>(".view-header")!;
                fire(away, "dragover", away!.getBoundingClientRect().left + 5);
                fire(away, "drop", away!.getBoundingClientRect().left + 5);
                fire(th("title"), "dragend", 0);
                return {
                  line: !!activeDocument.querySelector<HTMLElement>(
                    ".table-drag-target",
                  )!,
                  grabbing:
                    activeDocument.body.classList.contains("is-grabbing"),
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        line: boolean;
        grabbing: boolean;
      }
    >();
    expect(outside.line).toBe(false);
    expect(outside.grabbing).toBe(false);
    expect(outside.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(outside.text).toBe(menuReset.text);

    // A move reads the order the view holds at the drop: here a save during
    // the drag puts the dragged column last, and the drop over the first
    // column still puts it first.
    const stale = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app, page: pageHelpers }, { __typedArg0 }) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const transfer = new DataTransfer();
              const fire = (target: HTMLElement, type: string, x: number) => {
                const r = target.getBoundingClientRect();
                const event = new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const out = await (async () => {
                fire(
                  th("firstAuthor"),
                  "dragstart",
                  th("firstAuthor")!.getBoundingClientRect().left + 5,
                );
                (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.document.editView({
                  order: ["date", "title", "firstAuthor"],
                });
                await (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.flush();
                await until(
                  "order changes",
                  () =>
                    [
                      ...el.querySelectorAll<HTMLTableCellElement>(
                        "[data-query-table] th[data-query-column]",
                      ),
                    ]
                      .map((n) => n.getAttribute("data-query-column"))
                      .join() === "date,title,firstAuthor",
                );
                const date = th("date")!.getBoundingClientRect();
                fire(th("date"), "dragover", date.left + 5);
                fire(th("date"), "drop", date.left + 5);
                fire(th("firstAuthor"), "dragend", 0);
                await until(
                  "dropped",
                  () =>
                    [
                      ...el.querySelectorAll<HTMLTableCellElement>(
                        "[data-query-table] th[data-query-column]",
                      ),
                    ]
                      .map((n) => n.getAttribute("data-query-column"))
                      .join() === "firstAuthor,date,title",
                );
                return {};
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: [
                    ...el.querySelectorAll<HTMLTableCellElement>(
                      "[data-query-table] th[data-query-column]",
                    ),
                  ].map((n) => n.getAttribute("data-query-column")),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<Read>();
    expect(stale.columns).toEqual(["firstAuthor", "date", "title"]);
    expect(stale.text).toContain(
      "    order:\n      - firstAuthor\n      - date\n      - title\n",
    );

    // A tab that closes mid-drag ends the drag: no drop line, no grabbing
    // cursor, the width as it was, and a later drop saves nothing.
    const closed = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { until } = pageHelpers;
          const leaf = app.workspace.getMostRecentLeaf()!;
          const view = leaf!.view;
          const el = (view as import("obsidian").ItemView).contentEl;
          const th = (p: string) =>
            el.querySelector<HTMLTableCellElement>(
              `[data-query-table] th[data-query-column="${p}"]`,
            )!;
          const transfer = new DataTransfer();
          const fire = (target: HTMLElement, type: string, x: number) => {
            const r = target.getBoundingClientRect();
            const event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: x,
              clientY: r.top + r.height / 2,
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
          };
          const before = await app.vault.read(
            (view as import("obsidian").FileView).file!,
          );
          const file = (view as import("obsidian").FileView).file;
          const date = th("date")!.getBoundingClientRect();
          fire(
            th("title"),
            "dragstart",
            th("title")!.getBoundingClientRect().left + 5,
          );
          fire(th("date"), "dragover", date.left + 5);
          const during = {
            line: !!activeDocument.querySelector<HTMLElement>(
              ".table-drag-target",
            )!,
            grabbing: activeDocument.body.classList.contains("is-grabbing"),
          };
          const layout = (
            view as import("@/views/query-view/file-view").QueryFileView
          ).query.layout;
          const left = () =>
            !activeDocument.querySelector<HTMLElement>(".table-drag-target")! &&
            !activeDocument.body.classList.contains("is-grabbing");
          leaf!.detach();
          if ((layout as typeof layout & { _loaded: boolean })._loaded)
            throw new Error("the Table stays mounted");
          await until("drag ends", left).catch(() => {});
          const after = {
            line: !!activeDocument.querySelector<HTMLElement>(
              ".table-drag-target",
            )!,
            grabbing: activeDocument.body.classList.contains("is-grabbing"),
          };
          fire(activeDocument.body, "dragover", 10);
          fire(activeDocument.body, "drop", 10);
          return String(
            JSON.stringify({
              during,
              after,
              same: (await app.vault.read(file!)) === before,
            }),
          );
        },
        undefined,
      ),
    ) as {
      during: { line: boolean; grabbing: boolean };
      after: { line: boolean; grabbing: boolean };
      same: boolean;
    };
    expect(closed.during).toEqual({ line: true, grabbing: true });
    expect(closed.after).toEqual({ line: false, grabbing: false });
    expect(closed.same).toBe(true);
  }, 240000);

  it("moves, resizes and hides the Literature Note Property in the Table, saves it in the Query File view, and keeps it across a switch to Cards", async () => {
    const path = "query-files/Note column.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          document.body.classList.remove("is-grabbing");
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    const note = "vault.literatureNote";
    const source = `views:\n  - type: table\n    name: Note column\n    from: items\n    order:\n      - title\n      - date\n      - ${note}\n    limit: 3\n`;
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path, __typedArg1: source },
    );
    /**
     * Runs `steps` against the open Query File tab once its Table shows, with
     * `th(path)`, `edge(path)`, `fire(target, type, x)`, a drag event at the
     * client x `x`, `pointer(target, type, x)`, a pointer event there, and
     * `popup()`, the open Properties popover; then saves and reads the
     * header and the file.
     */

    interface Read {
      columns: string[];
      text: string;
    }

    // The column's header drags as any other: dropped on the first column,
    // it goes first, and each Item row shows its note link or Create there.
    const moved = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async (
              { app, page: pageHelpers },
              {
                __typedArg0,
                __typedArg1,
                __typedArg2,
                __typedArg3,
                __typedArg4,
                __typedArg5,
              },
            ) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const transfer = new DataTransfer();
              const fire = (target: HTMLElement, type: string, x: number) => {
                const r = target.getBoundingClientRect();
                const event = new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const columns = () =>
                [
                  ...el.querySelectorAll<HTMLTableCellElement>(
                    "[data-query-table] th[data-query-column]",
                  ),
                ].map((n) => n.getAttribute("data-query-column"));

              const out = await (async () => {
                const title = th("title")!.getBoundingClientRect();
                fire(
                  th(__typedArg1),
                  "dragstart",
                  th(__typedArg2)!.getBoundingClientRect().left + 5,
                );
                fire(th("title"), "dragover", title.left + 5);
                fire(th("title"), "drop", title.left + 5);
                fire(th(__typedArg3), "dragend", 0);
                await until("moved", () => columns()[0] === __typedArg4);
                const at = th(__typedArg5)!.cellIndex;
                return {
                  cells: [
                    ...el.querySelectorAll<HTMLTableRowElement>(
                      '[data-query-table-row="item"]',
                    ),
                  ].map(
                    (row) =>
                      !!row.cells[at]!.querySelector<HTMLElement>(
                        "[data-query-note],[data-query-create-note]",
                      )!,
                  ),
                };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: columns(),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            {
              __typedArg0: path,
              __typedArg1: note,
              __typedArg2: note,
              __typedArg3: note,
              __typedArg4: note,
              __typedArg5: note,
            },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        cells: boolean[];
      }
    >();
    expect(moved.columns).toEqual([note, "title", "date"]);
    expect(moved.cells).toEqual([true, true, true]);
    expect(moved.text).toContain(
      `    order:\n      - ${note}\n      - title\n      - date\n`,
    );

    // Its edge sets its width, saved by its path.
    const resized = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async (
              { app, page: pageHelpers },
              {
                __typedArg0,
                __typedArg1,
                __typedArg2,
                __typedArg3,
                __typedArg4,
                __typedArg5,
                __typedArg6,
                __typedArg7,
              },
            ) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");
              const edge = (p: string) =>
                th(p)!.querySelector<HTMLElement>(
                  "[data-query-column-resizer]",
                )!;

              const pointer = (
                target: HTMLElement,
                type: string,
                x: number,
              ) => {
                const r = target.getBoundingClientRect();
                const event = new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 7,
                  isPrimary: true,
                  button: 0,
                  buttons: type === "pointerup" ? 0 : 1,
                  clientX: x,
                  clientY: r.top + r.height / 2,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
              };

              const columns = () =>
                [
                  ...el.querySelectorAll<HTMLTableCellElement>(
                    "[data-query-table] th[data-query-column]",
                  ),
                ].map((n) => n.getAttribute("data-query-column"));
              const width = (p: string) =>
                Math.round(th(p)!.getBoundingClientRect().width);
              const out = await (async () => {
                const before = width(__typedArg1);
                const x = edge(__typedArg2)!.getBoundingClientRect().left + 2;
                pointer(edge(__typedArg3), "pointerdown", x);
                pointer(el, "pointermove", x + 80);
                await until("live width", () => width(__typedArg4) !== before);
                pointer(th(__typedArg5), "pointerup", x + 80);
                await until(
                  "saved width",
                  () => "sized" in th(__typedArg6)!.dataset,
                );
                return { before, after: width(__typedArg7) };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: columns(),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            {
              __typedArg0: path,
              __typedArg1: note,
              __typedArg2: note,
              __typedArg3: note,
              __typedArg4: note,
              __typedArg5: note,
              __typedArg6: note,
              __typedArg7: note,
            },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        before: number;
        after: number;
      }
    >();
    expect(resized.after).toBe(resized.before + 80);
    expect(resized.text).toContain(
      `    columnSize:\n      ${note}: ${resized.before + 80}\n`,
    );

    // The Properties popover ticks it; an untick hides the column and keeps
    // its row, unticked, so a tick shows it again, last.
    const toggled = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async (
              { app, page: pageHelpers },
              { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
            ) => {
              const { press, until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const popup = () =>
                activeDocument.querySelector<HTMLElement>(
                  "[data-query-properties-popup]:popover-open",
                )!;
              const columns = () =>
                [
                  ...el.querySelectorAll<HTMLTableCellElement>(
                    "[data-query-table] th[data-query-column]",
                  ),
                ].map((n) => n.getAttribute("data-query-column"));

              const out = await (async () => {
                if (!popup())
                  press(
                    el.querySelector<HTMLElement>("[data-query-properties]")!,
                    "Properties",
                  );
                await until("Properties popover opens", () =>
                  popup()?.querySelector<HTMLElement>("[data-query-property]")!,
                );
                const row = () =>
                  popup()!.querySelector<HTMLElement>(
                    `[data-query-property=${JSON.stringify(__typedArg1)}]`,
                  )!;
                const label = row()!.textContent;
                press(row(), "Literature Note Property row");
                await until("hidden", () => !columns().includes(__typedArg2));
                await (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.flush();
                const hidden = columns();
                const hiddenText = await app.vault.read(
                  (view as import("obsidian").FileView).file!,
                );
                const kept = row()?.getAttribute("aria-selected") === "false";
                press(row(), "Literature Note Property row");
                await until("shown", () => columns().includes(__typedArg3));
                popup()!.hidePopover();
                return { label, hidden, hiddenText, kept };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: columns(),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            {
              __typedArg0: path,
              __typedArg1: note,
              __typedArg2: note,
              __typedArg3: note,
            },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        label: string;
        hidden: string[];
        hiddenText: string;
        kept: boolean;
      }
    >();
    expect(toggled.label).toBe(run.m.query_view_table_literature_note());
    expect(toggled.hidden).toEqual(["title", "date"]);
    expect(toggled.hiddenText).toContain(
      "    order:\n      - title\n      - date\n    limit",
    );
    expect(toggled.kept).toBe(true);
    expect(toggled.columns).toEqual(["title", "date", note]);

    // Cards do not show it and name it no unused setting, and the Table
    // shows it again after the switch back.
    const switched = await (async <T>(): Promise<T> => {
      let out: T | null = null;
      const settled = await waitFor(async () => {
        out = JSON.parse(
          await obRun(
            run.vaultId,
            async (
              { app, page: pageHelpers },
              { __typedArg0, __typedArg1 },
            ) => {
              const { until } = pageHelpers;
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const th = (p: string) =>
                el.querySelector<HTMLTableCellElement>(
                  `[data-query-table] th[data-query-column="${p}"]`,
                )!;
              if (
                !th("title") ||
                !el.querySelector<HTMLTableRowElement>(
                  '[data-query-table-row="item"]',
                )!
              )
                return String("null");

              const columns = () =>
                [
                  ...el.querySelectorAll<HTMLTableCellElement>(
                    "[data-query-table] th[data-query-column]",
                  ),
                ].map((n) => n.getAttribute("data-query-column"));

              const out = await (async () => {
                (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.document.setViewLayout(0, "cards");
                await until("cards", () =>
                  el.querySelector<HTMLElement>("[data-query-row]")!,
                );
                await (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.settled;
                const card = !!el.querySelector<HTMLElement>(
                  "[data-query-row] [data-query-note],[data-query-row] [data-query-create-note]",
                )!;
                const unused =
                  el.querySelector<HTMLElement>("[data-query-unused]")
                    ?.textContent ?? null;
                (
                  view as import("@/views/query-view/file-view").QueryFileView
                ).query.document.setViewLayout(0, "table");
                await until("table", () => th(__typedArg1));
                return { card, unused };
              })();
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.flush();
              return String(
                JSON.stringify({
                  ...out,
                  columns: columns(),
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            { __typedArg0: path, __typedArg1: note },
          ),
        ) as T | null;
        return out !== null;
      }, 120);
      if (!settled) throw new Error("Query File tab shows no Table");
      return out!;
    })<
      Read & {
        card: boolean;
        unused: string | null;
      }
    >();
    expect(switched.card).toBe(false);
    expect(switched.unused).toBeNull();
    expect(switched.columns).toEqual(["title", "date", note]);
    expect(switched.text).toContain(
      `    order:\n      - title\n      - date\n      - ${note}\n`,
    );
  }, 240000);
});
