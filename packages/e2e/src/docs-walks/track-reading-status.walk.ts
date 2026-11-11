// The walk of the lesson apps/docs/content/docs/organize-your-research/
// track-reading-status.mdx: a researcher planning next week's reading sees
// which papers they have not started, saves their library as a reading plan,
// marks each paper to-read, reading, or done in a Table, filters the plan to
// the papers still to read, and finds the status in each literature note.
// Each `it` is one step of the page, in the page's order, and asserts what
// the page says the reader sees. Run it with `pnpm --filter @zotlit/e2e
// docs-walk`; see AGENTS.md.

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

/** The five papers of the docs Vault Case, by Zotero key. */
const PAPERS = {
  munafo: { key: "DCMNFART", citekey: "munafo2017" },
  wilson: { key: "DCWLSART", citekey: "wilson2014" },
  sandve: { key: "DCSNDART", citekey: "sandve2013" },
  rougier: { key: "DMRGRART", citekey: "rougier2014" },
  ioannidis: { key: "DMIANART", citekey: "ioannidis2005" },
};
/** The papers with no annotation, no read in Zotero, and no note: Unread. */
const UNREAD = [PAPERS.munafo.key, PAPERS.wilson.key];
/** The reader's marks, in the order the page makes them. Rougier stays unmarked. */
const MARKS: [keyof typeof PAPERS, string][] = [
  ["wilson", "to-read"],
  ["munafo", "to-read"],
  ["sandve", "reading"],
  ["ioannidis", "done"],
];
const PLAN = "Reading plan";
const PLAN_FILE = `${PLAN}.zotquery`;
const PROPERTY = "reading-status";
const notePath = (paper: keyof typeof PAPERS) =>
  `literatures/${PAPERS[paper].citekey}.md`;

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type PlanLeaf = WorkspaceLeaf & { view: QueryFileView };
type NoteLeaf = WorkspaceLeaf & { view: MarkdownView };
/** The text input of the window, as a reader types. */
type Remote = {
  getCurrentWebContents(): { insertText(text: string): void };
};

interface Table {
  rows: string[];
  cells: Record<string, string>;
  header: string[];
}

