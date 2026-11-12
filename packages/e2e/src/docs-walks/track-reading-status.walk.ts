// The walk of /learn Lesson 5, "Track what you have read": a researcher with
// the Lesson 1 literature note on Sandve et al. 2013 saves the library as the
// query file Reading plan, shows it as a Table, adds a reading-status column
// of their own, marks each paper to-read, reading, or done, and filters the
// plan to the papers still to read. Each `it` is one step of the lesson, in
// the lesson's order, named after it, and asserts what the lesson says the
// reader sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see
// AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type { WorkspaceLeaf } from "obsidian";
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

const SLUG = "track-reading-status";
/** The five papers of the docs Vault Case, by Zotero key. */
const PAPERS = {
  munafo: { key: "DCMNFART", citekey: "munafo2017" },
  wilson: { key: "DCWLSART", citekey: "wilson2014" },
  sandve: { key: "DCSNDART", citekey: "sandve2013" },
  rougier: { key: "DMRGRART", citekey: "rougier2014" },
  ioannidis: { key: "DMIANART", citekey: "ioannidis2005" },
};
const PLAN = "Reading plan";
const PLAN_FILE = `${PLAN}.zotquery`;
const PROPERTY = "reading-status";
const notePath = (paper: keyof typeof PAPERS) =>
  `literatures/${PAPERS[paper].citekey}.md`;

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type PlanLeaf = WorkspaceLeaf & { view: QueryFileView };
/** The text input of the window, as a reader types. */
type Remote = {
  getCurrentWebContents(): { insertText(text: string): void };
};

interface Table {
  rows: string[];
  cells: Record<string, string>;
  header: string[];
}

const STEP = { timeoutMs: 60000 };

