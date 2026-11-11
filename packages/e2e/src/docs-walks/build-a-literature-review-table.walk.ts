// The walk of the lesson apps/docs/content/docs/organize-your-research/
// build-a-literature-review-table.mdx: a researcher writing a literature
// review saves one Zotero collection as a table, picks its columns, rates
// each paper in a column of their own, sorts the papers by year, puts the
// table in their chapter draft, sees it follow the collection, copies it into
// the draft and exports it as CSV, groups it by theme, and recovers when a
// renamed collection empties it. Each `it` is one step of the page, in the
// page's order, and asserts what the page says the reader sees. Run it with
// `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type { MarkdownView, WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";
import type { QueryFileView } from "@/views/query-view/file-view";

import { openDocsWalk, readNotices, watchNotices } from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

/** The Reproducibility collection of the docs Vault Case, and its papers. */
const COLLECTION = { key: "DCRPRDCB", name: "Reproducibility" };
const PAPERS = {
  ioannidis: { key: "DMIANART", citekey: "ioannidis2005", year: "2005" },
  sandve: { key: "DCSNDART", citekey: "sandve2013", year: "2013" },
  wilson: { key: "DCWLSART", citekey: "wilson2014", year: "2014" },
  munafo: { key: "DCMNFART", citekey: "munafo2017", year: "2017" },
};
/** The paper the reader files in the collection later, in Zotero. */
const ROUGIER = {
  key: "DMRGRART",
  title: "Ten Simple Rules for Better Figures",
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
const RATING_NAME = "My rating";
/** The columns of the finished table, as its header reads them. */
const COLUMNS = [
  m.query_view_property_title(),
  m.query_view_table_literature_note(),
  m.query_view_property_creators(),
  m.query_view_property_year(),
  "Publication",
  RATING_NAME,
];
const RENAMED = "Reproducible research";

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
/** The table's Query File tab. */
type TableLeaf = WorkspaceLeaf & { view: QueryFileView };
type DraftLeaf = WorkspaceLeaf & { view: MarkdownView };

/** The table in its tab: its header, its rows by key, and each rating cell. */
interface Table {
  header: string[];
  rows: string[];
  ratings: Record<string, string>;
  groups: string[];
  empty: boolean;
}

/** The text a Results menu copy put on the clipboard. */
interface Clipboard {
  readText(): string;
  readHTML(): string;
}
/** The window's Electron remote, for focus, typing, and trusted clicks. */
interface Remote {
  getCurrentWindow(): { focus(): void };
  getCurrentWebContents(): {
    insertText(text: string): void;
    sendInputEvent(event: object): void;
  };
}

/** The table in its tab once `ready` holds. */
function tableWhen(
  vaultId: string,
  what: string,
  ready: (table: Table) => boolean,
): Promise<Table> {
  return obRunUntil(
    vaultId,
    async ({ app }, { file, property, noResults }): Promise<Table | null> => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find((l) => (l.view as QueryFileView).file?.path === file) as
        | TableLeaf
        | undefined;
      const view = leaf?.view;
      if (!view) return null;
      const el = view.contentEl;
      await view.query.settled;
      return {
        header: [...el.querySelectorAll("th")]
          .map((n) => n.textContent)
          .filter(Boolean),
        rows: [...el.querySelectorAll('[data-query-table-row="item"]')].map(
          (n) => n.getAttribute("data-query-key")!,
        ),
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
        groups: [
          ...el.querySelectorAll(
            "[data-query-table] tbody tr:not([data-query-table-row])",
          ),
        ]
          .map((n) => n.textContent.trim())
          .filter(Boolean),
        empty: el.textContent.includes(noResults),
      };
    },
    {
      file: FILE,
      property: PROPERTY,
      noResults: m.query_view_no_results_items(),
    },
    { what, ready: (table) => table !== null && ready(table) },
  ) as Promise<Table>;
}

