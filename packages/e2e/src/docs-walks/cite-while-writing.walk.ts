// The walk of the lesson apps/docs/content/docs/cite-and-export/
// cite-while-writing.mdx: a researcher drafting a thesis chapter in Obsidian
// cites a Zotero paper with its page, checks the citation names the right
// paper, quotes one of its highlights with the citation and page, checks the
// quote by hovering its link, reviews and fixes what the draft cites in the
// References sidebar, and sees the draft and its sources in the local
// citation graph. Each `it` is one step of the page, in the page's order, and
// asserts what the page says the reader sees. Run it with
// `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun } from "@e2e/obsidian-cli.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import type {
  FileView,
  HoverPopover,
  ItemView,
  MarkdownView,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { openDocsWalk, watchNotices } from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "cite-while-writing";

/** Sandve et al. 2013 in the docs Vault Case: a PDF in Zotero storage, five annotations. */
const PAPER = {
  key: "DCSNDART",
  attachmentKey: "DCSNDPDF",
  citekey: "sandve2013",
  title: "Ten Simple Rules for Reproducible Computational Research",
  /** The blue highlight on page 2 the reader quotes. */
  passage: "SV6RZB2J",
  quote:
    "you should ensure that every detail that may influence the execution of the step is recorded.",
  comment: "Keep a run log beside each figure script.",
};
/** Wilson et al. 2014: the paper whose key the reader mistypes. */
const WILSON = { citekey: "wilson2014", typo: "wilson2015" };
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
/** The heading the reader writes the new section above. */
const BEFORE = "## Notes to self";
const SECTION = "## 3.3 Keeping each figure reproducible";
const SENTENCE =
  "Every figure in this chapter comes from a script that records how it ran ";
const TYPO_SENTENCE = `Those scripts follow the practices recommended for any research code [@${WILSON.typo}].`;
const SEARCH = "sandve";

type DraftLeaf = WorkspaceLeaf & {
  view: MarkdownView & {
    hoverPopover: (HoverPopover & { hide(): void }) | null;
  };
};
type ItemLeaf = WorkspaceLeaf & { view: ItemView };
type PdfLeaf = WorkspaceLeaf & { view: FileView };

/** The durable link ZotLit writes for the quoted highlight. */
const LINK = `zotero://open/library/items/${PAPER.attachmentKey}?annotation=${PAPER.passage}&page=2`;

/** A reader's step in Obsidian can wait on several views: one call may take a minute. */
const STEP = { timeoutMs: 60000 };

const flat = (text: string) => text.replaceAll(/\s+/g, " ").trim();