describe.skipIf(!reachable)("Lesson 5: Track what you have read", () => {
  let walk: DocsWalk;

  /** The plan's Table once `ready` holds. */
  const tableWhen = (what: string, ready: (table: Table) => boolean) =>
    obRunUntil(
      walk.vaultId,
      async ({ app }, { planFile, property }): Promise<Table | null> => {
        const view = (
          app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as QueryFileView).file?.path === planFile) as
            | PlanLeaf
            | undefined
        )?.view;
        if (!view) return null;
        const el = view.contentEl;
        await view.query.settled;
        return {
          rows: [...el.querySelectorAll('[data-query-table-row="item"]')].map(
            (n) => n.getAttribute("data-query-key")!,
          ),
          cells: Object.fromEntries(
            [
              ...el.querySelectorAll(
                `[data-query-vault-cell][data-query-vault-name="${property}"]`,
              ),
            ].map((n) => [
              n.closest("tr")!.getAttribute("data-query-key")!,
              n.textContent,
            ]),
          ),
          header: [...el.querySelectorAll("th")].map((n) => n.textContent),
        };
      },
      { planFile: PLAN_FILE, property: PROPERTY },
      { what, ready: (table) => table !== null && ready(table) },
    ) as Promise<Table>;

  /**
   * Mark `paper` with `value` in the plan's status cell, as a reader types
   * it, and answer what the cell suggested before the typing.
   */
  async function mark(
    paper: keyof typeof PAPERS,
    value: string,
  ): Promise<string[]> {
    const key = PAPERS[paper].key;
    const suggested = await obRun(
      walk.vaultId,
      async ({ app, page }, { planFile, key, property, value }) => {
        const pointer = page.scratch.docsWalkPointer;
        const view = (
          app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find(
              (l) => (l.view as QueryFileView).file?.path === planFile,
            ) as PlanLeaf
        ).view;
        const el = view.contentEl;
        await view.query.settled;
        const cell = el
          .querySelector(
            `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${property}"]`,
          )!
          .closest("td")!;
        // The table keeps its sideways scroll from step 3, so the Title
        // column stays whole: the status field's focus would scroll the table
        // a few pixels further, and the walk holds it where the reader left it.
        let scroller = cell.closest("table")!.parentElement;
        while (
          scroller &&
          !(
            scroller.scrollWidth > scroller.clientWidth &&
            /auto|scroll/.test(getComputedStyle(scroller).overflowX)
          )
        )
          scroller = scroller.parentElement;
        const left = scroller?.scrollLeft ?? 0;
        const hold = () => {
          if (scroller) scroller.scrollLeft = left;
        };
        cell.closest("tr")!.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        await pointer?.point(cell, { inset: 20 });
        await page.trusted(window).click(cell);
        await page.until("status field", () =>
          activeDocument.activeElement?.matches("[data-query-vault-input]"),
        );
        hold();
        await new Promise((r) => setTimeout(r, 400));
        const suggested = [
          ...activeDocument.querySelectorAll(
            ".suggestion-container .suggestion-item",
          ),
        ].map((i) => i.textContent);
        const contents = (
          require("@electron/remote") as Remote
        ).getCurrentWebContents();
        if (pointer) {
          // The pointer moves off the cell, so the typing shows.
          const b = cell.getBoundingClientRect();
          await pointer.park(b.right + 30, b.bottom + 30);
          await pointer.keys(value, (ch) => contents.insertText(ch), {
            speed: 1.5,
          });
          await new Promise((r) => setTimeout(r, 300));
        } else contents.insertText(value);
        await new Promise((r) => setTimeout(r, 300));
        await page.trusted(window).key("Enter");
        await new Promise((r) => setTimeout(r, 300));
        hold();
        return suggested;
      },
      { planFile: PLAN_FILE, key, property: PROPERTY, value },
      STEP,
    );
    await tableWhen(`${paper} marked ${value}`, (t) => t.cells[key] === value);
    return suggested;
  }

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

  it("step 1: in the Zotero library tab, select Save as query file and name it Reading plan; Reading plan.zotquery opens and lists your papers", async () => {
    const saved = await walk.record("step-1", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { plan, planFile }) => {
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
          await app.workspace.revealLeaf(leaf);
          const el = leaf.view.contentEl;
          await leaf.view.query.settled;
          await page.until(
            "papers",
            () => el.querySelectorAll("[data-query-item-row]").length > 0,
            20000,
          );
          const heading =
            el.querySelector("[data-library-heading]")?.textContent ?? "";
          const banner = !!el.querySelector("[data-welcome-banner]");
          const saveAs = await page.stands(
            el.querySelector<HTMLElement>("[data-query-save-as]"),
            "Save as query file",
          );
          await pointer?.point(saveAs);
          page.press(saveAs, "Save as query file");
          const modal = await page.until(
            "save dialog",
            () => document.querySelector(".zt-save-query-file-modal"),
            5000,
          );
          const name = modal.querySelector<HTMLInputElement>(
            '[data-save-field="name"]',
          )!;
          const offered = name.value;
          // The reader sees the offered name before typing over it.
          await new Promise((r) => setTimeout(r, pointer ? 700 : 0));
          const folder =
            modal.querySelector<HTMLInputElement>('[data-save-field="folder"]')
              ?.value ?? null;
          name.focus();
          name.select();
          if (pointer) {
            const b = name.getBoundingClientRect();
            await pointer.park(b.right - 20, b.bottom + 24);
            await pointer.keys(plan, (ch) =>
              document.execCommand("insertText", false, ch),
            );
          } else document.execCommand("insertText", false, plan);
          const created = await page.until("file name", () => {
            const t = modal.querySelector("[role=status]")!.textContent;
            return t.includes(planFile) && t;
          });
          const dialog = modal.querySelector(".modal-title")!.textContent;
          const save = modal.querySelector<HTMLElement>(".mod-cta")!;
          await pointer?.point(save);
          page.press(save, "Save");
          await page.until(
            "plan open",
            () => app.workspace.getActiveFile()?.path === planFile,
            10000,
          );
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          await view.query.settled;
          const rows = await page.until(
            "plan rows",
            () => {
              const r = [
                ...view.contentEl.querySelectorAll("[data-query-papers-row]"),
              ].map((n) => n.getAttribute("data-query-papers-row"));
              return r.length >= 5 && r;
            },
            10000,
          );
          if (pointer) {
            const b = view.contentEl.getBoundingClientRect();
            await pointer.park(b.right - 14, b.bottom - 24);
          }
          return {
            heading,
            banner,
            offered,
            folder,
            dialog,
            created,
            active: app.workspace.getActiveFile()?.path ?? null,
            rows: [...new Set(rows)],
          };
        },
        { plan: PLAN, planFile: PLAN_FILE },
        STEP,
      ),
    );
    console.log("[walk] saved", JSON.stringify(saved));
    expect(saved).toMatchObject({
      offered: m.query_file_untitled(),
      dialog: m.annot_view_save_title(),
      created: m.annot_view_save_file({ file: PLAN_FILE }),
      active: PLAN_FILE,
    });
    expect(saved.rows.toSorted()).toEqual(
      Object.values(PAPERS)
        .map((p) => p.key)
        .toSorted(),
    );
    await walk.capture("step-1");
    await walk.compose("step-1");
  });

  it("step 2: select Views, Configure view, and set Layout to Table; your papers as rows", async () => {
    const layout = await walk.record("step-2", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { planFile }) => {
          const pointer = page.scratch.docsWalkPointer;
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          const trigger = el.querySelector<HTMLElement>(
            "[data-query-view-menu]",
          )!;
          const name = trigger.getAttribute("aria-label");
          await pointer?.point(trigger);
          page.press(trigger, "Views");
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
          const options = [...select.options].map((o) => o.text);
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
          if (pointer) {
            const b = el.getBoundingClientRect();
            await pointer.park(b.right - 14, b.bottom - 24);
          }
          return { options, name };
        },
        { planFile: PLAN_FILE },
        STEP,
      ),
    );
    expect(layout.name).toBe(m.query_view_views());
    expect(layout.options).toContain(m.query_view_layout_table());
    const table = await tableWhen("five rows", (t) => t.rows.length === 5);
    expect(table.header).toContain(m.query_view_property_title());
    await walk.capture("step-2");
    await walk.compose("step-2");
  });

  it('step 3: select Properties, type reading-status, and select the second entry, Add "reading-status" vault property; a column reading-status (note); papers without a literature note read No note, and Sandve et al. 2013 an empty cell', async () => {
    const entries = await walk.record("step-3", () =>
      obRun(
        walk.vaultId,
        async (
          { app, page },
          { planFile, properties, property, titleLabel },
        ) => {
          const pointer = page.scratch.docsWalkPointer;
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          const button = await page.stands(
            el.querySelector<HTMLElement>(
              `[data-query-properties][aria-label="${properties}"]`,
            ),
            "Properties",
          );
          await pointer?.point(button);
          page.press(button, "Properties");
          const popup = await page.until("Properties menu", () =>
            document.querySelector<HTMLElement>(
              "[data-query-properties-popup]",
            ),
          );
          const input = popup.querySelector("input")!;
          input.focus();
          if (pointer) {
            // The pointer moves beside the menu, off its list.
            const b = popup.getBoundingClientRect();
            await pointer.park(b.right + 30, b.top + 20);
            await pointer.keys(property, (ch) =>
              document.execCommand("insertText", false, ch),
            );
          } else document.execCommand("insertText", false, property);
          await page.until("add entries", () =>
            popup.querySelector(
              '[data-query-properties-action="add-vault-property"]',
            ),
          );
          const options = [...popup.querySelectorAll("[role=option]")].map(
            (o) => o.textContent,
          );
          const second = [
            ...popup.querySelectorAll<HTMLElement>("[role=option]"),
          ][1]!;
          await pointer?.point(second, { inset: 40 });
          page.press(second, "second entry");
          await new Promise((r) => setTimeout(r, 300));
          page.closePopovers(document);
          const column = await page.until(
            "the status column",
            () =>
              [...el.querySelectorAll<HTMLElement>("th")].find((th) =>
                th.textContent.includes(property),
              ),
            10000,
          );
          const title = [
            ...el.querySelectorAll<HTMLTableCellElement>("th"),
          ].find((th) => th.textContent.trim() === titleLabel)!;
          /** The box of the text in `cell`, without its padding and icon. */
          const text = (cell: Element) => {
            const range = document.createRange();
            const walker = document.createTreeWalker(
              cell,
              NodeFilter.SHOW_TEXT,
            );
            const nodes: Node[] = [];
            for (let n = walker.nextNode(); n; n = walker.nextNode())
              if (n.textContent?.trim()) nodes.push(n);
            range.setStart(nodes[0]!, 0);
            const last = nodes.at(-1)!;
            range.setEnd(last, last.textContent!.length);
            return range.getBoundingClientRect();
          };
          // The text of the Title column: its name and each paper's title.
          const titles = [title, ...el.querySelectorAll("tbody tr")].map(
            (row) =>
              row === title
                ? title
                : (row as HTMLTableRowElement).cells[title.cellIndex]!,
          );
          // The new column joins just past the tab's right edge; the reader
          // scrolls the table until its name shows, and the Title column
          // stays in view: the scroll splits the room between the two.
          await new Promise((r) => setTimeout(r, pointer ? 500 : 0));
          const pane = el.getBoundingClientRect();
          let scroller = column.closest("table")!.parentElement;
          while (
            scroller &&
            !(
              scroller.scrollWidth > scroller.clientWidth &&
              /auto|scroll/.test(getComputedStyle(scroller).overflowX)
            )
          )
            scroller = scroller.parentElement;
          const need = text(column).right - pane.right;
          const room = Math.min(...titles.map((c) => text(c).left)) - pane.left;
          scroller?.scrollBy({
            left: Math.max(0, Math.round((need + room) / 2)),
            behavior: pointer ? "smooth" : "instant",
          });
          await new Promise((r) => setTimeout(r, pointer ? 800 : 100));
          if (pointer) {
            await pointer.park(pane.right - 14, pane.bottom - 24);
          }
          // The Title column's text and the new column's name show whole.
          const within = (r: DOMRect) =>
            r.left >= pane.left - 1 && r.right <= pane.right + 1;
          return {
            options,
            titleText: title.textContent,
            titleShown: titles.every((cell) => within(text(cell))),
            columnNameShown: within(text(column)),
          };
        },
        {
          planFile: PLAN_FILE,
          properties: m.query_view_properties(),
          property: PROPERTY,
          titleLabel: m.query_view_property_title(),
        },
        STEP,
      ),
    );
    console.log("[walk] columns", JSON.stringify(entries));
    expect(entries.titleText).toContain(m.query_view_property_title());
    expect(entries.titleShown).toBe(true);
    expect(entries.columnNameShown).toBe(true);
    // The first entry adds a Zotero field; the second, the reader's own property.
    expect(entries.options.slice(0, 2)).toEqual([
      m.query_view_properties_add({ name: PROPERTY }),
      m.query_view_properties_add_vault({ name: PROPERTY }),
    ]);
    const table = await tableWhen(
      "the status column",
      (t) => Object.keys(t.cells).length === 5,
    );
    console.log("[walk] status cells", JSON.stringify(table));
    expect(table.header).toContain(
      m.query_view_vault_property_label({ name: PROPERTY }),
    );
    // Papers without a literature note read No note. Sandve et al. 2013 has
    // the note from Lesson 1, so its cell is empty, ready for a value.
    for (const paper of ["munafo", "wilson", "rougier", "ioannidis"] as const)
      expect(table.cells[PAPERS[paper].key]).toBe(m.query_view_vault_no_note());
    expect(table.cells[PAPERS.sandve.key]).toBe("");
    await walk.capture("step-3");
    await walk.compose("step-3");
  });

  it("step 4: select a cell, type to-read, and press Enter; the notice Literature note created. and the cell shows to-read", async () => {
    const suggested = await walk.record(
      "step-4",
      () => mark("wilson", "to-read"),
      { notices: true },
    );
    expect(suggested).toEqual([]);
    const note = await obRunUntil(
      walk.vaultId,
      ({ app }, { path }) =>
        app.metadataCache.getCache(path)?.frontmatter ?? null,
      { path: notePath("wilson") },
      {
        what: "the new note's status",
        ready: (fm) => fm?.[PROPERTY] === "to-read",
      },
    );
    expect(note).toMatchObject({
      "zotero-key": PAPERS.wilson.key,
      [PROPERTY]: "to-read",
    });
    expect(await readNotices(walk.vaultId)).toContain(m.notice_created_note());
    // The note is made in the background: the plan stays the active tab.
    expect(
      await obRun(
        walk.vaultId,
        ({ app }) => app.workspace.getActiveFile()?.path ?? null,
      ),
    ).toBe(PLAN_FILE);
    await walk.capture("step-4", { notices: true });
    await walk.compose("step-4");
  });

  it("step 5: mark a paper you started reading and a finished one done; the cell suggests the statuses you used", async () => {
    const { started, finished } = await walk.record("step-5", async () => {
      const started = await mark("sandve", "reading");
      const finished = await mark("ioannidis", "done");
      // The clip ends on the suggestions in a fourth cell, as the image.
      await openSuggestions();
      return { started, finished };
    });
    console.log("[walk] suggestions", JSON.stringify({ started, finished }));
    expect(started).toEqual(["to-read"]);
    expect(new Set(finished)).toEqual(new Set(["to-read", "reading"]));
    async function openSuggestions() {
      await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, key, property }) => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const cell = view.contentEl
            .querySelector(
              `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${property}"]`,
            )!
            .closest("td")!;
          const pointer = page.scratch.docsWalkPointer;
          // As in `mark`, the table keeps its sideways scroll.
          let scroller = cell.closest("table")!.parentElement;
          while (
            scroller &&
            !(
              scroller.scrollWidth > scroller.clientWidth &&
              /auto|scroll/.test(getComputedStyle(scroller).overflowX)
            )
          )
            scroller = scroller.parentElement;
          const left = scroller?.scrollLeft ?? 0;
          await pointer?.point(cell, { inset: 20 });
          await page.trusted(window).click(cell);
          await page.until("status field", () =>
            activeDocument.activeElement?.matches("[data-query-vault-input]"),
          );
          if (scroller) scroller.scrollLeft = left;
          await page.until("suggestions", () =>
            activeDocument.querySelector(
              ".suggestion-container .suggestion-item",
            ),
          );
          if (pointer) {
            // The pointer moves off the cell and its suggestions.
            const b = cell.getBoundingClientRect();
            await pointer.park(b.left - 30, b.bottom + 30);
          }
        },
        { planFile: PLAN_FILE, key: PAPERS.munafo.key, property: PROPERTY },
        STEP,
      );
    }
    await walk.capture("step-5");
    await walk.compose("step-5");
    await obRun(walk.vaultId, async ({ page }) => {
      await page.trusted(window).key("Escape");
      (activeDocument.activeElement as HTMLElement | null)?.blur();
    });
    const table = await tableWhen(
      "the marks",
      (t) => t.cells[PAPERS.ioannidis.key] === "done",
    );
    expect(table.cells).toMatchObject({
      [PAPERS.wilson.key]: "to-read",
      [PAPERS.sandve.key]: "reading",
      [PAPERS.ioannidis.key]: "done",
      [PAPERS.munafo.key]: m.query_view_vault_no_note(),
    });
  });

  it("step 6: select Filter and choose reading-status (note), is, to-read; only the papers still to read", async () => {
    const filtered = await walk.record("step-6", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, label, kind, operator, value }) => {
          const pointer = page.scratch.docsWalkPointer;
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          const trigger = el.querySelector<HTMLElement>(
            '[data-query-toolbar="filter"]',
          )!;
          const name = trigger.getAttribute("aria-label");
          await pointer?.point(trigger);
          const popup = await page.openToolbarPopover(el, "filter");
          // This view holds one empty condition; the reader sets it, after the All views group.
          const row = await page.until("condition row", () =>
            [
              ...popup.querySelectorAll<HTMLElement>("[data-condition-row]"),
            ].pop(),
          );
          const control = (label: string) =>
            row.querySelector<HTMLButtonElement | HTMLSelectElement>(
              `:is(select,button)[aria-label="${CSS.escape(label)}"]`,
            );
          await pointer?.point(control(kind)!);
          page.press(control(kind), "Condition type");
          const list = await page.until("condition types", () =>
            document.querySelector<HTMLElement>("[data-select-popup]"),
          );
          const option = await page.until("reading-status option", () =>
            [...list.querySelectorAll<HTMLElement>("[role=option]")].find((o) =>
              o.textContent.startsWith(label),
            ),
          );
          await pointer?.point(option, { inset: 40 });
          page.press(option, "reading-status");
          await page.until("condition type set", () => !list.isConnected);
          const op = await page.until("operator", () => control(operator));
          let operators: string[] = [];
          await pointer?.point(op);
          if (op instanceof HTMLSelectElement) {
            operators = [...op.options].map((o) => o.text);
            await page.pick(op, "is", "Operator");
          } else {
            page.press(op, "Operator");
            const ops = await page.until("operators", () =>
              document.querySelector<HTMLElement>("[data-select-popup]"),
            );
            operators = [...ops.querySelectorAll("[role=option]")].map(
              (o) => o.textContent,
            );
            const is = await page.stands(
              ops.querySelector<HTMLElement>('[role=option][data-value="is"]'),
              "is",
            );
            await pointer?.point(is, { inset: 30 });
            page.press(is, "is");
            await page.until("operator set", () => !ops.isConnected);
          }
          const input = await page.until("value", () =>
            page.labelledInput(row, value),
          );
          await pointer?.point(input, { inset: 30 });
          input.focus();
          const contents = (
            require("@electron/remote") as Remote
          ).getCurrentWebContents();
          if (pointer) {
            const b = input.getBoundingClientRect();
            await pointer.park(b.right - 20, b.bottom + 24);
            await pointer.keys("to-read", (ch) => contents.insertText(ch), {
              speed: 1.5,
            });
          } else contents.insertText("to-read");
          await page.until(
            "one row",
            () =>
              el.querySelectorAll('[data-query-table-row="item"]').length === 1,
            10000,
          );
          return { name, operators, text: await app.vault.read(view.file!) };
        },
        {
          planFile: PLAN_FILE,
          label: m.query_view_vault_property_label({ name: PROPERTY }),
          kind: m.workbench_match_condition_kind(),
          operator: m.workbench_filter_operator(),
          value: m.workbench_filter_value(),
        },
        STEP,
      ),
    );
    console.log("[walk] filter", JSON.stringify(filtered));
    expect(filtered.name).toBe(m.query_view_filter());
    expect(filtered.text).toContain(`vault["${PROPERTY}"] == "to-read"`);
    const table = await tableWhen(
      "the to-read papers",
      (t) => t.rows.length === 1,
    );
    expect(table.rows).toEqual([PAPERS.wilson.key]);
    await walk.capture("step-6");
    await walk.compose("step-6");
  });
});
