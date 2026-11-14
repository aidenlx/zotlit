// A long list mounts only the rows near the screen: the Library View's Papers
// and Table layouts over hundreds of papers, and a Query File embed in a
// note. The Stress Build is isolated from the Development Vault and from the
// run's shared Fixture, which lists fewer papers than a long list starts at.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MarkdownView } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";

import { prepareRunWindow } from "./background-throttling.ts";
import { revealQueryView } from "./note-query-view.ts";
import { cli, obRun, obRunUntil } from "./obsidian-cli.ts";
import type { QueryViewElement } from "./page-helpers.ts";
import type { QueryPrintModal } from "./page-query-types.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-long-list-fixture"),
);
const vaultPath = e2eVaultDir(workspaceRoot, "long-list-vault");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const reachable = await isObsidianReachable(workspaceRoot);
/**
 * The synthetic Items of the Stress Build. They spread over its Libraries;
 * My Library then lists well past a long list's start.
 */
const STRESS_ITEMS = 1000;
/** The fewest papers each case reads from My Library. */
const LISTED = 260;

describe.skipIf(!reachable)("Library View long lists", () => {
  let vaultId = "";

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    await mkdir(join(vaultPath, ".obsidian", "plugins", "zotlit"), {
      recursive: true,
    });
    await cp(
      pluginBundleDir,
      join(vaultPath, ".obsidian", "plugins", "zotlit"),
      {
        recursive: true,
      },
    );
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
    await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
    await buildFixture(fixture, {
      stressItemCount: STRESS_ITEMS,
      pluginBundleDir,
      linkedAttachmentVaultDir: vaultPath,
    });
    await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
    await obRunUntil(
      vaultId,
      async ({ zotlit }, { scopeKey }) => {
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": {
              node: { kind: "library", library: { type: "personal" } },
              facets: [],
              search: "",
              sort: [{ property: "title", direction: "ASC" }],
              cardClosed: true,
            },
            [scopeKey]: { mode: "all" },
          }),
        );
        await bridge.runPromise(settings.flush);
        return true;
      },
      { scopeKey: LIBRARY_SCOPE_SETTING_KEY },
      { what: "the Library View settings" },
    );
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  /** Open the Library View in `layout`, once it lists every paper. */
  async function openLibrary(layout: "papers" | "table"): Promise<number> {
    return await obRunUntil(
      vaultId,
      async ({ app }, { layout }) => {
        let leaf = app.workspace.getLeavesOfType("zotlit-library")[0];
        if (!leaf) {
          app.commands.executeCommandById("zotlit:open-library-view");
          return 0;
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await app.workspace.revealLeaf(leaf);
        const view = leaf.view as LibraryView;
        const state = view.query.state.getState();
        if (!state.view || !state.file) return 0;
        if (state.view.type !== layout) {
          view.query.document.setViewLayout(
            state.file.views.indexOf(state.view),
            layout,
          );
          return 0;
        }
        const shown = view.contentEl.querySelectorAll("[data-query-item-row]");
        return shown.length > 0 ? (state.results?.rows.length ?? 0) : 0;
      },
      { layout },
      { what: `the Library View in ${layout}`, ready: (n) => n > LISTED },
    );
  }

  /** The scroll box of a Library View list. */
  const BOX = '[data-query-layout="papers"], div:has(> [data-query-table])';

  /** Close the Library View once the case ends, as it found none open. */
  function closeLibrary(cleanup: AsyncDisposableStack) {
    cleanup.defer(() =>
      obRun(vaultId, ({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("zotlit-library"))
          leaf.detach();
      }),
    );
  }

  /**
   * The list's rows as the pointer drags its scroll bar from top to end, a
   * step each frame: how many are mounted, how far the list's height moved,
   * and each set of widths a Table's property columns took on the way. The
   * drag starts once the list holds its height.
   */
  async function dragToEnd(rowSelector: string) {
    await obRunUntil(
      vaultId,
      async ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        list.scrollTop = 0;
        const before = list.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return list.scrollHeight === before;
      },
      { box: BOX },
      { what: "the list's height before the drag" },
    );
    return await obRun(
      vaultId,
      async ({ app }, { rowSelector, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const heights = new Set<number>();
        const columns = new Set<string>();
        let mounted = 0;
        let off = 0;
        const end = list.scrollHeight - list.clientHeight;
        // The pointer moves the bar once a frame, as a drag does.
        for (let at = 0; at <= end; at += 200) {
          list.scrollTop = at;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          heights.add(list.scrollHeight);
          columns.add(
            [...list.querySelectorAll("th[data-query-column]")]
              .map((th) => Math.round(th.getBoundingClientRect().width))
              .join(" "),
          );
          mounted = Math.max(
            mounted,
            list.querySelectorAll(rowSelector).length,
          );
          // A step past the end the list has now is the browser's clamp.
          const max = list.scrollHeight - list.clientHeight;
          if (at <= max && Math.abs(list.scrollTop - at) > 1) off++;
        }
        list.scrollTop = list.scrollHeight;
        return {
          mounted,
          heightMoved: Math.max(...heights) - Math.min(...heights),
          off,
          columnWidths: [...columns],
        };
      },
      { rowSelector, box: BOX },
      { timeoutMs: 120_000 },
    );
  }

  /** Whether the row of `key` shows whole in its list, selected and with the focus. */
  async function shownWhole(key: string, what: string) {
    return await obRunUntil(
      vaultId,
      ({ app }, { key, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const row = view.contentEl.querySelector<HTMLElement>(
          `[data-query-item-row="${key}"]`,
        );
        const list = row?.closest<HTMLElement>(box);
        if (!row || !list)
          return { selected: false, inView: false, focused: false };
        const rowBounds = row.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        return {
          selected: view.selected.key === key,
          inView:
            rowBounds.top >= listBounds.top - 1 &&
            rowBounds.bottom <= listBounds.bottom + 1,
          focused: row.doc.activeElement === row,
        };
      },
      { key, box: BOX },
      {
        what,
        ready: ({ selected, inView, focused }) => selected && inView && focused,
      },
    );
  }

  /** The Indexed Keys of the list's rows, in order. */
  async function listedKeys() {
    return await obRun(vaultId, ({ app }) =>
      (
        app.workspace.getLeavesOfType("zotlit-library")[0]!.view as LibraryView
      ).query.state
        .getState()
        .results!.rows.map((row) => row.indexedKey),
    );
  }

  /**
   * Show in Library selects a far paper, which shows whole with the focus;
   * the list scrolls back to its top and keeps the row mounted; ↓ then
   * selects the next paper and brings it into view with the focus.
   */
  async function revealThenStep() {
    const keys = await listedKeys();
    const [far, next] = [keys[250]!, keys[251]!];
    expect(
      await obRun(
        vaultId,
        ({ app }, { far }) =>
          (
            app.workspace.getLeavesOfType("zotlit-library")[0]!
              .view as LibraryView
          ).reveal(far),
        { far },
      ),
    ).toBe("listed");
    await shownWhole(far, "the far paper Show in Library selected");
    await obRun(
      vaultId,
      ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        view.contentEl.querySelector<HTMLElement>(box)!.scrollTop = 0;
      },
      { box: BOX },
    );
    await obRunUntil(
      vaultId,
      ({ app }, { far, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const first = list.querySelector("[data-index]");
        // The list draws its top again, and the selected row stays mounted.
        return (
          list.scrollTop === 0 &&
          first?.getAttribute("data-index") === "0" &&
          list.querySelector(`[data-query-item-row="${far}"]`) !== null
        );
      },
      { far, box: BOX },
      { what: "the selected paper mounted with the list at its top" },
    );
    await obRun(
      vaultId,
      ({ app }, { far }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        view.contentEl
          .querySelector<HTMLElement>(`[data-query-item-row="${far}"]`)!
          .dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              code: "ArrowDown",
              bubbles: true,
            }),
          );
      },
      { far },
    );
    await shownWhole(next, "the paper ↓ selected after the far one");
  }

  it("mounts only the Papers rows near the screen, and the list's height holds as the scroll bar is dragged to the last paper", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    const listed = await openLibrary("papers");
    expect(listed).toBeGreaterThan(LISTED);
    const drag = await dragToEnd("[data-query-papers-row]");
    expect(drag.mounted).toBeLessThan(80);
    // Rows measured on the way take the height their kind measured: the
    // scroll bar stays under the pointer.
    expect(drag.heightMoved).toBeLessThan(50);
    expect(drag.off).toBe(0);
    const keys = await listedKeys();
    await obRunUntil(
      vaultId,
      ({ app }, { last, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const row = view.contentEl.querySelector<HTMLElement>(
          `[data-query-item-row="${last}"]`,
        );
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        return (
          row !== null &&
          row.getBoundingClientRect().bottom <=
            list.getBoundingClientRect().bottom + 1
        );
      },
      { last: keys.at(-1)!, box: BOX },
      { what: "the last paper at the end of the drag" },
    );
  }, 180_000);

  it("mounts the Papers rows ahead of a scroll down, and draws a bar for each row not yet mounted", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    const ahead = await obRun(
      vaultId,
      async ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        list.scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // A scroll of 100 px a frame, as a slow drag of the scroll bar.
        for (let step = 0; step < 30; step++) {
          list.scrollTop += 100;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        const rows = list.querySelectorAll<HTMLElement>(
          "[data-query-papers-row]",
        );
        const spacer = list.querySelector<HTMLElement>("[data-query-spacer]");
        return {
          below:
            rows[rows.length - 1]!.getBoundingClientRect().bottom -
            list.getBoundingClientRect().bottom,
          bars: spacer ? getComputedStyle(spacer).backgroundImage : "none",
        };
      },
      { box: BOX },
    );
    // The overscan alone mounts eight rows, about 370 px, past the screen;
    // the scroll mounts four of its steps more.
    expect(ahead.below).toBeGreaterThan(600);
    expect(ahead.bars).toContain("linear-gradient");
  }, 120_000);

  it("brings a far paper into view from Show in Library, and ↓ steps on from it after the Papers list scrolled away", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    await revealThenStep();
  }, 120_000);

  it("mounts only the Table rows near the screen, and brings a far paper into view from Show in Library", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("table");
    const drag = await dragToEnd('tr[data-query-table-row="item"]');
    expect(drag.mounted).toBeLessThan(80);
    expect(drag.heightMoved).toBeLessThan(50);
    expect(drag.off).toBe(0);
    // A column the researcher has not sized holds its default width, wherever
    // the list scrolls: the first, where a title reads, wider than the rest.
    expect(drag.columnWidths).toHaveLength(1);
    const [first, ...later] = drag.columnWidths[0]!.split(" ").map(Number);
    expect(first).toBe(300);
    expect(new Set(later)).toEqual(new Set([150]));
    // A pane wider than the columns leaves its room to the filler after them.
    const wide = await obRun(
      vaultId,
      async ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const widths = () =>
          [...list.querySelectorAll("th[data-query-column]")]
            .map((th) => Math.round(th.getBoundingClientRect().width))
            .join(" ");
        const { width, flex } = list.style;
        try {
          list.style.flex = "none";
          list.style.width = `${list.scrollWidth + 600}px`;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const table = list.querySelector("table")!;
          return {
            widths: widths(),
            fills: Math.abs(table.offsetWidth - list.clientWidth) <= 1,
          };
        } finally {
          Object.assign(list.style, { width, flex });
        }
      },
      { box: BOX },
    );
    expect(wide).toEqual({ widths: drag.columnWidths[0], fills: true });
    await revealThenStep();
  }, 180_000);

  it("keeps mounting the Papers rows near the screen, and brings a far paper into view, after the Library View moves into a pop-out", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    await obRun(vaultId, ({ app }) => {
      const leaf = app.workspace.getLeavesOfType("zotlit-library")[0]!;
      app.workspace.moveLeafToPopout(leaf);
    });
    await obRunUntil(
      vaultId,
      ({ app }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]
          ?.view as LibraryView | undefined;
        return (
          view !== undefined &&
          view.contentEl.win !== window &&
          view.contentEl.querySelector("[data-query-papers-row]") !== null
        );
      },
      undefined,
      { what: "the Library View's rows in the pop-out" },
    );
    const drag = await dragToEnd("[data-query-papers-row]");
    expect(drag.mounted).toBeLessThan(80);
    expect(drag.heightMoved).toBeLessThan(50);
    expect(drag.off).toBe(0);
    await revealThenStep();
  }, 180_000);

  /** The box that scrolls an embed's rows, in each Items layout. */
  const EMBED_BOX =
    '[data-query-layout="papers"], [data-query-layout="list"], div:has(> [data-query-table])';

  /** The rows of each layout, as the page marks them. */
  const ROWS = {
    papers: "[data-query-papers-row]",
    table: 'tr[data-query-table-row="item"]',
    list: "[data-query-row]",
  } as const;

  it.each(["papers", "table", "list"] as const)(
    "caps a long %s embed's height, mounts the rows near the screen as the embed scrolls, and Export to PDF prints every row",
    async (layout) => {
      const queryPath = `Long ${layout}.zotquery`;
      const notePath = `Long ${layout}.md`;
      const pdfPath = join(fixture.root, `long-${layout}.pdf`);
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(() =>
        obRun(
          vaultId,
          async ({ app }, { queryPath, notePath }) => {
            for (const leaf of app.workspace.getLeavesOfType("markdown"))
              if ((leaf.view as MarkdownView).file?.path === notePath)
                leaf.detach();
            for (const path of [notePath, queryPath]) {
              const file = app.vault.getFileByPath(path);
              if (file) await app.vault.delete(file);
            }
          },
          { queryPath, notePath },
        ),
      );
      await obRun(
        vaultId,
        async ({ app }, { layout, queryPath, notePath }) => {
          await app.vault.create(
            queryPath,
            [
              "views:",
              `  - type: ${layout}`,
              "    name: All",
              "    from: items",
              '    filters: library == "personal"',
              "",
            ].join("\n"),
          );
          await app.vault.create(
            notePath,
            ["# Long list", "", `![[${queryPath}]]`, "", "The end.", ""].join(
              "\n",
            ),
          );
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode: "preview" },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { layout, queryPath, notePath },
      );
      const view = await revealQueryView(vaultId, notePath, {
        embed: queryPath,
      });
      // The embed stands no taller than its cap, and scrolls its own rows
      // 5,000 px down; the rows there mount.
      const capped = await obRunUntil(
        vaultId,
        async ({ page }, { view, box }) => {
          const el = await page.revealQueryView(view);
          const list = el.querySelector<HTMLElement>(box);
          if (!list) return null;
          list.scrollTop = 5000;
          return {
            height: el.getBoundingClientRect().height,
            scrolls: list.scrollHeight > list.clientHeight,
            scrolled: list.scrollTop,
          };
        },
        { view, box: EMBED_BOX },
        {
          what: "the embed scrolled 5,000 px down its own box",
          ready: (state) => state !== null && state.scrolled === 5000,
        },
      );
      expect(capped!.height).toBeLessThanOrEqual(501);
      expect(capped!.scrolls).toBe(true);
      const scrolled = await obRunUntil(
        vaultId,
        ({ app }, { notePath, rowSelector, box }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          // Reading view's own embed: the tab keeps Live Preview's, hidden,
          // beside it.
          const scroller = leaf.view.containerEl.querySelector<HTMLElement>(
            ".markdown-preview-view",
          )!;
          const host =
            scroller.querySelector<QueryViewElement>(".zt-query-view");
          const bounds = host
            ?.querySelector<HTMLElement>(box)
            ?.getBoundingClientRect();
          const rows = [
            ...(host?.querySelectorAll<HTMLElement>(rowSelector) ?? []),
          ];
          if (!bounds) return { listed: 0, mounted: 0, shown: 0 };
          return {
            listed:
              host?.zotlitQueryView?.state.getState().results?.rows.length ?? 0,
            mounted: rows.length,
            shown: rows.filter((row) => {
              const rowBounds = row.getBoundingClientRect();
              return (
                rowBounds.bottom > bounds.top && rowBounds.top < bounds.bottom
              );
            }).length,
          };
        },
        { notePath, rowSelector: ROWS[layout], box: EMBED_BOX },
        {
          ready: ({ shown }) => shown > 0,
          what: `${layout} rows in view 5,000 px into the embed`,
        },
      );
      expect(scrolled.mounted).toBeLessThan(80);

      // Obsidian's own Export to PDF, as the Query View print case drives it.
      const printed = await obRun(
        vaultId,
        async ({ app }, { notePath, pdfPath, rowSelector, box }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const modalProto = Object.getPrototypeOf(
            Object.getPrototypeOf(Object.getPrototypeOf(app.setting)),
          ) as Pick<QueryPrintModal, "open">;
          const open = modalProto.open;
          const capture: { modal: QueryPrintModal | null } = { modal: null };
          modalProto.open = new Proxy(open, {
            apply(target, receiver: QueryPrintModal, args) {
              capture.modal = receiver;
              return Reflect.apply(target, receiver, args);
            },
          });
          try {
            (leaf.view as unknown as { printToPdf(): void }).printToPdf();
          } finally {
            modalProto.open = open;
          }
          const modal = capture.modal!;
          modal.close();
          let rows = -1;
          let clipped = true;
          const print = modal.print.bind(modal);
          modal.print = async (el, component, includeName) => {
            const out = await print(el, component, includeName);
            rows = el.querySelectorAll(rowSelector).length;
            // The print lifts the cap: no box scrolls its rows out of the page.
            clipped = [...el.querySelectorAll<HTMLElement>(box)].some(
              (list) => list.scrollHeight > list.clientHeight + 1,
            );
            return out;
          };
          await modal.printToPdf({
            filepath: pdfPath,
            includeName: true,
            pageSize: "A4",
            landscape: false,
            marginsType: 0,
            scaleFactor: 100,
            scale: 1,
            open: false,
          });
          return { rows, clipped };
        },
        { notePath, pdfPath, rowSelector: ROWS[layout], box: EMBED_BOX },
        { timeoutMs: 180_000 },
      );
      expect(scrolled.listed).toBeGreaterThan(LISTED);
      expect(printed).toEqual({ rows: scrolled.listed, clipped: false });
    },
    240_000,
  );

  /**
   * Create `files`, and remove them and close their tabs once the case ends.
   */
  async function createFiles(
    cleanup: AsyncDisposableStack,
    files: Record<string, string>,
  ) {
    const paths = Object.keys(files);
    cleanup.defer(() =>
      obRun(
        vaultId,
        async ({ app }, { paths }) => {
          for (const leaf of app.workspace.getLeavesOfType("markdown"))
            if (paths.includes((leaf.view as MarkdownView).file?.path ?? ""))
              leaf.detach();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            if (paths.includes((leaf.view as MarkdownView).file?.path ?? ""))
              leaf.detach();
          for (const path of paths) {
            const file = app.vault.getFileByPath(path);
            if (file) await app.vault.delete(file);
          }
        },
        { paths },
      ),
    );
    await obRun(
      vaultId,
      async ({ app }, { files }) => {
        for (const [path, text] of Object.entries(files))
          await app.vault.create(path, text);
      },
      { files },
    );
  }

  it("keeps the List's height as the scroll bar is dragged while its rows wrap, and after Indent properties makes them taller", async () => {
    const path = "Long indent.zotquery";
    // A paper in three repeats its title, so the rows wrap to different
    // numbers of lines, as a real library's titles do.
    const view = (indent: boolean) =>
      [
        "formulas:",
        '  long: \'if(date.year % 3 == 0, title + " " + title + " " + title, title)\'',
        "views:",
        "  - type: list",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
        "    order:",
        "      - formula.long",
        "      - date",
        "      - itemType",
        ...(indent ? ["    indentProperties: true"] : []),
        "",
      ].join("\n");
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, { [path]: view(false) });
    await obRun(
      vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    /** The List of the Query File tab drawn the way `indent` asks. */
    const drawn = (indent: boolean) =>
      obRunUntil(
        vaultId,
        ({ app }, { path, indent }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as MarkdownView).file?.path === path);
          const row = leaf?.view.containerEl.querySelector(
            '[data-query-layout="list"] li[data-query-row]',
          );
          // An indented row holds its other properties on lines below.
          const indented = [...(row?.children ?? [])].some((child) =>
            child.className.includes("zt:block"),
          );
          return row != null && indented === indent;
        },
        { path, indent },
        {
          what: `the List drawn with Indent properties ${indent ? "on" : "off"}`,
        },
      );
    /**
     * Drag the List's scroll bar from top to end, a step each frame; at
     * `width`, where the rows wrap to more lines, the longer ones to more.
     */
    const drag = (width?: number) =>
      obRun(
        vaultId,
        async ({ app }, { path, width }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as MarkdownView).file?.path === path)!;
          const list = leaf.view.containerEl.querySelector<HTMLElement>(
            '[data-query-layout="list"]',
          )!;
          const style = { width: list.style.width, flex: list.style.flex };
          if (width !== undefined)
            Object.assign(list.style, { width: `${width}px`, flex: "none" });
          try {
            list.scrollTop = 0;
            for (let still = 0, last = -1, tries = 0; still < 5; tries++) {
              if (tries > 120) throw new Error("The List's height never held");
              await new Promise((resolve) => requestAnimationFrame(resolve));
              still = list.scrollHeight === last ? still + 1 : 0;
              last = list.scrollHeight;
            }
            const start = list.scrollHeight;
            const heights = new Set<number>();
            let mounted = 0;
            const end = list.scrollHeight - list.clientHeight;
            for (let at = 0; at <= end; at += 200) {
              list.scrollTop = at;
              await new Promise((resolve) => requestAnimationFrame(resolve));
              heights.add(list.scrollHeight);
              mounted = Math.max(
                mounted,
                list.querySelectorAll("li[data-query-row]").length,
              );
            }
            return {
              start,
              mounted,
              heightMoved: Math.max(...heights) - Math.min(...heights),
            };
          } finally {
            Object.assign(list.style, style);
          }
        },
        { path, width },
        { timeoutMs: 120_000 },
      );
    await drawn(false);
    const inline = await drag();
    // Narrow, a row wraps to as many lines as its text takes there.
    const wrapped = await drag(180);
    expect(wrapped.start).toBeGreaterThan(inline.start * 1.5);
    expect(wrapped.heightMoved).toBeLessThan(50);
    await obRun(
      vaultId,
      async ({ app }, { path, text }) => {
        await app.vault.modify(app.vault.getFileByPath(path)!, text);
      },
      { path, text: view(true) },
    );
    await drawn(true);
    const indented = await drag();
    expect(inline.mounted).toBeLessThan(80);
    expect(indented.mounted).toBeLessThan(80);
    // The rows take more lines, and the list learns their new height.
    expect(indented.start).toBeGreaterThan(inline.start * 1.3);
    expect(indented.heightMoved).toBeLessThan(50);
  }, 180_000);

  it("mounts a bounded number of rows of a long embed in a folded callout, and the rows near the screen once it unfolds", async () => {
    const queryPath = "Long fold.zotquery";
    const notePath = "Long fold.md";
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, {
      [queryPath]: [
        "views:",
        "  - type: papers",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
        "",
      ].join("\n"),
      [notePath]: [
        "# Folded",
        "",
        "> [!note]- Long list",
        `> ![[${queryPath}]]`,
        "",
        "The end.",
        "",
      ].join("\n"),
    });
    await obRun(
      vaultId,
      async ({ app }, { notePath }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(notePath)!, {
          state: { mode: "preview" },
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { notePath },
    );
    /** The folded state, and the embed's listed, mounted and shown rows. */
    const state = (
      what: string,
      ready: (s: {
        folded: boolean;
        listed: number;
        mounted: number;
        shown: number;
      }) => boolean,
    ) =>
      obRunUntil(
        vaultId,
        ({ app }, { notePath }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const scroller = leaf.view.containerEl.querySelector<HTMLElement>(
            ".markdown-preview-view",
          )!;
          const callout = scroller.querySelector<HTMLElement>(".callout");
          const host =
            scroller.querySelector<QueryViewElement>(".zt-query-view");
          const bounds = scroller.getBoundingClientRect();
          const rows = [
            ...(host?.querySelectorAll<HTMLElement>(
              "[data-query-papers-row]",
            ) ?? []),
          ];
          return {
            folded: callout?.classList.contains("is-collapsed") ?? false,
            listed:
              host?.zotlitQueryView?.state.getState().results?.rows.length ?? 0,
            mounted: rows.length,
            shown: rows.filter((row) => {
              const rowBounds = row.getBoundingClientRect();
              return (
                rowBounds.height > 0 &&
                rowBounds.bottom > bounds.top &&
                rowBounds.top < bounds.bottom
              );
            }).length,
          };
        },
        { notePath },
        { what, ready },
      );
    const folded = await state(
      "the embed's rows listed in the folded callout",
      (s) => s.folded && s.listed > LISTED,
    );
    expect(folded.mounted).toBeLessThan(80);
    await obRun(
      vaultId,
      ({ app }, { notePath }) => {
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
        leaf.view.containerEl
          .querySelector<HTMLElement>(".markdown-preview-view .callout-title")!
          .click();
      },
      { notePath },
    );
    const open = await state(
      "the embed's rows in view once the callout unfolds",
      (s) => !s.folded && s.shown > 0,
    );
    expect(open.mounted).toBeLessThan(80);
  }, 180_000);

  it("hides the rows a Table embed in a callout scrolls under its header, in the callout's tint", async () => {
    const queryPath = "Long callout table.zotquery";
    const notePath = "Long callout table.md";
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, {
      [queryPath]: [
        "views:",
        "  - type: table",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
        "",
      ].join("\n"),
      [notePath]: ["> [!note] A table", `> ![[${queryPath}]]`, ""].join("\n"),
    });
    await obRun(
      vaultId,
      async ({ app }, { notePath }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(notePath)!, {
          state: { mode: "preview" },
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { notePath },
    );
    const header = await obRunUntil(
      vaultId,
      ({ app }, { notePath }) => {
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
        const table = leaf.view.containerEl.querySelector<HTMLTableElement>(
          ".markdown-preview-view .callout [data-query-table]",
        );
        const cell = table?.tHead?.rows[0]?.cells[1];
        if (!table || !cell || !table.tBodies.length) return null;
        table.parentElement!.scrollTop = 600;
        const style = getComputedStyle(cell);
        return {
          scrolled: table.parentElement!.scrollTop,
          color: style.backgroundColor,
          tint: style.backgroundImage,
        };
      },
      { notePath },
      {
        what: "the callout's Table scrolled under its header",
        ready: (h) => h !== null && h.scrolled > 0,
      },
    );
    // An opaque colour has no alpha part, `rgb(...)`; the tint lies over it.
    expect(header!.color).toMatch(/^rgb\(/);
    expect(header!.tint).toContain("linear-gradient");
  }, 120_000);
});
