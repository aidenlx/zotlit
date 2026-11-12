// The landing page's five workflow clips: find a paper, read and highlight,
// write the literature note, cite as you draft, and send the chapter to Word.
// Each `it` sets up its own scene on the docs Vault Case, so one case can be
// recorded again alone with `-t '<case>: '`, and records one action that starts
// on a calm frame and ends on its result. The window's content area is
// 1024 × 640 CSS px, 16:10, so a clip shown about 720 px wide keeps its text
// readable. With `DOCS_WALK_RECORD=1 DOCS_WALK_CAPTURE=1`, each case writes
// `<case>.webm`, `<case>.mp4` and the poster `<case>.webp` (1600 × 1000) to
// `apps/docs/public/img/landing/`; `word` writes only the poster, the
// exported document's first page. Run it with
// `pnpm --filter @zotlit/e2e docs-walk src/docs-walks/landing.walk.ts`.

import { obRun } from "@e2e/obsidian-cli.ts";
import type { PagePdfView } from "@e2e/page-notes-types.ts";
import { raiseWindow } from "@e2e/reader-gestures.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  FileSystemAdapter,
  HoverPopover,
  MarkdownView,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { AnnotationView } from "@/views/annot-view/view";
import type { LibraryView } from "@/views/library/view";

import {
  captureRequested,
  closeWelcome,
  openDocsWalk,
  readNotices,
  watchNotices,
} from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const execFileAsync = promisify(execFile);
const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "landing";
/** The window's content area in CSS px: 16:10. */
const WINDOW = { width: 1024, height: 640 };
/** The poster's size in px. */
const POSTER = { width: 1600, height: 1000 };
const IMAGES = join(root, "apps", "docs", "public", "img", "landing");
const CAPTURES = join(root, ".scratch", "docs-walks", SLUG);

/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five annotations. */
const SANDVE = {
  key: "DCSNDART",
  attachmentKey: "DCSNDPDF",
  citekey: "sandve2013",
  title: "Ten Simple Rules for Reproducible Computational Research",
  annotations: 5,
  /** Its five highlights in Zotero, before the clip adds one. */
  annotationKeys: ["SV4QMR7A", "SV8KTW3C", "SV2HXN6E", "SV9PLD5G", "SV6RZB2J"],
};
/**
 * The sentence the reader highlights in Sandve et al. 2013: on page 1, with
 * no highlight in the Fixture, as its text layer holds it, and how far past
 * page width the PDF zooms so it reads at the clip's size.
 */
const SENTENCE_READ = {
  page: 1,
  from: "We further note",
  to: "realistic.",
  words: "just as much about the habits",
  zoom: 1.8,
};
/** Wilson et al. 2014: a PDF not yet read, in Reproducibility. */
const WILSON = {
  key: "DCWLSART",
  title: "Best Practices for Scientific Computing",
};
const COLLECTION = "Reproducibility";
const NOTE = `literatures/${SANDVE.citekey}.md`;
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
const EXPORTED = DRAFT.replace(/\.md$/, ".docx");
const EXPORTED_NAME = "Chapter 3 - Presenting the results.docx";
const NOTES_TO_SELF = "## Notes to self";
const SECTION = "## 3.3 Keeping each figure reproducible";
const SENTENCE =
  "Every figure in this chapter comes from a script that records how it ran ";
const APA = "http://www.zotero.org/styles/apa";
const APA_TITLE = "APA Style 7th edition";

type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type AnnotationLeaf = WorkspaceLeaf & { view: AnnotationView };
type PdfLeaf = WorkspaceLeaf & { view: PagePdfView };
type DraftLeaf = WorkspaceLeaf & {
  view: MarkdownView & {
    hoverPopover: (HoverPopover & { hide(): void }) | null;
  };
};

/** One step's calls into the apps can wait on Zotero: up to a minute. */
const STEP = { timeoutMs: 60000 };
/** How long a clip holds its opening frame before the first action, in ms. */
const OPENING = 900;

