// The walk of /learn Lesson 1, "Connect Zotero to Obsidian and write your
// first literature note": a researcher who has never used ZotLit turns it on,
// sees it connect to their Zotero library, finds Sandve et al. 2013, reads its
// PDF in Obsidian, writes a first literature note, and adds a thought of their
// own. Each `it` is one step of the lesson, in the lesson's order, named after
// it, and asserts what the lesson says the reader sees. Run it with
// `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import type { PagePdfView } from "@e2e/page-notes-types.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type { FileView, MarkdownView, WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LibraryView } from "@/views/library/view";

import { openDocsWalk, readNotices, watchNotices } from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "connect-zotero-to-obsidian";
/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five annotations. */
const PAPER = {
  key: "DCSNDART",
  title: "Ten Simple Rules for Reproducible Computational Research",
  citekey: "sandve2013",
  creators: "Sandve",
  venue: "PLOS Computational Biology",
  annotations: 5,
};
/** Every top-level Item in the docs Vault Case's library. */
const LIBRARY_ITEMS = 5;
/** A few words of the title, as the reader types them. */
const SEARCH = "reproducible computational";
const NOTE = `literatures/${PAPER.citekey}.md`;
const HEADING = "## My thoughts";
const THOUGHTS =
  "Rule 1 is the habit my methods chapter lacks: each figure needs a record of the script and data that made it.";
/**
 * The folder a reader's Zotero data sits in by default. The walk's Fixture
 * lives in the worktree, so the images show this path in its place.
 */
const READER_DATA_DIR = "~/Zotero";

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type NoteLeaf = WorkspaceLeaf & { view: MarkdownView };
/** Obsidian's plugin manager, with the calls that also save the plugin list. */
interface SavingPlugins {
  disablePluginAndSave(id: string): Promise<void>;
  enablePluginAndSave(id: string): Promise<void>;
}

/** One step's calls into the apps can wait on Zotero: up to a minute. */
const STEP = { timeoutMs: 60000 };