describe.skipIf(!reachable)(
  "Track which papers you have read, from Zotero in Obsidian",
  () => {
    let walk: DocsWalk;
    /** When Zotero last changed each paper, before the reader marks any. */
    let modified: Record<string, string>;

    /** The plan's Table once `ready` holds. */
    const tableWhen = (what: string, ready: (table: Table) => boolean) =>
      obRunUntil(
        walk.vaultId,
        async ({ app }, { planFile, property }): Promise<Table | null> => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf | undefined
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

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: "track-reading-status",
        collection: "organize-your-research/track-reading-status",
        vaultCase: "docs",
      });
      await watchNotices(walk.vaultId);
      modified = await walk.zotero.json<Record<string, string>>(
        `Object.fromEntries(${JSON.stringify(Object.values(PAPERS).map((p) => p.key))}.map(k=>[k,Zotero.Items.getByLibraryAndKey(1,k).dateModified]))`,
      );
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("shows the papers not yet started under Unread in the Library View", async () => {
      const shown = await obRun(
        walk.vaultId,
        async ({ app, page }, { unread }) => {
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
          page.press(
            await page.until(
              "My Library",
              () =>
                [
                  ...el.querySelectorAll<HTMLElement>("[data-library-label]"),
                ].find((n) => n.textContent === "My Library"),
              20000,
            ),
            "My Library",
          );
          await page.until(
            "five papers",
            () => el.querySelectorAll("[data-query-item-row]").length === 5,
            10000,
          );
          page.press(
            el.querySelector<HTMLElement>('[data-library-facet="unread"]'),
            "Unread",
          );
          await page.until(
            "Unread on",
            () =>
              el
                .querySelector('[data-library-facet="unread"]')!
                .getAttribute("aria-pressed") === "true",
          );
          await page.until(
            "unread papers",
            () =>
              el.querySelectorAll("[data-query-item-row]").length === unread,
            10000,
          );
          await leaf.view.query.settled;
          return {
            heading:
              el.querySelector("[data-library-heading]")?.textContent ?? "",
            rows: [...el.querySelectorAll("[data-query-item-row]")].map((n) =>
              n.getAttribute("data-query-item-row")!,
            ),
          };
        },
        { unread: UNREAD.length },
      );
      expect(shown.rows.toSorted()).toEqual(UNREAD.toSorted());
      expect(shown.heading).toContain("My Library");
      await walk.capture("unread");
      await walk.compose("unread");
      // The reader turns Unread off again before saving the plan.
      await obRun(walk.vaultId, async ({ app, page }) => {
        const leaf = app.workspace.getLeavesOfType(
          "zotlit-library",
        )[0] as LibraryLeaf;
        const el = leaf.view.contentEl;
        page.press(
          el.querySelector<HTMLElement>('[data-library-facet="unread"]'),
          "Unread",
        );
        await page.until(
          "five papers",
          () => el.querySelectorAll("[data-query-item-row]").length === 5,
          10000,
        );
      });
    });

    it("saves the library as the query file Reading plan", async () => {
      const saved = await obRun(
        walk.vaultId,
        async ({ app, page }, { plan, planFile }) => {
          {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            page.press(
              leaf.view.contentEl.querySelector<HTMLElement>(
                "[data-query-save-as]",
              ),
              "Save as query file",
            );
          }
          const modal = await page.until(
            "save dialog",
            () => document.querySelector(".zt-save-query-file-modal"),
            5000,
          );
          const name = modal.querySelector<HTMLInputElement>(
            '[data-save-field="name"]',
          )!;
          name.focus();
          name.select();
          document.execCommand("insertText", false, plan);
          const created = await page.until("file name", () => {
            const t = modal.querySelector("[role=status]")!.textContent;
            return t.includes(planFile) && t;
          });
          const dialog = modal.querySelector(".modal-title")!.textContent;
          page.press(modal.querySelector<HTMLElement>(".mod-cta"), "Save");
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
          const el = view.contentEl;
          await view.query.settled;
          await page.until(
            "plan rows",
            () => el.querySelectorAll("[data-query-papers-row]").length === 5,
            10000,
          );
          return {
            dialog,
            created,
            active: app.workspace.getActiveFile()?.path ?? null,
            rows: el.querySelectorAll("[data-query-papers-row]").length,
          };
        },
        { plan: PLAN, planFile: PLAN_FILE },
      );
      expect(saved).toMatchObject({
        dialog: m.annot_view_save_title(),
        active: PLAN_FILE,
        rows: 5,
      });
    });

    it("switches the plan to the Table layout", async () => {
      const layout = await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, views }) => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
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
            document.querySelector<HTMLSelectElement>(
              "[popover]:popover-open select[data-query-view-layout]",
            ),
          );
          const options = [...select.options].map((o) => o.text);
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
          // The reader closes both sidebars to give the Table room.
          app.workspace.leftSplit.collapse();
          app.workspace.rightSplit.collapse();
          await page.until(
            "sidebars closed",
            () =>
              [app.workspace.leftSplit, app.workspace.rightSplit].every(
                (split) => {
                  const s = split as typeof split & {
                    containerEl: HTMLElement;
                  };
                  return (
                    s.containerEl.getBoundingClientRect().width < 1 &&
                    s.containerEl.getAnimations({ subtree: true }).length === 0
                  );
                },
              ),
            5000,
          );
          await new Promise((r) => setTimeout(r, 300));
          await view.query.settled;
          return {
            options,
            header: [...el.querySelectorAll("th")].map((n) => n.textContent),
          };
        },
        { planFile: PLAN_FILE, views: m.query_view_views() },
      );
      expect(layout.options).toContain(m.query_view_layout_table());
      expect(layout.header).toContain(m.query_view_table_literature_note());
    });

    it("adds reading-status as a vault property, with No note in every row", async () => {
      const entries = await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, properties, property }) => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === properties,
            ),
            "Properties",
          );
          const popup = await page.until("Properties menu", () => {
            const p = [
              ...document.querySelectorAll("[popover]:popover-open"),
            ].pop();
            return p?.querySelector("input") && p;
          });
          const input = popup.querySelector("input")!;
          input.focus();
          document.execCommand("insertText", false, property);
          await page.until("add entries", () =>
            popup.querySelector(
              '[data-query-properties-action="add-vault-property"]',
            ),
          );
          return [...popup.querySelectorAll("[role=option]")].map(
            (o) => o.textContent,
          );
        },
        {
          planFile: PLAN_FILE,
          properties: m.query_view_properties(),
          property: PROPERTY,
        },
      );
      // The first entry adds a Zotero field; the second, the reader's own property.
      expect(entries.slice(0, 2)).toEqual([
        m.query_view_properties_add({ name: PROPERTY }),
        m.query_view_properties_add_vault({ name: PROPERTY }),
      ]);
      await walk.capture("add-column");
      await walk.compose("add-column");
      await obRun(walk.vaultId, async ({ page }) => {
        page.press(
          [...document.querySelectorAll("[popover]:popover-open")]
            .pop()!
            .querySelector<HTMLElement>(
              '[data-query-properties-action="add-vault-property"]',
            ),
          "Add vault property",
        );
        await new Promise((r) => setTimeout(r, 300));
        for (const p of document.querySelectorAll<HTMLElement>(
          "[popover]:popover-open",
        ))
          p.hidePopover();
      });
      const table = await tableWhen(
        "the status column",
        (t) => Object.keys(t.cells).length === 5,
      );
      expect(table.header).toContain(
        m.query_view_vault_property_label({ name: PROPERTY }),
      );
      expect(new Set(Object.values(table.cells))).toEqual(
        new Set([m.query_view_vault_no_note()]),
      );
    });

    it("marks a paper to-read, which creates its literature note", async () => {
      const [paper, value] = MARKS[0]!;
      await mark(paper, value);
      const note = await obRunUntil(
        walk.vaultId,
        ({ app }, { path }) =>
          app.metadataCache.getCache(path)?.frontmatter ?? null,
        { path: notePath(paper) },
        {
          what: "the new note's status",
          ready: (fm) => fm?.[PROPERTY] === value,
        },
      );
      expect(note).toMatchObject({
        "zotero-key": PAPERS[paper].key,
        [PROPERTY]: value,
      });
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_created_note(),
      );
      // The note is made in the background: the plan stays the active tab.
      expect(
        await obRun(
          walk.vaultId,
          ({ app }) => app.workspace.getActiveFile()?.path ?? null,
        ),
      ).toBe(PLAN_FILE);
    });

    it("marks the other papers, and leaves Zotero unchanged", async () => {
      for (const [paper, value] of MARKS.slice(1)) await mark(paper, value);
      const table = await tableWhen("every mark", (t) =>
        MARKS.every(([paper, value]) => t.cells[PAPERS[paper].key] === value),
      );
      expect(table.cells[PAPERS.rougier.key]).toBe(
        m.query_view_vault_no_note(),
      );
      await obRun(walk.vaultId, () => {
        (activeDocument.activeElement as HTMLElement | null)?.blur();
      });
      await walk.capture("statuses");
      await walk.compose("statuses");
      // Marking writes to the notes alone: Zotero changed none of the papers.
      const after = await walk.zotero.json<Record<string, string>>(
        `Object.fromEntries(${JSON.stringify(Object.keys(modified))}.map(k=>[k,Zotero.Items.getByLibraryAndKey(1,k).dateModified]))`,
      );
      expect(after).toEqual(modified);
    });

    it("filters the plan to the papers still to read", async () => {
      const filtered = await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, filter, label }) => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          page.press(
            [...el.querySelectorAll("button")].find(
              (b) => b.getAttribute("aria-label") === filter,
            ),
            "Filter",
          );
          const popup = await page.until("Filter", () => {
            const p = [
              ...document.querySelectorAll("[popover]:popover-open"),
            ].pop();
            return p?.querySelector('button[aria-label="Condition type"]') && p;
          });
          // This view holds one empty condition; the reader sets it, after the All views group.
          const type = [
            ...popup.querySelectorAll<HTMLButtonElement>(
              'button[aria-label="Condition type"]',
            ),
          ].pop();
          page.press(type, "Condition type");
          const list = await page.until(
            "condition types",
            () =>
              type!.popoverTargetElement?.matches(":popover-open") &&
              type!.popoverTargetElement,
          );
          const option = await page.until("reading-status option", () =>
            [...list.querySelectorAll<HTMLElement>("[role=option]")].find((o) =>
              o.textContent.startsWith(label),
            ),
          );
          page.press(option, "reading-status");
          await page.until(
            "condition type set",
            () => !list.matches(":popover-open"),
          );
          const op = await page.until("operator", () => {
            const s = [
              ...popup.querySelectorAll<HTMLSelectElement>(
                'select[aria-label="Operator"]',
              ),
            ].pop();
            return s && [...s.options].some((o) => o.value === "is") && s;
          });
          await page.pick(op, "is", "Operator");
          const input = [
            ...popup.querySelectorAll<HTMLInputElement>(
              'input[aria-label="Value"]',
            ),
          ].pop()!;
          input.focus();
          (require("@electron/remote") as Remote)
            .getCurrentWebContents()
            .insertText("to-read");
          await page.until(
            "two rows",
            () =>
              el.querySelectorAll('[data-query-table-row="item"]').length === 2,
            10000,
          );
          return { text: await app.vault.read(view.file!) };
        },
        {
          planFile: PLAN_FILE,
          filter: m.query_view_filter(),
          label: m.query_view_vault_property_label({ name: PROPERTY }),
        },
      );
      expect(filtered.text).toContain(`vault["${PROPERTY}"] == "to-read"`);
      const table = await tableWhen(
        "the to-read papers",
        (t) => t.rows.length === 2,
      );
      expect(table.rows.toSorted()).toEqual(
        [PAPERS.wilson.key, PAPERS.munafo.key].toSorted(),
      );
      await walk.capture("filter");
      await walk.compose("filter");
      await obRun(walk.vaultId, () => {
        for (const p of document.querySelectorAll<HTMLElement>(
          "[popover]:popover-open",
        ))
          p.hidePopover();
        (activeDocument.activeElement as HTMLElement | null)?.blur();
      });
    });

    it("shows the status in the note's properties, keeps it on Update, and follows a change there", async () => {
      const path = notePath("wilson");
      // The reader opens the note from its link in the Literature note column.
      const opened = await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, key, path }) => {
          const view = (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .find(
                (l) => (l.view as QueryFileView).file?.path === planFile,
              ) as PlanLeaf
          ).view;
          const el = view.contentEl;
          const link = page.press(
            el.querySelector<HTMLElement>(
              `[data-query-key="${key}"] [data-query-note] a, [data-query-key="${key}"] a`,
            ),
            "note link",
          );
          await page.until(
            "note open",
            () =>
              app.workspace
                .getLeavesOfType("markdown")
                .some((l) => (l.view as MarkdownView).file?.path === path),
            10000,
          );
          return {
            link: link.textContent,
            tabs: app.workspace.getLeavesOfType("zotlit-query-file").length,
          };
        },
        { planFile: PLAN_FILE, key: PAPERS.wilson.key, path },
      );
      expect(opened.link).toBe(PAPERS.wilson.citekey);
      // The note opens in the plan's tab, in place of the plan.
      expect(opened.tabs).toBe(0);
      const shown = await obRunUntil(
        walk.vaultId,
        async ({ app }, { path, property }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === path) as
            | NoteLeaf
            | undefined;
          if (!leaf) return null;
          await app.workspace.revealLeaf(leaf);
          return (
            leaf.view.contentEl.querySelector(
              `.metadata-property[data-property-key="${property}"] .metadata-property-value`,
            )?.textContent ?? null
          );
        },
        { path, property: PROPERTY },
        { what: "the note's status", ready: (value) => value === "to-read" },
      );
      expect(shown).toBe("to-read");
      await obRun(
        walk.vaultId,
        ({ app }, { path }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === path,
            ) as NoteLeaf;
          const cm = leaf.view.editor.cm;
          cm.dispatch({ selection: { anchor: cm.state.doc.length } });
          leaf.view.contentEl.querySelector(".cm-scroller")!.scrollTop = 0;
        },
        { path },
      );
      await walk.capture("in-note");
      await walk.compose("in-note");
      // Update note refreshes the properties from Zotero and keeps the status.
      const updated = await obRun(
        walk.vaultId,
        async ({ app, page }, { path, notice }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === path,
            ) as NoteLeaf;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:update-note");
          await page.until(
            "update notice",
            () => page.scratch.docsWalkNotices!.includes(notice),
            20000,
          );
          return app.metadataCache.getCache(path)!.frontmatter as Record<
            string,
            string
          >;
        },
        { path, notice: m.notice_updated_note_no_region() },
      );
      expect(updated[PROPERTY]).toBe("to-read");
      // The reader starts the paper and changes its status in the Properties panel.
      await obRun(
        walk.vaultId,
        async ({ app, page }, { path, property }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === path,
            ) as NoteLeaf;
          const field = leaf.view.contentEl.querySelector<HTMLElement>(
            `.metadata-property[data-property-key="${property}"] .metadata-input-longtext`,
          )!;
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          await wait(1000);
          await page.trusted(window).click(field);
          await page.until(
            "field focused",
            () => activeDocument.activeElement === field,
          );
          await wait(300);
          document.execCommand("selectAll");
          (require("@electron/remote") as Remote)
            .getCurrentWebContents()
            .insertText("reading");
          await wait(300);
          await page.trusted(window).key("Enter");
          return field.textContent;
        },
        { path, property: PROPERTY },
      );
      await obRunUntil(
        walk.vaultId,
        ({ app }, { path, property }) =>
          (app.metadataCache.getCache(path)?.frontmatter?.[property] ??
            null) as string | null,
        { path, property: PROPERTY },
        {
          what: "the status in the note",
          ready: (value) => value === "reading",
        },
      );
      // The back arrow returns to the plan, which follows: the paper leaves the to-read list.
      await obRun(
        walk.vaultId,
        async ({ app, page }, { path }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === path,
            ) as NoteLeaf;
          await new Promise((r) => setTimeout(r, 1000));
          page.press(
            leaf.view.containerEl.querySelector<HTMLElement>(
              ".view-header-nav-buttons button",
            ),
            "back arrow",
          );
          await page.until(
            "back to the plan",
            () =>
              app.workspace.getLeavesOfType("zotlit-query-file").length === 1,
            10000,
          );
        },
        { path },
      );
      const table = await tableWhen(
        "the plan after the change",
        (t) => t.rows.length === 1,
      );
      expect(table.rows).toEqual([PAPERS.munafo.key]);
    });

    /** The statuses marked so far. */
    const used = new Set<string>();

    /** Mark `paper` with `value` in the plan's status cell, as a reader types it. */
    async function mark(paper: keyof typeof PAPERS, value: string) {
      const key = PAPERS[paper].key;
      const suggested = await obRun(
        walk.vaultId,
        async ({ app, page }, { planFile, key, property, value }) => {
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
          cell.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
          await page.trusted(window).click(cell);
          await page.until("status field", () =>
            activeDocument.activeElement?.matches("[data-query-vault-input]"),
          );
          await new Promise((r) => setTimeout(r, 300));
          const suggested = [
            ...activeDocument.querySelectorAll(
              ".suggestion-container .suggestion-item",
            ),
          ].map((i) => i.textContent);
          (require("@electron/remote") as Remote)
            .getCurrentWebContents()
            .insertText(value);
          await new Promise((r) => setTimeout(r, 300));
          await page.trusted(window).key("Enter");
          return suggested;
        },
        { planFile: PLAN_FILE, key, property: PROPERTY, value },
      );
      // The cell suggests the statuses the notes already hold.
      expect(new Set(suggested)).toEqual(new Set(used));
      used.add(value);
      await tableWhen(
        `${paper} marked ${value}`,
        (t) => t.cells[key] === value,
      );
    }
  },
);