describe.skipIf(!reachable)("Landing page clips", () => {
  let walk: DocsWalk;

  /**
   * Save the window as the poster `<name>.webp`, exactly 1600 × 1000, without
   * notices. Does nothing unless the run captures.
   */
  async function poster(name: string): Promise<void> {
    if (!captureRequested()) return;
    await walk.capture(name);
    await mkdir(IMAGES, { recursive: true });
    await execFileAsync("cwebp", [
      "-quiet",
      "-q",
      "90",
      "-resize",
      String(POSTER.width),
      String(POSTER.height),
      join(CAPTURES, `${name}.png`),
      "-o",
      join(IMAGES, `${name}.webp`),
    ]);
  }

  /**
   * Close every other tab and both sidebars, and show the Zotero library tab
   * alone on the collection `node`, or on My Library for `null`, with no
   * Reading State facet on.
   */
  async function libraryAlone(node: string | null): Promise<void> {
    await obRun(
      walk.vaultId,
      async ({ app, page }, { node }) => {
        page.closePopovers(document);
        // The library tab opens before the other tabs close.
        let leaf = app.workspace.getLeavesOfType("zotlit-library")[0] as
          | LibraryLeaf
          | undefined;
        if (!leaf) {
          const opened = app.workspace.getLeaf("tab");
          await opened.setViewState({ type: "zotlit-library", active: true });
          leaf = opened as LibraryLeaf;
        }
        const keep = leaf;
        // A leaf closed while the workspace walks its leaves skips the next one.
        const others: WorkspaceLeaf[] = [];
        app.workspace.iterateRootLeaves((l) => {
          if (l !== keep) others.push(l);
        });
        for (const l of others) l.detach();
        app.workspace.leftSplit.collapse();
        await app.workspace.revealLeaf(leaf);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.workspace.rightSplit.collapse();
        const el = leaf.view.contentEl;
        await leaf.view.query.settled;
        const row = await page.stands(
          await page.until(
            "tree node",
            () =>
              node === null
                ? // The first Library, under Recent.
                  el.querySelectorAll<HTMLElement>(
                    '[data-library-node][aria-level="1"]',
                  )[1]
                : [
                    ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
                  ].find(
                    (n) =>
                      n.querySelector("[data-library-label]")?.textContent ===
                      node,
                  ),
            20000,
          ),
          "tree node",
        );
        if (row.getAttribute("aria-selected") !== "true")
          page.press(row, "tree node");
        for (const facet of el.querySelectorAll<HTMLElement>(
          '[data-library-facet][aria-pressed="true"]',
        ))
          page.press(facet, "facet");
        await page.until(
          "the node's papers",
          () =>
            row.getAttribute("aria-selected") === "true" &&
            !el.querySelector('[data-library-facet][aria-pressed="true"]') &&
            el.querySelectorAll("[data-query-item-row]").length > 0,
          20000,
        );
        await leaf.view.query.settled;
        await new Promise((r) => setTimeout(r, 500));
      },
      { node },
      STEP,
    );
  }

  beforeAll(async () => {
    walk = await openDocsWalk({
      slug: SLUG,
      collection: SLUG,
      vaultCase: "docs",
      window: WINDOW,
      // The landing clips keep the whole window and their short still start.
      clip: { camera: false, opening: 0.3 },
    });
    // `setSize` sets the outer size; the clip needs the content area itself.
    const size = await obRun(
      walk.vaultId,
      async (_, size) => {
        const win = (
          require("@electron/remote") as {
            getCurrentWindow(): {
              setContentSize(width: number, height: number): void;
            };
          }
        ).getCurrentWindow();
        win.setContentSize(size.width, size.height);
        await new Promise((r) => setTimeout(r, 500));
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          ratio: window.devicePixelRatio,
        };
      },
      WINDOW,
    );
    console.log("[walk] window", JSON.stringify(size));
    expect({ width: size.width, height: size.height }).toEqual(WINDOW);
    await closeWelcome(walk.vaultId);
    await obRun(
      walk.vaultId,
      async ({ zotlit }, { apa }) => {
        const s = zotlit.services;
        // The chapter's style is APA, as the journal asks.
        await s.bridge.runPromise(
          s.settings.updateDefaultLiteratureNoteProfileBindings({
            "citation.references-style": apa,
          }),
        );
        await s.bridge.runPromise(s.settings.flush);
        await s.bridge.runPromise(s.attachmentResolver.indexed);
        // The PDF tab's path runs through the Fixture's folders; notices and
        // the status bar are not part of any clip.
        const style = document.head.createEl("style");
        style.textContent =
          '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none} .notice-container{visibility:hidden} .status-bar{display:none}';
      },
      { apa: APA },
      STEP,
    );
    // The engine is installed once per computer.
    await obRun(
      walk.vaultId,
      async ({ zotlit }) => {
        const h = zotlit.services.pandocEngine;
        const status = await h.runPromise(h.binary.getStatus);
        if (status.kind !== "installed") await h.runPromise(h.binary.install);
      },
      undefined,
      { timeoutMs: 600000 },
    );
    // Obsidian's PDF view reopens a PDF where it last was; the clips open
    // Sandve et al. 2013 at page 1, as on a first read.
    const pdfPath = await walk.zotero.json<string>(
      `Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(SANDVE.attachmentKey)}).getFilePath()`,
    );
    await obRun(
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
        if (!raw) return;
        const history = JSON.parse(raw) as {
          files: { fingerprint: string }[];
        };
        history.files = history.files.filter(
          (f) => f.fingerprint !== fingerprint,
        );
        localStorage.setItem("pdfjs.history", JSON.stringify(history));
      },
      { path: pdfPath, lib: "/lib/pdfjs/pdf.min.mjs" },
      STEP,
    );
    await watchNotices(walk.vaultId);
  }, 900000);

  afterAll(async () => {
    await walk?.[Symbol.asyncDispose]();
  });

  it("find: select Reproducibility, then Unread, then a paper; its Reading Card", async () => {
    await libraryAlone(null);
    const found = await walk.record("find", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { collection, prefer, opening }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          const rows = () =>
            [
              ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
            ].filter((r) => r.checkVisibility());
          if (pointer) {
            const b = el.getBoundingClientRect();
            await pointer.park(b.left + b.width * 0.5, b.top + b.height * 0.7);
            await new Promise((r) => setTimeout(r, opening));
          }
          const node = await page.stands(
            [...el.querySelectorAll<HTMLElement>("[data-library-node]")].find(
              (n) =>
                n.querySelector("[data-library-label]")?.textContent ===
                collection,
            ),
            "collection",
          );
          await pointer?.point(node, { inset: 50 });
          page.press(node, collection);
          await page.until(
            "collection selected",
            () => node.getAttribute("aria-selected") === "true",
            10000,
          );
          await leaf.view.query.settled;
          const inCollection = rows().length;
          await new Promise((r) => setTimeout(r, pointer ? 500 : 0));
          const unread = await page.stands(
            el.querySelector<HTMLElement>('[data-library-facet="unread"]'),
            "Unread",
          );
          await pointer?.point(unread);
          page.press(unread, "Unread");
          await page.until(
            "Unread on",
            () => unread.getAttribute("aria-pressed") === "true",
            10000,
          );
          await leaf.view.query.settled;
          await page.until(
            "fewer papers",
            () => rows().length > 0 && rows().length < inCollection,
            10000,
          );
          const left = rows().map((r) => r.dataset.queryItemRow!);
          await new Promise((r) => setTimeout(r, pointer ? 500 : 0));
          const row =
            rows().find((r) => r.dataset.queryItemRow === prefer) ?? rows()[0]!;
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
          if (pointer) {
            // The pointer leaves the card and the list for the tab's corner.
            const b = el.getBoundingClientRect();
            await pointer.park(b.right - 14, b.bottom - 20);
          }
          const tree = el.querySelector("[data-library-tree]");
          const list = row.getBoundingClientRect();
          const box = card.getBoundingClientRect();
          return {
            inCollection,
            left,
            title:
              card.querySelector("[data-library-card-title]")?.textContent ??
              "",
            treeShown: tree?.checkVisibility() ?? false,
            beside: box.left >= list.right - 1,
          };
        },
        { collection: COLLECTION, prefer: WILSON.key, opening: OPENING },
        STEP,
      ),
    );
    console.log("[walk] find", JSON.stringify(found));
    expect(found.inCollection).toBeGreaterThan(found.left.length);
    expect(found.left).not.toContain(SANDVE.key);
    expect(found.treeShown).toBe(true);
    expect(found.title).toBe(
      found.left.includes(WILSON.key) ? WILSON.title : found.title,
    );
    await poster("find");
  });

  it("read: open Sandve et al. 2013, select a sentence and pick a colour; the sentence highlighted and its new card beside the PDF", async () => {
    await libraryAlone(COLLECTION);
    await raiseWindow(walk.vaultId);
    // The reader opens the PDF from its card: the PDF with its highlights,
    // and the paper's highlights and comments in the sidebar beside it.
    await obRun(
      walk.vaultId,
      async ({ app, page }, { key, attachmentKey, title }) => {
        const leaf = app.workspace.getLeavesOfType(
          "zotlit-library",
        )[0] as LibraryLeaf;
        const el = leaf.view.contentEl;
        const row = await page.until(
          "paper row",
          () => el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`),
          20000,
        );
        page.press(row, "paper row");
        await page.until(
          "the paper's card",
          () =>
            el.querySelector("[data-library-card-title]")?.textContent ===
            title,
          10000,
        );
        await leaf.view.card.settled;
        const open = await page.until(
          "Open PDF",
          () =>
            el.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="pdf"]',
            ),
          10000,
        );
        page.press(open, "Open PDF");
        const pdf = await page.until(
          "PDF",
          () =>
            app.workspace
              .getLeavesOfType("pdf")
              .find((l) =>
                decodeURI((l.view as MarkdownView).file?.path ?? "").includes(
                  attachmentKey,
                ),
              ),
          20000,
        );
        leaf.detach();
        app.workspace.setActiveLeaf(pdf, { focus: true });
        app.workspace.rightSplit.expand();
        await page.until(
          "the highlights in the sidebar",
          () =>
            (
              app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
                | AnnotationLeaf
                | undefined
            )?.view.contentEl.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ).length,
          20000,
        );
        await page.until(
          "the marks on the page",
          () =>
            pdf.view.containerEl.querySelectorAll(".zt-pdf-annotation-mark")
              .length >= 2,
          20000,
        );
        await new Promise((r) => setTimeout(r, 1500));
      },
      {
        key: SANDVE.key,
        attachmentKey: SANDVE.attachmentKey,
        title: SANDVE.title,
      },
      STEP,
    );
    // The reader zooms in on the first page, so the sentence they are about
    // to highlight reads at the clip's size.
    await obRun(
      walk.vaultId,
      async ({ app, page }, { from, pageNumber, zoom }) => {
        const pdf = app.workspace.getLeavesOfType("pdf")[0] as PdfLeaf;
        const scroller = pdf.view.viewer.child.pdfViewer.pdfViewer;
        const viewer = scroller as unknown as {
          currentScale: number;
          currentScaleValue: string;
        };
        viewer.currentScaleValue = "page-width";
        await new Promise((r) => setTimeout(r, 300));
        viewer.currentScale *= zoom;
        const pageEl = await page.until(
          "the page",
          () =>
            pdf.view.containerEl.querySelector<HTMLElement>(
              `.page[data-page-number="${pageNumber}"]`,
            ),
          10000,
        );
        /** The text node where the sentence starts, in the page's current text layer. */
        const startOf = () => {
          const layer = pageEl.querySelector<HTMLElement>(".textLayer");
          const at = layer?.textContent.indexOf(from) ?? -1;
          if (!layer || at < 0) return null;
          let seen = 0;
          const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const length = (n as Text).data.length;
            if (seen + length > at) return n.parentElement;
            seen += length;
          }
          return null;
        };
        // The sentence's column comes whole into the tab, its first line a
        // third of the way down. The PDF view redraws its pages after the
        // zoom, so the walk scrolls until the sentence stays in place.
        let placed = false;
        for (let tries = 0; tries < 20 && !placed; tries++) {
          await new Promise((r) => setTimeout(r, 400));
          const start = startOf();
          if (!start) continue;
          const box = start.getBoundingClientRect();
          const pane = scroller.container.getBoundingClientRect();
          const dx = box.left - (pane.left + 48);
          const dy = box.top - (pane.top + pane.height / 3);
          placed = Math.abs(dx) < 6 && Math.abs(dy) < 6;
          scroller.container.scrollLeft += dx;
          scroller.container.scrollTop += dy;
        }
        if (!placed) throw new Error("the sentence did not come into view");
        await new Promise((r) => setTimeout(r, 1500));
      },
      {
        from: SENTENCE_READ.from,
        pageNumber: SENTENCE_READ.page,
        zoom: SENTENCE_READ.zoom,
      },
      STEP,
    );
    const made = await walk.record("read", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { from, to, pageNumber, before, opening }) => {
          const pointer = page.scratch.docsWalkPointer;
          const pdf = app.workspace.getLeavesOfType("pdf")[0] as PdfLeaf;
          const view = pdf.view.containerEl.getBoundingClientRect();
          if (pointer) {
            await pointer.park(view.right - 40, view.top + view.height * 0.7);
            await new Promise((r) => setTimeout(r, opening));
          }
          // The reader drags across a sentence that has no highlight yet.
          const layer = pdf.view.containerEl.querySelector<HTMLElement>(
            `.page[data-page-number="${pageNumber}"] .textLayer`,
          )!;
          const nodes: Text[] = [];
          const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode())
            nodes.push(n as Text);
          let all = "";
          const starts = nodes.map((t) => {
            const at = all.length;
            all += t.data;
            return at;
          });
          // The start lies in the node that holds its first character, the
          // end in the node that holds its last.
          const at = (k: number, end: boolean): [Text, number] => {
            const x = nodes.findIndex((t, n) =>
              end
                ? starts[n]! < k && k <= starts[n]! + t.data.length
                : starts[n]! <= k && k < starts[n]! + t.data.length,
            );
            return [nodes[x]!, k - starts[x]!];
          };
          const i = all.indexOf(from);
          const j = all.indexOf(to, i) + to.length;
          const range = document.createRange();
          range.setStart(...at(i, false));
          range.setEnd(...at(j, true));
          const rects = [...range.getClientRects()];
          const first = rects[0]!;
          const last = rects.at(-1)!;
          const x = first.left + 2;
          const y = first.top + first.height / 2;
          if (pointer) {
            await pointer.pointAt(x, y);
            await pointer.park(last.right, last.top + last.height / 2);
          }
          const pressed = page.fire("pointerdown", x, y);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          page.fire("pointerup", x, y, pressed);
          const popup = await page.until(
            "the Mark popup",
            () =>
              document.querySelector(
                '.zt-pdf-mark-popup [data-zt-verb="highlight"]',
              ) && document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
            5000,
          );
          await new Promise((r) => setTimeout(r, pointer ? 700 : 0));
          // Then picks green, or yellow when the popup offers no green.
          const swatch = await page.stands(
            popup.querySelector<HTMLElement>('[data-zt-verb="color-3"]') ??
              popup.querySelector<HTMLElement>('[data-zt-verb="color-1"]'),
            "colour",
          );
          const colour = swatch.getAttribute("aria-label");
          const disabled = swatch.getAttribute("aria-disabled");
          await pointer?.point(swatch);
          page.press(swatch, "colour");
          const side = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            )[0] as AnnotationLeaf
          ).view.contentEl;
          const card = await page.until(
            "the new card",
            () =>
              [
                ...side.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ),
              ].find((c) => !before.includes(c.dataset.zoteroAnnotationKey!)),
            20000,
          );
          const key = card.dataset.zoteroAnnotationKey!;
          const mark = await page.until(
            "the highlight on the page",
            () =>
              pdf.view.containerEl.querySelector<HTMLElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key="${key}"]`,
              ),
            10000,
          );
          getSelection()!.removeAllRanges();
          // The popup of the new highlight closes, so the highlight shows whole.
          await new Promise((r) => setTimeout(r, pointer ? 500 : 0));
          await page.trusted(window).key("Escape");
          await page.until(
            "the popup closed",
            () =>
              !document.querySelector(".zt-pdf-mark-popup")?.checkVisibility(),
            5000,
          );
          // The new card shows in the list beside the PDF.
          card.scrollIntoView({
            block: "center",
            behavior: pointer ? "smooth" : "instant",
          });
          await new Promise((r) => setTimeout(r, pointer ? 900 : 100));
          if (pointer) {
            // The pointer rests in the tab's margin, off the sentence.
            await pointer.park(view.right - 14, view.bottom - 24);
          }
          const painted = mark.matches("[fill],[stroke]")
            ? mark
            : mark.querySelector("[fill],[stroke]");
          const cardBox = card.getBoundingClientRect();
          const sideBox = side.getBoundingClientRect();
          return {
            key,
            colour,
            disabled,
            fill:
              painted?.getAttribute("fill") ??
              painted?.getAttribute("stroke") ??
              null,
            text: card.innerText.replaceAll(/\s+/g, " "),
            cardShown:
              cardBox.top >= sideBox.top && cardBox.bottom <= sideBox.bottom,
            cards: side.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ).length,
          };
        },
        {
          from: SENTENCE_READ.from,
          to: SENTENCE_READ.to,
          pageNumber: SENTENCE_READ.page,
          before: SANDVE.annotationKeys,
          opening: OPENING,
        },
        STEP,
      ),
    );
    console.log("[walk] read", JSON.stringify(made));
    expect(made.disabled).not.toBe("true");
    expect(made.cards).toBe(SANDVE.annotations + 1);
    expect(made.text).toContain(SENTENCE_READ.words);
    expect(made.cardShown).toBe(true);
    await poster("read");
    // The library loses the new highlight again, as the Fixture had it.
    await walk.zotero.json<boolean>(
      `(async()=>{await Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(made.key)}).eraseTx();return true;})()`,
    );
  });

  it("note: select Write literature note on the paper's card; the note with its details and highlights", async () => {
    await libraryAlone(COLLECTION);
    await obRun(
      walk.vaultId,
      async ({ app, page }, { key, note, title }) => {
        // No note from an earlier attempt: the clip writes it new.
        const old = app.vault.getFileByPath(note);
        if (old) await app.vault.delete(old);
        const leaf = app.workspace.getLeavesOfType(
          "zotlit-library",
        )[0] as LibraryLeaf;
        const el = leaf.view.contentEl;
        const row = await page.until(
          "paper row",
          () => el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`),
          20000,
        );
        page.press(row, "paper row");
        await page.until(
          "the paper's card",
          () =>
            el.querySelector("[data-library-card-title]")?.textContent ===
            title,
          10000,
        );
        await leaf.view.card.settled;
        await page.until(
          "Reading Card",
          () =>
            el.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="note"]',
            ),
          10000,
        );
        await leaf.view.card.settled;
      },
      { key: SANDVE.key, note: NOTE, title: SANDVE.title },
      STEP,
    );
    const written = await walk.record("note", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { note, opening }) => {
          const pointer = page.scratch.docsWalkPointer;
          const leaf = app.workspace.getLeavesOfType(
            "zotlit-library",
          )[0] as LibraryLeaf;
          const el = leaf.view.contentEl;
          if (pointer) {
            const b = el.getBoundingClientRect();
            await pointer.park(b.left + b.width * 0.4, b.top + b.height * 0.7);
            await new Promise((r) => setTimeout(r, opening));
          }
          const button = await page.stands(
            el.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="note"]',
            ),
            "Write literature note",
          );
          const label = button.innerText.trim();
          await pointer?.point(button);
          page.press(button, "Write literature note");
          await page.until(
            "note",
            () => app.workspace.getActiveFile()?.path === note,
            20000,
          );
          const noteLeaf = app.workspace.getMostRecentLeaf()!;
          const content = (noteLeaf.view as MarkdownView).contentEl;
          // The note's own Annotations section shows the highlights.
          await page.until(
            "the highlights in the note",
            () =>
              content.querySelectorAll(
                ".zt-annot-card[data-zotero-annotation-key]",
              ).length > 0,
            20000,
          );
          // The sidebar would crowd the note: the note shows the highlights.
          app.workspace.rightSplit.collapse();
          // The reader reads: the note shows without its Markdown.
          (noteLeaf.view as MarkdownView).editor.blur();
          await new Promise((r) => setTimeout(r, 900));
          // The reader scrolls down to the highlights.
          const scroller = content.querySelector<HTMLElement>(".cm-scroller");
          const heading = [
            ...content.querySelectorAll<HTMLElement>(".HyperMD-header-2"),
          ].find((h) => h.textContent.includes("Annotations"));
          if (scroller && heading) {
            const top =
              heading.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top;
            scroller.scrollBy({
              top: Math.max(0, top - 140),
              behavior: pointer ? "smooth" : "instant",
            });
            await new Promise((r) => setTimeout(r, pointer ? 900 : 100));
          }
          if (pointer) {
            const b = content.getBoundingClientRect();
            await pointer.park(b.right - 14, b.bottom - 24);
          }
          return {
            label,
            active: app.workspace.getActiveFile()?.path ?? null,
            cards: content.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ).length,
            body: await app.vault.read(app.workspace.getActiveFile()!),
          };
        },
        { note: NOTE, opening: OPENING },
        STEP,
      ),
    );
    console.log(
      "[walk] note",
      JSON.stringify({ ...written, body: written.body.slice(0, 600) }),
    );
    expect(written.label).toBe(m.library_view_menu_write_note());
    expect(written.active).toBe(NOTE);
    expect(written.cards).toBeGreaterThan(0);
    expect(written.body).toContain(SANDVE.title);
    expect(await readNotices(walk.vaultId)).toContain(m.notice_created_note());
    await poster("note");
  });

  it("cite: type [@sandve and press Enter, then point at the citation; the citation in APA and the paper's reference", async () => {
    await obRun(
      walk.vaultId,
      async (
        { app, page },
        { draftPath, before, section, typed, sentence },
      ) => {
        page.closePopovers(document);
        const file = app.vault.getFileByPath(draftPath)!;
        // The draft as it was before any earlier attempt of this clip.
        await app.vault.process(file, (text) => {
          const from = text.indexOf(section);
          const to = text.indexOf(before, from);
          return from < 0 || to < 0
            ? text
            : text.slice(0, from) + text.slice(to);
        });
        // The draft opens before the other tabs close.
        const leaf = app.workspace.getLeaf("tab") as DraftLeaf;
        await leaf.openFile(file);
        // A leaf closed while the workspace walks its leaves skips the next one.
        const others: WorkspaceLeaf[] = [];
        app.workspace.iterateRootLeaves((l) => {
          if (l !== leaf) others.push(l);
        });
        for (const l of others) l.detach();
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
        // The reader has written a new section, up to where the citation goes.
        const editor = leaf.view.editor;
        const line = editor
          .getValue()
          .split("\n")
          .findIndex((l) => l === before);
        editor.setCursor({ line, ch: 0 });
        editor.replaceSelection(typed);
        editor.setCursor({ line: line + 2, ch: sentence.length });
        editor.focus();
        await new Promise((r) => setTimeout(r, 300));
        // The new section sits mid-tab, with room for the list under it.
        editor.scrollIntoView(
          { from: { line, ch: 0 }, to: { line: line + 2, ch: 0 } },
          true,
        );
        await new Promise((r) => setTimeout(r, 800));
      },
      {
        draftPath: DRAFT,
        before: NOTES_TO_SELF,
        section: SECTION,
        typed: `${SECTION}\n\n${SENTENCE}\n\n`,
        sentence: SENTENCE,
      },
      STEP,
    );
    const cited = await walk.record("cite", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, title, sentence, opening }) => {
          const pointer = page.scratch.docsWalkPointer;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          const cm = editor.cm;
          const at = cm.coordsAtPos(cm.state.selection.main.head)!;
          if (pointer) {
            // The pointer rests above the line, off the text and the list.
            await pointer.park(at.right + 120, at.top - 60);
            await new Promise((r) => setTimeout(r, opening));
          }
          const put = (ch: string) =>
            cm.dispatch(cm.state.replaceSelection(ch), {
              userEvent: "input.type",
            });
          if (pointer) await pointer.keys("[@sandve", put, { speed: 1.3 });
          else for (const ch of "[@sandve") put(ch);
          const popup = await page.until(
            "Citation Suggester",
            () =>
              [...activeDocument.querySelectorAll(".suggestion-container")].at(
                -1,
              ),
            5000,
          );
          await page.until(
            "suggestions",
            () =>
              [...popup.querySelectorAll(".suggestion-item")].some(
                (n) =>
                  !n.closest("[aria-busy]") && n.textContent.includes(title),
              ),
            10000,
          );
          await new Promise((r) => setTimeout(r, pointer ? 900 : 0));
          await page.trusted(window).key("Enter");
          await page.until(
            "citation inserted",
            () => editor.getValue().includes("[@sandve2013]"),
            5000,
          );
          // The reader clicks on the empty line under the paragraph: the
          // citation shows formatted.
          const line =
            editor
              .getValue()
              .split("\n")
              .findIndex((l) => l.startsWith(sentence.trim())) + 1;
          const end = editor.posToOffset({ line, ch: 0 });
          const box = cm.coordsAtPos(end);
          if (pointer && box)
            await pointer.pointAt(box.left + 60, (box.top + box.bottom) / 2);
          editor.setCursor(editor.offsetToPos(end));
          await draft.view.save();
          const cite = await page.until(
            "formatted",
            () =>
              [
                ...draft.view.contentEl.querySelectorAll<HTMLElement>(
                  ".zt-citation",
                ),
              ].find((e) => e.textContent.includes("Sandve")),
            20000,
          );
          await new Promise((r) => setTimeout(r, pointer ? 600 : 0));
          // Then points at it: the paper's full reference.
          const b = cite.getClientRects()[0]!;
          const last = [...cite.getClientRects()].at(-1)!;
          await pointer?.park(last.right - 3, last.bottom - 3);
          cite.dispatchEvent(
            new MouseEvent("mouseover", {
              clientX: b.left + b.width / 2,
              clientY: b.top + b.height / 2,
              bubbles: true,
              view: window,
            }),
          );
          const pop = await page.until(
            "popover",
            () => {
              const p = draft.view.hoverPopover;
              return (
                p?.hoverEl.isConnected &&
                p.hoverEl.innerText.includes("Sandve") &&
                p
              );
            },
            10000,
          );
          await new Promise((r) => setTimeout(r, 600));
          return {
            cite: cite.textContent,
            popover: pop.hoverEl.innerText.replaceAll(/\s+/g, " "),
          };
        },
        {
          draftPath: DRAFT,
          title: SANDVE.title,
          sentence: SENTENCE,
          opening: OPENING,
        },
        STEP,
      ),
    );
    console.log("[walk] cite", JSON.stringify(cited));
    expect(cited.cite).toContain("Sandve et al., 2013");
    expect(cited.popover).toContain(SANDVE.title);
    await poster("cite");
    await obRun(walk.vaultId, ({ app }) => {
      for (const l of app.workspace.getLeavesOfType("markdown"))
        (l as DraftLeaf).view.hoverPopover?.hide();
    });
  });

  it("word: export the chapter to Word in APA; the document's citations and References", async () => {
    const vaultPath = await obRun(walk.vaultId, ({ app }) =>
      (app.vault.adapter as FileSystemAdapter).getBasePath(),
    );
    await watchNotices(walk.vaultId);
    // The chapter, without the notes meant only for its writer, exported as
    // the reader does: Export note with citations, then Export.
    const notices = await obRun(
      walk.vaultId,
      async (
        { app, page },
        { draftPath, notes, section, lesson3, command, title, done },
      ) => {
        page.closePopovers(document);
        const file = app.vault.getFileByPath(draftPath)!;
        // The draft as Lesson 3 leaves it, with its section citing Sandve et
        // al. 2013 at page 2, less the notes to self.
        await app.vault.process(file, (text) => {
          const from = text.indexOf(section);
          const at = text.indexOf(notes);
          if (at < 0) return text;
          const head =
            from >= 0 && from < at ? text.slice(0, from) : text.slice(0, at);
          return `${`${head}${lesson3}`.trimEnd()}\n`;
        });
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        // A leaf closed while the workspace walks its leaves skips the next one.
        const others: WorkspaceLeaf[] = [];
        app.workspace.iterateRootLeaves((l) => {
          if (l !== leaf) others.push(l);
        });
        for (const l of others) l.detach();
        app.workspace.setActiveLeaf(leaf, { focus: true });
        // Export note with citations.
        app.commands.executeCommandById(command);
        const dialog = await page.until(
          "export dialog",
          () =>
            [...document.querySelectorAll(".modal")].find(
              (d) => d.querySelector(".modal-title")?.textContent === title,
            ),
          10000,
        );
        const button = await page.stands(
          dialog.querySelector<HTMLElement>("button.mod-cta"),
          "Export",
        );
        page.press(button, "Export");
        await page.until(
          "export ends",
          () => page.scratch.docsWalkNotices!.some((t) => t.startsWith(done)),
          60000,
        );
        return page.scratch.docsWalkNotices!;
      },
      {
        draftPath: DRAFT,
        notes: NOTES_TO_SELF,
        section: SECTION,
        lesson3: `${SECTION}\n\n${SENTENCE}[@${SANDVE.citekey}, p. 2].\n`,
        command: "zotlit:pandoc-export",
        title: m.pandoc_export_title(),
        done: m
          .notice_pandoc_export_done({ file: "", style: "" })
          .split(" ")[0]!,
      },
      { timeoutMs: 90000 },
    );
    expect(notices).toContain(
      m.notice_pandoc_export_done({ file: EXPORTED_NAME, style: APA_TITLE }),
    );
    const docx = join(vaultPath, EXPORTED);
    const { stdout: text } = await execFileAsync("pandoc", [
      docx,
      "-t",
      "plain",
      "--wrap=none",
    ]);
    expect(text).toContain("(Sandve et al., 2013, p. 2)");
    expect(text).toContain("\nReferences\n");
    if (!captureRequested()) return;
    // Obsidian opens no Word file and no Word app is at hand: the poster is
    // the document's first page as macOS Quick Look draws it, on Word's grey
    // page canvas.
    await mkdir(CAPTURES, { recursive: true });
    const page = join(CAPTURES, `${EXPORTED_NAME}.png`);
    await rm(page, { force: true });
    await execFileAsync("qlmanage", ["-t", "-s", "2400", "-o", CAPTURES, docx]);
    await mkdir(IMAGES, { recursive: true });
    await wordPoster(page, join(CAPTURES, "word.png"));
    await execFileAsync("cwebp", [
      "-quiet",
      "-q",
      "90",
      join(CAPTURES, "word.png"),
      "-o",
      join(IMAGES, "word.webp"),
    ]);
  });
});

/**
 * Lay the first page `page` on a grey canvas, 1600 × 1000: the page's top
 * edge shows, and its text from the first heading to the end of the
 * References fills the frame's height.
 */
async function wordPoster(page: string, out: string): Promise<void> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    page,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number) as [number, number];
  // The page down to where its text ends: the fraction of the page's height
  // the text reaches, measured on this chapter.
  const shown = Math.round(h * WORD_TEXT_END);
  // The canvas: 16:10, with the page's top edge 5 % under its top.
  const top = Math.round(shown * 0.05);
  const height = shown + top;
  const width = Math.round((height * 16) / 10);
  const x = Math.round((width - w) / 2);
  await execFileAsync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    page,
    "-vf",
    `crop=${w}:${shown}:0:0,pad=${width}:${height}:${x}:${top}:0xe6e6e6,scale=${POSTER.width}:${POSTER.height}:flags=lanczos`,
    "-frames:v",
    "1",
    out,
  ]);
}

/** Where the chapter's References end on its first page, as a fraction of the page's height. */
const WORD_TEXT_END = 0.5;
