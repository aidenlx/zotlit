// The walk of the lesson apps/docs/content/docs/(intro)/
// connect-zotero-to-obsidian.mdx: a researcher who has never used ZotLit
// turns it on, sees it connect to their Zotero library, finds a paper, reads
// its PDF in Obsidian, writes a first literature note with a thought of their
// own, and goes back from the note to the highlighted passage. Each `it` is
// one step of the page, in the page's order, and asserts what the page says
// the reader sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see
// AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import type { PagePdfView } from "@e2e/page-notes-types.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type { FileView, ItemView, MarkdownView, WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";

import { openDocsWalk, readNotices, watchNotices } from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five highlights. */
const PAPER = {
  key: "DCSNDART",
  attachmentKey: "DCSNDPDF",
  title: "Ten Simple Rules for Reproducible Computational Research",
  citekey: "sandve2013",
  annotations: 5,
  /** The blue highlight on page 2 the reader goes back to. */
  passage: "SV6RZB2J",
};
/** Every top-level Item in the docs Vault Case's library. */
const LIBRARY_ITEMS = 5;
const SEARCH = "reproducible";
const NOTE = `literatures/${PAPER.citekey}.md`;
const THOUGHTS =
  "## My thoughts\n\nRule 1 is the habit my methods chapter lacks: each figure needs a record of the script and data that made it.";
/**
 * The folder a reader's Zotero data sits in by default, which the Connect
 * step names. The walk's Fixture lives in the worktree, so the first
 * screenshot shows this path in its place.
 */
const READER_DATA_DIR = "~/Zotero";

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type NoteLeaf = WorkspaceLeaf & { view: MarkdownView };
/** Obsidian's plugin manager, with the calls that also save the plugin list. */
interface SavingPlugins {
  disablePluginAndSave(id: string): Promise<void>;
  enablePluginAndSave(id: string): Promise<void>;
}