describe.skipIf(!reachable)(
  "Cite Zotero sources while writing in Obsidian",
  () => {
    let walk: DocsWalk;

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `cite-and-export/${SLUG}`,
        vaultCase: "docs",
      });
      await watchNotices(walk.vaultId);
      await obRun(
        walk.vaultId,
        async ({ app }, { draftPath }) => {
          app.workspace.leftSplit.collapse();
          // The PDF tab's path runs through the Fixture's folders; the images show the file name alone.
          const style = document.head.createEl("style");
          style.textContent =
            '.workspace-leaf-content[data-type="pdf"] .view-header-title-parent{display:none}';
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(draftPath)!);
          app.workspace.iterateRootLeaves((l) => {
            if (l !== leaf) l.detach();
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          // The draft alone fills the window while the reader writes; the quote step opens the sidebar.
          app.workspace.rightSplit.collapse();
        },
        { draftPath: DRAFT },
        STEP,
      );
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("suggests the paper when the reader types [@ and the first author", async () => {
      const shown = await obRun(
        walk.vaultId,
        async (
          { app, page },
          { draftPath, before, typed, sentence, search, title },
        ) => {
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          const line = editor
            .getValue()
            .split("\n")
            .findIndex((l) => l === before);
          editor.setCursor({ line, ch: 0 });
          editor.replaceSelection(typed);
          editor.setCursor({ line: line + 2, ch: sentence.length });
          editor.focus();
          const cm = editor.cm;
          for (const ch of `[@${search}`) {
            cm.dispatch(cm.state.replaceSelection(ch), {
              userEvent: "input.type",
            });
            await new Promise((r) => setTimeout(r, 70));
          }
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
          await new Promise((r) => setTimeout(r, 500));
          return {
            rows: [
              ...popup.querySelectorAll<HTMLElement>(".suggestion-item"),
            ].map((n) => n.innerText),
          };
        },
        {
          draftPath: DRAFT,
          before: BEFORE,
          typed: `${SECTION}\n\n${SENTENCE}\n\n`,
          sentence: SENTENCE,
          search: SEARCH,
          title: PAPER.title,
        },
        STEP,
      );
      const [first = ""] = shown.rows;
      expect(flat(first)).toContain(PAPER.title);
      expect(flat(first)).toContain("Sandve et al. (2013)");
      await walk.capture("suggest");
      await walk.compose("suggest");
    });

    it("inserts the citation, and the page typed inside the brackets shows in the formatted citation", async () => {
      const inserted = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, title, citekey, sentence }) => {
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          const popup = [
            ...activeDocument.querySelectorAll(".suggestion-container"),
          ].at(-1)!;
          const row = [...popup.querySelectorAll(".suggestion-item")].find(
            (n) => n.textContent.includes(title),
          )!;
          row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
          row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await page.until(
            "citation inserted",
            () => editor.getValue().includes(`[@${citekey}]`),
            5000,
          );
          // The reader puts the cursor before the closing bracket and types the page,
          const at =
            editor.getValue().indexOf(`[@${citekey}]`) + `[@${citekey}`.length;
          editor.setCursor(editor.offsetToPos(at));
          const cm = editor.cm;
          for (const ch of ", p. 2") {
            cm.dispatch(cm.state.replaceSelection(ch), {
              userEvent: "input.type",
            });
            await new Promise((r) => setTimeout(r, 40));
          }
          // then ends the sentence with a full stop after the citation.
          const cited = `[@${citekey}, p. 2]`;
          const end = editor.getValue().indexOf(cited) + cited.length;
          if (editor.getValue().slice(end, end + 1) === " ")
            editor.replaceRange(
              ".",
              editor.offsetToPos(end),
              editor.offsetToPos(end + 1),
            );
          else editor.replaceRange(".", editor.offsetToPos(end));
          editor.setCursor({ line: 0, ch: 0 });
          await draft.view.save();
          const shown = await page.until(
            "formatted",
            () => {
              const c = [
                ...draft.view.contentEl.querySelectorAll(".zt-citation"),
              ].map((e) => e.textContent);
              return c.some((t) => t.includes("Sandve")) && c;
            },
            20000,
          );
          const line = editor
            .getValue()
            .split("\n")
            .find((l) => l.startsWith(sentence.trim()));
          return { line, shown };
        },
        {
          draftPath: DRAFT,
          title: PAPER.title,
          citekey: PAPER.citekey,
          sentence: SENTENCE,
        },
        STEP,
      );
      expect(inserted.line).toBe(`${SENTENCE}[@${PAPER.citekey}, p. 2].`);
      expect(inserted.shown).toContain("(Sandve et al. 2013, 2)");
    });

    it("shows the paper's full reference when the citation is hovered", async () => {
      const popover = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath }) => {
          /** Hover `el` as a mouse does. */
          const hover = (el: Element) => {
            el.scrollIntoView({ block: "center" });
            const b = el.getClientRects()[0]!;
            el.dispatchEvent(
              new MouseEvent("mouseover", {
                clientX: b.left + b.width / 2,
                clientY: b.top + b.height / 2,
                bubbles: true,
                view: window,
              }),
            );
          };
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          app.workspace.setActiveLeaf(draft, { focus: true });
          const cite = await page.until(
            "citation",
            () =>
              [...draft.view.contentEl.querySelectorAll(".zt-citation")].find(
                (e) => e.textContent.includes("Sandve"),
              ),
            10000,
          );
          hover(cite);
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
          await new Promise((r) => setTimeout(r, 800));
          return pop.hoverEl.innerText;
        },
        { draftPath: DRAFT },
        STEP,
      );
      expect(flat(popover)).toContain(PAPER.title);
      expect(flat(popover)).toContain("Sandve, Geir Kjetil");
      await walk.capture("citation-popover");
      await walk.compose("citation-popover");
    });

    it("quotes a highlight with its citation and page by dragging it into the draft", async () => {
      const text = await obRun(
        walk.vaultId,
        async (
          { app, page },
          { draftPath, paperKey, attachmentKey, passage, before, comment },
        ) => {
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          draft.view.hoverPopover?.hide();
          app.workspace.rightSplit.expand();
          app.commands.executeCommandById("zotlit:open-library-view");
          const el = await page.until(
            "Library View",
            () =>
              (
                app.workspace.getLeavesOfType("zotlit-library")[0] as
                  | ItemLeaf
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
          const pdf = await page.until(
            "PDF",
            () =>
              (app.workspace.getLeavesOfType("pdf") as PdfLeaf[]).find((l) =>
                decodeURI(l.view.file?.path ?? "").includes(attachmentKey),
              ),
            20000,
          );
          // The reader puts the draft beside the PDF.
          for (const l of app.workspace.getLeavesOfType("zotlit-library"))
            l.detach();
          draft.detach();
          const beside = app.workspace.createLeafBySplit(
            pdf,
            "vertical",
            true,
          ) as DraftLeaf;
          await beside.openFile(app.vault.getFileByPath(draftPath)!);
          app.workspace.setActiveLeaf(pdf, { focus: true });
          await new Promise((r) => setTimeout(r, 800));
          const side = (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0] as
              | ItemLeaf
              | undefined
          )?.view.contentEl;
          const card = `.zt-annot-card[data-zotero-annotation-key="${passage}"]`;
          const chip = await page.until(
            "page label",
            () =>
              side?.querySelector(
                `${card} a.zt-annot-page-chip[draggable="true"]`,
              ),
            15000,
          );
          const editor = beside.view.editor;
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
            .findIndex((l) => l === before);
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
          app.workspace.trigger("editor-drop", drop, editor, beside.view);
          await page.until(
            "quote inserted",
            () => editor.getValue().includes(passage),
            15000,
          );
          await beside.view.save();
          app.workspace.setActiveLeaf(beside, { focus: true });
          editor.setCursor({ line: 0, ch: 0 });
          await new Promise((r) => setTimeout(r, 800));
          const box = [
            ...beside.view.contentEl.querySelectorAll<HTMLElement>(".callout"),
          ].find((c) => c.innerText.includes(comment));
          box?.scrollIntoView({ block: "center" });
          // The reader selects the PDF again, and its highlights fill the sidebar.
          app.workspace.setActiveLeaf(pdf, { focus: true });
          await page.until("cards", () => side?.querySelector(card), 10000);
          side!.querySelector(card)!.scrollIntoView({ block: "center" });
          await new Promise((r) => setTimeout(r, 1200));
          return editor.getValue();
        },
        {
          draftPath: DRAFT,
          paperKey: PAPER.key,
          attachmentKey: PAPER.attachmentKey,
          passage: PAPER.passage,
          before: BEFORE,
          comment: PAPER.comment,
        },
        STEP,
      );
      expect(text).toContain(`> [!note] Page [2](${LINK})`);
      expect(text).toContain(`> ${PAPER.quote} [@${PAPER.citekey}, {p. 2}]`);
      expect(text).toContain(`> ${PAPER.comment}`);
      expect(text.indexOf(LINK)).toBeLessThan(text.indexOf(BEFORE));
      await walk.capture("quote");
      await walk.compose("quote");
    });

    it("shows the quote, the comment, and the page when the Page link is hovered", async () => {
      const popover = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, link: href }) => {
          /** Hover `el` as a mouse does. */
          const hover = (el: Element) => {
            el.scrollIntoView({ block: "center" });
            const b = el.getClientRects()[0]!;
            el.dispatchEvent(
              new MouseEvent("mouseover", {
                clientX: b.left + b.width / 2,
                clientY: b.top + b.height / 2,
                bubbles: true,
                view: window,
              }),
            );
          };
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
              [
                ...draft.view.contentEl.querySelectorAll("a.external-link"),
              ].find((a) => a.getAttribute("href") === href),
            10000,
          );
          await new Promise((r) => setTimeout(r, 300));
          hover(link);
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
        { draftPath: DRAFT, link: LINK },
        STEP,
      );
      expect(flat(popover)).toContain(flat(m.annot_view_page({ page: "2" })));
      expect(flat(popover)).toContain(PAPER.quote);
      expect(popover).toContain(PAPER.comment);
      await walk.capture("check-quote");
      await walk.compose("check-quote");
    });

    it("lists every paper the draft cites in the References sidebar", async () => {
      const listed = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath }) => {
          const refs = () =>
            (
              app.workspace.getLeavesOfType("zotlit-references")[0] as
                | ItemLeaf
                | undefined
            )?.view.contentEl;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          draft.view.hoverPopover?.hide();
          for (const l of app.workspace.getLeavesOfType("pdf")) l.detach();
          app.workspace.setActiveLeaf(draft, { focus: true });
          app.commands.executeCommandById("zotlit:open-references-view");
          const el = await page.until(
            "References",
            () => refs()?.innerText.includes("Sandve") && refs(),
            20000,
          );
          await new Promise((r) => setTimeout(r, 1000));
          return {
            text: el.innerText,
            labels: [...el.querySelectorAll("[aria-label]")].map((e) =>
              e.getAttribute("aria-label"),
            ),
          };
        },
        { draftPath: DRAFT },
        STEP,
      );
      expect(listed.text).toContain("Ioannidis, John P. A. 2005");
      expect(listed.text).toContain("Rougier, Nicolas P.");
      expect(listed.text).toContain("Sandve, Geir Kjetil");
      expect(listed.labels).toContain(
        m.references_go_to_occurrence({ count: 2 }),
      );
      await walk.capture("references");
      await walk.compose("references");
    });

    it("reports a mistyped citation key, and lists the paper once the key is fixed", async () => {
      const broken = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, sentence, typoSentence, typo }) => {
          const refs = () =>
            (
              app.workspace.getLeavesOfType("zotlit-references")[0] as
                | ItemLeaf
                | undefined
            )?.view.contentEl;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          const line = editor
            .getValue()
            .split("\n")
            .findIndex((l) => l.startsWith(sentence.trim()));
          editor.setCursor({ line, ch: editor.getLine(line).length });
          editor.replaceSelection(` ${typoSentence}`);
          editor.setCursor({ line: 0, ch: 0 });
          await draft.view.save();
          await page.until(
            "error",
            () => refs()!.innerText.includes(`@${typo}`),
            20000,
          );
          await new Promise((r) => setTimeout(r, 1000));
          return refs()!.innerText;
        },
        {
          draftPath: DRAFT,
          sentence: SENTENCE,
          typoSentence: TYPO_SENTENCE,
          typo: WILSON.typo,
        },
        STEP,
      );
      expect(broken).toContain(
        m.references_citekey_unresolved({ citekey: WILSON.typo }),
      );
      await walk.capture("unresolved");
      await walk.compose("unresolved");
      const fixed = await obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, typo, citekey }) => {
          const refs = () =>
            (
              app.workspace.getLeavesOfType("zotlit-references")[0] as
                | ItemLeaf
                | undefined
            )?.view.contentEl;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          const at = editor.getValue().indexOf(`@${typo}`);
          editor.replaceRange(
            `@${citekey}`,
            editor.offsetToPos(at),
            editor.offsetToPos(at + `@${typo}`.length),
          );
          await draft.view.save();
          await page.until(
            "fixed",
            () =>
              refs()!.innerText.includes("Wilson") &&
              !refs()!.innerText.includes(`@${typo}`),
            20000,
          );
          return { text: refs()!.innerText, doc: editor.getValue() };
        },
        { draftPath: DRAFT, typo: WILSON.typo, citekey: WILSON.citekey },
        STEP,
      );
      expect(fixed.text).toContain("Wilson");
      expect(fixed.doc).toContain(`[@${WILSON.citekey}]`);
    });
  },
);
