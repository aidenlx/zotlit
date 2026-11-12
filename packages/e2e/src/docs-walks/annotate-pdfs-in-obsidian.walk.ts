// The walk of /learn Lesson 2, "Read and annotate a paper in Obsidian": a
// researcher with the Lesson 1 literature note on Sandve et al. 2013 opens
// its PDF in Obsidian, allows ZotLit to edit Zotero, highlights a passage
// with a comment, finds the same highlight in Zotero, and sees it in the
// literature note without an update. Each `it` is one step of the lesson, in
// the lesson's order, named after it, and asserts what the lesson says the
// reader sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see
// AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
import type { PagePdfView } from "@e2e/page-notes-types.ts";
import {
  clickAuthorizationDialog,
  denyAnyAuthorizationDialog,
  waitForAuthorizationDialog,
} from "@e2e/paired-zotero.ts";
import { raiseWindow } from "@e2e/reader-gestures.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MarkdownView, SecretStorage, WorkspaceLeaf } from "obsidian";
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

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "annotate-pdfs-in-obsidian";

/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five annotations. */
const PAPER = {
  key: "DCSNDART",
  attachmentKey: "DCSNDPDF",
  citekey: "sandve2013",
  file: "Sandve et al. - 2013 - Ten Simple Rules for Reproducible Computational Research.pdf",
  annotations: 5,
};
/** The passage the reader highlights on page 2, as the PDF's text layer holds it. */
const PASSAGE = {
  page: 2,
  from: "Such manual",
  to: "reproduce.",
  words: "difficult to reproduce.",
};
const COMMENT = "Why I script every change to the survey data.";
/** The literature note Lesson 1 wrote. */
const NOTE = `literatures/${PAPER.citekey}.md`;
/** Zotero's yellow, the highlight colour a new highlight takes. */
const YELLOW = "#ffd400";

type PdfLeaf = WorkspaceLeaf & { view: PagePdfView };
type AnnotationLeaf = WorkspaceLeaf & { view: AnnotationView };
type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type NoteLeaf = WorkspaceLeaf & { view: MarkdownView };

/** The `zotero:` links ZotLit handed to the system handler. */
interface ZoteroLinks {
  native: Window["open"];
  passed: string[];
}
declare module "../page-helpers.ts" {
  interface PageScratch {
    annotatePdfsLinks?: ZoteroLinks;
  }
}

/** A reader's step in Obsidian may wait on the apps for up to a minute. */
const STEP = { timeoutMs: 60000 };

/** The Zotero expression for the open authorization dialog, or `null`. */
const FIND_DIALOG = `(()=>{const all=Services.wm.getEnumerator(null);while(all.hasMoreElements()){const w=all.getNext();if(w.location?.href==='chrome://global/content/commonDialog.xhtml'&&w.document.getElementById('commonDialog'))return w;}return null;})()`;

