// The walk of the lesson apps/docs/content/docs/find-and-read-sources/
// annotate-pdfs-in-obsidian.mdx: a researcher reading a Zotero PDF in
// Obsidian allows ZotLit to edit Zotero, highlights a passage with a comment,
// finds it in the annotation sidebar, edits the comment and sees the edit in
// Zotero, then quotes the highlight in a chapter draft and follows its link
// back, on this computer and on one without the PDF. Each `it` is one step of
// the page, in the page's order, and asserts what the page says the reader
// sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

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
import type {
  HoverPopover,
  MarkdownView,
  SecretStorage,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { AnnotationView } from "@/views/annot-view/view";
import type { LibraryView } from "@/views/library/view";

import {
  captureRequested,
  openDocsWalk,
  readNotices,
  watchNotices,
} from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "annotate-pdfs-in-obsidian";

/** Wilson et al. 2014 in the docs Vault Case: a PDF in Zotero storage with no annotation yet. */
const PAPER = {
  key: "DCWLSART",
  attachmentKey: "DCWLSPDF",
  citekey: "wilson2014",
  file: "Wilson et al. - 2014 - Best Practices for Scientific Computing.pdf",
};
/** The passage the reader highlights on page 1, as the PDF's text layer holds it. */
const PASSAGE = {
  from: "We believe that software",
  to: "physical apparatus.",
  text: "We believe that software is just another kind of experimental apparatus [3] and should be built, checked, and used as carefully as any physical apparatus.",
};
const COMMENT =
  "The argument for treating my analysis scripts like lab equipment.";
const ADDED = " Cite in the methods chapter, section 2.3.";
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
/** The heading the reader drops the quote above. */
const DROP_BEFORE = "## Notes to self";

type PdfLeaf = WorkspaceLeaf & { view: PagePdfView };
type AnnotationLeaf = WorkspaceLeaf & { view: AnnotationView };
type LibraryLeaf = WorkspaceLeaf & { view: LibraryView };
type DraftLeaf = WorkspaceLeaf & {
  view: MarkdownView & {
    hoverPopover: (HoverPopover & { hide(): void }) | null;
  };
};

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

/** The durable link ZotLit writes for an annotation of the paper on page 1. */
function linkTo(annotationKey: string): string {
  return `zotero://open/library/items/${PAPER.attachmentKey}?annotation=${annotationKey}&page=1`;
}

describe.skipIf(!reachable)("Annotate Zotero PDFs in Obsidian", () => {
  let walk: DocsWalk;
  let dataDir: string;
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
    const find =
      window === "main"
        ? "Zotero.getMainWindow()"
        : `(()=>{const all=Services.wm.getEnumerator(null);while(all.hasMoreElements()){const w=all.getNext();if(w.location?.href==='chrome://global/content/commonDialog.xhtml'&&w.document.getElementById('commonDialog'))return w;}return null;})()`;
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
      collection: "find-and-read-sources",
      vaultCase: "docs",
    });
    dataDir = (await obRun(
      walk.vaultId,
      ({ zotlit }) =>
        zotlit.services.bridge.runSync(zotlit.services.zoteroPref.current)
          .dataDirOverride,
    ))!;
    // The Paired Run grants ZotLit editing ahead of the walk; the reader
    // starts without that grant. The walk also records every `zotero:` link
    // ZotLit hands to the system, which would otherwise reach the real
    // Zotero on this computer. ZotLit patches `window.open` as it loads, so
    // it loads again over the recorder.
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
    await watchNotices(walk.vaultId);
  });

  afterAll(async () => {
    // A failure between the request and the answer leaves Zotero's dialog
    // up, which blocks every later RDP call.
    if (walk) await denyAnyAuthorizationDialog(walk.zotero).catch(() => {});
    await walk?.[Symbol.asyncDispose]();
  });

  it("opens the PDF read-only, with the tools dimmed until editing is allowed", async () => {
    await raiseWindow(walk.vaultId);
    const opened = await obRun(
      walk.vaultId,
      async ({ app, page }, { paperKey, file, readingOnly }) => {
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
        page.press(
          await page.until(
            "paper row",
            () =>
              el.querySelector<HTMLElement>(
                `[data-query-item-row="${paperKey}"]`,
              ),
            20000,
          ),
          "paper row",
        );
        page.press(
          await page.until(
            "Open PDF",
            () =>
              el.querySelector<HTMLElement>(
                '[data-library-card] [data-library-card-action="pdf"]',
              ),
            10000,
          ),
          "Open PDF",
        );
        const tool = await page.until(
          "PDF tools",
          () => {
            const pdf = (
              app.workspace.getLeavesOfType("pdf") as PdfLeaf[]
            ).find((l) => decodeURI(l.view.file?.path ?? "").endsWith(file));
            return pdf?.view.containerEl.querySelector(
              '[data-zt-tool="highlight"]',
            );
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
        return {
          disabled: tool.getAttribute("aria-disabled"),
          tooltip: tool.getAttribute("aria-label"),
          header: header.innerText,
        };
      },
      {
        paperKey: PAPER.key,
        file: PAPER.file,
        readingOnly: m.annot_view_header_reading_only(),
      },
      STEP,
    );
    expect(opened.disabled).toBe("true");
    expect(opened.tooltip).toBe(m.capability_authorization_required_detail());
    expect(opened.header).toContain(m.annot_view_header_reading_only());
  });

  it("asks Zotero for permission from the annotation sidebar, and Always Allow turns the tools on", async () => {
    await raiseWindow(walk.vaultId);
    const asked = await obRun(
      walk.vaultId,
      async ({ app, page }, { file, enable }) => {
        const side = (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
            | AnnotationLeaf
            | undefined
        )?.view.contentEl;
        page.press(
          await page.stands(
            side?.querySelector<HTMLElement>(".zt-annot-header"),
            "sidebar header",
          ),
          "sidebar header",
        );
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
        page.press(item, "Allow editing");
        const pdf = (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find(
          (l) => decodeURI(l.view.file?.path ?? "").endsWith(file),
        )!;
        const status = await page.until(
          "waiting status",
          () =>
            pdf.view.containerEl.querySelector<HTMLElement>(
              ".zt-pdf-capability",
            )?.innerText,
          10000,
        );
        return { menu, status };
      },
      { file: PAPER.file, enable: m.capability_enable_editing() },
      STEP,
    );
    expect(asked.menu).toContain(m.capability_authorization_required());
    expect(asked.status).toBe(m.capability_authorizing());
    expect(await waitForAuthorizationDialog(walk.zotero)).toBe(true);
    const dialog = await walk.zotero.json<{
      text: string;
      buttons: string[];
    }>(
      `(()=>{const all=Services.wm.getEnumerator(null);while(all.hasMoreElements()){const w=all.getNext();const d=w.document?.getElementById('commonDialog');if(w.location?.href==='chrome://global/content/commonDialog.xhtml'&&d)return ({text:w.document.getElementById('infoBody').textContent,buttons:['accept','cancel','extra1'].map(b=>d.getButton(b).label)});}return null;})()`,
    );
    expect(dialog.text).toContain("wants to modify your Zotero library");
    expect(dialog.buttons).toEqual(["Allow", "Always Allow", "Deny"]);
    await walk.capture("allow-editing");
    await captureZotero("zotero-dialog", "dialog");
    await walk.compose("allow-editing");
    // The reader chooses Always Allow, Zotero's second button.
    await clickAuthorizationDialog(walk.zotero, "cancel");
    const granted = await obRunUntil(
      walk.vaultId,
      ({ app }, { file }) => {
        const pdf = (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find(
          (l) => decodeURI(l.view.file?.path ?? "").endsWith(file),
        )!;
        return {
          disabled: pdf.view.containerEl
            .querySelector('[data-zt-tool="highlight"]')!
            .getAttribute("aria-disabled"),
        };
      },
      { file: PAPER.file },
      { what: "tools on", ready: (value) => value.disabled !== "true" },
    );
    expect(granted.disabled).not.toBe("true");
    expect(await readNotices(walk.vaultId)).toContain(
      m.notice_zotero_editing_enabled(),
    );
  });

  it("highlights a passage with a comment from the selection's popup", async () => {
    await raiseWindow(walk.vaultId);
    const popup = await obRun(
      walk.vaultId,
      async ({ app, page }, { file, from, to }) => {
        const pdf = (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find(
          (l) => decodeURI(l.view.file?.path ?? "").endsWith(file),
        )!;
        const layerOf = () =>
          pdf.view.containerEl.querySelector<HTMLElement>(
            '.page[data-page-number="1"] .textLayer',
          );
        const layer = await page.until(
          "text layer",
          () => (layerOf()?.textContent.length ?? 0) > 0 && layerOf(),
          20000,
        );
        const nodes: Text[] = [];
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
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
        const box = range.getClientRects()[0]!;
        const x = box.left + 2;
        const y = box.top + box.height / 2;
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
        return {
          verbs: [...row.querySelectorAll("[data-zt-verb]")].map((b) =>
            b.getAttribute("aria-label"),
          ),
          selected: range.toString().replaceAll(/\s+/g, " "),
        };
      },
      { file: PAPER.file, from: PASSAGE.from, to: PASSAGE.to },
      STEP,
    );
    expect(popup.verbs).toEqual([
      m.pdf_toolbar_highlight(),
      m.pdf_toolbar_underline(),
      "Yellow",
      "Red",
      "Green",
      "Blue",
      m.annot_view_card_add_comment(),
      m.pdf_create_popup_copy(),
    ]);
    const sheet = await obRun(
      walk.vaultId,
      async ({ page }, { comment, highlight }) => {
        page.press(
          document.querySelector<HTMLElement>(
            '.zt-pdf-mark-popup [data-zt-verb="comment"]',
          ),
          "Add comment",
        );
        const editor = await page.until(
          "comment editor",
          () =>
            document.querySelector<HTMLElement>(
              ".zt-pdf-mark-popup .cm-content",
            ),
          5000,
        );
        editor.focus();
        document.execCommand("insertText", false, comment);
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
    expect(sheet.commit).toBe(m.pdf_toolbar_highlight());
    await walk.capture("highlight-popup");
    await walk.compose("highlight-popup");
    const created = await obRun(
      walk.vaultId,
      async ({ app, page }, { comment, highlight }) => {
        page.press(
          [
            ...document.querySelectorAll<HTMLElement>(
              ".zt-pdf-mark-popup button",
            ),
          ].find((b) => b.textContent === highlight),
          "Highlight",
        );
        const sideOf = () =>
          (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
              | AnnotationLeaf
              | undefined
          )?.view.contentEl;
        const card = await page.until(
          "new card",
          () =>
            sideOf()?.querySelector<HTMLElement>(
              ".zt-annot-card[data-zotero-annotation-key]",
            ),
          20000,
        );
        await page.until(
          "card comment",
          () => card.innerText.includes(comment),
          10000,
        );
        const side = sideOf()!;
        return {
          key: card.dataset.zoteroAnnotationKey!,
          text: card.innerText,
          filters: [...side.querySelectorAll("[aria-label]")].map((b) =>
            b.getAttribute("aria-label")!,
          ),
        };
      },
      { comment: COMMENT, highlight: m.pdf_toolbar_highlight() },
      STEP,
    );
    annotationKey = created.key;
    expect(created.text.replaceAll(/\s+/g, " ")).toContain(
      m.annot_view_page({ page: "1" }).replaceAll(/\s+/g, " "),
    );
    expect(created.text.replaceAll(/\s+/g, " ")).toContain(PASSAGE.text);
    expect(created.text).toContain(COMMENT);
    expect(created.filters).toContain(m.annot_view_filter_color_trigger());
    expect(created.filters).toContain(m.annot_view_filter_tag_trigger_none());
    // Zotero holds the highlight the moment it appears.
    const stored = await walk.zotero.json<{
      text: string;
      comment: string;
      color: string;
    }>(
      `(()=>{const i=Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(annotationKey)});return {text:i.annotationText,comment:i.annotationComment,color:i.annotationColor};})()`,
    );
    expect(stored).toEqual({
      text: PASSAGE.text,
      comment: COMMENT,
      color: "#ffd400",
    });
    await obRun(
      walk.vaultId,
      async ({ app }, { file }) => {
        const pdf = (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find(
          (l) => decodeURI(l.view.file?.path ?? "").endsWith(file),
        )!;
        getSelection()!.removeAllRanges();
        pdf.view.containerEl
          .querySelector('.page[data-page-number="1"]')!
          .scrollIntoView({ block: "start" });
        await new Promise((r) => setTimeout(r, 300));
        pdf.view.viewer.child.pdfViewer.pdfViewer.container.scrollTop += 420;
        await new Promise((r) => setTimeout(r, 800));
      },
      { file: PAPER.file },
    );
    await walk.capture("highlight");
    await walk.compose("highlight");
  });

  it("edits the comment on its card, and the edit arrives in Zotero", async () => {
    const edited = await obRun(
      walk.vaultId,
      async ({ app, page }, { annotationKey, added }) => {
        const side = (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
            | AnnotationLeaf
            | undefined
        )?.view.contentEl;
        const card = side!.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key="${annotationKey}"]`,
        )!;
        page.press(card, "card");
        page.press(
          await page.until(
            "comment field",
            () => card.querySelector<HTMLElement>(".zt-annot-comment-field"),
            5000,
          ),
          "comment",
        );
        const editor = await page.until(
          "card editor",
          () => card.querySelector<HTMLElement>(".cm-content"),
          5000,
        );
        editor.focus();
        const sel = getSelection()!;
        sel.selectAllChildren(editor);
        sel.collapseToEnd();
        document.execCommand("insertText", false, added);
        return { typed: editor.innerText };
      },
      { annotationKey, added: ADDED },
      STEP,
    );
    expect(edited.typed).toBe(COMMENT + ADDED);
    // The comment saves by itself once the typing stops; Zotero is the oracle.
    let held = "";
    for (let tries = 0; tries < 40 && held !== COMMENT + ADDED; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      held = await walk.zotero.json<string>(
        `Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(annotationKey)}).annotationComment`,
      );
    }
    expect(held).toBe(COMMENT + ADDED);
    await obRun(walk.vaultId, () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    // The reader opens the same PDF in Zotero and finds the comment there.
    const shown = await walk.zotero.json<{ sidebar: boolean }>(
      `(async()=>{const att=Zotero.Items.getByLibraryAndKey(1,${JSON.stringify(PAPER.attachmentKey)});
      const w=Zotero.getMainWindow();w.resizeTo(1440,900);
      const reader=await Zotero.Reader.open(att.id);await reader._initPromise;await new Promise(r=>setTimeout(r,2000));
      reader.toggleSidebar(true);for(let i=0;i<2;i++){await reader.navigate({annotationID:${JSON.stringify(annotationKey)}});await new Promise(r=>setTimeout(r,2000));}
      return {sidebar:true};})()`,
    );
    expect(shown.sidebar).toBe(true);
    await captureZotero("in-zotero", "main");
    await walk.compose("in-zotero");
  });

  it("drags the highlight into the chapter draft as a quote with a link", async () => {
    const text = await obRun(
      walk.vaultId,
      async ({ app, page }, { file, draftPath, annotationKey, dropBefore }) => {
        const pdf = (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find(
          (l) => decodeURI(l.view.file?.path ?? "").endsWith(file),
        )!;
        const draft = app.workspace.createLeafBySplit(
          pdf,
          "vertical",
        ) as DraftLeaf;
        await draft.openFile(app.vault.getFileByPath(draftPath)!);
        app.workspace.setActiveLeaf(pdf, { focus: true });
        await new Promise((r) => setTimeout(r, 800));
        const side = (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
            | AnnotationLeaf
            | undefined
        )?.view.contentEl;
        const chip = await page.until(
          "page label",
          () =>
            side?.querySelector(
              `.zt-annot-card[data-zotero-annotation-key="${annotationKey}"] a.zt-annot-page-chip[draggable="true"]`,
            ),
          10000,
        );
        const editor = draft.view.editor;
        const transfer = new DataTransfer();
        chip.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
        const line = editor
          .getValue()
          .split("\n")
          .findIndex((l) => l === dropBefore);
        const rect = editor.cm.coordsAtPos(
          editor.posToOffset({ line: line - 1, ch: 0 }),
        )!;
        const drop = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: Math.floor(rect.left + 1),
          clientY: Math.floor((rect.top + rect.bottom) / 2),
        });
        app.workspace.trigger("editor-drop", drop, editor, draft.view);
        await page.until(
          "quote inserted",
          () => editor.getValue().includes(annotationKey),
          15000,
        );
        await draft.view.save();
        return editor.getValue();
      },
      {
        file: PAPER.file,
        draftPath: DRAFT,
        annotationKey,
        dropBefore: DROP_BEFORE,
      },
      STEP,
    );
    expect(text).toContain(`> [!note] Page [1](${linkTo(annotationKey)})`);
    expect(text).toContain(`> ${PASSAGE.text} [@${PAPER.citekey}, {p. 1}]`);
    expect(text).toContain(`> ${COMMENT}${ADDED}`);
    expect(text.indexOf(linkTo(annotationKey))).toBeLessThan(
      text.indexOf(DROP_BEFORE),
    );
  });

  it("shows the quote and the comment when the link is hovered", async () => {
    const popover = await obRun(
      walk.vaultId,
      async ({ app, page }, { draftPath, link: href }) => {
        app.workspace.rightSplit.collapse();
        const draft = app.workspace
          .getLeavesOfType("markdown")
          .find(
            (l) => (l.view as MarkdownView).file?.path === draftPath,
          ) as DraftLeaf;
        app.workspace.setActiveLeaf(draft, { focus: true });
        draft.view.editor.setCursor({ line: 0, ch: 0 });
        const link = await page.until(
          "link",
          () =>
            [...draft.view.contentEl.querySelectorAll("a.external-link")].find(
              (a) => a.getAttribute("href") === href,
            ),
          10000,
        );
        link.scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 500));
        const box = link.getClientRects()[0]!;
        link.dispatchEvent(
          new MouseEvent("mouseover", {
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2,
            bubbles: true,
            view: window,
          }),
        );
        const pop = await page.until(
          "popover",
          () =>
            draft.view.hoverPopover?.hoverEl.isConnected &&
            draft.view.hoverPopover.hoverEl.querySelector(
              ".zt-citation-popover-content",
            )?.textContent &&
            draft.view.hoverPopover,
          10000,
        );
        await new Promise((r) => setTimeout(r, 800));
        return pop.hoverEl.innerText;
      },
      { draftPath: DRAFT, link: linkTo(annotationKey) },
      STEP,
    );
    expect(popover.replaceAll(/\s+/g, " ")).toContain(
      m.annot_view_page({ page: "1" }).replaceAll(/\s+/g, " "),
    );
    expect(popover.replaceAll(/\s+/g, " ")).toContain(PASSAGE.text);
    expect(popover).toContain(COMMENT + ADDED);
    await walk.capture("hover");
    await walk.compose("hover");
  });

  it("opens the passage in Obsidian when the link is selected", async () => {
    const landed = await obRun(
      walk.vaultId,
      async ({ app, page }, { draftPath, link: href }) => {
        app.workspace.rightSplit.expand();
        for (const l of app.workspace.getLeavesOfType("pdf")) l.detach();
        const draft = app.workspace
          .getLeavesOfType("markdown")
          .find(
            (l) => (l.view as MarkdownView).file?.path === draftPath,
          ) as DraftLeaf;
        app.workspace.setActiveLeaf(draft, { focus: true });
        draft.view.hoverPopover?.hide();
        draft.view.editor.setCursor({ line: 0, ch: 0 });
        const link = await page.until(
          "link",
          () =>
            [...draft.view.contentEl.querySelectorAll("a.external-link")].find(
              (a) => a.getAttribute("href") === href,
            ),
          10000,
        );
        link.scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 300));
        const box = link.getClientRects()[0]!;
        const init = {
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
        };
        link.dispatchEvent(
          new MouseEvent("mousedown", { ...init, buttons: 1 }),
        );
        link.dispatchEvent(new MouseEvent("mouseup", init));
        link.dispatchEvent(new MouseEvent("click", init));
        await page.until(
          "PDF in the draft tab",
          () => draft.view.getViewType() === "pdf",
          15000,
        );
        const pdfView = draft.view as unknown as PagePdfView;
        const selected = await page.until(
          "passage selected",
          () => {
            const k = [
              ...pdfView.containerEl.querySelectorAll<HTMLElement>(
                ".zt-pdf-annotation-mark.is-selected",
              ),
            ].map((e) => e.dataset.zoteroAnnotationKey!);
            return k.length ? k : false;
          },
          15000,
        );
        return {
          sameTab: pdfView.getViewType() === "pdf",
          page:
            pdfView.viewer?.child?.pdfViewer?.pdfViewer?.currentPageNumber ??
            null,
          selected: [...new Set(selected)],
          passed: page.scratch.annotatePdfsLinks!.passed,
        };
      },
      { draftPath: DRAFT, link: linkTo(annotationKey) },
      STEP,
    );
    expect(landed).toEqual({
      sameTab: true,
      page: 1,
      selected: [annotationKey],
      passed: [],
    });
  });

  it("hands the link to Zotero on a computer that does not hold the PDF", async () => {
    // The laptop case: the library synced, the PDF file did not. The walk
    // moves the file away for this one click and puts it back.
    const pdfPath = join(dataDir, "storage", PAPER.attachmentKey, PAPER.file);
    await obRun(
      walk.vaultId,
      ({ app }, { path }) => {
        const fs = require("fs") as typeof import("node:fs");
        for (const l of app.workspace.getLeavesOfType("pdf")) l.detach();
        fs.renameSync(path, `${path}.away`);
      },
      { path: pdfPath },
    );
    let outcome: { passed: string[]; pdf: number };
    try {
      outcome = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, link: href }) => {
          const links = page.scratch.annotatePdfsLinks!;
          const leaf = app.workspace.getLeaf("tab") as DraftLeaf;
          await leaf.openFile(app.vault.getFileByPath(draftPath)!);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          leaf.view.editor.setCursor({ line: 0, ch: 0 });
          links.passed = [];
          const link = await page.until(
            "link",
            () =>
              [...leaf.view.contentEl.querySelectorAll("a.external-link")].find(
                (a) => a.getAttribute("href") === href,
              ),
            10000,
          );
          link.scrollIntoView({ block: "center" });
          await new Promise((r) => setTimeout(r, 300));
          const box = link.getClientRects()[0]!;
          const init = {
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2,
            bubbles: true,
            cancelable: true,
            button: 0,
            view: window,
          };
          link.dispatchEvent(
            new MouseEvent("mousedown", { ...init, buttons: 1 }),
          );
          link.dispatchEvent(new MouseEvent("mouseup", init));
          link.dispatchEvent(new MouseEvent("click", init));
          await page.until(
            "handed to Zotero",
            () => links.passed.length,
            10000,
          );
          return {
            passed: links.passed,
            pdf: app.workspace.getLeavesOfType("pdf").length,
          };
        },
        { draftPath: DRAFT, link: linkTo(annotationKey) },
        STEP,
      );
    } finally {
      await obRun(
        walk.vaultId,
        (_, { path }) => {
          const fs = require("fs") as typeof import("node:fs");
          fs.renameSync(`${path}.away`, path);
        },
        { path: pdfPath },
      );
    }
    expect(outcome).toEqual({ passed: [linkTo(annotationKey)], pdf: 0 });
  });
});