/** Show or hide the property `path` in the Properties menu, found by `search`. */
async function toggleProperty(
  vaultId: string,
  search: string,
  path: string,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ page }, { search, path }) => {
      const popup = [
        ...document.querySelectorAll<HTMLElement>("[popover]:popover-open"),
      ].pop()!;
      const input = popup.querySelector("input")!;
      input.focus();
      input.select();
      document.execCommand("insertText", false, search);
      page.press(
        await page.until(path, () =>
          popup.querySelector<HTMLElement>(`[data-query-property="${path}"]`),
        ),
        path,
      );
      await new Promise((r) => setTimeout(r, 300));
    },
    { search, path },
  );
}

/**
 * The reader clicks the empty space under the table: the last cell they
 * typed in stays outlined until then.
 */
async function letGo(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app }, { file }) => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find((l) => (l.view as QueryFileView).file?.path === file) as
        | TableLeaf
        | undefined;
      const el = leaf!.view.contentEl;
      (activeDocument.activeElement as HTMLElement | null)?.blur();
      const r = el.getBoundingClientRect();
      const zoom = (
        require("electron") as typeof import("electron")
      ).webFrame.getZoomFactor();
      const at = {
        x: Math.round((r.left + r.width / 2) * zoom),
        y: Math.round((r.bottom - 12) * zoom),
        button: "left",
        clickCount: 1,
      };
      const up = new Promise((res) =>
        window.addEventListener("mouseup", res, { once: true, capture: true }),
      );
      const win: Window = window;
      const c = (
        win as Window & {
          electronWindow: {
            webContents: { sendInputEvent(event: object): void };
          };
        }
      ).electronWindow.webContents;
      c.sendInputEvent({ type: "mouseDown", ...at });
      c.sendInputEvent({ type: "mouseUp", ...at });
      await up;
      await new Promise((res) => setTimeout(res, 200));
      return !el
        .querySelector("[data-query-vault-cell]")
        ?.closest("td")
        ?.matches(":focus-within");
    },
    { file: FILE },
  );
}

/** Presses the Results menu of the table and waits for its item `label`. */
async function openResultsMenu(vaultId: string, label: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { file, label }) => {
      const leaf = app.workspace
        .getLeavesOfType("zotlit-query-file")
        .find((l) => (l.view as QueryFileView).file?.path === file) as
        | TableLeaf
        | undefined;
      const el = leaf!.view.contentEl;
      page.press(
        el.querySelector<HTMLElement>("[data-query-results]"),
        "results",
      );
      const item = (popup: ParentNode, label: string) =>
        [...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]")].find(
          (b) => b.textContent.includes(label),
        );
      const top = () =>
        [
          ...document.querySelectorAll<HTMLElement>("[popover]:popover-open"),
        ].pop();
      await page.until(
        "Results menu",
        () => item(top() ?? document.body, label) && top(),
      );
    },
    { file: FILE, label },
  );
}

