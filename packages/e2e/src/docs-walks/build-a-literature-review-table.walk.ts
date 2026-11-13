// The walk of /learn Lesson 6, "Build a literature review table": a
// researcher with the Lesson 1 literature note on Sandve et al. 2013 saves
// the Zotero collection Reproducibility as a table in Thesis/, picks its
// columns, rates each paper in a column of their own, sorts the papers by
// year, and pastes the table into `Chapter 3 - Presenting the results`. Each
// `it` is one step of the lesson, in the lesson's order, named after it, and
// asserts what the lesson says the reader sees. Run it with
// `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type { MarkdownView, WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";
import type { QueryFileView } from "@/views/query-view/file-view";

import {
  closeWelcome,
  openDocsWalk,
  readNotices,
  watchNotices,
} from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "build-a-literature-review-table";
/** The Reproducibility collection of the docs Vault Case, and its papers. */
const COLLECTION = { key: "DCRPRDCB", name: "Reproducibility" };
const PAPERS = {
  ioannidis: { key: "DMIANART", citekey: "ioannidis2005", year: "2005" },
  sandve: { key: "DCSNDART", citekey: "sandve2013", year: "2013" },
  wilson: { key: "DCWLSART", citekey: "wilson2014", year: "2014" },
  munafo: { key: "DCMNFART", citekey: "munafo2017", year: "2017" },
};
/** The reader's rating of each paper, out of 5. */
const RATINGS: [keyof typeof PAPERS, string][] = [
  ["sandve", "5"],
  ["ioannidis", "5"],
  ["munafo", "4"],
  ["wilson", "3"],
];
const FOLDER = "Thesis";
const FILE = `${FOLDER}/${COLLECTION.name}.zotquery`;
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
const PROPERTY = "rating";

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
/** The table's Query File tab. */
type TableLeaf = WorkspaceLeaf & { view: QueryFileView };
type DraftLeaf = WorkspaceLeaf & { view: MarkdownView };

/** The table in its tab: its header, its rows by key, and each rating cell. */
interface Table {
  header: string[];
  rows: string[];
  ratings: Record<string, string>;
  cells: Record<string, string[]>;
}

/** The text a Results menu copy put on the clipboard. */
interface Clipboard {
  readText(): string;
  readHTML(): string;
}
/** The window's Electron remote, for typing. */
interface Remote {
  getCurrentWebContents(): { insertText(text: string): void };
}

const STEP = { timeoutMs: 60000 };

/** The table in its tab once `ready` holds. */
function tableWhen(
  vaultId: string,
  what: string,
  ready: (table: Table) => boolean,
): Promise<Table> {
  return obRunUntil(
    vaultId,
    async ({ app }, { file, property }): Promise<Table | null> => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find((l) => (l.view as QueryFileView).file?.path === file) as
        | TableLeaf
        | undefined;
      const view = leaf?.view;
      if (!view) return null;
      const el = view.contentEl;
      await view.query.settled;
      const rows = [
        ...el.querySelectorAll<HTMLElement>('[data-query-table-row="item"]'),
      ];
      return {
        header: [...el.querySelectorAll("th")]
          .map((n) => n.textContent)
          .filter(Boolean),
        rows: rows.map((n) => n.getAttribute("data-query-key")!),
        ratings: Object.fromEntries(
          [
            ...el.querySelectorAll(
              `[data-query-vault-cell][data-query-vault-name="${property}"]`,
            ),
          ].map((n) => [
            n.closest("tr")!.getAttribute("data-query-key")!,
            n.textContent,
          ]),
        ),
        cells: Object.fromEntries(
          rows.map((r) => [
            r.getAttribute("data-query-key")!,
            [...r.querySelectorAll("td")].map((c) => c.innerText.trim()),
          ]),
        ),
      };
    },
    { file: FILE, property: PROPERTY },
    { what, ready: (table) => table !== null && ready(table) },
  ) as Promise<Table>;
}