describe.skipIf(!reachable)(
  "Lesson 1: Connect Zotero to Obsidian and write your first literature note",
  () => {
    let walk: DocsWalk;

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `learn/${SLUG}`,
        vaultCase: "docs",
      });
      // The PDF tab's path runs through the Fixture's folders; the images
      // show the file name alone.
      await obRun(walk.vaultId, () => {
        const style = document.head.createEl("style");
        style.textContent =
          '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
      });
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("step 1: install and enable ZotLit; a tab named Zotero library opens", async () => {
      // Browse and Install in Settings → Community plugins reach the network
      // and the community list, which the Fixture cannot walk: the Fixture
      // installs the plugin. The Paired Run also loaded ZotLit once to point
      // it at the Fixture, which saved its settings, so the walk clears them
      // and turns ZotLit on again, as Enable does.
      await obRun(
        walk.vaultId,
        async ({ app }) => {
          const plugins = app.plugins as typeof app.plugins & SavingPlugins;
          await plugins.disablePluginAndSave("zotlit");
          await app.vault.adapter.remove(".obsidian/plugins/zotlit/data.json");
          app.workspace.iterateRootLeaves((l) => l.detach());
          await plugins.enablePluginAndSave("zotlit");
        },
        undefined,
        STEP,
      );
      await watchNotices(walk.vaultId);
      const first = await obRun(
        walk.vaultId,
        async ({ app, page }) => {
          const leaf = await page.until(
            "Library View",
            () =>
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined,
            30000,
          );
          const el = leaf.view.contentEl;
          const rows = () => [
            ...el.querySelectorAll<HTMLElement>("[data-welcome-step]"),
          ];
          await page.until(
            "setup steps",
            () =>
              rows().length > 0 &&
              !rows().some((s) => s.dataset.welcomeStep === "checking"),
            30000,
          );
          const early = rows().map((s) => s.dataset.welcomeStep!);
          // ZotLit re-reads Zotero's add-on list for 15 seconds after start.
          await new Promise((r) => setTimeout(r, 16000));
          return {
            tab: leaf.getDisplayText(),
            tabActive: app.workspace.getMostRecentLeaf() === leaf,
            badge:
              el.querySelector("[data-welcome-badge]")?.textContent ?? null,
            early,
            steps: rows().map((s) => ({
              state: s.dataset.welcomeStep!,
              text: s.innerText.replaceAll(/\s+/g, " ").trim(),
            })),
          };
        },
        undefined,
        { timeoutMs: 90000 },
      );
      console.log("[walk] first launch", JSON.stringify(first));
      expect(first.tab).toBe(m.library_view_name());
      expect(first.tabActive).toBe(true);
      expect(first.badge).toBe(m.welcome_badge());
      // Fact a: the order and the text of the checklist on a first launch.
      expect(first.steps).toHaveLength(4);
      expect(first.steps[0]!.text).toContain(m.welcome_step_connect_title());
      expect(first.steps[1]!.text).toContain(m.welcome_step_folder_title());
      expect(first.steps[2]!.text).toContain(m.welcome_step_library_title());
      expect(first.steps[3]!.text).toContain(m.welcome_step_companion_title());
      // Connect and Open your library are done; the notes folder waits. The
      // Paired Zotero loads ZotLit Companion from a proxy file that its
      // extensions.json does not list, and ZotLit reads that list, so the
      // Companion step stays at Recommended here.
      expect(first.steps.map((s) => s.state)).toEqual([
        "done",
        "todo",
        "done",
        "todo",
      ]);
      expect(first.steps[3]!.text).toContain(
        m.welcome_step_companion_recommended(),
      );
      await obRun(
        walk.vaultId,
        ({ app }, { dir }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
          ).view.contentEl;
          const code = el.querySelector("[data-welcome-step] code");
          if (code) code.textContent = dir;
        },
        { dir: READER_DATA_DIR },
      );
      await walk.capture("step-1");
      await walk.compose("step-1");
    }, 120000);

    it("step 2: look at the first line of the tab; Connect to Zotero has a green check and your item count", async () => {
      const line = await obRun(walk.vaultId, ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
        ).view.contentEl;
        const row = el.querySelector<HTMLElement>("[data-welcome-step]")!;
        const mark = row.querySelector<HTMLElement>("[data-welcome-mark]")!;
        const probe = document.body.createDiv({ cls: "zt-root" });
        probe.style.color = "var(--color-green)";
        const green = getComputedStyle(probe).color;
        probe.remove();
        return {
          state: row.dataset.welcomeStep!,
          text: row.innerText.replaceAll(/\s+/g, " ").trim(),
          icon: mark.querySelector("svg")?.classList.contains("lucide-check"),
          markColor: getComputedStyle(mark).color,
          green,
        };
      });
      console.log("[walk] connect line", JSON.stringify(line));
      expect(line.state).toBe("done");
      expect(line.text).toContain(m.welcome_step_connect_title());
      expect(line.text).toContain(
        m.welcome_step_connect_connected({ count: LIBRARY_ITEMS }),
      );
      expect(line.icon).toBe(true);
      expect(line.markColor).toBe(line.green);
      await walk.capture("step-2");
      await walk.compose("step-2");
    });

    it("step 3: type a few words of a title into Search papers and select the paper; a card with the authors, the journal, and two buttons", async () => {
      const found = await obRun(
        walk.vaultId,
        async ({ app, page }, { search, key }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          await leaf.view.query.settled;
          const input = el.querySelector<HTMLInputElement>(
            "[data-library-search] input",
          )!;
          const placeholder = input.placeholder;
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
          const card = await page.until(
            "Reading Card",
            () => {
              const c = el.querySelector<HTMLElement>("[data-library-card]");
              return c?.checkVisibility() && c;
            },
            10000,
          );
          await leaf.view.card.settled;
          const rect = (n: Element | null | undefined) => {
            const r = n?.getBoundingClientRect();
            return r
              ? {
                  x: Math.round(r.x),
                  y: Math.round(r.y),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                }
              : null;
          };
          const visible = [
            ...card.querySelectorAll<HTMLElement>("[data-library-card-action]"),
          ].filter((b) => b.checkVisibility());
          const tree = el.querySelector<HTMLElement>("[data-library-tree]");
          return {
            placeholder,
            rows: [...el.querySelectorAll("[data-query-item-row]")].map((n) =>
              n.getAttribute("data-query-item-row"),
            ),
            title: card.querySelector("[data-library-card-title]")!.textContent,
            creators:
              card.querySelector("[data-library-card-creators]")?.textContent ??
              "",
            venue:
              card.querySelector("[data-library-card-venue]")?.textContent ??
              "",
            buttons: visible.map((b) => ({
              action: b.dataset.libraryCardAction!,
              text: b.innerText.trim(),
              label: b.getAttribute("aria-label"),
            })),
            // Fact d: where the card sits beside the list, at the walk's window size.
            layout: {
              window: { w: window.innerWidth, h: window.innerHeight },
              pane: rect(el),
              row: rect(el.querySelector("[data-query-item-row]")),
              card: rect(card),
              treeShown: tree?.checkVisibility() ?? false,
              tree: rect(tree),
            },
          };
        },
        { search: SEARCH, key: PAPER.key },
        STEP,
      );
      console.log("[walk] card", JSON.stringify(found));
      expect(found.placeholder).toBe(m.library_view_search_placeholder());
      expect(found.rows).toContain(PAPER.key);
      expect(found.title).toBe(PAPER.title);
      expect(found.creators).toContain(PAPER.creators);
      expect(found.venue).toContain(PAPER.venue);
      expect(found.buttons.filter((b) => b.text).map((b) => b.text)).toEqual([
        m.library_view_menu_open_pdf(),
        m.library_view_menu_write_note(),
      ]);
      // At this window size the card sits under the list, below the banner,
      // and its buttons start under the tab's lower edge: the reader scrolls
      // the tab down to reach them.
      const below = await obRun(walk.vaultId, async ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library")[0] as LibraryLeaf
        ).view.contentEl;
        const pdf = el.querySelector<HTMLElement>(
          '[data-library-card] [data-library-card-action="pdf"]',
        )!;
        const hidden =
          pdf.getBoundingClientRect().top > el.getBoundingClientRect().bottom;
        pdf.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((r) => setTimeout(r, 300));
        return hidden;
      });
      console.log("[walk] card buttons below the fold", below);
      await walk.capture("step-3");
      await walk.compose("step-3");
    });

    it("step 4: select Open PDF; the PDF in a new tab, with your Zotero highlights in colour", async () => {
      const opened = await obRunUntil(
        walk.vaultId,
        ({ app, page }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          if (!app.workspace.getLeavesOfType("pdf").length)
            page.press(
              leaf.view.contentEl.querySelector<HTMLElement>(
                '[data-library-card] [data-library-card-action="pdf"]',
              ),
              "Open PDF",
            );
          const pdf = app.workspace.getLeavesOfType("pdf")[0];
          if (!pdf) return null;
          const marks = [
            ...pdf.view.containerEl.querySelectorAll<HTMLElement>(
              ".zt-pdf-annotation-mark",
            ),
          ];
          return {
            file: (pdf.view as FileView).file?.name ?? null,
            active: app.workspace.getMostRecentLeaf() === pdf,
            ownTab:
              pdf !== leaf && leaf.view.getViewType() === "zotlit-library",
            marks: new Set(marks.map((n) => n.dataset.zoteroAnnotationKey))
              .size,
            colours: new Set(
              // Each mark draws in its Zotero colour, as an SVG fill or stroke.
              marks.map((n) => {
                const painted = n.matches("[fill],[stroke]")
                  ? n
                  : n.querySelector("[fill],[stroke]");
                return (
                  painted?.getAttribute("fill") ??
                  painted?.getAttribute("stroke") ??
                  null
                );
              }),
            ).size,
          };
        },
        undefined,
        {
          what: "the PDF and its highlights",
          ready: (value) => value !== null && value.active && value.marks >= 3,
        },
      );
      console.log("[walk] pdf", JSON.stringify(opened));
      expect(opened!.file).toContain("Sandve");
      expect(opened!.ownTab).toBe(true);
      // Page 1 is in view with its three marks, each in its own colour.
      expect(opened!.marks).toBeGreaterThanOrEqual(3);
      expect(opened!.colours).toBeGreaterThanOrEqual(3);
      // The PDF opens on the page Zotero last showed; the reader scrolls to
      // page 1, where three highlights sit.
      const page = await obRun(walk.vaultId, async ({ app }) => {
        const pdf = app.workspace.getLeavesOfType("pdf")[0]!;
        const opened =
          (pdf.view as PagePdfView).viewer?.child?.pdfViewer?.pdfViewer
            ?.currentPageNumber ?? null;
        pdf.view.containerEl
          .querySelector('.page[data-page-number="1"]')
          ?.scrollIntoView({ block: "start" });
        await new Promise((r) => setTimeout(r, 800));
        return opened;
      });
      console.log("[walk] pdf opened on page", page);
      await walk.capture("step-4");
      await walk.compose("step-4");
    });

    it("step 5: go back to the Zotero library tab and select Write literature note; the notice Literature note created. and the note in a new tab", async () => {
      const written = await obRun(
        walk.vaultId,
        async ({ app, page }, { note }) => {
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const card = leaf.view.contentEl.querySelector<HTMLElement>(
            "[data-library-card]",
          )!;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await page.until(
            "library in front",
            () => card.checkVisibility(),
            5000,
          );
          const button = card.querySelector<HTMLElement>(
            '[data-library-card-action="note"]',
          )!;
          const label = button.innerText.trim();
          page.press(button, "Write literature note");
          await page.until(
            "note",
            () => app.workspace.getActiveFile()?.path === note,
            20000,
          );
          const noteLeaf = app.workspace.getMostRecentLeaf()!;
          return {
            label,
            active: app.workspace.getActiveFile()?.path ?? null,
            ownTab:
              noteLeaf !== leaf &&
              !app.workspace.getLeavesOfType("pdf").includes(noteLeaf) &&
              leaf.view.getViewType() === "zotlit-library",
            prompt: !!document.querySelector(".prompt"),
          };
        },
        { note: NOTE },
        STEP,
      );
      expect(written).toEqual({
        label: m.library_view_menu_write_note(),
        active: NOTE,
        ownTab: true,
        prompt: false,
      });
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_created_note(),
      );
      await walk.capture("step-5", { notices: true });
      await walk.compose("step-5");
    });

    it("step 6: under the two links, type a heading and your own thoughts; your text above the Annotations section", async () => {
      const note = await obRunUntil(
        walk.vaultId,
        async ({ app }, { note }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === note) as
            | NoteLeaf
            | undefined;
          if (!leaf) return null;
          return {
            cards: leaf.view.contentEl.querySelectorAll(
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
      console.log("[walk] new note", JSON.stringify(note!.body));
      // The body under the Properties: the title, one line with the two
      // links (the paper in Zotero, its PDF), then the Annotations section.
      const body = note!.body.replace(/^---\n[\s\S]*?\n---\n/, "");
      const [links = "", annotations = ""] = body.split("## Annotations");
      expect(annotations).toContain("```zotquery");
      const linkLines = links
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      expect(linkLines).toHaveLength(2);
      expect(linkLines[0]).toBe(`# ${PAPER.title}`);
      expect(linkLines[1]!.match(/\]\(/g)).toHaveLength(2);
      const typed = await obRun(
        walk.vaultId,
        async ({ app }, { note, heading, thoughts, last }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === note,
            ) as NoteLeaf;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const cm = leaf.view.editor.cm;
          const doc = cm.state.doc.toString();
          // The reader puts the cursor at the end of the second link.
          const at = doc.indexOf(last) + last.length;
          cm.dispatch({ selection: { anchor: at } });
          for (const text of [`\n\n${heading}\n\n`, thoughts]) {
            cm.dispatch(cm.state.replaceSelection(text), {
              userEvent: "input.type",
            });
            await new Promise((r) => setTimeout(r, 100));
          }
          await leaf.view.save();
          const s = leaf.view.contentEl.querySelector(".cm-scroller")!;
          s.scrollTop = 0;
          await new Promise((r) => setTimeout(r, 500));
          return app.vault.read(leaf.view.file!);
        },
        {
          note: NOTE,
          heading: HEADING,
          thoughts: THOUGHTS,
          last: linkLines[1]!,
        },
        STEP,
      );
      expect(typed).toContain(`${HEADING}\n\n${THOUGHTS}`);
      expect(typed.indexOf(linkLines[1]!)).toBeLessThan(typed.indexOf(HEADING));
      expect(typed.indexOf(THOUGHTS)).toBeLessThan(
        typed.indexOf("## Annotations"),
      );
      await walk.capture("step-6");
      await walk.compose("step-6");
    });
  },
);
