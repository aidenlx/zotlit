// The walk of /learn Lesson 3, "Cite while you write": a researcher drafting
// `Chapter 3 - Presenting the results` installs the Pandoc engine, cites
// Sandve et al. 2013 with its page, checks the citation names the right
// paper, and quotes one of its highlights with the citation and page. Each
// `it` is one step of the lesson, in the lesson's order, named after it, and
// asserts what the lesson says the reader sees. Run it with
// `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun, obRunUntil } from "@e2e/obsidian-cli.ts";
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

import {
  closeWelcome,
  openDocsWalk,
  readNotices,
  recordRequested,
  watchNotices,
} from "./docs-walk.ts";
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
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
/** The heading the reader writes the new section above. */
const BEFORE = "## Notes to self";
const SECTION = "## 3.3 Keeping each figure reproducible";
const SENTENCE =
  "Every figure in this chapter comes from a script that records how it ran ";
const SEARCH = "sandve";

type DraftLeaf = WorkspaceLeaf & {
  view: MarkdownView & {
    hoverPopover: (HoverPopover & { hide(): void }) | null;
  };
};
type ItemLeaf = WorkspaceLeaf & { view: ItemView };
type PdfLeaf = WorkspaceLeaf & { view: FileView };

/** A reader's step in Obsidian can wait on several views: one call may take a minute. */
const STEP = { timeoutMs: 60000 };

const flat = (text: string) => text.replaceAll(/\s+/g, " ").trim();