describe.skipIf(!reachable)(
  "Build a literature review table from a Zotero collection",
  () => {
    let walk: DocsWalk;

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: "build-a-literature-review-table",
        collection: "organize-your-research/build-a-literature-review-table",
        vaultCase: "docs",
      });
      await watchNotices(walk.vaultId);
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("opens the collection in the Library View and saves it as a query file", async () => {
      const shown = await obRun(
        walk.vaultId,
        async ({ app, page }, { name, showTree }) => {
          app.commands.executeCommandById("zotlit:open-library-view");
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          await app.workspace.revealLeaf(leaf);
          await leaf.view.query.settled;
          // The lesson's reader has finished setup and put the welcome banner away.
          const dismiss = el.querySelector<HTMLElement>(
            "[data-welcome-dismiss]",
          );
          if (dismiss) {
            page.press(dismiss, "Dismiss");
            await page.until(
              "banner gone",
              () => !el.querySelector("[data-welcome-banner]"),
            );
          }
          const label = () =>
            [...el.querySelectorAll<HTMLElement>("[data-library-label]")].find(
              (n) => n.textContent === name,
            );
          if (!label()?.checkVisibility())
            page.press(
              [...el.querySelectorAll("button")].find(
                (b) => b.getAttribute("aria-label") === showTree,
              ),
              "Show libraries and collections",
            );
          page.press(
            await page.until(
              "the collection",
              () => label()?.checkVisibility() && label(),
              20000,
            ),
            "collection",
          );
          await page.until(
            "four papers",
            () => el.querySelectorAll("[data-query-item-row]").length === 4,
            10000,
          );
          await leaf.view.query.settled;
          return {
            heading:
              el.querySelector("[data-library-heading]")?.textContent ?? "",
            rows: el.querySelectorAll("[data-query-item-row]").length,
          };
        },
        { name: COLLECTION.name, showTree: m.library_view_show_tree() },
      );
      expect(shown.heading).toContain(COLLECTION.name);
      expect(shown.rows).toBe(4);
      const saved = await obRun(
        walk.vaultId,
        async ({ app, page }, { folder: folderName, file }) => {
          {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const el = leaf.view.contentEl;
            page.press(
              el.querySelector<HTMLElement>("[data-query-save-as]"),
              "Save as query file",
            );
          }
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
          document.execCommand("insertText", false, folderName);
          const created = await page.until("file path", () => {
            const t = modal.querySelector("[role=status]")!.textContent;
            return t.includes(file) && t;
          });
          const title = modal.querySelector(".modal-title")!.textContent;
          // The folder field suggests folders; the reader closes the list first.
          for (const s of document.querySelectorAll(".suggestion-container"))
            s.remove();
          page.press(modal.querySelector<HTMLElement>(".mod-cta"), "Save");
          await page.until(
            "file open",
            () => app.workspace.getActiveFile()?.path === file,
            10000,
          );
          return {
            title,
            name,
            created,
            active: app.workspace.getActiveFile()?.path ?? null,
          };
        },
        { folder: FOLDER, file: FILE },
      );
      // The dialog offers the collection's name, so only the folder changes.
      expect(saved).toEqual({
        title: m.annot_view_save_title(),
        name: COLLECTION.name,
        created: m.annot_view_save_file({ file: FILE }),
        active: FILE,
      });
    });

    it("switches the view to the Table layout", async () => {
      const header = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, views }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const view = leaf!.view;
          const el = view.contentEl;
          await view.query.settled;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === views,
            ),
            "Views",
          );
          page.press(
            await page.until("Configure view", () =>
              document.querySelector<HTMLElement>(
                "[popover]:popover-open [data-query-view-configure]",
              ),
            ),
            "Configure view",
          );
          const select = await page.until("Layout", () =>
            document.querySelector<HTMLButtonElement | HTMLSelectElement>(
              "[popover]:popover-open [data-query-view-layout]",
            ),
          );
          await page.pick(select, "table", "Layout");
          await page.until(
            "Table",
            () => el.querySelector('[data-query-table-row="item"]'),
            10000,
          );
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
          // The reader closes both sidebars to give the table room.
          app.workspace.leftSplit.collapse();
          app.workspace.rightSplit.collapse();
          await page.until(
            "sidebars closed",
            () =>
              [app.workspace.leftSplit, app.workspace.rightSplit].every((s) => {
                const { containerEl } = s as typeof s & {
                  containerEl: HTMLElement;
                };
                return (
                  containerEl.getBoundingClientRect().width < 1 &&
                  containerEl.getAnimations({ subtree: true }).length === 0
                );
              }),
            5000,
          );
          await new Promise((r) => setTimeout(r, 300));
          await view.query.settled;
          return [...el.querySelectorAll("th")]
            .map((n) => n.textContent)
            .filter(Boolean);
        },
        { file: FILE, views: m.query_view_views() },
      );
      // Zotero's own field names head the Zotero columns.
      expect(header).toEqual([
        "Item Type",
        m.query_view_property_title(),
        "Modified",
        m.query_view_table_literature_note(),
      ]);
    });

    it("chooses the columns for the comparison", async () => {
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, properties }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === properties,
            ),
            "Properties",
          );
          await page.until("Properties menu", () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ]
              .pop()
              ?.querySelector("input"),
          );
        },
        { file: FILE, properties: m.query_view_properties() },
      );
      // Clear the two columns a review needs least.
      await toggleProperty(walk.vaultId, "item type", "itemType");
      await toggleProperty(walk.vaultId, "modified", "dateModified");
      // The menu does not list Creators: typing its name offers to add it.
      const offered = await obRun(walk.vaultId, async ({ page }) => {
        const popup = [
          ...document.querySelectorAll<HTMLElement>("[popover]:popover-open"),
        ].pop()!;
        const input = popup.querySelector("input")!;
        input.focus();
        input.select();
        document.execCommand("insertText", false, "creators");
        await page.until("add entry", () =>
          popup.querySelector('[data-query-properties-action="add-property"]'),
        );
        return [...popup.querySelectorAll("[role=option]")].map(
          (o) => o.textContent,
        );
      });
      expect(offered[0]).toBe(
        m.query_view_properties_add({ name: "creators" }),
      );
      await obRun(walk.vaultId, async ({ page }) => {
        page.press(
          [...document.querySelectorAll<HTMLElement>("[popover]:popover-open")]
            .pop()!
            .querySelector<HTMLElement>(
              '[data-query-properties-action="add-property"]',
            ),
          "Add creators",
        );
        await new Promise((r) => setTimeout(r, 300));
      });
      await toggleProperty(walk.vaultId, "year", "date.year");
      await toggleProperty(walk.vaultId, "publication", "publicationTitle");
      // The Properties menu over the table, its search cleared, for the image.
      await obRun(walk.vaultId, async () => {
        const popup = [
          ...document.querySelectorAll<HTMLElement>("[popover]:popover-open"),
        ].pop()!;
        const input = popup.querySelector("input")!;
        input.focus();
        input.select();
        document.execCommand("delete");
        await new Promise((r) => setTimeout(r, 300));
        input.blur();
      });
      await walk.capture("columns");
      await walk.compose("columns");
      await obRun(walk.vaultId, () => {
        for (const p of document.querySelectorAll<HTMLElement>(
          "[popover]:popover-open",
        ))
          p.hidePopover();
      });
      const table = await tableWhen(walk.vaultId, "the chosen columns", (t) =>
        t.header.includes("Publication"),
      );
      expect(table.header).toEqual([
        m.query_view_property_title(),
        m.query_view_table_literature_note(),
        m.query_view_property_creators(),
        m.query_view_property_year(),
        "Publication",
      ]);
    });

    it("adds a rating column of the reader's own and rates each paper", async () => {
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, properties, property }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === properties,
            ),
            "Properties",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Properties menu",
            () => top()?.querySelector("input") && top(),
          );
          const input = popup.querySelector("input")!;
          input.focus();
          document.execCommand("insertText", false, property);
          page.press(
            await page.until("add vault property", () =>
              popup.querySelector<HTMLElement>(
                '[data-query-properties-action="add-vault-property"]',
              ),
            ),
            "Add vault property",
          );
          await new Promise((r) => setTimeout(r, 300));
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
        },
        {
          file: FILE,
          properties: m.query_view_properties(),
          property: PROPERTY,
        },
      );
      const added = await tableWhen(
        walk.vaultId,
        "the rating column",
        (t) => Object.keys(t.ratings).length === 4,
      );
      expect(added.header).toContain(
        m.query_view_vault_property_label({ name: PROPERTY }),
      );
      expect(new Set(Object.values(added.ratings))).toEqual(
        new Set([m.query_view_vault_no_note()]),
      );
      const modified = () =>
        walk.zotero.json<Record<string, string>>(
          `Object.fromEntries(${JSON.stringify(Object.values(PAPERS).map((p) => p.key))}.map(k=>[k,Zotero.Items.getByLibraryAndKey(1,k).dateModified]))`,
        );
      const before = await modified();
      for (const [paper, value] of RATINGS) await rate(paper, value);
      // A rating is written to the notes alone: Zotero changed none of the papers.
      expect(await modified()).toEqual(before);
      // The first rating of each paper creates its literature note.
      const notes = await obRun(
        walk.vaultId,
        ({ app }, { citekeys, property }) =>
          Object.fromEntries(
            citekeys.map((c) => [
              c,
              (app.metadataCache.getCache(`literatures/${c}.md`)?.frontmatter?.[
                property
              ] ?? null) as string | number | null,
            ]),
          ),
        {
          citekeys: Object.values(PAPERS).map((p) => p.citekey),
          property: PROPERTY,
        },
      );
      expect(notes).toEqual(
        Object.fromEntries(
          RATINGS.map(([paper, value]) => [PAPERS[paper].citekey, value]),
        ),
      );
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_created_note(),
      );
      // The reader gives the column a plain name.
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, properties, property, ratingName }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          (activeDocument.activeElement as HTMLElement | null)?.blur();
          // The reader waits for the notices to go; the walk takes them away.
          for (const n of document.querySelectorAll(".notice")) n.remove();
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === properties,
            ),
            "Properties",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const more = `[data-query-property-more="vault.${property}"]`;
          const popup = await page.until(
            "Properties menu",
            () => top()?.querySelector(more) && top(),
          );
          page.press(popup.querySelector<HTMLElement>(more), "Edit property");
          const field = await page.until("Display name", () =>
            top()?.querySelector<HTMLElement>("[data-query-display-name]"),
          );
          field.focus();
          document.execCommand("insertText", false, ratingName);
          await new Promise((r) => setTimeout(r, 300));
          await page.trusted(window).key("Enter");
          await new Promise((r) => setTimeout(r, 300));
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
        },
        {
          file: FILE,
          properties: m.query_view_properties(),
          property: PROPERTY,
          ratingName: RATING_NAME,
        },
      );
      const renamed = await tableWhen(walk.vaultId, "the renamed column", (t) =>
        t.header.includes(RATING_NAME),
      );
      expect(renamed.header).toEqual(COLUMNS);
    });

    it("sorts the papers by year, oldest first", async () => {
      const directions = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, sort }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === sort,
            ),
            "Sort",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Sort menu",
            () => top()?.querySelector("[data-sort-add]") && top(),
          );
          page.press(
            popup.querySelector<HTMLElement>("[data-sort-add]"),
            "Add sort",
          );
          const property = await page.until("Sort by", () =>
            popup.querySelector<HTMLButtonElement | HTMLSelectElement>(
              "[data-sort-property]",
            ),
          );
          await page.pick(property, "date", "Sort by");
          const direction = popup.querySelector<HTMLSelectElement>(
            "[data-sort-direction]",
          )!;
          const names = [...direction.options].map((o) => o.text);
          await page.pick(direction, "ASC", "direction");
          await new Promise((r) => setTimeout(r, 300));
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
          return names;
        },
        { file: FILE, sort: m.query_view_sort() },
      );
      expect(directions).toEqual([
        m.query_view_sort_old_new(),
        m.query_view_sort_new_old(),
      ]);
      const sorted = await tableWhen(
        walk.vaultId,
        "the papers by year",
        (t) => t.rows[0] === PAPERS.ioannidis.key,
      );
      expect(sorted.rows).toEqual([
        PAPERS.ioannidis.key,
        PAPERS.sandve.key,
        PAPERS.wilson.key,
        PAPERS.munafo.key,
      ]);
      // The reader lets go of the last rating cell they typed in.
      await letGo(walk.vaultId);
      await walk.capture("table");
      await walk.compose("table");
    });

    it("puts the table in the chapter draft, where it shows the same view", async () => {
      const embed = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, section }) => {
          const file = app.vault.getFileByPath(draftPath)!;
          const leaf = app.workspace.getLeaf("tab") as DraftLeaf;
          await leaf.openFile(file);
          const editor = leaf.view.editor;
          const at = editor.getValue().indexOf("## Notes to self");
          editor.replaceRange(section, editor.offsetToPos(at));
          await leaf.view.save();
          const el = leaf.view.contentEl;
          const table = await page.until(
            "embedded table",
            () =>
              el.querySelectorAll(
                '.internal-embed [data-query-table-row="item"]',
              ).length === 4 && el.querySelector(".internal-embed"),
            20000,
          );
          editor.setCursor(editor.lastLine(), 0);
          const heading = [
            ...el.querySelectorAll<HTMLElement>(".cm-line"),
          ].find((n) => n.textContent.startsWith("3.3"))!;
          heading.scrollIntoView({ block: "start", behavior: "instant" });
          await new Promise((r) => setTimeout(r, 500));
          return {
            header: [...table.querySelectorAll("th")]
              .map((n) => n.textContent)
              .filter(Boolean),
            rows: [
              ...table.querySelectorAll('[data-query-table-row="item"]'),
            ].map((n) => n.getAttribute("data-query-key")!),
          };
        },
        {
          draftPath: DRAFT,
          section: `## 3.3 The papers behind the method\n\n![[${COLLECTION.name}.zotquery]]\n\n`,
        },
      );
      expect(embed.header).toEqual(COLUMNS);
      expect(embed.rows[0]).toBe(PAPERS.ioannidis.key);
      await walk.capture("embed");
      await walk.compose("embed");
    });

    it("follows the collection when a paper joins it in Zotero", async () => {
      await walk.zotero
        .json(`(async()=>{const c=Zotero.Collections.getByLibraryAndKey(1,${JSON.stringify(COLLECTION.key)});
      const item=Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(ROUGIER.key)});item.addToCollection(c.key);await item.saveTx();return true;})()`);
      // The reader goes back to the table's tab.
      await obRun(
        walk.vaultId,
        ({ app }, { file }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
        },
        { file: FILE },
      );
      const grown = await tableWhen(walk.vaultId, "the new paper", (t) =>
        t.rows.includes(ROUGIER.key),
      );
      expect(grown.rows).toHaveLength(5);
      // Rougier 2014 sorts between Wilson 2014 and Munafò 2017 or beside Wilson.
      expect(grown.rows.at(-1)).toBe(PAPERS.munafo.key);
      expect(grown.ratings[ROUGIER.key]).toBe(m.query_view_vault_no_note());
    });

    it("copies the table into the draft as a Markdown table", async () => {
      const copied = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, copy, copiedNotice }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          (require("@electron/remote") as Remote).getCurrentWindow().focus();
          window.focus();
          page.press(
            el.querySelector<HTMLElement>("[data-query-results]"),
            "results",
          );
          const item = (popup: ParentNode, label: string) =>
            [
              ...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]"),
            ].find((b) => b.textContent.includes(label));
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Results menu",
            () => item(top() ?? document.body, copy) && top(),
          );
          const menu = [
            ...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]"),
          ]
            .map((b) => b.textContent.trim())
            .filter(Boolean);
          page.press(item(popup, copy), "Copy");
          await page.until(
            "copied",
            () => page.scratch.docsWalkNotices!.includes(copiedNotice),
            5000,
          );
          const { clipboard } = require("electron") as {
            clipboard: Clipboard;
          };
          return {
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
      );
      expect(copied.menu).toEqual(
        expect.arrayContaining([
          m.query_view_copy(),
          m.query_view_export_csv(),
        ]),
      );
      const lines = copied.text.trim().split("\n");
      // The Literature note column stays out; the reader's rating goes in.
      expect(lines[0]).toBe(
        COLUMNS.filter((c) => c !== m.query_view_table_literature_note()).join(
          "\t",
        ),
      );
      expect(lines).toHaveLength(6);
      // The copy holds a table for a word processor as well.
      expect(copied.html).toContain(`<th>${RATING_NAME}</th>`);
      // Pasted into the draft, the copy becomes a Markdown table.
      const pasted = await obRun(
        walk.vaultId,
        async ({ app }, { draftPath }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const editor = leaf.view.editor;
          editor.focus();
          const last = editor.lastLine();
          editor.setCursor(last, editor.getLine(last).length);
          editor.replaceSelection("\n\n");
          await new Promise((r) => setTimeout(r, 300));
          // A paste gesture, with what the clipboard holds now: webContents.paste()
          // in the shared app pasted an older clipboard in trial runs.
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
          return app.vault.read(leaf.view.file!);
        },
        { draftPath: DRAFT },
      );
      // Obsidian may pad the cells; the walk reads the table without the padding.
      const rows = pasted
        .split("\n")
        .filter((line) => line.startsWith("|"))
        .map((line) => line.replaceAll(/ *\| */g, "|"));
      expect(rows[0]).toBe("|Title|Creators|Year|Publication|My rating|");
      expect(rows).toContain(
        "|Why Most Published Research Findings Are False|John P. A. Ioannidis|2005|PLoS Medicine|5|",
      );
      expect(rows).toHaveLength(7);
    });

    it("exports the same table as a CSV file named after the view", async () => {
      // The walk keeps the file the browser would save; no save dialog opens.
      const csv = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, exportCsv }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await page.until("table shown", () =>
            el.querySelector("[data-query-results]")?.checkVisibility(),
          );
          const saved: { blob?: Blob; name?: string } = {};
          // The originals go back in place as they were, unbound.
          // oxlint-disable-next-line typescript/unbound-method
          const create = URL.createObjectURL;
          // oxlint-disable-next-line typescript/unbound-method
          const click = HTMLAnchorElement.prototype.click;
          URL.createObjectURL = (blob: Blob | MediaSource) => {
            saved.blob = blob as Blob;
            return create.call(URL, blob);
          };
          HTMLAnchorElement.prototype.click = function (
            this: HTMLAnchorElement,
          ) {
            if (this.download) {
              saved.name = this.download;
              return;
            }
            return click.call(this);
          };
          try {
            page.press(
              el.querySelector<HTMLElement>("[data-query-results]"),
              "results",
            );
            const item = (popup: ParentNode, label: string) =>
              [
                ...popup.querySelectorAll<HTMLElement>(
                  "button,[role=menuitem]",
                ),
              ].find((b) => b.textContent.includes(label));
            const top = () =>
              [
                ...document.querySelectorAll<HTMLElement>(
                  "[popover]:popover-open",
                ),
              ].pop();
            const popup = await page.until(
              "Results menu",
              () => item(top() ?? document.body, exportCsv) && top(),
            );
            page.press(item(popup, exportCsv), "Export CSV");
            await page.until("CSV", () => saved.name && saved.blob, 5000);
          } finally {
            URL.createObjectURL = create;
            HTMLAnchorElement.prototype.click = click;
          }
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
          return {
            name: saved.name!,
            text: await saved.blob!.text(),
            start: [
              ...new Uint8Array(await saved.blob!.slice(0, 3).arrayBuffer()),
            ],
          };
        },
        { file: FILE, exportCsv: m.query_view_export_csv() },
      );
      expect(csv.name).toBe(`${m.library_view_papers_view_name()}.csv`);
      expect(csv.text.split(/\r?\n/)[0]).toContain("My rating");
      expect(csv.text).toContain("Ten Simple Rules for Better Figures");
      // A byte order mark tells a spreadsheet the file is UTF-8, so Munafò keeps its accent.
      expect(csv.start).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("groups the papers by tag, one heading per theme", async () => {
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, group }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === group,
            ),
            "Group",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Group menu",
            () => top()?.querySelector("[data-group-property]") && top(),
          );
          await page.pick(
            popup.querySelector<HTMLButtonElement | HTMLSelectElement>(
              "[data-group-property]",
            ),
            "tags[]",
            "Group by",
          );
          await new Promise((r) => setTimeout(r, 300));
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
        },
        { file: FILE, group: m.query_view_group() },
      );
      const grouped = await tableWhen(
        walk.vaultId,
        "the groups",
        (t) => t.groups.length >= 3,
      );
      expect(grouped.groups).toEqual(
        expect.arrayContaining([
          "methodology",
          "reproducibility",
          "research-practice",
        ]),
      );
      // A paper with two tags shows under both.
      expect(
        grouped.rows.filter((key) => key === PAPERS.ioannidis.key),
      ).toHaveLength(2);
      await letGo(walk.vaultId);
      await walk.capture("grouped");
      await walk.compose("grouped");
      // A copy of the grouped table lists each paper once, without the headings.
      await openResultsMenu(walk.vaultId, m.query_view_copy());
      await watchNotices(walk.vaultId);
      const copy = await obRun(
        walk.vaultId,
        async ({ page }, { copy, copiedNotice }) => {
          const popup = [
            ...document.querySelectorAll<HTMLElement>("[popover]:popover-open"),
          ].pop()!;
          page.press(
            [
              ...popup.querySelectorAll<HTMLElement>("button,[role=menuitem]"),
            ].find((b) => b.textContent.includes(copy)),
            "Copy",
          );
          await page.until(
            "copied",
            () => page.scratch.docsWalkNotices!.includes(copiedNotice),
            5000,
          );
          return (
            require("electron") as { clipboard: Clipboard }
          ).clipboard.readText();
        },
        { copy: m.query_view_copy(), copiedNotice: m.query_view_copied() },
      );
      expect(copy.trim().split("\n")).toHaveLength(6);
      // The reader turns grouping off again.
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, group }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const el = leaf!.view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === group,
            ),
            "Group",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Group menu",
            () => top()?.querySelector("[data-group-remove]") && top(),
          );
          page.press(
            popup.querySelector<HTMLElement>("[data-group-remove]"),
            "Remove grouping",
          );
          await new Promise((r) => setTimeout(r, 300));
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
        },
        { file: FILE, group: m.query_view_group() },
      );
      await tableWhen(
        walk.vaultId,
        "one list again",
        (t) => t.groups.length === 0,
      );
    });

    it("empties when the collection is renamed in Zotero, and comes back when the filter follows", async () => {
      await walk.zotero.json(
        `(async()=>{const c=Zotero.Collections.getByLibraryAndKey(1,${JSON.stringify(COLLECTION.key)});c.name=${JSON.stringify(RENAMED)};await c.saveTx();return true;})()`,
      );
      const empty = await tableWhen(
        walk.vaultId,
        "the empty table",
        (t) => t.empty,
      );
      expect(empty.rows).toHaveLength(0);
      const fixed = await obRun(
        walk.vaultId,
        async ({ app, page }, { file, filter, name, renamed }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const view = leaf!.view;
          const el = view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === filter,
            ),
            "Filter",
          );
          const top = () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[popover]:popover-open",
              ),
            ].pop();
          const popup = await page.until(
            "Filter",
            () => top()?.querySelector('input[aria-label="Value"]') && top(),
          );
          const value = [
            ...popup.querySelectorAll<HTMLInputElement>(
              'input[aria-label="Value"]',
            ),
          ].find((i) => i.value === name)!;
          value.focus();
          value.select();
          (require("@electron/remote") as Remote)
            .getCurrentWebContents()
            .insertText(renamed);
          value.blur();
          await page.until(
            "rows back",
            () =>
              el.querySelectorAll('[data-query-table-row="item"]').length === 5,
            10000,
          );
          for (const p of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            p.hidePopover();
          return { text: await app.vault.read(view.file!) };
        },
        {
          file: FILE,
          filter: m.query_view_filter(),
          name: COLLECTION.name,
          renamed: RENAMED,
        },
      );
      expect(fixed.text).toContain(`collections.within("${RENAMED}")`);
    });

    /** Rate `paper` with `value` in its rating cell, as a reader types it. */
    async function rate(paper: keyof typeof PAPERS, value: string) {
      const key = PAPERS[paper].key;
      await obRun(
        walk.vaultId,
        async ({ app, page }, { file, key, property, value }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === file) as
            | TableLeaf
            | undefined;
          const view = leaf!.view;
          const el = view.contentEl;
          await view.query.settled;
          const cell = el
            .querySelector(
              `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${property}"]`,
            )!
            .closest("td")!;
          cell.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
          await page.trusted(window).click(cell);
          await page.until("rating field", () =>
            activeDocument.activeElement?.matches("[data-query-vault-input]"),
          );
          await new Promise((r) => setTimeout(r, 300));
          (require("@electron/remote") as Remote)
            .getCurrentWebContents()
            .insertText(value);
          await new Promise((r) => setTimeout(r, 300));
          await page.trusted(window).key("Enter");
        },
        { file: FILE, key, property: PROPERTY, value },
      );
      await tableWhen(
        walk.vaultId,
        `${paper} rated ${value}`,
        (t) => t.ratings[key] === value,
      );
    }
  },
);