describe.skipIf(!reachable)(
  "Lesson 2: Read and annotate a paper in Obsidian",
  () => {
    let walk: DocsWalk;
    /** The literature note as Lesson 1 left it on disk. */
    let noteBefore: string;
    /** The annotation keys of the PDF before the reader highlights. */
    let keysBefore: string[];
    let annotationKey: string;

    /**
     * Save a Zotero window as the layer `layer` beside the Obsidian captures.
     * Gecko draws its own window to a canvas, which needs no screen-recording
     * permission. Does nothing unless the run captures.
     */
    async function captureZotero(
      layer: string,
      window: "dialog" | "main",
    ): Promise<void> {
      if (!captureRequested()) return;
      const folder = join(root, ".scratch", "docs-walks", SLUG);
      await mkdir(folder, { recursive: true });
      const path = join(folder, `${layer}.png`);
      const find = window === "main" ? "Zotero.getMainWindow()" : FIND_DIALOG;
      await walk.zotero
        .json<boolean>(`(async()=>{const w=${find};if(!w)throw new Error('no Zotero window');
      const r=w.devicePixelRatio,W=w.innerWidth,H=w.innerHeight;
      const c=w.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');c.width=W*r;c.height=H*r;
      const ctx=c.getContext('2d');ctx.scale(r,r);ctx.drawWindow(w,0,0,W,H,'rgb(255,255,255)');
      const data=atob(c.toDataURL('image/png').split(',')[1]);
      await IOUtils.write(${JSON.stringify(path)},Uint8Array.from(data,ch=>ch.charCodeAt(0)));return true;})()`);
    }

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `learn/${SLUG}`,
        vaultCase: "docs",
      });
      // The Paired Run grants ZotLit editing ahead of the walk; the reader
      // starts without that grant. The walk also records every `zotero:`
      // link ZotLit hands to the system, which would otherwise reach the
      // real Zotero on this computer. ZotLit patches `window.open` as it
      // loads, so it loads again over the recorder.
      await obRun(
        walk.vaultId,
        async ({ app, zotlit, page }) => {
          await app.plugins.disablePlugin("zotlit");
          // Obsidian's runtime removes a secret; the public typings list no remover.
          (
            app.secretStorage as SecretStorage & {
              deleteSecret(id: string): void;
            }
          ).deleteSecret("zotlit-zotero-write-authorization");
          const links: ZoteroLinks = { native: window.open, passed: [] };
          page.scratch.annotatePdfsLinks = links;
          window.open = function (
            this: Window,
            ...args: Parameters<Window["open"]>
          ) {
            if (String(args[0]).startsWith("zotero:")) {
              links.passed.push(String(args[0]));
              return null;
            }
            return links.native.apply(this, args);
          };
          await app.plugins.enablePlugin("zotlit");
          const services = zotlit.services;
          await services.bridge.runPromise(services.attachmentResolver.indexed);
          app.workspace.leftSplit.collapse();
          // The PDF tab's path runs through the Fixture's folders; the images show the file name alone.
          const style = document.head.createEl("style");
          style.textContent =
            '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
        },
        undefined,
        STEP,
      );
      // The reader closed the setup section in Lesson 1.
      await closeWelcome(walk.vaultId);
      // The reader wrote the literature note on this paper in Lesson 1.
      noteBefore = await obRun(
        walk.vaultId,
        async ({ app, zotlit }, { key }) => {
          const hits = await zotlit.services.itemLookup.search("", {
            limit: 100,
          });
          const hit = hits.find((h) => h.item.key === key);
          if (!hit) throw new Error(`no item ${key}`);
          const result = await zotlit.services.noteFeature.createNote(
            hit.item,
            {},
          );
          if (result.outcome !== "created") throw new Error("note refused");
          return app.vault.read(result.file);
        },
        { key: PAPER.key },
        STEP,
      );
      keysBefore = await walk.zotero.json<string[]>(
        `Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(PAPER.attachmentKey)}).getAnnotations().map(a=>a.key)`,
      );
      expect(keysBefore).toHaveLength(PAPER.annotations);
      await watchNotices(walk.vaultId);
    });

    afterAll(async () => {
      // A failure between the request and the answer leaves Zotero's dialog
      // up, which blocks every later RDP call.
      if (walk) await denyAnyAuthorizationDialog(walk.zotero).catch(() => {});
      await walk?.[Symbol.asyncDispose]();
    });

    it("step 1: open the paper's PDF from its card; annotation tools at the top right are dimmed", async () => {
      await raiseWindow(walk.vaultId);
      const opened = await walk.record("step-1", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { paperKey, file, readingOnly }) => {
            const pointer = page.scratch.docsWalkPointer;
            app.commands.executeCommandById("zotlit:open-library-view");
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
            const row = await page.until(
              "paper row",
              () =>
                el.querySelector<HTMLElement>(
                  `[data-query-item-row="${paperKey}"]`,
                ),
              20000,
            );
            await pointer?.point(row, { inset: 40 });
            page.press(row, "paper row");
            const button = await page.until(
              "Open PDF",
              () =>
                el.querySelector<HTMLElement>(
                  '[data-library-card] [data-library-card-action="pdf"]',
                ),
              10000,
            );
            await pointer?.point(button);
            page.press(button, "Open PDF");
            const pdf = await page.until(
              "PDF tab",
              () =>
                (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find((l) =>
                  decodeURI(l.view.file?.path ?? "").endsWith(file),
                ),
              20000,
            );
            const tools = await page.until(
              "PDF tools",
              () => {
                const t = [
                  ...pdf.view.containerEl.querySelectorAll<HTMLElement>(
                    "[data-zt-tool]",
                  ),
                ];
                return t.length > 0 && t;
              },
              20000,
            );
            const header = await page.until(
              "Reading only",
              () => {
                const side = (
                  app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
                    | AnnotationLeaf
                    | undefined
                )?.view.contentEl;
                const h = side?.querySelector<HTMLElement>(".zt-annot-header");
                return h?.innerText.includes(readingOnly) && h;
              },
              20000,
            );
            const view = pdf.view.containerEl.getBoundingClientRect();
            const box = tools[0]!.getBoundingClientRect();
            // The pointer rests in the tab's right margin, off the page text.
            await pointer?.park(view.right - 8, view.top + view.height * 0.6);
            return {
              tools: tools.map((t) => t.dataset.ztTool),
              disabled: tools.map((t) => t.getAttribute("aria-disabled")),
              tooltip: tools[0]!.getAttribute("aria-label"),
              header: header.innerText,
              // How far the first tool sits from the tab's top-right corner.
              fromRight: Math.round(view.right - box.right),
              fromTop: Math.round(box.top - view.top),
              tabWidth: Math.round(view.width),
            };
          },
          {
            paperKey: PAPER.key,
            file: PAPER.file,
            readingOnly: m.annot_view_header_reading_only(),
          },
          STEP,
        ),
      );
      console.log("[walk] tools", JSON.stringify(opened));
      // Every drawing tool is dimmed; the show-annotations toggle stays on.
      opened.tools.forEach((tool, i) =>
        expect([tool, opened.disabled[i]]).toEqual([
          tool,
          tool === "visibility" ? null : "true",
        ]),
      );
      expect(opened.tooltip).toContain(
        m.capability_authorization_required_detail(),
      );
      expect(opened.header).toContain(m.annot_view_header_reading_only());
      // The tools sit in the right half of the tab's top bar.
      expect(opened.fromRight).toBeLessThan(opened.tabWidth / 2);
      expect(opened.fromTop).toBeLessThan(80);
      await walk.capture("step-1");
      await walk.compose("step-1");
    });

    it("step 2: select the heading of the Zotero annotations sidebar and choose Allow editing; the toolbar shows Waiting for approval in Zotero", async () => {
      await raiseWindow(walk.vaultId);
      const asked = await walk.record("step-2", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { file, enable }) => {
            const pointer = page.scratch.docsWalkPointer;
            const side = (
              app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
                | AnnotationLeaf
                | undefined
            )?.view.contentEl;
            const header = await page.stands(
              side?.querySelector<HTMLElement>(".zt-annot-header"),
              "sidebar header",
            );
            await pointer?.point(header);
            page.press(header, "sidebar header");
            const item = await page.until(
              "Allow editing",
              () =>
                [
                  ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
                ].find((i) => i.innerText === enable),
              5000,
            );
            const menu = [
              ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
            ].map((i) => i.innerText);
            await pointer?.point(item);
            page.press(item, "Allow editing");
            const pdf = (
              app.workspace.getLeavesOfType("pdf") as PdfLeaf[]
            ).find((l) => decodeURI(l.view.file?.path ?? "").endsWith(file))!;
            const status = await page.until(
              "waiting status",
              () =>
                pdf.view.containerEl.querySelector<HTMLElement>(
                  ".zt-pdf-capability",
                )?.innerText,
              10000,
            );
            if (pointer) {
              // The pointer leaves the sidebar's cards for the tab's margin.
              const view = pdf.view.containerEl.getBoundingClientRect();
              await pointer.park(view.right - 8, view.top + view.height * 0.6);
            }
            return { menu, status };
          },
          { file: PAPER.file, enable: m.capability_enable_editing() },
          STEP,
        ),
      );
      expect(asked.menu).toContain(m.capability_enable_editing());
      expect(asked.status).toBe(m.capability_authorizing());
      expect(await waitForAuthorizationDialog(walk.zotero)).toBe(true);
      await walk.capture("step-2");
      await captureZotero("step-2-zotero", "dialog");
      await walk.compose("step-2");
    });

    it("step 3: in Zotero, choose Always Allow (not Allow); a notice that editing is on, and the tools are in colour", async () => {
      const dialog = await walk.zotero.json<{
        text: string;
        buttons: string[];
      }>(
        `(()=>{const w=${FIND_DIALOG};const d=w.document.getElementById('commonDialog');return ({text:w.document.getElementById('infoBody').textContent,buttons:['accept','cancel','extra1'].map(b=>d.getButton(b).label)});})()`,
      );
      expect(dialog.text).toContain("wants to modify your Zotero library");
      expect(dialog.buttons).toEqual(["Allow", "Always Allow", "Deny"]);
      // The reader chooses Always Allow, Zotero's second button. The clip
      // records Zotero's dialog with macOS screen capture and ends on the
      // press, before the dialog closes.
      const title = await walk.zotero.json<string>(
        `${FIND_DIALOG}.document.title`,
      );
      // The image is taken before the clip encodes: the notice lasts only a
      // few seconds.
      const granted = await walk.recordZotero(
        "step-3",
        exactly(title),
        async (pointAt, stop) => {
          await pointAt(
            FIND_DIALOG,
            "w.document.getElementById('commonDialog').getButton('cancel')",
          );
          await stop();
          await clickAuthorizationDialog(walk.zotero, "cancel");
          const granted = await obRunUntil(
            walk.vaultId,
            ({ app }, { file }) => {
              const pdf = (
                app.workspace.getLeavesOfType("pdf") as PdfLeaf[]
              ).find((l) => decodeURI(l.view.file?.path ?? "").endsWith(file))!;
              return [
                ...pdf.view.containerEl.querySelectorAll("[data-zt-tool]"),
              ].map((t) => t.getAttribute("aria-disabled"));
            },
            { file: PAPER.file },
            {
              what: "tools on",
              ready: (value) => value.length > 0 && !value.includes("true"),
            },
          );
          await raiseWindow(walk.vaultId);
          await walk.capture("step-3", { notices: true });
          return granted;
        },
      );
      expect(granted).not.toContain("true");
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_zotero_editing_enabled(),
      );
      await walk.compose("step-3");
    });

    it("step 4: drag across a passage in the PDF; a small toolbar under the passage", async () => {
      await raiseWindow(walk.vaultId);
      const popup = await walk.record("step-4", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { file, from, to, pageNumber }) => {
            const pointer = page.scratch.docsWalkPointer;
            const pdf = (
              app.workspace.getLeavesOfType("pdf") as PdfLeaf[]
            ).find((l) => decodeURI(l.view.file?.path ?? "").endsWith(file))!;
            app.workspace.setActiveLeaf(pdf, { focus: true });
            const pageEl = pdf.view.containerEl.querySelector<HTMLElement>(
              `.page[data-page-number="${pageNumber}"]`,
            )!;
            pageEl.scrollIntoView({ block: "start" });
            const layerOf = () =>
              pageEl.querySelector<HTMLElement>(".textLayer");
            const layer = await page.until(
              "text layer",
              () => (layerOf()?.textContent.length ?? 0) > 0 && layerOf(),
              20000,
            );
            const nodes: Text[] = [];
            const walker = document.createTreeWalker(
              layer,
              NodeFilter.SHOW_TEXT,
            );
            let n: Node | null;
            while ((n = walker.nextNode())) nodes.push(n as Text);
            let all = "";
            const starts = nodes.map((t) => {
              const s = all.length;
              all += t.data;
              return s;
            });
            const at = (k: number): [Text, number] => {
              const x = nodes.findIndex(
                (t, i) => starts[i]! <= k && k <= starts[i]! + t.data.length,
              );
              return [nodes[x]!, k - starts[x]!];
            };
            const i = all.indexOf(from);
            const j = all.indexOf(to, i) + to.length;
            const range = document.createRange();
            range.setStart(...at(i));
            range.setEnd(...at(j));
            range.startContainer.parentElement!.scrollIntoView({
              block: "center",
            });
            await new Promise((r) => setTimeout(r, 500));
            const rects = [...range.getClientRects()];
            const first = rects[0]!;
            const x = first.left + 2;
            const y = first.top + first.height / 2;
            const last = rects.at(-1)!;
            if (pointer) {
              // The reader presses at the passage's start and drags to its end.
              await pointer.pointAt(x, y);
              await pointer.park(last.right, last.top + last.height / 2);
            }
            const pressed = page.fire("pointerdown", x, y);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            page.fire("pointerup", x, y, pressed);
            const row = await page.until(
              "create popup",
              () =>
                document.querySelector(
                  '.zt-pdf-mark-popup [data-zt-verb="highlight"]',
                ) && document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
              5000,
            );
            const box = row.getBoundingClientRect();
            if (pointer) {
              // Then it moves off the passage, so the clip shows all of it.
              const view = pdf.view.containerEl.getBoundingClientRect();
              await pointer.park(view.right - 8, box.bottom + 40);
            }
            return {
              verbs: [...row.querySelectorAll("[data-zt-verb]")].map((b) =>
                b.getAttribute("aria-label"),
              ),
              selected: range.toString().replaceAll(/\s+/g, " "),
              popupTop: Math.round(box.top),
              selectionBottom: Math.round(
                Math.max(...rects.map((r) => r.bottom)),
              ),
            };
          },
          {
            file: PAPER.file,
            from: PASSAGE.from,
            to: PASSAGE.to,
            pageNumber: PASSAGE.page,
          },
          STEP,
        ),
      );
      console.log("[walk] popup", JSON.stringify(popup));
      expect(popup.selected).toContain(PASSAGE.from);
      expect(popup.verbs).toEqual(
        expect.arrayContaining([
          m.pdf_toolbar_highlight(),
          m.annot_view_card_add_comment(),
        ]),
      );
      expect(popup.popupTop).toBeGreaterThanOrEqual(popup.selectionBottom - 2);
      await walk.capture("step-4");
      await walk.compose("step-4");
    });

    it("step 5: select Add comment, type a comment, and select Highlight; the passage turns yellow and a card appears in the sidebar", async () => {
      const { typed, created } = await walk.record("step-5", async () => {
        const typed = await obRun(
          walk.vaultId,
          async ({ page }, { comment, highlight }) => {
            const pointer = page.scratch.docsWalkPointer;
            const add = await page.stands(
              document.querySelector<HTMLElement>(
                '.zt-pdf-mark-popup [data-zt-verb="comment"]',
              ),
              "Add comment",
            );
            await pointer?.point(add);
            page.press(add, "Add comment");
            const editor = await page.until(
              "comment editor",
              () =>
                document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup .cm-content",
                ),
              5000,
            );
            editor.focus();
            if (pointer) {
              const b = editor.getBoundingClientRect();
              await pointer.park(b.right - 20, b.bottom + 30);
              await pointer.keys(
                comment,
                (ch) => document.execCommand("insertText", false, ch),
                { speed: 2 },
              );
            } else document.execCommand("insertText", false, comment);
            await page.until(
              "comment typed",
              () => editor.innerText === comment,
              5000,
            );
            const commit = [
              ...document.querySelectorAll(".zt-pdf-mark-popup button"),
            ].find((b) => b.textContent === highlight);
            return { commit: commit?.textContent ?? null };
          },
          { comment: COMMENT, highlight: m.pdf_toolbar_highlight() },
          STEP,
        );
        const created = await obRun(
          walk.vaultId,
          async ({ app, page }, { comment, highlight, before, file }) => {
            const pointer = page.scratch.docsWalkPointer;
            const commit = await page.stands(
              [
                ...document.querySelectorAll<HTMLElement>(
                  ".zt-pdf-mark-popup button",
                ),
              ].find((b) => b.textContent === highlight),
              "Highlight",
            );
            await pointer?.point(commit);
            page.press(commit, "Highlight");
            const sideOf = () =>
              (
                app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
                  | AnnotationLeaf
                  | undefined
              )?.view.contentEl;
            const card = await page.until(
              "new card",
              () =>
                [
                  ...(sideOf()?.querySelectorAll<HTMLElement>(
                    ".zt-annot-card[data-zotero-annotation-key]",
                  ) ?? []),
                ].find((c) => !before.includes(c.dataset.zoteroAnnotationKey!)),
              20000,
            );
            await page.until(
              "card comment",
              () => card.innerText.includes(comment),
              10000,
            );
            const key = card.dataset.zoteroAnnotationKey!;
            getSelection()!.removeAllRanges();
            const pdf = (
              app.workspace.getLeavesOfType("pdf") as PdfLeaf[]
            ).find((l) => decodeURI(l.view.file?.path ?? "").endsWith(file))!;
            const mark = await page.until(
              "mark on the page",
              () =>
                pdf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key="${key}"]`,
                ),
              10000,
            );
            const painted = mark.matches("[fill],[stroke]")
              ? mark
              : mark.querySelector("[fill],[stroke]");
            card.scrollIntoView({ block: "center" });
            await new Promise((r) => setTimeout(r, 500));
            if (pointer) {
              // The pointer leaves the new highlight and its card in view.
              const view = pdf.view.containerEl.getBoundingClientRect();
              await pointer.park(view.right - 8, view.top + view.height * 0.6);
            }
            return {
              key,
              text: card.innerText,
              colour:
                painted?.getAttribute("fill") ??
                painted?.getAttribute("stroke") ??
                null,
            };
          },
          {
            comment: COMMENT,
            highlight: m.pdf_toolbar_highlight(),
            before: keysBefore,
            file: PAPER.file,
          },
          STEP,
        );
        return { typed, created };
      });
      expect(typed.commit).toBe(m.pdf_toolbar_highlight());
      annotationKey = created.key;
      expect(created.colour?.toLowerCase()).toBe(YELLOW);
      expect(created.text.replaceAll(/\s+/g, " ")).toContain(PASSAGE.words);
      expect(created.text).toContain(COMMENT);
      // Zotero holds the highlight the moment it appears.
      const stored = await walk.zotero.json<{
        text: string;
        comment: string;
        color: string;
        page: string;
      }>(
        `(()=>{const i=Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(annotationKey)});return {text:i.annotationText,comment:i.annotationComment,color:i.annotationColor,page:i.annotationPageLabel};})()`,
      );
      expect(stored).toMatchObject({
        comment: COMMENT,
        color: YELLOW,
        page: String(PASSAGE.page),
      });
      expect(stored.text).toContain(PASSAGE.words);
      await walk.capture("step-5");
      await walk.compose("step-5");
    });

    it("step 6: open the same PDF in Zotero; the same highlight is there", async () => {
      const title = await walk.zotero.json<string>(
        `(async()=>{const w=Zotero.getMainWindow();w.resizeTo(1440,900);w.focus();await new Promise(r=>setTimeout(r,800));return w.document.title;})()`,
      );
      const shown = await walk.recordZotero("step-6", exactly(title), () =>
        walk.zotero.json<{
          listed: boolean;
          comment: string | null;
        }>(
          `(async()=>{const att=Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(PAPER.attachmentKey)});
      const reader=await Zotero.Reader.open(att.id);await reader._initPromise;await new Promise(r=>setTimeout(r,2000));
      reader.toggleSidebar(true);for(let i=0;i<2;i++){await reader.navigate({annotationID:${JSON.stringify(annotationKey)}});await new Promise(r=>setTimeout(r,2000));}
      const a=reader._internalReader._state.annotations.find(x=>x.id===${JSON.stringify(annotationKey)});
      return {listed:!!a,comment:a?.comment??null};})()`,
        ),
      );
      expect(shown).toEqual({ listed: true, comment: COMMENT });
      await captureZotero("step-6", "main");
      await walk.compose("step-6");
    });

    it("step 7: open your literature note from Lesson 1; the new highlight is in the Annotations section, with no update", async () => {
      await raiseWindow(walk.vaultId);
      const note = await walk.record("step-7", async () => {
        const popupState = await obRun(
          walk.vaultId,
          async ({ app, page }, { note, name }) => {
            const pointer = page.scratch.docsWalkPointer;
            app.workspace.setActiveLeaf(
              app.workspace.getLeavesOfType("pdf")[0]!,
              {
                focus: true,
              },
            );
            const popup = () =>
              document.querySelector<HTMLElement>(".zt-pdf-mark-popup");
            // The new highlight's popup is open over the PDF.
            const before = popup()?.checkVisibility() ?? false;
            // The reader opens a new tab (⌘T) and finds the note with the
            // quick switcher (⌘O).
            app.commands.executeCommandById("workspace:new-tab");
            await page.until(
              "empty tab",
              () => app.workspace.getLeavesOfType("empty").length > 0,
              5000,
            );
            app.commands.executeCommandById("switcher:open");
            const input = await page.until(
              "quick switcher",
              () => document.querySelector<HTMLInputElement>(".prompt-input"),
              5000,
            );
            if (pointer) await pointer.type(input, name);
            else {
              input.value = name;
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            const item = await page.until(
              "the note in the quick switcher",
              () =>
                [
                  ...document.querySelectorAll<HTMLElement>(
                    ".prompt .suggestion-item",
                  ),
                ].find((i) => i.innerText.includes(name)),
              5000,
            );
            await pointer?.point(item, { inset: 40 });
            page.press(item, "the note");
            await page.until(
              "the note",
              () => app.workspace.getActiveFile()?.path === note,
              10000,
            );
            if (pointer) {
              const b = app.workspace
                .getMostRecentLeaf()!
                .view.containerEl.getBoundingClientRect();
              await pointer.park(b.right - 14, b.top + b.height * 0.6);
            }
            // The popup hides while the note's tab covers the PDF.
            return {
              before,
              after: {
                mounted: !!popup(),
                covered: popup()?.hasAttribute("data-zt-covered") ?? false,
                shown: popup()?.checkVisibility() ?? false,
              },
            };
          },
          { note: NOTE, name: PAPER.citekey },
          STEP,
        );
        expect(popupState).toEqual({
          before: true,
          after: { mounted: true, covered: true, shown: false },
        });
        return obRunUntil(
          walk.vaultId,
          async ({ app, page }, { note, key }) => {
            let leaf = app.workspace
              .getLeavesOfType("markdown")
              .find((l) => (l.view as MarkdownView).file?.path === note) as
              | NoteLeaf
              | undefined;
            if (!leaf) {
              // The reader opens the note from the file explorer, as any note.
              leaf = app.workspace.getLeaf("tab") as NoteLeaf;
              await leaf.openFile(app.vault.getFileByPath(note)!);
            }
            app.workspace.setActiveLeaf(leaf, { focus: true });
            const card = leaf.view.contentEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key="${key}"]`,
            );
            if (!card) return null;
            card.scrollIntoView({
              block: "center",
              behavior: page.scratch.docsWalkPointer ? "smooth" : "instant",
            });
            await new Promise((r) => setTimeout(r, 900));
            await page.until("settled", () => true);
            return {
              cards: leaf.view.contentEl.querySelectorAll(
                ".zt-annot-card[data-zotero-annotation-key]",
              ).length,
              text: card.innerText,
              body: await app.vault.read(leaf.view.file!),
            };
          },
          { note: NOTE, key: annotationKey },
          { what: "the new highlight in the note", ready: (v) => v !== null },
        );
      });
      // No update: the note on disk is as Lesson 1 left it.
      expect(note!.body).toBe(noteBefore);
      expect(note!.cards).toBe(PAPER.annotations + 1);
      expect(note!.text).toContain(COMMENT);
      // Nothing was handed to the Zotero app on the way.
      expect(
        await obRun(
          walk.vaultId,
          ({ page }) => page.scratch.annotatePdfsLinks!.passed,
        ),
      ).toEqual([]);
      await walk.capture("step-7");
      await walk.compose("step-7");
    });
  },
);

/** A RegExp that matches the window title `title` and nothing longer. */
function exactly(title: string): RegExp {
  return new RegExp(`^${title.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