/**
 * Whether the table shows the text of the Title column (its name and each
 * paper's title) and of the rating column (its name and each rating) whole
 * inside its tab.
 */
function columnsWhole(
  vaultId: string,
): Promise<{ title: boolean; rating: boolean }> {
  return obRun(
    vaultId,
    ({ app }, { file, titleLabel, ratingLabel }) => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find(
          (l) => (l.view as QueryFileView).file?.path === file,
        ) as TableLeaf;
      const el = leaf.view.contentEl;
      const pane = el.getBoundingClientRect();
      /** Each box of the text in `cell`, without its padding and icon. */
      const whole = (cell: Element) => {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const boxes: DOMRect[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const box = range.getBoundingClientRect();
          // Text that does not render has an empty box.
          if (box.width > 0 && box.height > 0) boxes.push(box);
        }
        return (
          boxes.length > 0 &&
          boxes.every(
            (b) => b.left >= pane.left - 1 && b.right <= pane.right + 1,
          )
        );
      };
      const heads = [...el.querySelectorAll<HTMLTableCellElement>("th")];
      const column = (label: string) => {
        const head = heads.find((th) => th.textContent.trim() === label);
        if (!head) return false;
        const cells = [
          ...el.querySelectorAll<HTMLTableRowElement>("tbody tr"),
        ].map((row) => row.cells[head.cellIndex]!);
        return [head, ...cells].every(whole);
      };
      return { title: column(titleLabel), rating: column(ratingLabel) };
    },
    {
      file: FILE,
      titleLabel: m.query_view_property_title(),
      ratingLabel: m.query_view_vault_property_label({ name: PROPERTY }),
    },
  );
}

/**
 * Ends a recorded clip on the table's header row, or on the header and cells
 * of the column `label` names.
 */
async function lookAtTable(vaultId: string, label = ""): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { file, label }) => {
      const pointer = page.scratch.docsWalkPointer;
      if (!pointer) return;
      const el = (
        app.workspace
          .getLeavesOfType("zotlit-query-file")
          .find(
            (l) => (l.view as QueryFileView).file?.path === file,
          ) as TableLeaf
      ).view.contentEl;
      // The first header cell, over the row toggles, has no name.
      const head = label
        ? [...el.querySelectorAll<HTMLTableCellElement>("th")].find(
            (th) => th.textContent.trim() === label,
          )
        : undefined;
      const parts: Element[] = head
        ? [
            head,
            ...[...el.querySelectorAll<HTMLTableRowElement>("tbody tr")].map(
              (row) => row.cells[head.cellIndex]!,
            ),
          ]
        : [...el.querySelectorAll("th")];
      if (parts.length > 0) await pointer.look(parts);
    },
    { file: FILE, label },
  );
}

/** Opens the Properties menu of the table and answers once its search shows. */
async function openProperties(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { file }) => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find(
          (l) => (l.view as QueryFileView).file?.path === file,
        ) as TableLeaf;
      if (document.querySelector("[data-query-properties-popup]")) return;
      const button = await page.stands(
        leaf.view.contentEl.querySelector<HTMLElement>(
          "[data-query-properties]",
        ),
        "Properties",
      );
      await page.scratch.docsWalkPointer?.point(button);
      page.press(button, "Properties");
      await page.until("Properties menu", () =>
        document.querySelector("[data-query-properties-popup] input"),
      );
    },
    { file: FILE },
  );
}

/**
 * Types `search` into the open Properties menu and answers its entries; with
 * `choose`, then selects the entry `choose` names by its property path or its
 * action.
 */