describe.skipIf(!reachable)(
  "Connect Zotero to Obsidian and write your first literature note",
  () => {
    let walk: DocsWalk;
    let dataDir: string | null;

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: "connect-zotero-to-obsidian",
        collection: "get-started",
        vaultCase: "docs",
      });
      dataDir = await obRun(
        walk.vaultId,
        ({ zotlit }) =>
          zotlit.services.bridge.runSync(zotlit.services.zoteroPref.current)
            .dataDirOverride,
      );
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("turns on ZotLit, which opens the Zotero library with its setup steps", async () => {
      // The Paired Run loaded ZotLit once to point it at the Fixture, and that
      // load saved its settings. The reader's first launch has none, so the
      // walk clears them and turns ZotLit on again, as the reader does under
      // Settings → Community plugins. The Fixture's data folder stays set.
      await obRun(walk.vaultId, async ({ app }) => {
        const plugins = app.plugins as typeof app.plugins & SavingPlugins;
        await plugins.disablePluginAndSave("zotlit");
        await app.vault.adapter.remove(".obsidian/plugins/zotlit/data.json");
        app.workspace.iterateRootLeaves((l) => l.detach());
        await plugins.enablePluginAndSave("zotlit");
      });
      await watchNotices(walk.vaultId);
      const first = await obRun(walk.vaultId, async ({ app, page }) => {
        const el = await page.until(
          "Library View",
          () =>
            (
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined
            )?.view.contentEl,
          20000,
        );
        const steps = () =>
          [...el.querySelectorAll<HTMLElement>("[data-welcome-step]")].map(
            (s) => s.dataset.welcomeStep!,
          );
        await page.until(
          "setup steps",
          () => steps().length === 3 && !steps().includes("checking"),
          20000,
        );
        const step = (id: number) =>
          [...el.querySelectorAll<HTMLElement>("[data-welcome-step]")][id]!;
        return {
          badge: el.querySelector("[data-welcome-badge]")?.textContent ?? null,
          steps: steps(),
          connect: step(0).innerText,
          folder: step(1).innerText,
        };
      });
      expect(first.badge).toBe(m.welcome_badge());
      // Connect and Open your library are done; the notes folder waits.
      expect(first.steps).toEqual(["done", "todo", "done"]);
      expect(first.connect).toContain(m.welcome_step_connect_title());
      expect(first.connect).toContain(
        m.welcome_step_connect_connected({ count: LIBRARY_ITEMS }),
      );
      expect(first.folder).toContain(m.welcome_step_folder_title());
      expect(first.folder).toContain(
        m.welcome_step_folder_body({ folder: "literatures" }),
      );
      await obRun(
        walk.vaultId,
        ({ app }, { dir }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          const code = el.querySelector("[data-welcome-step] code")!;
          code.textContent = dir;
        },
        { dir: READER_DATA_DIR },
      );
      await walk.capture("first-screen");
      await walk.compose("first-screen");
    });

    it("shows Locate data folder when ZotLit cannot find the Zotero data", async () => {
      const missing = await obRun(
        walk.vaultId,
        async ({ app, zotlit, page }, { body, locate }) => {
          zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.setDataDir(
              "/Users/Shared/No Zotero here",
            ),
          );
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          await page.until(
            "not found",
            () => el.innerText.includes(body),
            20000,
          );
          const notFound = [...el.querySelectorAll("button")].find(
            (b) => b.textContent === locate && b.checkVisibility(),
          );
          return {
            title: el.innerText,
            action: notFound?.textContent ?? null,
          };
        },
        {
          body: m.library_view_not_found_body(),
          locate: m.library_view_locate(),
        },
      );
      expect(missing.title).toContain(m.library_view_not_found());
      expect(missing.title).toContain(m.library_view_not_found_body());
      expect(missing.action).toBe(m.library_view_locate());
      await walk.capture("not-found");
      await walk.compose("not-found");
      // The reader locates the folder; the walk sets the Fixture's back.
      await obRun(
        walk.vaultId,
        async ({ app, zotlit, page }, { dir, key }) => {
          zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.setDataDir(dir),
          );
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          await page.until(
            "papers again",
            () => el.querySelector(`[data-query-item-row="${key}"]`),
            20000,
          );
        },
        { dir: dataDir, key: PAPER.key },
      );
    });

    it("finds the paper by searching and shows its Reading Card", async () => {
      const found = await obRun(
        walk.vaultId,
        async ({ app, page }, { search, key }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]")!;
          await leaf.view.query.settled;
          const input = el.querySelector<HTMLInputElement>(
            "[data-library-search] input",
          )!;
          input.focus();
          input.value = search;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await leaf.view.searched;
          await leaf.view.query.settled;
          page.press(
            await page.until(
              "paper row",
              () => {
                const r = el.querySelector<HTMLElement>(
                  `[data-query-item-row="${key}"]`,
                );
                return r?.checkVisibility() && r;
              },
              10000,
            ),
            "paper row",
          );
          await page.until("Reading Card", () => card.checkVisibility(), 10000);
          await leaf.view.card.settled;
          return {
            rows: [...el.querySelectorAll("[data-query-papers-row]")].map((n) =>
              n.getAttribute("data-query-papers-row"),
            ),
            title: card.querySelector("[data-library-card-title]")!.textContent,
            actions: ["pdf", "note"].map(
              (a) =>
                card.querySelector(`[data-library-card-action="${a}"]`)
                  ?.textContent ?? "",
            ),
            quotes: card.querySelectorAll("[data-library-card-quote]").length,
          };
        },
        { search: SEARCH, key: PAPER.key },
      );
      expect(found.rows).toContain(PAPER.key);
      expect(found.title).toBe(PAPER.title);
      expect(found.actions).toEqual([
        m.library_view_menu_open_pdf(),
        m.library_view_menu_write_note(),
      ]);
      expect(found.quotes).toBe(2);
      await walk.capture("find-paper");
      await walk.compose("find-paper");
    });

    it("opens the PDF in Obsidian with the highlights made in Zotero", async () => {
      const pdfPath = await walk.zotero.json<string>(
        `Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(PAPER.attachmentKey)}).getFilePath()`,
      );
      const opened = await obRunUntil(
        walk.vaultId,
        ({ app, page }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const card = leaf.view.contentEl.querySelector<HTMLElement>(
            "[data-library-card]",
          )!;
          if (!app.workspace.getLeavesOfType("pdf").length)
            page.press(
              card.querySelector<HTMLElement>(
                '[data-library-card-action="pdf"]',
              ),
              "Open PDF",
            );
          const pdf = app.workspace.getLeavesOfType("pdf")[0];
          if (!pdf) return null;
          const side = (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
              | ItemView
              | undefined
          )?.contentEl;
          return {
            file:
              app.workspace.activeLeaf === pdf
                ? ((pdf.view as FileView).file?.path ?? null)
                : null,
            cards: side
              ? side.querySelectorAll("[data-zotero-annotation-key]").length
              : 0,
            library:
              app.workspace.getLeavesOfType("zotlit-library").length === 1,
          };
        },
        undefined,
        {
          what: "the PDF and its annotations",
          ready: (value) =>
            value !== null &&
            value.file !== null &&
            value.cards >= PAPER.annotations,
        },
      );
      // ZotLit reads the PDF where Zotero stores it; nothing is copied into the vault.
      expect(decodeURI(opened!.file ?? "")).toContain(pdfPath.split("/").pop());
      expect(opened!.file).not.toMatch(/^Papers\//);
      expect(opened!.library).toBe(true);
      await walk.capture("pdf");
      await walk.compose("pdf");
    });

    it("writes the first literature note and puts the setup steps away", async () => {
      const written = await obRun(
        walk.vaultId,
        async ({ app, page }, { note }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]")!;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await page.until(
            "library in front",
            () => card.checkVisibility(),
            5000,
          );
          page.press(
            card.querySelector<HTMLElement>(
              '[data-library-card-action="note"]',
            ),
            "Write literature note",
          );
          await page.until(
            "note",
            () => app.workspace.getActiveFile()?.path === note,
            20000,
          );
          await page.until(
            "banner gone",
            () => !el.querySelector("[data-welcome-banner]"),
            10000,
          );
          return {
            active: app.workspace.getActiveFile()?.path ?? null,
            prompt: !!document.querySelector(".prompt"),
            banner: !!el.querySelector("[data-welcome-banner]"),
          };
        },
        { note: NOTE },
      );
      // One profile, so ZotLit asks nothing; the notes folder now exists.
      expect(written).toEqual({ active: NOTE, prompt: false, banner: false });
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_created_note(),
      );
    });

    it("keeps the reader's own thoughts written in the note", async () => {
      const note = await obRunUntil(
        walk.vaultId,
        async ({ app }, { note }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === note) as
            | NoteLeaf
            | undefined;
          if (!leaf) return null;
          const el = leaf.view.contentEl;
          return {
            cards: el.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ).length,
            body: await app.vault.read(leaf.view.file!),
          };
        },
        { note: NOTE },
        {
          what: "the new note",
          ready: (value) => value !== null && value.cards === PAPER.annotations,
        },
      );
      expect(note!.body).toContain(`citekey: ${PAPER.citekey}`);
      const body = await obRun(
        walk.vaultId,
        async ({ app }, { note, thoughts }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === note,
            ) as NoteLeaf;
          const cm = leaf.view.editor.cm;
          const doc = cm.state.doc.toString();
          const at = doc.indexOf("\n\n## Annotations");
          cm.dispatch({
            changes: { from: at, insert: `\n\n${thoughts}` },
            userEvent: "input.type",
          });
          cm.dispatch({ selection: { anchor: cm.state.doc.length } });
          await leaf.view.save();
          leaf.view.contentEl.querySelector(".cm-scroller")!.scrollTop = 0;
          return app.vault.read(leaf.view.file!);
        },
        { note: NOTE, thoughts: THOUGHTS },
      );
      expect(body).toContain(THOUGHTS);
      expect(body.indexOf(THOUGHTS)).toBeLessThan(body.indexOf("```zotquery"));
      // The thoughts sit above the cards, and the first cards show below them.
      await obRun(
        walk.vaultId,
        async ({ app }, { note }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === note,
            ) as NoteLeaf;
          const s = leaf.view.contentEl.querySelector(".cm-scroller")!;
          const h = [
            ...leaf.view.contentEl.querySelectorAll<HTMLElement>(".cm-line"),
          ].find((n) => n.textContent === "My thoughts");
          s.scrollTop = h ? h.offsetTop - 320 : 0;
          await new Promise((r) => setTimeout(r, 500));
        },
        { note: NOTE },
      );
      await walk.capture("first-note");
      await walk.compose("first-note");
    });

    it("goes back to the highlighted passage from its card in the note", async () => {
      const landed = await obRun(
        walk.vaultId,
        async ({ app, page }, { note, passage }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === note,
            ) as WorkspaceLeaf;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const chip = await page.until(
            "page chip",
            () =>
              (leaf.view as MarkdownView).contentEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key="${passage}"] a.zt-annot-page-chip`,
              ),
            10000,
          );
          chip.scrollIntoView({ block: "center" });
          await new Promise((r) => setTimeout(r, 500));
          const tip = chip.getAttribute("aria-label");
          await page.trusted(window).click(chip);
          await page.until(
            "PDF in the note tab",
            () => leaf.view.getViewType() === "pdf",
            10000,
          );
          const selected = await page.until(
            "passage selected",
            () => {
              const k = [
                ...document.querySelectorAll<HTMLElement>(
                  "[data-zotero-annotation-key].is-selected,[data-zotero-annotation-key][aria-selected=true]",
                ),
              ].map((e) => e.dataset.zoteroAnnotationKey!);
              return k.length ? k : false;
            },
            10000,
          );
          await new Promise((r) => setTimeout(r, 1000));
          return {
            tip,
            sameTab: leaf.view.getViewType() === "pdf",
            page:
              (leaf.view as PagePdfView).viewer?.child?.pdfViewer?.pdfViewer
                ?.currentPageNumber ?? null,
            selected: [...new Set(selected)],
          };
        },
        { note: NOTE, passage: PAPER.passage },
      );
      expect(landed.tip).toBe(m.annot_view_open_page());
      expect(landed.sameTab).toBe(true);
      expect(landed.page).toBe(2);
      expect(landed.selected).toEqual([PAPER.passage]);
      await walk.capture("back-to-passage");
      await walk.compose("back-to-passage");
      // The back arrow at the top of the tab returns to the note.
      const back = await obRun(walk.vaultId, async ({ app, page }) => {
        const leaf = app.workspace.activeLeaf!;
        page.press(
          leaf.view.containerEl.querySelector<HTMLElement>(
            ".view-header-nav-buttons button",
          ),
          "back arrow",
        );
        return page.until(
          "back to the note",
          () =>
            leaf.view.getViewType() === "markdown" &&
            (leaf.view as FileView).file?.path,
          10000,
        );
      });
      expect(back).toBe(NOTE);
    });
  },
);
