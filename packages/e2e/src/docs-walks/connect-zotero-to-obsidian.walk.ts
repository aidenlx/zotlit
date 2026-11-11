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
import { reloadWindow } from "@e2e/window-reload.ts";
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
      // Connect, Open your library and the Companion are done; the notes
      // folder waits.
      expect(first.steps.map((s) => s.state)).toEqual([
        "done",
        "todo",
        "done",
        "done",
      ]);
      expect(first.steps[3]!.text).toContain(
        m.welcome_step_companion_installed(),
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

    it("step 2: look at the first line of the tab, then close the setup section with its × button; Connect to Zotero has a green check and your item count, and then your papers fill the tab", async () => {
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
        const close = el.querySelector<HTMLElement>("[data-welcome-dismiss]");
        return {
          state: row.dataset.welcomeStep!,
          text: row.innerText.replaceAll(/\s+/g, " ").trim(),
          icon: mark.querySelector("svg")?.classList.contains("lucide-check"),
          markColor: getComputedStyle(mark).color,
          green,
          close: {
            label: close?.getAttribute("aria-label") ?? null,
            tooltip: close?.dataset.tooltip ?? null,
            icon: close?.querySelector("svg")?.classList.contains("lucide-x"),
          },
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
      // The × at the section's top-right corner is named Dismiss.
      expect(line.close.label).toBe(m.welcome_dismiss());
      expect(line.close.icon).toBe(true);
      const closed = await walk.record("step-2", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const el = leaf.view.contentEl;
            if (pointer) {
              // The reader reads the first line, then closes the section.
              const first = el.querySelector<HTMLElement>(
                "[data-welcome-step]",
              )!;
              const b = first.getBoundingClientRect();
              await pointer.park(b.right - 60, b.bottom + 24);
              await new Promise((r) => setTimeout(r, 900));
            }
            const close = el.querySelector<HTMLElement>(
              "[data-welcome-dismiss]",
            )!;
            await pointer?.point(close);
            page.press(close, "Dismiss");
            await page.until(
              "section closed",
              () => !el.querySelector("[data-welcome-banner]"),
              10000,
            );
            await new Promise((r) => setTimeout(r, 300));
            if (pointer) {
              const b = el.getBoundingClientRect();
              await pointer.park(b.right - 40, b.bottom - 40);
            }
            const shell = el
              .querySelector("[data-library-shell]")!
              .getBoundingClientRect();
            const tab = el.getBoundingClientRect();
            return {
              banner: !!el.querySelector("[data-welcome-banner]"),
              shell: Math.round(shell.height),
              tab: Math.round(tab.height),
              rows: el.querySelectorAll("[data-query-item-row]").length,
            };
          },
          undefined,
          STEP,
        ),
      );
      console.log("[walk] closed", JSON.stringify(closed));
      expect(closed.banner).toBe(false);
      // The tree, the list and the empty card fill the whole tab.
      expect(closed.shell).toBeGreaterThanOrEqual(closed.tab - 2);
      expect(closed.rows).toBe(LIBRARY_ITEMS);
      await walk.capture("step-2");
      await walk.compose("step-2");
      // The section stays closed: the setting survives a window reload, and
      // Welcome & help (?) in the tab's header brings it back and closes it.
      const after = await obRun(
        walk.vaultId,
        ({ zotlit }) =>
          zotlit.services.bridge.runSync(zotlit.services.settings.current)[
            "welcome.dismissed"
          ],
      );
      expect(after).toBe(true);
      await reloadWindow(walk.vaultId);
      await watchNotices(walk.vaultId);
      const reloaded = await obRun(
        walk.vaultId,
        async ({ app, page }, { help }) => {
          const leaf = await page.until(
            "Library View",
            () =>
              app.workspace.getLeavesOfType("zotlit-library")[0] as
                | LibraryLeaf
                | undefined,
            30000,
          );
          await app.workspace.revealLeaf(leaf);
          const el = leaf.view.contentEl;
          await page.until(
            "papers",
            () => el.querySelectorAll("[data-query-item-row]").length > 0,
            30000,
          );
          const banner = !!el.querySelector("[data-welcome-banner]");
          const action = [
            ...leaf.view.containerEl.querySelectorAll<HTMLElement>(
              ".view-action",
            ),
          ].find((a) => a.getAttribute("aria-label") === help)!;
          page.press(action, "Welcome & help");
          await page.until(
            "section back",
            () => el.querySelector("[data-welcome-banner]"),
            10000,
          );
          const steps = el.querySelectorAll("[data-welcome-step]").length;
          page.press(action, "Welcome & help");
          await page.until(
            "section closed again",
            () => !el.querySelector("[data-welcome-banner]"),
            10000,
          );
          // The Fixture path in the tab's first line again shows the default.
          return { banner, steps };
        },
        { help: m.library_view_help_action() },
        { timeoutMs: 90000 },
      );
      console.log("[walk] after reload", JSON.stringify(reloaded));
      expect(reloaded).toEqual({ banner: false, steps: 4 });
      await obRun(walk.vaultId, () => {
        const style = document.head.createEl("style");
        style.textContent =
          '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
      });
    }, 180000);

    it("step 3: type a few words of a title into Search papers and select the paper; a card under the list with the authors, the journal, and the buttons Open PDF and Write literature note", async () => {
      const found = await walk.record("step-3", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { search, key }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const el = leaf.view.contentEl;
            await leaf.view.query.settled;
            const input = el.querySelector<HTMLInputElement>(
              "[data-library-search] input",
            )!;
            const placeholder = input.placeholder;
            if (pointer) {
              await pointer.point(input, { inset: 60 });
              await pointer.type(input, search);
            } else {
              input.focus();
              input.value = search;
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            await leaf.view.searched;
            await leaf.view.query.settled;
            const row = await page.until(
              "paper row",
              () => {
                const r = el.querySelector<HTMLElement>(
                  `[data-query-item-row="${key}"]`,
                );
                return r?.checkVisibility() && r;
              },
              10000,
            );
            await pointer?.point(row, { inset: 40 });
            page.press(row, "paper row");
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
            const tab = el.getBoundingClientRect();
            const shown = (b: Element) => {
              const r = b.getBoundingClientRect();
              return r.top >= tab.top && r.bottom <= tab.bottom;
            };
            const actions = [
              ...card.querySelectorAll<HTMLElement>(
                "[data-library-card-action]",
              ),
            ].filter((b) => b.checkVisibility());
            const tree = el.querySelector<HTMLElement>("[data-library-tree]");
            const list = el
              .querySelector("[data-query-item-row]")!
              .getBoundingClientRect();
            if (pointer) {
              // The pointer leaves the card, so it hides none of its text.
              await pointer.park(tab.right - 30, list.top + 10);
            }
            return {
              placeholder,
              rows: [...el.querySelectorAll("[data-query-item-row]")].map((n) =>
                n.getAttribute("data-query-item-row"),
              ),
              title: card.querySelector("[data-library-card-title]")!
                .textContent,
              creators:
                card.querySelector("[data-library-card-creators]")
                  ?.textContent ?? "",
              venue:
                card.querySelector("[data-library-card-venue]")?.textContent ??
                "",
              buttons: actions.map((b) => ({
                action: b.dataset.libraryCardAction!,
                text: b.innerText.trim(),
                label: b.getAttribute("aria-label"),
                inView: shown(b),
              })),
              // Where the card sits by the list, at the walk's window size.
              layout: {
                window: { w: window.innerWidth, h: window.innerHeight },
                pane: rect(el),
                row: rect(el.querySelector("[data-query-item-row]")),
                card: rect(card),
                under: card.getBoundingClientRect().top >= list.bottom,
                treeShown: tree?.checkVisibility() ?? false,
                tree: rect(tree),
              },
            };
          },
          { search: SEARCH, key: PAPER.key },
          STEP,
        ),
      );
      console.log("[walk] card", JSON.stringify(found));
      expect(found.placeholder).toBe(m.library_view_search_placeholder());
      expect(found.rows).toContain(PAPER.key);
      expect(found.title).toBe(PAPER.title);
      expect(found.creators).toContain(PAPER.creators);
      expect(found.venue).toContain(PAPER.venue);
      expect(found.layout.under).toBe(true);
      // The two labelled buttons, then two icon buttons: More actions and
      // Open in the annotation view.
      expect(found.buttons.filter((b) => b.text).map((b) => b.text)).toEqual([
        m.library_view_menu_open_pdf(),
        m.library_view_menu_write_note(),
      ]);
      // They show without a scroll.
      expect(found.buttons.every((b) => b.inView)).toBe(true);
      await walk.capture("step-3");
      await walk.compose("step-3");
    });

    it("step 4: select Open PDF; the PDF in a new tab, with your highlights in their original colours", async () => {
      // Obsidian's PDF view opens a PDF at the page in its own view history
      // (`pdfjs.history` in localStorage, keyed by the PDF's fingerprint and
      // shared by every vault). The walk removes this PDF's entry, so the PDF
      // opens at page 1, as on a reader's first open.
      const pdfPath = await walk.zotero.json<string>(
        `Zotero.Items.getByLibraryAndKey(1,"DCSNDPDF").getFilePath()`,
      );
      const forgotten = await obRun(
        walk.vaultId,
        async (_, { path, lib: libUrl }) => {
          type PdfJs = {
            GlobalWorkerOptions: { workerSrc: string };
            getDocument(src: { data: Uint8Array }): {
              promise: Promise<{
                fingerprints: string[];
                destroy(): Promise<void>;
              }>;
            };
          };
          const host = window as unknown as { pdfjsLib?: PdfJs };
          // Obsidian's own pdf.js, loaded as its PDF view loads it: a module
          // script that sets `window.pdfjsLib`.
          if (!host.pdfjsLib) {
            const script = document.head.createEl("script", {
              attr: { type: "module", src: libUrl },
            });
            await new Promise((resolve, reject) => {
              script.onload = resolve;
              script.onerror = reject;
            });
          }
          const lib = host.pdfjsLib!;
          if (!lib.GlobalWorkerOptions.workerSrc)
            lib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
          const fs = require("node:fs") as typeof import("node:fs");
          const doc = await lib.getDocument({
            data: new Uint8Array(fs.readFileSync(path)),
          }).promise;
          const fingerprint = doc.fingerprints[0]!;
          await doc.destroy();
          const raw = localStorage.getItem("pdfjs.history");
          if (!raw) return { fingerprint, removed: 0 };
          const history = JSON.parse(raw) as {
            files: { fingerprint: string }[];
          };
          const before = history.files.length;
          history.files = history.files.filter(
            (f) => f.fingerprint !== fingerprint,
          );
          localStorage.setItem("pdfjs.history", JSON.stringify(history));
          return { fingerprint, removed: before - history.files.length };
        },
        { path: pdfPath, lib: "/lib/pdfjs/pdf.min.mjs" },
        STEP,
      );
      console.log("[walk] pdf history", JSON.stringify(forgotten));
      const opened = await walk.record("step-4", async () => {
        await obRun(
          walk.vaultId,
          async ({ app, page }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const button = leaf.view.contentEl.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="pdf"]',
            )!;
            await page.scratch.docsWalkPointer?.point(button);
            page.press(button, "Open PDF");
          },
          undefined,
          STEP,
        );
        const opened = await obRunUntil(
          walk.vaultId,
          ({ app }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
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
              page:
                (pdf.view as PagePdfView).viewer?.child?.pdfViewer?.pdfViewer
                  ?.currentPageNumber ?? null,
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
            ready: (value) =>
              value !== null && value.active && value.marks >= 2,
          },
        );
        // The pointer rests at the tab's edge, clear of the highlights.
        await obRun(walk.vaultId, async ({ app, page }) => {
          const body = app.workspace
            .getLeavesOfType("pdf")[0]!
            .view.containerEl.getBoundingClientRect();
          await page.scratch.docsWalkPointer?.park(
            body.right - 14,
            body.bottom - 24,
          );
        });
        return opened!;
      });
      console.log("[walk] pdf", JSON.stringify(opened));
      expect(opened.file).toContain("Sandve");
      expect(opened.ownTab).toBe(true);
      expect(opened.page).toBe(1);
      expect(opened.marks).toBeGreaterThanOrEqual(2);
      expect(opened.colours).toBe(opened.marks);
      await walk.capture("step-4");
      await walk.compose("step-4");
    });

    it("step 5: go back to the Zotero library tab and select Write literature note; the notice Literature note created. and the note in a new tab", async () => {
      const written = await walk.record("step-5", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { note }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace.getLeavesOfType(
              "zotlit-library",
            )[0] as LibraryLeaf;
            const card = leaf.view.contentEl.querySelector<HTMLElement>(
              "[data-library-card]",
            )!;
            const tab = (leaf as unknown as { tabHeaderEl: HTMLElement })
              .tabHeaderEl;
            await pointer?.point(tab);
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
            await pointer?.point(button);
            page.press(button, "Write literature note");
            await page.until(
              "note",
              () => app.workspace.getActiveFile()?.path === note,
              20000,
            );
            const noteLeaf = app.workspace.getMostRecentLeaf()!;
            if (pointer) {
              const b = noteLeaf.view.containerEl.getBoundingClientRect();
              await pointer.park(b.right - 40, b.bottom - 60);
            }
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
        ),
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
      // The annotation sidebar lists the note's highlights.
      await obRunUntil(
        walk.vaultId,
        ({ app }) =>
          app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .some(
              (l) =>
                l.view.containerEl.querySelectorAll(".zt-annot-card").length >
                0,
            ),
        undefined,
        { what: "the highlights in the annotation sidebar" },
      );
      await walk.capture("step-5", { notices: true });
      await walk.compose("step-5");
    });

    it("step 6: under the line with the Zotero and PDF links, type a heading and your own thoughts; your text above the Annotations section", async () => {
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
      const typed = await walk.record("step-6", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { note, heading, thoughts, last }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace
              .getLeavesOfType("markdown")
              .find(
                (l) => (l.view as MarkdownView).file?.path === note,
              ) as NoteLeaf;
            app.workspace.setActiveLeaf(leaf, { focus: true });
            const cm = leaf.view.editor.cm;
            const doc = cm.state.doc.toString();
            // The reader puts the cursor at the end of the links line.
            const at = doc.indexOf(last) + last.length;
            const box = cm.coordsAtPos(at);
            if (pointer && box) {
              await pointer.pointAt(box.right + 6, (box.top + box.bottom) / 2);
              // Then it rests at the note's right edge, clear of the text.
              const pane = leaf.view.contentEl.getBoundingClientRect();
              await pointer.park(pane.right - 14, box.bottom + 70);
            }
            cm.dispatch({ selection: { anchor: at } });
            const put = (text: string) =>
              cm.dispatch(cm.state.replaceSelection(text), {
                userEvent: "input.type",
              });
            // The long thought types at five times a typist's pace, so the
            // clip stays short.
            for (const [text, speed] of [
              [`\n\n${heading}\n\n`, 1],
              [thoughts, 5],
            ] as const) {
              if (pointer) await pointer.keys(text, put, { speed });
              else put(text);
            }
            await leaf.view.save();
            return app.vault.read(leaf.view.file!);
          },
          {
            note: NOTE,
            heading: HEADING,
            thoughts: THOUGHTS,
            last: linkLines[1]!,
          },
          STEP,
        ),
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