function searchProperties(
  vaultId: string,
  search: string,
  choose?: { path?: string; action?: string },
): Promise<string[]> {
  return obRun(
    vaultId,
    async ({ page }, { search, path, action }) => {
      const pointer = page.scratch.docsWalkPointer;
      const popup = document.querySelector<HTMLElement>(
        "[data-query-properties-popup]",
      )!;
      const input = popup.querySelector("input")!;
      input.focus();
      input.select();
      if (pointer) {
        // The pointer waits beside the menu, off its list.
        const b = popup.getBoundingClientRect();
        await pointer.park(b.right + 30, b.top + 20);
        await pointer.keys(
          search,
          (ch) => document.execCommand("insertText", false, ch),
          { speed: 3 },
        );
      } else document.execCommand("insertText", false, search);
      const selector = path
        ? `[data-query-property="${path}"]`
        : action
          ? `[data-query-properties-action="${action}"]`
          : "[role=option]";
      const target = await page.until(search, () =>
        popup.querySelector<HTMLElement>(selector),
      );
      const entries = [...popup.querySelectorAll("[role=option]")].map(
        (o) => o.textContent,
      );
      if (path || action) {
        await pointer?.point(target, { inset: 40 });
        page.press(target, search);
      }
      await new Promise((r) => setTimeout(r, 300));
      return entries;
    },
    { search, path: choose?.path ?? "", action: choose?.action ?? "" },
  );
}