describe.skipIf(!reachable)("Lesson 3: Cite while you write", () => {
  let walk: DocsWalk;

  beforeAll(async () => {
    walk = await openDocsWalk({
      slug: SLUG,
      collection: `learn/${SLUG}`,
      vaultCase: "docs",
    });
    await watchNotices(walk.vaultId);
    // The reader closed the setup section in Lesson 1.
    await closeWelcome(walk.vaultId);
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
        // The draft alone fills the window while the reader writes.
        app.workspace.rightSplit.collapse();
      },
      { draftPath: DRAFT },
      STEP,
    );
  });

  afterAll(async () => {
    await walk?.[Symbol.asyncDispose]();
  });

  it("step 1: in Settings, ZotLit, Citations, select Install at Pandoc engine; Pandoc … is installed", async () => {
    // The clip shows the install from the start: the engine is removed from
    // this computer first, and the reader's Install puts it back.
    const recording = recordRequested("step-1");
    const removed = recording
      ? await obRun(walk.vaultId, async ({ zotlit }) => {
          const h = zotlit.services.pandocEngine;
          await h.runPromise(h.binary.uninstall);
          const s = await h.runPromise(h.binary.getStatus);
          return s.kind;
        })
      : null;
    expect(removed).toBe(recording ? "absent" : null);
    const before = await obRun(walk.vaultId, async ({ zotlit }) => {
      const h = zotlit.services.pandocEngine;
      const s = await h.runPromise(h.binary.getStatus);
      return s.kind;
    });
    const row = await walk.record("step-1", () =>
      obRun(
        walk.vaultId,
        async (
          { app, page },
          { citationsName, engineName, install, installingStatus, uninstall },
        ) => {
          const pointer = page.scratch.docsWalkPointer;
          app.vault.setConfig("settingsPopoutWindow", false);
          app.setting.open();
          app.setting.openTabById("zotlit");
          const named = (name: string) =>
            [
              ...app.setting.modalEl.querySelectorAll<HTMLElement>(
                ".setting-item",
              ),
            ].find(
              (s) =>
                s.querySelector(".setting-item-name")?.textContent === name,
            );
          const citations = await page.until(
            "Citations row",
            () => named(citationsName),
            5000,
          );
          // The page list sits below the window's fold; the reader scrolls to it.
          citations.scrollIntoView({
            block: "center",
            behavior: pointer ? "smooth" : "instant",
          });
          await new Promise((r) => setTimeout(r, pointer ? 700 : 0));
          await new Promise((r) => requestAnimationFrame(r));
          await pointer?.point(citations, { inset: 60 });
          page.press(citations, "Citations");
          const row = await page.until(
            "engine row",
            () => named(engineName),
            5000,
          );
          row.scrollIntoView({ block: "center", behavior: "instant" });
          await page.stands(row, "engine row");
          // The pointer rests under the row's button, off its text.
          const rest = async () => {
            const b = row.getBoundingClientRect();
            await pointer?.park(b.right - 40, b.bottom + 30);
          };
          const buttons = [...row.querySelectorAll("button")].map(
            (b) => b.textContent,
          );
          // The engine is installed once per computer: an earlier run on this
          // computer leaves it installed, and the row offers Uninstall instead.
          const press = [...row.querySelectorAll<HTMLElement>("button")].find(
            (b) => b.textContent === install,
          );
          let installing = false;
          if (press) {
            // The reader reads "Not installed" before pressing Install.
            if (pointer) await new Promise((r) => setTimeout(r, 1000));
            await pointer?.point(press);
            page.press(press, "Install");
            // The row re-renders as the status moves: it shows the download,
            // then the installed engine and its Uninstall.
            await page.until(
              "installing state",
              () =>
                named(engineName)
                  ?.querySelector(".setting-item-description")
                  ?.textContent.includes(installingStatus),
              5000,
            );
            installing = true;
            await rest();
            await page.until(
              "installed state",
              () =>
                [...(named(engineName)?.querySelectorAll("button") ?? [])].some(
                  (b) => b.textContent === uninstall,
                ),
              300000,
            );
          } else await rest();
          // The step ends on the row, where the status appears.
          await pointer?.look(named(engineName) ?? row);
          return { buttons, pressed: !!press, installing };
        },
        {
          citationsName: m.settings_page_citations(),
          engineName: m.settings_citation_engine_name(),
          install: m.settings_citation_engine_install(),
          installingStatus: m.settings_citation_engine_status_installing(),
          uninstall: m.settings_citation_engine_uninstall(),
        },
        // A real download can take minutes.
        { timeoutMs: 330000 },
      ),
    );
    // A recorded step starts from the removed engine and shows its install.
    expect(!recording || (row.pressed && row.installing)).toBe(true);
    const version = await obRunUntil(
      walk.vaultId,
      async ({ zotlit }) => {
        const h = zotlit.services.pandocEngine;
        const s = await h.runPromise(h.binary.getStatus);
        return s.kind === "installed" ? s.version : null;
      },
      undefined,
      { what: "the engine installed", ready: (v) => v !== null, tries: 300 },
    );
    const desc = await obRunUntil(
      walk.vaultId,
      ({ app }, { engineName }) => {
        const row = [
          ...app.setting.modalEl.querySelectorAll<HTMLElement>(".setting-item"),
        ].find(
          (s) =>
            s.querySelector(".setting-item-name")?.textContent === engineName,
        );
        return (
          row?.querySelector(".setting-item-description")?.textContent ?? ""
        );
      },
      { engineName: m.settings_citation_engine_name() },
      {
        what: "the installed status",
        ready: (d) =>
          d.includes(
            m.settings_citation_engine_status_installed({ version: version! }),
          ),
      },
    );
    console.log("[walk] engine", JSON.stringify({ before, row, version }));
    expect(desc).toContain(
      m.settings_citation_engine_status_installed({ version: version! }),
    );
    expect(desc).toContain(m.settings_citation_engine_desc());
    // Pressed, Install ends in its notice; an engine installed before offers Uninstall.
    const notices = await readNotices(walk.vaultId);
    expect(
      row.pressed
        ? notices.includes(m.notice_pandoc_engine_installed())
        : row.buttons.includes(m.settings_citation_engine_uninstall()),
    ).toBe(true);
    await walk.capture("step-1");
    await walk.compose("step-1");
    await obRun(walk.vaultId, ({ app }) => {
      app.setting.close();
    });
  }, 600000);

  it("step 2: in your draft, type [@sandve; a list of matching papers under the cursor", async () => {
    // The reader has written a new section, up to where the citation goes.
    await obRun(
      walk.vaultId,
      ({ app }, { draftPath, before, typed, sentence }) => {
        const draft = app.workspace
          .getLeavesOfType("markdown")
          .find(
            (l) => (l.view as MarkdownView).file?.path === draftPath,
          ) as DraftLeaf;
        app.workspace.setActiveLeaf(draft, { focus: true });
        const editor = draft.view.editor;
        const line = editor
          .getValue()
          .split("\n")
          .findIndex((l) => l === before);
        editor.setCursor({ line, ch: 0 });
        editor.replaceSelection(typed);
        editor.setCursor({ line: line + 2, ch: sentence.length });
        editor.focus();
      },
      {
        draftPath: DRAFT,
        before: BEFORE,
        typed: `${SECTION}\n\n${SENTENCE}\n\n`,
        sentence: SENTENCE,
      },
      STEP,
    );
    const shown = await walk.record("step-2", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, search, title }) => {
          const pointer = page.scratch.docsWalkPointer;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const cm = draft.view.editor.cm;
          if (pointer) {
            // The pointer rests above the line, off the text and the list.
            const at = cm.coordsAtPos(cm.state.selection.main.head)!;
            await pointer.park(at.right + 160, at.top - 40);
          }
          const put = (ch: string) =>
            cm.dispatch(cm.state.replaceSelection(ch), {
              userEvent: "input.type",
            });
          if (pointer) await pointer.keys(`[@${search}`, put);
          else
            for (const ch of `[@${search}`) {
              put(ch);
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
          const caret = cm.coordsAtPos(cm.state.selection.main.head)!;
          const box = popup.getBoundingClientRect();
          // The step ends on the typed text and the list under it.
          await pointer?.look([popup, caret]);
          return {
            rows: [
              ...popup.querySelectorAll<HTMLElement>(".suggestion-item"),
            ].map((n) => n.innerText),
            below: box.top >= caret.bottom - 2,
            near: Math.abs(box.left - caret.left) < 200,
          };
        },
        {
          draftPath: DRAFT,
          search: SEARCH,
          title: PAPER.title,
        },
        STEP,
      ),
    );
    console.log("[walk] suggest", JSON.stringify(shown));
    const [first = ""] = shown.rows;
    expect(flat(first)).toContain(PAPER.title);
    expect(flat(first)).toContain("Sandve et al. (2013)");
    expect(shown.below).toBe(true);
    expect(shown.near).toBe(true);
    await walk.capture("step-2");
    await walk.compose("step-2");
  });

  it("step 3: press Enter; [@sandve2013] in your draft", async () => {
    const inserted = await walk.record("step-3", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, citekey, sentence }) => {
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          // The clip opens on the list, then the reader presses Enter.
          if (page.scratch.docsWalkPointer)
            await new Promise((r) => setTimeout(r, 1000));
          await page.trusted(window).key("Enter");
          await page.until(
            "citation inserted",
            () => editor.getValue().includes(`[@${citekey}]`),
            5000,
          );
          const pointer = page.scratch.docsWalkPointer;
          if (pointer) {
            // The step ends on the citation in the draft.
            const at = editor.getValue().indexOf(`[@${citekey}]`);
            const from = editor.cm.coordsAtPos(at);
            const to = editor.cm.coordsAtPos(at + `[@${citekey}]`.length);
            if (from && to)
              await pointer.look({
                left: from.left,
                right: to.right,
                top: Math.min(from.top, to.top),
                bottom: Math.max(from.bottom, to.bottom),
              });
          }
          return editor
            .getValue()
            .split("\n")
            .find((l) => l.startsWith(sentence.trim()));
        },
        { draftPath: DRAFT, citekey: PAPER.citekey, sentence: SENTENCE },
        STEP,
      ),
    );
    expect(inserted?.trimEnd()).toBe(`${SENTENCE}[@${PAPER.citekey}]`);
    await walk.capture("step-3");
    await walk.compose("step-3");
  });

  it("step 4: before the bracket, type , p. 2 and move the cursor away; (Sandve et al. 2013, 2)", async () => {
    const shown = await walk.record("step-4", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath, citekey, sentence }) => {
          const pointer = page.scratch.docsWalkPointer;
          const draft = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draftPath,
            ) as DraftLeaf;
          const editor = draft.view.editor;
          // The reader puts the cursor before the closing bracket and types the page.
          const at =
            editor.getValue().indexOf(`[@${citekey}]`) + `[@${citekey}`.length;
          const cm = editor.cm;
          const box = cm.coordsAtPos(at);
          if (pointer && box) {
            await pointer.pointAt(box.left, (box.top + box.bottom) / 2);
            await pointer.park(box.left + 40, box.bottom + 40);
          }
          editor.setCursor(editor.offsetToPos(at));
          const put = (ch: string) =>
            cm.dispatch(cm.state.replaceSelection(ch), {
              userEvent: "input.type",
            });
          if (pointer) await pointer.keys(", p. 2", put);
          else
            for (const ch of ", p. 2") {
              put(ch);
              await new Promise((r) => setTimeout(r, 40));
            }
          // Then moves the cursor away, to the top of the draft.
          const top = cm.coordsAtPos(0);
          if (pointer && top) {
            await pointer.pointAt(top.left + 4, (top.top + top.bottom) / 2);
          }
          editor.setCursor({ line: 0, ch: 0 });
          await draft.view.save();
          const cites = await page.until(
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
          const cite = [
            ...draft.view.contentEl.querySelectorAll<HTMLElement>(
              ".zt-citation",
            ),
          ].find((e) => e.textContent.includes("Sandve"))!;
          cite.scrollIntoView({
            block: "center",
            behavior: pointer ? "smooth" : "instant",
          });
          if (pointer) {
            await new Promise((r) => setTimeout(r, 700));
            // The step ends on the formatted citation.
            await pointer.look(cite);
          }
          return { line, cites };
        },
        { draftPath: DRAFT, citekey: PAPER.citekey, sentence: SENTENCE },
        STEP,
      ),
    );
    expect(shown.line?.trimEnd()).toBe(`${SENTENCE}[@${PAPER.citekey}, p. 2]`);
    expect(shown.cites).toContain("(Sandve et al. 2013, 2)");
    await walk.capture("step-4");
    await walk.compose("step-4");
  });

  it("step 5: point at the citation; the paper's full reference", async () => {
    const popover = await walk.record("step-5", () =>
      obRun(
        walk.vaultId,
        async ({ app, page }, { draftPath }) => {
          const pointer = page.scratch.docsWalkPointer;
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
          cite.scrollIntoView({ block: "center" });
          const b = cite.getClientRects()[0]!;
          // The pointer comes to rest at the citation's lower right corner,
          // off its words.
          const end = [...cite.getClientRects()].at(-1)!;
          await pointer?.park(end.right - 3, end.bottom - 3);
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
          // The step ends on the citation and its reference.
          await pointer?.look([cite, pop.hoverEl]);
          await new Promise((r) => setTimeout(r, 800));
          return pop.hoverEl.innerText;
        },
        { draftPath: DRAFT },
        STEP,
      ),
    );
    console.log("[walk] reference", JSON.stringify(popover));
    expect(flat(popover)).toContain(PAPER.title);
    expect(flat(popover)).toContain("Sandve, Geir Kjetil");
    expect(flat(popover)).toContain("PLOS Computational Biology");
    await walk.capture("step-5");
    await walk.compose("step-5");
  });

  it("step 6: open the PDF beside the draft and drag a highlight's page label, such as p. 2, into the draft; a quote block with the passage, its citation and page, and your comment", async () => {
    const text = await walk.record("step-6", () =>
      obRun(
        walk.vaultId,
        async (
          { app, page },
          { draftPath, paperKey, attachmentKey, passage, before, comment },
        ) => {
          const pointer = page.scratch.docsWalkPointer;
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
          const open = await page.until(
            "Open PDF",
            () =>
              el.querySelector<HTMLElement>(
                '[data-library-card] [data-library-card-action="pdf"]',
              ),
            10000,
          );
          await pointer?.point(open);
          page.press(open, "Open PDF");
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
              side?.querySelector<HTMLElement>(
                `${card} a.zt-annot-page-chip[draggable="true"]`,
              ),
            15000,
          );
          const label = chip.innerText.trim();
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
          // The reader drags the page label across to the draft.
          await pointer?.drag(chip, {
            x: rect.left + 1,
            y: (rect.top + rect.bottom) / 2,
          });
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
          if (pointer) {
            // The pointer steps left of the drop, off the quote, and the step
            // ends on the quote block.
            await pointer.park(rect.left - 35, (rect.top + rect.bottom) / 2);
            if (box) await pointer.look(box);
          }
          return { label, doc: editor.getValue(), rendered: !!box };
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
      ),
    );
    const quote = text.doc
      .split("\n")
      .filter((l) => l.startsWith(">"))
      .join("\n");
    console.log("[walk] quote", JSON.stringify({ label: text.label, quote }));
    expect(text.label).toContain("2");
    expect(quote).toContain(PAPER.quote);
    expect(quote).toContain(`[@${PAPER.citekey}, {p. 2}]`);
    expect(quote).toContain(PAPER.comment);
    expect(text.rendered).toBe(true);
    expect(text.doc.indexOf(PAPER.passage)).toBeLessThan(
      text.doc.indexOf(BEFORE),
    );
    await walk.capture("step-6");
    await walk.compose("step-6");
  });
});