describe.skipIf(!reachable)("Lesson 6: Build a literature review table", () => {
  let walk: DocsWalk;

  beforeAll(async () => {
    walk = await openDocsWalk({
      slug: SLUG,
      collection: `learn/${SLUG}`,
      vaultCase: "docs",
    });
    // The reader wrote the literature note on Sandve et al. 2013 in Lesson 1.
    await obRun(
      walk.vaultId,
      async ({ zotlit }, { key }) => {
        const hits = await zotlit.services.itemLookup.search("", {
          limit: 100,
        });
        const hit = hits.find((h) => h.item.key === key)!;
        const result = await zotlit.services.noteFeature.createNote(
          hit.item,
          {},
        );
        if (result.outcome !== "created") throw new Error("note refused");
      },
      { key: PAPERS.sandve.key },
      STEP,
    );
    await watchNotices(walk.vaultId);
    // The reader closed the setup section in Lesson 1.
    await closeWelcome(walk.vaultId);
  });

  afterAll(async () => {
    await walk?.[Symbol.asyncDispose]();
  });

  it("step 1: select the collection, select Save as query file, type Thesis as the folder, and save; Thesis/Reproducibility.zotquery opens", async () => {
    const { shown, saved } = await walk.record("step-1", async () => {
      const shown = await obRun(
        walk.vaultId,
        async ({ app, page }, { name, showTree }) => {
          const pointer = page.scratch.docsWalkPointer;
          app.commands.executeCommandById("zotlit:open-library-view");
          const leaf = await page.until(
            "Library View",
            () =>
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined,
            20000,
          );
          const el = leaf.view.contentEl;
          await app.workspace.revealLeaf(leaf);
          await leaf.view.query.settled;
          const label = () =>
            [...el.querySelectorAll<HTMLElement>("[data-library-label]")].find(
              (n) => n.textContent === name,
            );
          // Fact d: whether the collection tree shows by default, once the
          // tab has its width.
          await page.until(
            "the tree",
            () =>
              el.getBoundingClientRect().width > 0 &&
              el.querySelector("[data-library-label]"),
            20000,
          );
          // The tree's toggle for this pane width says whether it shows.
          await page.until(
            "the tree toggle that agrees with the tree",
            () => {
              const toggle = [
                ...el.querySelectorAll<HTMLElement>(
                  "[data-library-tree-toggle], [data-library-tree-collapse]",
                ),
              ].find((b) => b.checkVisibility());
              return (
                toggle !== undefined &&
                (toggle.getAttribute("aria-pressed") === "true") ===
                  !!label()?.checkVisibility()
              );
            },
            20000,
          );
          const treeShown = !!label()?.checkVisibility();
          if (!treeShown)
            page.press(
              [...el.querySelectorAll("button")].find(
                (b) => b.getAttribute("aria-label") === showTree,
              ),
              "Show libraries and collections",
            );
          const collection = await page.until(
            "the collection",
            () => label()?.checkVisibility() && label(),
            20000,
          );
          await pointer?.point(collection);
          page.press(collection, "collection");
          await page.until(
            "four papers",
            () => el.querySelectorAll("[data-query-item-row]").length === 4,
            10000,
          );
          await leaf.view.query.settled;
          return {
            treeShown,
            heading:
              el.querySelector("[data-library-heading]")?.textContent ?? "",
            rows: el.querySelectorAll("[data-query-item-row]").length,
          };
        },
        { name: COLLECTION.name, showTree: m.library_view_show_tree() },
        STEP,
      );
      const saved = await obRun(
        walk.vaultId,
        async ({ app, page }, { folder: folderName, file }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const saveAs = await page.stands(
            leaf.view.contentEl.querySelector<HTMLElement>(
              "[data-query-save-as]",
            ),
            "Save as query file",
          );
          await pointer?.point(saveAs);
          page.press(saveAs, "Save as query file");
          const modal = await page.until(
            "save dialog",
            () =>
              document.querySelector<HTMLElement>(".zt-save-query-file-modal"),
            5000,
          );
          const name = modal.querySelector<HTMLInputElement>(
            '[data-save-field="name"]',
          )!.value;
          const folder = modal.querySelector<HTMLInputElement>(
            '[data-save-field="folder"]',
          )!;
          folder.focus();
          folder.select();
          if (pointer) {
            await pointer.point(folder, { inset: 30 });
            const b = folder.getBoundingClientRect();
            await pointer.park(b.right - 20, b.top - 16);
            await pointer.keys(folderName, (ch) =>
              document.execCommand("insertText", false, ch),
            );
          } else document.execCommand("insertText", false, folderName);
          const created = await page.until("file path", () => {
            const t = modal.querySelector("[role=status]")!.textContent;
            return t.includes(file) && t;
          });
          // The camera shows the file the dialog will create.
          await pointer?.look(modal.querySelector("[role=status]")!);
          const title = modal.querySelector(".modal-title")!.textContent;
          // The folder field suggests folders as the reader types.
          const suggestions = document.querySelectorAll(
            ".suggestion-container",
          ).length;
          const save = modal.querySelector<HTMLElement>(".mod-cta")!;
          await pointer?.point(save);
          page.press(save, "Save");
          await page.until(
            "file open",
            () => app.workspace.getActiveFile()?.path === file,
            10000,
          );
          if (pointer) {
            await new Promise((r) => setTimeout(r, 500));
            // The step ends on the new tab and its papers.
            const opened = app.workspace.getMostRecentLeaf()!;
            await pointer.look([
              (opened as unknown as { tabHeaderEl: HTMLElement }).tabHeaderEl,
              ...opened.view.containerEl.querySelectorAll(
                "[data-query-papers-row]",
              ),
            ]);
          }
          return {
            title,
            name,
            created,
            suggestions,
            active: app.workspace.getActiveFile()?.path ?? null,
          };
        },
        { folder: FOLDER, file: FILE },
        STEP,
      );
      return { shown, saved };
    });
    console.log("[walk] collection", JSON.stringify(shown));
    expect(shown.treeShown).toBe(true);
    expect(shown.heading).toContain(COLLECTION.name);
    expect(shown.rows).toBe(4);
    console.log("[walk] saved", JSON.stringify(saved));
    // The dialog offers the collection's name, so only the folder changes.
    expect(saved).toMatchObject({
      title: m.annot_view_save_title(),
      name: COLLECTION.name,
      created: m.annot_view_save_file({ file: FILE }),
      active: FILE,
    });
    await walk.capture("step-1");
    await walk.compose("step-1");
  });

  it("step 2: select Views, Configure view, and set Layout to Table; the papers as rows", async () => {
    await walk.record("step-2", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { file }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find(
              (l) => (l.view as QueryFileView).file?.path === file,
            ) as TableLeaf;
          const view = leaf.view;
          const el = view.contentEl;
          await view.query.settled;
          const menu = await page.stands(
            el.querySelector<HTMLElement>("[data-query-view-menu]"),
            "Views",
          );
          await pointer?.point(menu);
          page.press(menu, "Views");
          const configure = await page.until("Configure view", () =>
            document.querySelector<HTMLElement>(
              "[data-query-view-list] [data-query-view-configure]",
            ),
          );
          await pointer?.point(configure);
          page.press(configure, "Configure view");
          const select = await page.until("Layout", () =>
            document.querySelector<HTMLSelectElement>(
              "[data-query-view-list] [data-chooser-page] [data-query-view-layout]",
            ),
          );
          await pointer?.point(select);
          await page.pick(select, "table", "Layout");
          await page.until(
            "Table",
            () => el.querySelector('[data-query-table-row="item"]'),
            10000,
          );
          if (pointer) await new Promise((r) => setTimeout(r, 700));
          page.closePopovers(document);
          await page.until(
            "Views closed",
            () => !document.querySelector("[data-query-view-list]"),
          );
          await view.query.settled;
          // The step ends on the table.
          const table = el.querySelector("table");
          if (table) await pointer?.look(table);
        },
        { file: FILE },
        STEP,
      ),
    );
    const table = await tableWhen(
      walk.vaultId,
      "four rows",
      (t) => t.rows.length === 4,
    );
    console.log("[walk] table", JSON.stringify(table.header));
    expect(table.header).toEqual([
      "Item Type",
      m.query_view_property_title(),
      "Modified",
      m.query_view_table_literature_note(),
    ]);
    await walk.capture("step-2");
    await walk.compose("step-2");
  });

  it("step 3: select Properties, add Year, Publication, and creators, and clear Item Type and Modified; authors, year, and journal beside each title", async () => {
    const offered = await walk.record("step-3", async () => {
      await openProperties(walk.vaultId);
      await searchProperties(walk.vaultId, "year", { path: "date.year" });
      await searchProperties(walk.vaultId, "publication", {
        path: "publicationTitle",
      });
      // The menu does not list Creators: typing its name offers to add it.
      const offered = await searchProperties(walk.vaultId, "creators", {
        action: "add-property",
      });
      await searchProperties(walk.vaultId, "item type", { path: "itemType" });
      await searchProperties(walk.vaultId, "modified", {
        path: "dateModified",
      });
      await closeMenus(walk.vaultId);
      // The step ends on the columns.
      await lookAtTable(walk.vaultId);
      return offered;
    });
    expect(offered[0]).toBe(m.query_view_properties_add({ name: "creators" }));
    const table = await tableWhen(
      walk.vaultId,
      "the chosen columns",
      (t) => t.header.includes("Publication") && !t.header.includes("Modified"),
    );
    console.log("[walk] columns", JSON.stringify(table));
    // OUTLINE-MISMATCH: the authors' column reads Creators, Zotero's own
    // name for the field, not Authors.
    expect(table.header).toEqual([
      m.query_view_property_title(),
      m.query_view_table_literature_note(),
      m.query_view_property_year(),
      "Publication",
      m.query_view_property_creators(),
    ]);
    const sandve = table.cells[PAPERS.sandve.key]!.join(" | ");
    expect(sandve).toContain("Sandve");
    expect(sandve).toContain("2013");
    expect(sandve).toContain("PLOS Computational Biology");
    await walk.capture("step-3");
    await walk.compose("step-3");
  });

  it('step 4: type rating, select Add "rating" vault property, and type a rating in each cell; your ratings in a column of your own', async () => {
    const modified = () =>
      walk.zotero.json<Record<string, string>>(
        `Object.fromEntries(${JSON.stringify(Object.values(PAPERS).map((p) => p.key))}.map(k=>[k,Zotero.Items.getByLibraryAndKey(1,k).dateModified]))`,
      );
    const before = await modified();
    const { entries, added } = await walk.record("step-4", async () => {
      // The new column takes the table past the tab's width, so the reader
      // first closes both sidebars with their buttons: then every column fits
      // beside the titles. The sidebars stay closed for the rest of the lesson.
      await obRun(
        walk.vaultId,
        async ({ app, page }) => {
          const pointer = page.scratch.docsWalkPointer;
          for (const side of ["right", "left"] as const) {
            const split =
              side === "right"
                ? app.workspace.rightSplit
                : app.workspace.leftSplit;
            if (split.collapsed) continue;
            const toggle = document.querySelector<HTMLElement>(
              `.sidebar-toggle-button.mod-${side} .clickable-icon`,
            )!;
            await pointer?.point(toggle);
            await page.trusted(window).click(toggle);
            await page.until(`${side} sidebar closed`, () => split.collapsed);
            await new Promise((r) => setTimeout(r, pointer ? 500 : 100));
          }
        },
        undefined,
        STEP,
      );
      await openProperties(walk.vaultId);
      const entries = await searchProperties(walk.vaultId, PROPERTY, {
        action: "add-vault-property",
      });
      await closeMenus(walk.vaultId);
      const added = await tableWhen(
        walk.vaultId,
        "the rating column",
        (t) => Object.keys(t.ratings).length === 4,
      );
      for (const [paper, value] of RATINGS) {
        const key = PAPERS[paper].key;
        await obRun(
          walk.vaultId,
          async ({ app, page }, { file, key, property, value }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === file,
              ) as TableLeaf;
            await leaf.view.query.settled;
            const cell = leaf.view.contentEl
              .querySelector(
                `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${property}"]`,
              )!
              .closest("td")!;
            cell.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "instant",
            });
            await pointer?.point(cell, { inset: 20 });
            await page.trusted(window).click(cell);
            await page.until("rating field", () =>
              activeDocument.activeElement?.matches("[data-query-vault-input]"),
            );
            await new Promise((r) => setTimeout(r, pointer ? 100 : 300));
            if (pointer) {
              // The pointer moves off the cell, so the rating shows.
              const b = cell.getBoundingClientRect();
              await pointer.park(b.right + 30, b.bottom + 20);
            }
            (require("@electron/remote") as Remote)
              .getCurrentWebContents()
              .insertText(value);
            await new Promise((r) => setTimeout(r, 300));
            await page.trusted(window).key("Enter");
          },
          { file: FILE, key, property: PROPERTY, value },
          STEP,
        );
        await tableWhen(
          walk.vaultId,
          `${paper} rated ${value}`,
          (t) => t.ratings[key] === value,
        );
      }
      // The step ends on the rating column.
      await lookAtTable(
        walk.vaultId,
        m.query_view_vault_property_label({ name: PROPERTY }),
      );
      return { entries, added };
    });
    expect(entries).toContain(
      m.query_view_properties_add_vault({ name: PROPERTY }),
    );
    expect(added.header).toContain(
      m.query_view_vault_property_label({ name: PROPERTY }),
    );
    // A rating is written to the notes alone: Zotero changed none of the papers.
    expect(await modified()).toEqual(before);
    const table = await tableWhen(walk.vaultId, "every rating", () => true);
    expect(table.ratings).toEqual(
      Object.fromEntries(
        RATINGS.map(([paper, value]) => [PAPERS[paper].key, value]),
      ),
    );
    // The first rating of a paper without a note creates its literature note.
    expect(await readNotices(walk.vaultId)).toContain(m.notice_created_note());
    await obRun(walk.vaultId, () => {
      (activeDocument.activeElement as HTMLElement | null)?.blur();
    });
    expect(await columnsWhole(walk.vaultId)).toEqual({
      title: true,
      rating: true,
    });
    await walk.capture("step-4");
    await walk.compose("step-4");
  });

  it("step 5: select Sort, Add sort, and choose Date, old to new; the papers in order of year", async () => {
    const sorted = await walk.record("step-5", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { file, titleLabel, yearLabel }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find(
              (l) => (l.view as QueryFileView).file?.path === file,
            ) as TableLeaf;
          const el = leaf.view.contentEl;
          const name =
            el
              .querySelector('[data-query-toolbar="sort"]')
              ?.getAttribute("aria-label") ?? null;
          await pointer?.point(
            el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!,
          );
          const popup = await page.openToolbarPopover(el, "sort");
          const add = await page.until("Add sort", () =>
            popup.querySelector<HTMLElement>("[data-sort-add]"),
          );
          await pointer?.point(add);
          page.press(add, "Add sort");
          const property = await page.until("Sort by", () =>
            popup.querySelector<HTMLButtonElement | HTMLSelectElement>(
              "[data-sort-property]",
            ),
          );
          await pointer?.point(property);
          await page.pick(property, "date", "Sort by");
          const direction = await page.until("direction", () =>
            popup.querySelector<HTMLSelectElement>("[data-sort-direction]"),
          );
          const names = [...direction.options].map((o) => o.text);
          await pointer?.point(direction);
          await page.pick(direction, "ASC", "direction");
          await new Promise((r) => setTimeout(r, pointer ? 900 : 300));
          const shown = popup.querySelector<HTMLElement>(
            "[data-sort-property]",
          );
          const by =
            shown instanceof HTMLSelectElement
              ? (shown.selectedOptions[0]?.text ?? "")
              : (shown?.innerText.trim() ?? "");
          await page.closeToolbarPopover(el, "sort");
          // The step ends on the titles and years in their new order.
          const heads = [...el.querySelectorAll<HTMLTableCellElement>("th")];
          const columns = heads.filter((th) =>
            [titleLabel, yearLabel].includes(th.textContent.trim()),
          );
          await pointer?.look(
            columns.flatMap((head) => [
              head,
              ...[...el.querySelectorAll<HTMLTableRowElement>("tbody tr")].map(
                (row) => row.cells[head.cellIndex]!,
              ),
            ]),
          );
          return { name, names, by };
        },
        {
          file: FILE,
          titleLabel: m.query_view_property_title(),
          yearLabel: m.query_view_property_year(),
        },
        STEP,
      ),
    );
    console.log("[walk] sort", JSON.stringify(sorted));
    expect(sorted.name).toBe(m.query_view_sort());
    expect(sorted.by).toBe("Date");
    expect(sorted.names).toEqual([
      m.query_view_sort_old_new(),
      m.query_view_sort_new_old(),
    ]);
    const table = await tableWhen(
      walk.vaultId,
      "the papers by year",
      (t) => t.rows[0] === PAPERS.ioannidis.key,
    );
    expect(table.rows).toEqual([
      PAPERS.ioannidis.key,
      PAPERS.sandve.key,
      PAPERS.wilson.key,
      PAPERS.munafo.key,
    ]);
    expect(await columnsWhole(walk.vaultId)).toEqual({
      title: true,
      rating: true,
    });
    await walk.capture("step-5");
    await walk.compose("step-5");
  });

  it("step 6: select the result count, choose Copy to clipboard, and paste into your draft; the table in your chapter", async () => {
    const { copied, pasted } = await walk.record("step-6", async () => {
      const copied = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, copy, copiedNotice }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find(
              (l) => (l.view as QueryFileView).file?.path === file,
            ) as TableLeaf;
          const el = leaf.view.contentEl;
          const count = el.querySelector<HTMLElement>("[data-query-results]")!;
          const label = count.innerText.trim();
          await pointer?.point(count);
          page.press(count, "result count");
          const popup = await page.until("Results menu", () =>
            document.querySelector<HTMLElement>("[data-query-results-popup]"),
          );
          const item = await page.until("Copy to clipboard", () =>
            [
              ...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]"),
            ].find((b) => b.textContent.includes(copy)),
          );
          const menu = [
            ...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]"),
          ]
            .map((b) => b.textContent.trim())
            .filter(Boolean);
          await pointer?.point(item, { inset: 40 });
          page.press(item, "Copy to clipboard");
          await page.until(
            "copied",
            () => page.scratch.docsWalkNotices!.includes(copiedNotice),
            5000,
          );
          const { clipboard } = require("electron") as {
            clipboard: Clipboard;
          };
          return {
            label,
            menu,
            text: clipboard.readText(),
            html: clipboard.readHTML(),
          };
        },
        {
          file: FILE,
          copy: m.query_view_copy(),
          copiedNotice: m.query_view_copied(),
        },
        STEP,
      );
      // Pasted into the draft, the copy becomes a Markdown table.
      const pasted = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace.getLeaf("tab") as DraftLeaf;
          await leaf.openFile(app.vault.getFileByPath(draftPath)!);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const editor = leaf.view.editor;
          editor.focus();
          const at = editor.getValue().indexOf("## Notes to self");
          editor.setCursor(editor.offsetToPos(at));
          editor.replaceSelection(
            "## 3.3 The papers behind the method\n\n\n\n",
          );
          editor.setCursor(
            editor.offsetToPos(
              at + "## 3.3 The papers behind the method\n\n".length,
            ),
          );
          await new Promise((r) => setTimeout(r, pointer ? 900 : 300));
          const { clipboard } = require("electron") as {
            clipboard: Clipboard;
          };
          const data = new DataTransfer();
          data.setData("text/html", clipboard.readHTML());
          data.setData("text/plain", clipboard.readText());
          leaf.view.contentEl.querySelector(".cm-content")!.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => setTimeout(r, 1000));
          await leaf.view.save();
          const heading = [
            ...leaf.view.contentEl.querySelectorAll<HTMLElement>(".cm-line"),
          ].find((n) => n.textContent.startsWith("3.3"));
          heading?.scrollIntoView({ block: "start", behavior: "instant" });
          editor.setCursor({ line: 0, ch: 0 });
          await new Promise((r) => setTimeout(r, 500));
          // The step ends on the heading and the pasted table.
          const table = leaf.view.contentEl.querySelector("table");
          await pointer?.look(
            [heading, table].filter((e) => e !== null && e !== undefined),
          );
          return app.vault.read(leaf.view.file!);
        },
        { draftPath: DRAFT },
        STEP,
      );
      return { copied, pasted };
    });
    console.log("[walk] copied", JSON.stringify(copied));
    expect(copied.label).toContain("4");
    expect(copied.menu).toContain(m.query_view_copy());
    // Obsidian may pad the cells; the walk reads the table without the padding.
    const rows = pasted
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => line.replaceAll(/ *\| */g, "|"));
    console.log("[walk] pasted", JSON.stringify(rows));
    expect(rows[0]).toBe(
      `|Title|Year|Publication|Creators|${m.query_view_vault_property_label({ name: PROPERTY })}|`,
    );
    expect(rows).toContain(
      "|Why Most Published Research Findings Are False|2005|PLoS Medicine|John P. A. Ioannidis|5|",
    );
    // The header, its rule, and one row for each paper.
    expect(rows).toHaveLength(6);
    expect(pasted.indexOf("\n|")).toBeGreaterThan(
      pasted.indexOf("## 3.3 The papers behind the method"),
    );
    expect(pasted.indexOf("\n|")).toBeLessThan(
      pasted.indexOf("## Notes to self"),
    );
    await walk.capture("step-6");
    await walk.compose("step-6");
  });
});

/** Closes the open toolbar menus, as a press outside them does. */
async function closeMenus(vaultId: string): Promise<void> {
  await obRun(vaultId, async ({ page }) => {
    page.closePopovers(document);
    if (page.scratch.docsWalkPointer)
      await new Promise((r) => setTimeout(r, 600));
  });
}
