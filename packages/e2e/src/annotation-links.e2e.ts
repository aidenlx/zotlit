import { DatabaseSync } from "node:sqlite";
import type { WorkspaceLeaf, FileSystemAdapter } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";
// Annotation links in a note: a Durable Annotation Link clicked in any
// Obsidian surface lands on its Annotation in Obsidian's reader, or reaches
// Zotero when this computer cannot open the PDF; a hovered one shows the
// Annotation it names. The Annotation Suggester writes the same link from a
// search at the cursor.

import type { AnnotationView } from "@/views/annot-view/view";

import {
  annotationAttachment,
  annotationItem,
  annotationKeys,
  annotationSuggesterEnabled,
  attachmentAnnotations,
  e2eFixture,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";
import type {
  LinkGesture,
  LinkRecorder,
  LinkSettings,
} from "./page-links-types.ts";
import type { LinkMarkdownView } from "./page-links-types.ts";
import type { PagePdfView } from "./page-notes-types.ts";

const PDF_PATH = annotationAttachment.path!;
const NOTE = "Annotation links.md";

/** The Fixture's image Annotation on page two of the Rougier PDF. */
const SECOND_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "FDRFQ7C2",
)!;
/** Two Annotations on page one, so each surface lands on a Mark of its own. */
const FIRST_PAGE = attachmentAnnotations.find(({ key }) => key === "PUPR5FG5")!;
const ALSO_FIRST_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "Q8ZR4TDH",
)!;
/** The Fixture's note Annotation, which carries a comment and no text. */
const COMMENTED = attachmentAnnotations.find(({ key }) => key === "HRK7BG32")!;
/** The Fixture's ink Annotation. */
const INK = attachmentAnnotations.find(({ key }) => key === "TYY6Z6ZF")!;
/** An underline whose text a case rewrites with rich text. */
const RICH = attachmentAnnotations.find(({ key }) => key === "K3JRFLFQ")!;
/** A PDF the Fixture's Zotero holds a row for, and never a file. */
const MISSING_PDF = ATTACHMENTS.find(({ key }) => key === "MISSNG22")!;

/**
 * A second Attachment of the Rougier PDF's own file, which the Fixture does
 * not hold: the case that needs it adds it, with one Annotation of its own.
 */
const SHARED = { attachmentKey: "RGRSHRD2", annotationKey: "SHRDANN2" };

/** Stands in a note for the Rougier PDF's own `file://` URL on this computer. */
const FILE_URL = "%FILE_URL%";

/** The link Zotero writes into a child note for one Annotation. */
function durableLink(
  annotationKey: string,
  pageLabel: string,
  { attachmentKey = annotationAttachment.key }: { attachmentKey?: string } = {},
): string {
  return `zotero://open/library/items/${attachmentKey}?annotation=${annotationKey}&page=${pageLabel}`;
}

const LINK_TEXT = "the quoted passage";

/**
 * The citation the default annotation template writes after a quote of the
 * Rougier Item: its citation key, with the Annotation's page as a braced Pandoc locator.
 */
function citationOf(annotation: { pageLabel: string }): string {
  return `[@${annotationItem.citationKey}, {p. ${annotation.pageLabel}}]`;
}

/** A note quoting one passage, ending on an empty line that holds no link. */
function noteWith(url: string, properties = ""): string {
  return `${properties}# Draft\n\nAs Rougier argues, [${LINK_TEXT}](${url}).\n`;
}

/** What the Rougier PDF shows: its page, and the Marks it selects. */
interface ReaderState {
  page: number | null;
  selected: string[];
}

/** What one scenario left behind, read before its own cleanup ran. */
interface Outcome {
  /** Whether the Rougier PDF's view draws any Annotation Mark. */
  drawn: boolean;
  /** The Rougier PDF's view, or `null` when no tab shows it. */
  reader: ReaderState | null;
  /** Every `zotero:` URL the system handler was asked to open. */
  passed: { url: string; target: string | null }[];
  /** The text of every notice on screen. */
  notices: string[];
  /**
   * The Attachment the Rougier PDF's reader held each time the follow
   * recorded a read of the paper, in order; only for a scenario that asks.
   */
  reads?: (string | null)[];
}

/**
 * A one-line annotation template: the quote, its citation, and the durable
 * link, the shape a researcher writes to quote inside a sentence.
 */
const INLINE_ANNOTATION =
  "{{ zt.text }} {{ zt.citation }} [Zotero]({{ zt.backlink }})";

/** What {@link INLINE_ANNOTATION} renders for `annotation`. */
function inlineOf(annotation: {
  key: string;
  text?: string | null;
  pageLabel: string;
}): string {
  return `${annotation.text} ${citationOf(annotation)} [Zotero](${durableLink(annotation.key, annotation.pageLabel)})`;
}

/**
 * Where an insert lands and what follows it: the draft's last line reads
 * `line` with the cursor at `ch`; `inline` renders through
 * {@link INLINE_ANNOTATION}; `typeOn` is typed once the insert lands.
 */
interface InsertAt {
  line?: string;
  ch?: number;
  inline?: boolean;
  typeOn?: string;
}

/**
 * Inserts the Annotation `annotationKey` of the Rougier Item into an empty
 * draft the way a reader does: its card's "More options" menu in the
 * Annotation View, then "Insert into note". Answers the draft's text once the
 * insertion lands, from a vault already restored.
 */
async function insertFromCard(
  annotationKey: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<string> {
  const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`;
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        useInline,
        inlineTemplate,
        inlineSuffix,
        notePath,
        draftContent,
        itemKey,
        cursorCh,
        cardSelector,
        annotationKey,
        typeAfter,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      let text;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        if (useInline) {
          await links.inlineProfile(cleanup, {
            template: inlineTemplate,
            suffix: inlineSuffix,
          });
        }
        const { leaf, view } = await links.draft(cleanup, {
          notePath: notePath,
          content: draftContent,
        });
        const sidebar = app.workspace.getRightLeaf(false)!;
        cleanup.adopt(sidebar, (leaf) => leaf.detach());
        await sidebar.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "pinned", pinnedItemKey: itemKey },
        });
        await app.workspace.revealLeaf(sidebar);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const editor = view.editor;
        editor.setCursor({ line: editor.lastLine(), ch: cursorCh });
        const more = await until(
          () =>
            (
              sidebar.view as AnnotationView
            ).contentEl.querySelector<HTMLElement>(cardSelector),
          () => "The Annotation card did not render",
        );
        more.click();
        const item = await until(
          () =>
            [
              ...activeDocument.querySelectorAll<HTMLElement>(".menu-item"),
            ].find((el) => el.textContent.trim() === "Insert into note"),
          () => 'The card menu offers no "Insert into note"',
        );
        await page.menuReady();
        item.click();
        await until(
          () => editor.getValue().includes(annotationKey),
          () => `Nothing was inserted: ${JSON.stringify(editor.getValue())}`,
        );
        const typedAfter = typeAfter;
        if (typedAfter !== null)
          editor.cm.dispatch(editor.cm.state.replaceSelection(typedAfter), {
            userEvent: "input.type",
          });
        text = editor.getValue();
      }
      return text;
    },
    {
      useInline: inline,
      inlineTemplate: INLINE_ANNOTATION,
      inlineSuffix: `\n${INLINE_ANNOTATION}\n`,
      notePath: NOTE,
      draftContent: `# Draft\n\n${line}`,
      itemKey: annotationItem.key,
      cursorCh: ch,
      cardSelector: `${card} [aria-label="More options"]`,
      annotationKey: annotationKey,
      typeAfter: typeOn ?? null,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

/** What typing a search into a draft left: its text, and which suggesters opened. */
interface SearchOutcome {
  text: string;
  /** The rows the Annotation Suggester showed for the query, by their text. */
  rows: string[];
  /** The superscript the chosen row drew from the quote's rich text, if any. */
  sup: string | null;
  /** Whether the Citation Suggester opened on the typed text. */
  citationOpen: boolean;
  /** The Use the insert recorded for the Rougier Item, or null for none. */
  use: string | null;
}

/**
 * Types `typed` at the end of an empty draft as one input, waits for the
 * Annotation Suggester to answer that query, and chooses the row whose text
 * holds `choose`. Answers the draft's text once the insert lands, from a
 * vault already restored.
 */
async function searchAndInsert(
  typed: string,
  choose: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<SearchOutcome> {
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        useInline,
        inlineTemplate,
        inlineSuffix,
        notePath,
        draftContent,
        itemKey,
        cursorCh,
        typedText,
        queryText,
        querySource,
        chosenText,
        typeAfter,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      const suggesters = app.workspace.editorSuggest.suggests;
      const annotations = suggesters.find(
        (s) => s.constructor.name === "AnnotationEditorSuggest",
      );
      const citations = suggesters.find(
        (s) => s.constructor.name === "CitationEditorSuggest",
      );
      if (!annotations)
        throw new Error("No Annotation Suggester is registered");
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        if (useInline) {
          await links.inlineProfile(cleanup, {
            template: inlineTemplate,
            suffix: inlineSuffix,
          });
        }
        const { leaf, view } = await links.draft(cleanup, {
          notePath: notePath,
          content: draftContent,
        });
        cleanup.defer(() => annotations.close());
        const ledger = () =>
          zotlit.services.bridge.runSync(
            zotlit.services.useLedger.get(itemKey),
          );
        const before = ledger()?.instant.epochMilliseconds ?? null;
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const editor = view.editor;
        editor.setCursor({ line: editor.lastLine(), ch: cursorCh });
        editor.focus();
        editor.cm.dispatch(editor.cm.state.replaceSelection(typedText), {
          userEvent: "input.type",
        });
        const query = queryText.slice(querySource.indexOf("[>") + 2);
        const rows = () => [
          ...annotations.suggestEl.querySelectorAll(".suggestion-item"),
        ];
        const row = await until(
          () =>
            annotations.isOpen &&
            annotations.context?.query === query &&
            rows().find(
              (el) =>
                !el.closest("[aria-busy]") &&
                el.textContent.includes(chosenText),
            ),
          () =>
            `The Annotation Suggester showed no row for ${JSON.stringify(query)}: ${JSON.stringify(rows().map((el) => el.textContent))}`,
        );
        const shown = rows().map((el) => el.textContent);
        const sup = row.querySelector("sup")?.textContent ?? null;
        const citationOpen = !!citations?.isOpen;
        row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await until(
          () => {
            const value = editor.getValue();
            return !value.includes("[>") && value.includes("zotero://");
          },
          () => `Nothing was inserted: ${JSON.stringify(editor.getValue())}`,
        );
        const typedAfter = typeAfter;
        if (typedAfter !== null)
          editor.cm.dispatch(editor.cm.state.replaceSelection(typedAfter), {
            userEvent: "input.type",
          });
        const text = editor.getValue();
        // The Use lands with the text, so a Use the insert made is newer than
        // the one held before the search.
        const after = ledger();
        const use =
          after && after.instant.epochMilliseconds !== before
            ? after.kind
            : null;
        outcome = { text, rows: shown, sup, citationOpen, use };
      }
      return outcome;
    },
    {
      useInline: inline,
      inlineTemplate: INLINE_ANNOTATION,
      inlineSuffix: `\n${INLINE_ANNOTATION}\n`,
      notePath: NOTE,
      draftContent: `# Draft\n\n${line}`,
      itemKey: annotationItem.key,
      cursorCh: ch,
      typedText: typed,
      queryText: typed,
      querySource: typed,
      chosenText: choose,
      typeAfter: typeOn ?? null,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

interface Scenario {
  /** The note's Markdown; {@link FILE_URL} becomes the PDF's own `file://` URL. */
  note: string;
  /** The link the gesture follows; {@link FILE_URL} is replaced as in `note`. */
  url: string;
  /**
   * Where the link is clicked, `external` for Obsidian's open-in-default-app
   * target, or `chip` for the page chip of the Annotation's card in the
   * Annotation View, which carries the link as its backlink.
   */
  gesture: LinkGesture | "external" | "chip";
  /** Turn `reader.open-file-links` off for this scenario. */
  captureOff?: boolean;
  /** The annotation link settings to change for this scenario. */
  linkSettings?: LinkSettings;
  /** The reader state that ends the wait early, when a landing is expected. */
  lands?: ReaderState;
  /** The Attachment the reader must name for a landing; the Rougier PDF's own by default. */
  bound?: string;
  /** Report the reads the follow recorded, as {@link Outcome.reads}. */
  reads?: boolean;
}

/**
 * One scenario in one evaluation: write the note, show it, follow its link,
 * wait for the reader to land or the link to pass, and read the outcome. Every
 * change is undone on the evaluation's own stack, registered before the step
 * that can fail, so the outcome comes back from a vault already restored. The
 * click lands on the rendered link's point.
 */
async function follow({
  note,
  url,
  gesture,
  captureOff = false,
  linkSettings = {},
  lands,
  bound = annotationAttachment.key,
  reads = false,
}: Scenario): Promise<Outcome> {
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        observedPdfPath,
        fileUrlPath,
        requestedUrl,
        urlPlaceholder,
        captureDisabled,
        changedSettings,
        requestedGesture,
        notePath,
        noteContent,
        notePlaceholder,
        readPdfPath,
        itemKey,
        linkText,
        expectedLanding,
        bindingPdfPath,
        bindingKey,
        bindingLabel,
        reportReads,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { deadline, within, until } = links;
      const s = zotlit.services;
      const observe = () => {
        const pdf = app.workspace
          .getLeavesOfType("pdf")
          .map(({ view }) => view as PagePdfView)
          .find((view) => view.file?.path === observedPdfPath);
        return {
          drawn: !!pdf?.containerEl.querySelector(".zt-pdf-annotation-mark"),
          reader: pdf
            ? {
                page:
                  pdf.viewer.child?.pdfViewer?.pdfViewer?.currentPageNumber ??
                  null,
                selected: [
                  ...new Set(
                    [
                      ...pdf.containerEl.querySelectorAll<HTMLElement>(
                        ".zt-pdf-annotation-mark.is-selected",
                      ),
                    ].map((mark) => mark.dataset.zoteroAnnotationKey!),
                  ),
                ],
              }
            : null,
          passed: page.scratch.links!.passed.slice(),
          notices: page
            .windowDocuments()
            .flatMap((doc) =>
              [...doc.querySelectorAll(".notice")].map(
                (notice) => notice.textContent,
              ),
            ),
        };
      };
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          for (const leaf of app.workspace.getLeavesOfType("pdf"))
            leaf.detach();
          await app.workspace.changeLayout(layout);
        });
        const captureSetting = s.bridge.runSync(s.settings.current)[
          "reader.open-file-links"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "reader.open-file-links": captureSetting }),
          );
        });
        page.scratch.links!.passed = [];
        for (const doc of page.windowDocuments())
          for (const notice of doc.querySelectorAll(".notice")) notice.remove();
        const fileUrl = require("url").pathToFileURL(
          (app.vault.adapter as FileSystemAdapter).getFullPath(fileUrlPath),
        ).href;
        const url = requestedUrl.replaceAll(urlPlaceholder, fileUrl);
        if (captureDisabled)
          s.bridge.runSync(
            s.settings.update({ "reader.open-file-links": false }),
          );
        links.applySettings(cleanup, changedSettings);
        const gesture = requestedGesture;
        const shown =
          gesture === "chip"
            ? null
            : await links.showNote(cleanup, {
                notePath: notePath,
                content: noteContent.replaceAll(notePlaceholder, fileUrl),
                gesture: gesture === "external" ? "live-preview" : gesture,
              });
        const view = shown?.view;
        // The ledger records a read as the reader names its Attachment, so
        // the reader is asked which one it holds as each read lands.
        const reads: (string | null)[] = [];
        let replayed = false;
        cleanup.defer(
          s.bridge.subscribe(s.useLedger.changes, () => {
            if (!replayed) {
              replayed = true;
              return;
            }
            const [newest] =
              Object.entries(s.bridge.runSync(s.useLedger.uses)).sort(
                ([, a], [, b]) => b - a,
              )[0] ?? [];
            if (
              newest !== undefined &&
              s.bridge.runSync(s.useLedger.get(newest))?.kind === "read"
            ) {
              const attachment = s.bridge
                .runSync(s.pdfAnnotationEditor.bindings)
                .find((b) => b.filePath === readPdfPath)?.attachment;
              reads.push(
                attachment?.kind === "resolved"
                  ? attachment.attachmentKey
                  : null,
              );
            }
          }),
        );
        if (gesture === "external") {
          window.open(url, "_external");
        } else if (gesture === "chip") {
          const sidebar = cleanup.adopt(
            app.workspace.getRightLeaf(false)!,
            (leaf) => leaf.detach(),
          );
          await sidebar.setViewState({
            type: "zotero-annotation-view",
            state: { followMode: "pinned", pinnedItemKey: itemKey },
          });
          await app.workspace.revealLeaf(sidebar);
          const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(new URL(url).searchParams.get("annotation"))}]`;
          const link = await until(
            () =>
              (
                sidebar.view as AnnotationView
              ).contentEl.querySelector<HTMLElement>(
                `${card} a.zt-annot-page-chip`,
              ),
            () => "The card drew no page chip",
          );
          link.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
          const box = link.getBoundingClientRect();
          link.dispatchEvent(
            new MouseEvent("click", {
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
              bubbles: true,
              cancelable: true,
              button: 0,
              view: link.ownerDocument.defaultView,
            }),
          );
        } else {
          const { link, x, y } = await links.linkTarget(view!, {
            url,
            gesture,
            linkText: linkText,
          });
          const init = {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            button: 0,
            view: link.ownerDocument.defaultView,
          };
          link.dispatchEvent(
            new MouseEvent("mousedown", { ...init, buttons: 1 }),
          );
          link.dispatchEvent(new MouseEvent("mouseup", init));
          link.dispatchEvent(new MouseEvent("click", init));
        }
        const lands = expectedLanding;
        if (lands === null) {
          // A passed link is recorded as the open hands it on, which is the
          // whole of the gesture's work.
          await until(
            () => page.scratch.links!.passed.length > 0,
            () => "No link reached the system handler",
          );
        } else {
          // The reader's binding decides the Landing as it draws the read it
          // starts once it names the Attachment; a later read replaces the
          // promise, so the wait runs until the one awaited is the last.
          const binding = await until(
            () =>
              s.bridge
                .runSync(s.pdfAnnotationEditor.bindings)
                .find(
                  (b) =>
                    b.filePath === bindingPdfPath &&
                    b.attachment.kind === "resolved" &&
                    b.attachment.attachmentKey === bindingKey,
                ),
            () =>
              `No reader named the Attachment ${bindingLabel}: ${JSON.stringify(s.bridge.runSync(s.pdfAnnotationEditor.bindings).map((b) => b.attachment))}`,
          );
          for (
            let read = binding.refreshed, end = deadline();
            ;
            read = binding.refreshed
          ) {
            await within(read, end, "The reader never drew its last read");
            if (read === binding.refreshed) break;
          }
          // Obsidian's own page jump and the Landing's scroll frame follow,
          // and so do the Marks: the read settles on data, but PDF.js clears a
          // page as it renders and the binding paints it again on the page's
          // render event. A Landing on the page alone selects nothing, so the
          // wait asks for the Marks as well as the page.
          await until(
            () => {
              const now = observe();
              return now.drawn && JSON.stringify(now.reader) === lands;
            },
            () => `The reader did not land: ${JSON.stringify(observe())}`,
          );
        }
        outcome = { ...observe(), ...(reportReads ? { reads } : {}) };
      }
      return outcome;
    },
    {
      observedPdfPath: PDF_PATH,
      fileUrlPath: PDF_PATH,
      requestedUrl: url,
      urlPlaceholder: FILE_URL,
      captureDisabled: captureOff,
      changedSettings: linkSettings,
      requestedGesture: gesture,
      notePath: NOTE,
      noteContent: note,
      notePlaceholder: FILE_URL,
      readPdfPath: PDF_PATH,
      itemKey: annotationItem.key,
      linkText: LINK_TEXT,
      expectedLanding: lands === undefined ? null : JSON.stringify(lands),
      bindingPdfPath: PDF_PATH,
      bindingKey: bound,
      bindingLabel: bound,
      reportReads: reads,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

/**
 * Adds {@link SHARED} to the Fixture's Zotero database the way Zotero keeps a
 * second Attachment of one linked file: a copy of the Rougier PDF's
 * Attachment row under its own key, and a copy of `annotationKey` as its
 * one Annotation. Each row copies every column of its model but the id, the
 * key and the parent. Disposing deletes the rows it wrote.
 */
function addSharedFileAttachment(
  databasePath: string,
  annotationKey: string,
): Disposable {
  using database = new DatabaseSync(databasePath);
  const itemIDOf = (key: string) =>
    (
      database.prepare("select itemID from items where key = ?").get(key) as {
        itemID: number;
      }
    ).itemID;
  /** Inserts a copy of `table`'s row for `itemID`, with `set` in place. */
  const copy = (
    table: string,
    itemID: number,
    set: Record<string, string | number>,
  ) => {
    const columns = (
      database.prepare(`pragma table_info(${table})`).all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
    database
      .prepare(
        `insert into ${table} (${columns.join(", ")}) select ${columns.map((name) => (name in set ? "?" : name)).join(", ")} from ${table} where itemID = ?`,
      )
      .run(
        ...columns.filter((name) => name in set).map((name) => set[name]!),
        itemID,
      );
  };
  const attachmentID = Number(
    Object.values(
      database.prepare("select max(itemID) + 1 from items").get()!,
    )[0],
  );
  const annotationID = attachmentID + 1;

  // One transaction: a failed write leaves no row behind.
  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  const source = itemIDOf(annotationAttachment.key);
  copy("items", source, { itemID: attachmentID, key: SHARED.attachmentKey });
  copy("itemAttachments", source, { itemID: attachmentID });
  const annotation = itemIDOf(annotationKey);
  copy("items", annotation, {
    itemID: annotationID,
    key: SHARED.annotationKey,
  });
  copy("itemAnnotations", annotation, {
    itemID: annotationID,
    parentItemID: attachmentID,
  });
  database.exec("commit");
  rollback.move();

  return {
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemAnnotations", "itemAttachments", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(attachmentID, annotationID);
      database.exec("commit");
    },
  };
}

/**
 * Has ZotLit read the database again and waits, bounded, until its Attachment
 * index answers `kind` for {@link SHARED}'s Attachment. Answers which
 * Attachment the Rougier PDF's path names then.
 */
async function reindexed(
  kind: "resolved" | "unresolved",
): Promise<string | null> {
  return obRun(
    run.vaultId,
    async ({ app, zotlit, page }, { kind, attachmentKey, pdfPath }) => {
      const { until } = page.annotationLinkTools(() => zotlit.services);
      const s = zotlit.services;
      await s.bridge.runPromise(s.zoteroReads.refresh);
      await until(
        () =>
          s.bridge.runSync(s.attachmentResolver.lookup(attachmentKey)).kind ===
          kind,
        () =>
          `The Attachment index never answered ${kind} for ${attachmentKey}`,
      );
      const adapter = app.vault.adapter as import("obsidian").FileSystemAdapter;
      const resolution = s.bridge.runSync(
        s.attachmentResolver.resolve(adapter.getFullPath(pdfPath)),
      );
      return resolution.kind === "resolved" ? resolution.attachmentKey : null;
    },
    { kind, attachmentKey: SHARED.attachmentKey, pdfPath: PDF_PATH },
    { timeoutMs: 60000 },
  );
}

/** What two tabs on the Rougier PDF's one file showed, as {@link sharedTabs} read it. */
interface SharedTabsOutcome {
  /**
   * The Attachment the tab ZotLit found open held each time an open recorded
   * a read of the paper, from the open that named {@link SHARED}'s Attachment.
   */
  reads: (string | null)[];
  /** The Attachment that tab is bound to once that open lands. */
  restored: string | null;
  /** The Annotation View's cards beside that tab, by key. */
  besideRestored: string[];
  /** The Annotation View's cards beside a second tab on the file, by key. */
  besideSecond: string[];
  /** Every `zotero:` URL the system handler was asked to open. */
  passed: string[];
}

/**
 * With {@link SHARED} in the Fixture: a tab on the Rougier PDF that ZotLit
 * found open as it loaded, the way it finds a tab Obsidian restored at
 * startup, takes an open of {@link SHARED}'s Annotation through the opener
 * every ZotLit gesture shares. A second tab then opens the same file plainly,
 * and the sidebar Annotation View, following the active tab, is read beside
 * each tab. Every change is undone on the evaluation's own stack, the Use
 * Ledger included.
 */
async function sharedTabs(): Promise<SharedTabsOutcome> {
  const cardsOf = (keys: readonly string[]) => JSON.stringify([...keys].sort());
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        pdfPath,
        initialKey,
        reloadedKey,
        targetAttachment,
        targetAnnotation,
        targetPage,
        followedKey,
        secondKey,
        restoredCards,
        secondCards,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { deadline, within, until } = links;
      const services = () => zotlit.services;
      const file = app.vault.getFileByPath(pdfPath)!;
      const attachmentOf = (leaf: WorkspaceLeaf) =>
        services().bridge.runSync(
          services().pdfAnnotationEditor.sessionFor(leaf.view),
        )?.target?.attachmentKey ?? null;
      const boundTo = (leaf: WorkspaceLeaf, key: string, what: string) =>
        until(
          () => attachmentOf(leaf) === key,
          () => `${what} never named ${key}: ${attachmentOf(leaf)}`,
        );
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          for (const leaf of app.workspace.getLeavesOfType("pdf"))
            leaf.detach();
          await app.workspace.changeLayout(layout);
        });
        page.scratch.links!.passed = [];
        const restored = app.workspace.getLeaf("tab");
        cleanup.adopt(restored, (leaf) => leaf.detach());
        await restored.openFile(file);
        await boundTo(restored, initialKey, "The first tab");
        // ZotLit loads with the tab already open, as at startup.
        await app.plugins.disablePlugin("zotlit");
        await app.plugins.enablePlugin("zotlit");
        await within(
          services().bridge.runPromise(services().attachmentResolver.indexed),
          deadline(),
          "The Attachment index was not built again",
        );
        await boundTo(restored, reloadedKey, "The tab ZotLit found open");
        // A read is recorded once its binding names the Attachment, before
        // the tab's session does, so each is credited to the binding's.
        const reads: (string | null)[] = [];
        const ledger = services().useLedger;
        let replayed = false;
        cleanup.defer(
          services().bridge.subscribe(ledger.changes, () => {
            if (!replayed) {
              replayed = true;
              return;
            }
            const [newest] =
              Object.entries(services().bridge.runSync(ledger.uses)).sort(
                ([, a], [, b]) => b - a,
              )[0] ?? [];
            if (
              newest !== undefined &&
              services().bridge.runSync(ledger.get(newest))?.kind === "read"
            ) {
              const attachment = services().bridge.runSync(
                services().pdfAnnotationEditor.bindingFor(restored.view),
              )?.attachment;
              reads.push(
                attachment?.kind === "resolved"
                  ? attachment.attachmentKey
                  : null,
              );
            }
          }),
        );
        app.workspace.setActiveLeaf(restored, { focus: true });
        const opened = await services().bridge.runPromise(
          services().targetOpener.open(
            {
              kind: "annotation",
              attachmentKey: targetAttachment,
              annotationKey: targetAnnotation,
              pageIndex: 0,
              pageLabel: targetPage,
            },
            false,
          ),
        );
        if (opened.kind !== "reader")
          throw new Error(`The open went elsewhere: ${JSON.stringify(opened)}`);
        await boundTo(restored, followedKey, "The tab ZotLit found open");
        const second = app.workspace.getLeaf("tab");
        cleanup.adopt(second, (leaf) => leaf.detach());
        await second.openFile(file);
        await boundTo(second, secondKey, "The second tab");
        const sidebar = app.workspace.getRightLeaf(false)!;
        cleanup.adopt(sidebar, (leaf) => leaf.detach());
        await sidebar.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "active-tab" },
        });
        await app.workspace.revealLeaf(sidebar);
        const cards = () =>
          [
            ...new Set(
              [
                ...(
                  sidebar.view as AnnotationView
                ).contentEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ),
              ].map((el) => el.dataset.zoteroAnnotationKey!),
            ),
          ].sort();
        // Each wait ends on the cards of the Attachment its tab holds; a
        // sidebar stuck on other cards fails with the cards it last showed.
        const beside = (leaf: WorkspaceLeaf, expected: string) => {
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return until(
            () => JSON.stringify(cards()) === expected && cards(),
            () =>
              `The Annotation View beside the tab showed ${JSON.stringify(cards())}, not ${expected}`,
          );
        };
        const besideRestored = await beside(restored, restoredCards);
        const besideSecond = await beside(second, secondCards);
        outcome = {
          reads,
          restored: attachmentOf(restored),
          besideRestored,
          besideSecond,
          passed: page.scratch.links!.passed.map(({ url }) => url),
        };
      }
      return outcome;
    },
    {
      pdfPath: PDF_PATH,
      initialKey: annotationAttachment.key,
      reloadedKey: annotationAttachment.key,
      targetAttachment: SHARED.attachmentKey,
      targetAnnotation: SHARED.annotationKey,
      targetPage: FIRST_PAGE.pageLabel,
      followedKey: SHARED.attachmentKey,
      secondKey: annotationAttachment.key,
      restoredCards: cardsOf([SHARED.annotationKey]),
      secondCards: cardsOf(annotationKeys),
    },
    { timeoutMs: 120000 },
  );
  return reply;
}

/**
 * Sets the stored text of the Fixture's Annotation `annotationKey` to `text`
 * in its Zotero database, as Zotero stores rich text: its own HTML subset.
 * Disposing writes the Fixture's text back.
 */
function rewriteAnnotationText(
  databasePath: string,
  annotationKey: string,
  text: string,
): Disposable {
  const write = (value: string | null) => {
    using database = new DatabaseSync(databasePath);
    database
      .prepare(
        "update itemAnnotations set text = ? where itemID = (select itemID from items where key = ?)",
      )
      .run(value, annotationKey);
  };
  const original = attachmentAnnotations.find(
    ({ key }) => key === annotationKey,
  )!.text;
  write(text);
  return { [Symbol.dispose]: () => write(original ?? null) };
}

/**
 * Has ZotLit read the database again and waits, bounded, until its Annotation
 * repository holds `text` for the Rougier PDF's Annotation `annotationKey`.
 */
async function reread(annotationKey: string, text: string): Promise<void> {
  await obRun(
    run.vaultId,
    async (
      { zotlit, page },
      { attachmentKey, annotationKey, expectedText, annotationLabel },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { sleep, deadline, past } = links;
      const s = zotlit.services;
      await s.bridge.runPromise(s.zoteroReads.refresh);
      const holds = async () =>
        (
          await s.bridge.runPromise(s.annotationRepository.read(attachmentKey))
        )?.annotations.find(({ key }) => key === annotationKey)?.text ===
        expectedText;
      for (const end = deadline(); !(await holds()); await sleep(100))
        if (past(end))
          throw new Error(
            `The repository never read the new text of ${annotationLabel}`,
          );
      return true;
    },
    {
      attachmentKey: annotationAttachment.key,
      annotationKey: annotationKey,
      expectedText: text,
      annotationLabel: annotationKey,
    },
    { timeoutMs: 60000 },
  );
}

/** What a hover over one link left on screen, read before its cleanup ran. */
interface HoverOutcome {
  /** Whether the hover hung a popover off the note's view. */
  popover: boolean;
  /** The popover's text once filled, or null with no popover. */
  text: string | null;
  /** The Annotation colour the popover carries, or null with none. */
  color: string | null;
  /** Whether the popover painted a decoded Excerpt Image. */
  image: boolean;
  /** The superscript the popover drew from the quote's rich text, if any. */
  sup: string | null;
  /**
   * The open popover once the pointer crossed from the link's text onto its
   * URL; only for a scenario that asks.
   */
  crossed?: {
    /** Whether the view still shows the popover the text opened. */
    same: boolean;
    /** Whether the popover moved. */
    moved: boolean;
    /** The popover's text after the crossing. */
    text: string | null;
  };
}

/** The link a hover that shows nothing is read against: one that shows a popover. */
const CONTROL_URL = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

interface HoverScenario {
  /** The link the note quotes, and the pointer hovers. */
  url: string;
  gesture: "live-preview" | "reading" | "source";
  /** The Hover Action for this scenario; the vault's own when omitted. */
  hoverAction?: "off" | "popover" | "page-preview";
  /**
   * Whether ZotLit's row in Obsidian's Page preview settings asks for Mod;
   * the vault's own when omitted.
   */
  pagePreviewMod?: boolean;
  /** Turn `citation.pandoc-citations` off for this scenario. */
  pandocOff?: boolean;
  /** The annotation link settings to change for this scenario. */
  linkSettings?: LinkSettings;
  /** Wait for a decoded Excerpt Image as well as the text. */
  image?: boolean;
  /** Hold Ctrl or Command through the hover. */
  mod?: boolean;
  /** The hover is expected to show nothing; read against a control hover. */
  absent?: boolean;
  /**
   * Once the popover has filled, move the pointer from the link's text onto
   * its URL, which Source mode draws as a span of its own, as
   * {@link HoverOutcome.crossed}.
   */
  crossToUrl?: boolean;
}

/**
 * One hover in one evaluation: write the note, show it, move the pointer onto
 * its link, and read what the popover the hover hung off the view shows. As in
 * {@link follow}, every change is undone on the evaluation's own stack before
 * the outcome comes back.
 *
 * The hover is a synthetic `mouseover` at the rendered link's point. Obsidian
 * hangs a hover popover off the view once its opening delay has run, so a
 * hover that shows nothing is read against a later hover over
 * {@link CONTROL_URL} that does.
 */
async function hover({
  url,
  gesture,
  hoverAction,
  pagePreviewMod,
  pandocOff = false,
  linkSettings = {},
  image = false,
  mod = false,
  absent = false,
  crossToUrl = false,
}: HoverScenario): Promise<HoverOutcome> {
  // The control link has a line of its own; the cursor stays on the empty
  // last line, which holds no link.
  const note =
    absent && url !== CONTROL_URL
      ? `${noteWith(url)}\nSee also [the control](${CONTROL_URL}).\n`
      : noteWith(url);
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        requestedUrl,
        requestedHover,
        disablePandoc,
        changedSettings,
        previewModifier,
        notePath,
        noteContent,
        noteGesture,
        targetGesture,
        linkText,
        hoverMeta,
        hoverCtrl,
        expectAbsent,
        controlUrl,
        expectImage,
        crossUrl,
        crossMeta,
        crossCtrl,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { sleep, until } = links;
      const s = zotlit.services;
      let outcome: HoverOutcome;
      {
        await using cleanup = new AsyncDisposableStack();
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          await app.workspace.changeLayout(layout);
        });
        const hoverAction = s.bridge.runSync(s.settings.current)[
          "citation.hover-action"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": hoverAction }),
          );
        });
        const pandoc = s.bridge.runSync(s.settings.current)[
          "citation.pandoc-citations"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "citation.pandoc-citations": pandoc }),
          );
        });
        const url = requestedUrl;
        const changedHover = requestedHover;
        if (changedHover !== null)
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": changedHover }),
          );
        if (disablePandoc)
          s.bridge.runSync(
            s.settings.update({ "citation.pandoc-citations": false }),
          );
        links.applySettings(cleanup, changedSettings);
        const previewMod = previewModifier;
        if (previewMod !== null) {
          const pagePreview = (
            app.internalPlugins.getEnabledPluginById("page-preview") as {
              options?: {
                "zotlit-citekey"?: boolean;
              };
            } | null
          )?.options;
          if (!pagePreview)
            throw new Error("The Page preview core plugin is off");
          const rowSet = Object.hasOwn(pagePreview, "zotlit-citekey"),
            row = pagePreview["zotlit-citekey"];
          cleanup.defer(() => {
            if (rowSet) pagePreview["zotlit-citekey"] = row;
            else delete pagePreview["zotlit-citekey"];
          });
          pagePreview["zotlit-citekey"] = previewMod;
        }
        const { file, view } = await links.showNote(cleanup, {
          notePath: notePath,
          content: noteContent,
          gesture: noteGesture,
        });
        const { link, x, y } = await links.linkTarget(view, {
          url,
          gesture: targetGesture,
          linkText: linkText,
        });
        cleanup.defer(() => view.hoverPopover?.hide());
        link.dispatchEvent(
          new MouseEvent("mouseover", {
            clientX: x,
            clientY: y,
            bubbles: true,
            metaKey: hoverMeta,
            ctrlKey: hoverCtrl,
            view: link.ownerDocument.defaultView,
          }),
        );
        const opened = (view: LinkMarkdownView) =>
          view.hoverPopover?.hoverEl.isConnected ? view.hoverPopover : null;
        if (expectAbsent) {
          // Absence is read off a control: a link that shows a popover,
          // hovered later in a split under the Citation Popover. Every hover
          // popover waits the same opening delay, so once the control's has
          // opened, one the first hover had started would have opened too.
          // The Hover Action goes back on before that delay ends; the first
          // link's mouseover has already decided whether it opens a popover.
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": "popover" }),
          );
          const control = app.workspace.getLeaf("split", "vertical");
          cleanup.adopt(control, (leaf) => leaf.detach());
          await control.setViewState({
            type: "markdown",
            state: { file: file.path, mode: "preview" },
          });
          cleanup.defer(() =>
            (control.view as LinkMarkdownView).hoverPopover?.hide(),
          );
          const controlLink = await until(
            () =>
              [
                ...(
                  control.view as LinkMarkdownView
                ).previewMode.containerEl.querySelectorAll("a.external-link"),
              ].find((a) => a.getAttribute("href") === controlUrl),
            () => "The control link did not render",
          );
          controlLink.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              view: controlLink.ownerDocument.defaultView,
            }),
          );
          await until(
            () => opened(control.view as LinkMarkdownView),
            () => "The control hover opened no popover",
          );
          outcome = {
            popover:
              !!opened(view) ||
              link.ownerDocument.querySelectorAll(".hover-popover").length !==
                1,
            text: null,
            color: null,
            image: false,
            sup: null,
          };
        } else {
          const popover = await until(
            () => opened(view),
            () => "No popover opened over the link",
          );
          const content = () =>
            popover.hoverEl.isConnected
              ? popover.hoverEl.querySelector(".zt-citation-popover-content")
              : null;
          await until(
            () => content()?.textContent,
            () =>
              `The popover never filled: ${popover.hoverEl.outerHTML.slice(0, 300)}`,
          );
          const painted = () =>
            [...content()!.querySelectorAll("img")].find(
              (img) =>
                img.src.startsWith("blob:") &&
                img.complete &&
                img.naturalWidth > 0,
            );
          if (expectImage)
            await until(
              painted,
              () =>
                `The popover painted no Excerpt Image: ${content()!.outerHTML.slice(0, 300)}`,
            );
          const colored = content()!.querySelector<HTMLElement>(
            '[style*="--zt-annot-color"]',
          );
          outcome = {
            popover: true,
            text: content()!.textContent,
            color: colored
              ? colored.style.getPropertyValue("--zt-annot-color")
              : null,
            image: !!painted(),
            sup: content()!.querySelector("sup")?.textContent ?? null,
          };
          if (crossUrl) {
            // Past the opening delay, so a popover the crossing moved or
            // emptied has settled by the time it is read.
            const before = popover.hoverEl.getBoundingClientRect();
            const urlEl = [
              ...link.closest(".cm-line")!.querySelectorAll(".cm-url"),
            ].find((el) => !el.classList.contains("cm-formatting"));
            if (!urlEl) throw new Error("The link shows no URL");
            const urlBox = urlEl.getClientRects()[0]!;
            urlEl.dispatchEvent(
              new MouseEvent("mouseover", {
                clientX: urlBox.left + Math.min(urlBox.width / 2, 12),
                clientY: urlBox.top + urlBox.height / 2,
                bubbles: true,
                relatedTarget: link,
                metaKey: crossMeta,
                ctrlKey: crossCtrl,
                view: urlEl.ownerDocument.defaultView,
              }),
            );
            await sleep(500);
            const after = popover.hoverEl.getBoundingClientRect();
            outcome.crossed = {
              same: opened(view) === popover,
              moved: before.left !== after.left || before.top !== after.top,
              text: content()?.textContent ?? null,
            };
          }
        }
      }
      return outcome;
    },
    {
      requestedUrl: url,
      requestedHover: hoverAction ?? null,
      disablePandoc: pandocOff,
      changedSettings: linkSettings,
      previewModifier: pagePreviewMod ?? null,
      notePath: NOTE,
      noteContent: note,
      noteGesture: gesture,
      targetGesture: gesture,
      linkText: LINK_TEXT,
      hoverMeta: mod,
      hoverCtrl: mod,
      expectAbsent: absent,
      controlUrl: CONTROL_URL,
      expectImage: image,
      crossUrl: crossToUrl,
      crossMeta: mod,
      crossCtrl: mod,
    },
    { timeoutMs: 90000 },
  );
  return reply;
}

describe.skipIf(!reachable)("Annotation links", () => {
  registerEndToEndRunHooks();

  // The system handler would hand a passed link to the real Zotero on this
  // computer. ZotLit patches `window.open` once, as it loads, so it is
  // reloaded over a recorder that keeps every `zotero:` URL instead. A
  // `zotero:` anchor in the Annotation View would navigate on its own, past
  // `window.open`: a capture-phase listener stops that navigation and records
  // nothing, so a chip that skips `window.open` fails its case in silence.
  //
  // Capture warms the Attachment index as it installs, so it answers before
  // any PDF is open; a lookup that still answered `pending` would hand every
  // click to Zotero. `indexed` only waits — a lookup would start the build
  // itself and hide a missing warm-up.
  beforeAll(async () => {
    expect(
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }) => {
          await app.plugins.disablePlugin("zotlit");
          const s: LinkRecorder = (page.scratch.links = {
            native: window.open,
            passed: [],
            stopAnchor: (event) => {
              const anchor =
                event.target instanceof Element
                  ? event.target.closest('a[href^="zotero:"]')
                  : null;
              if (
                anchor?.closest(
                  '.workspace-leaf-content[data-type="zotero-annotation-view"]',
                )
              )
                event.preventDefault();
            },
          });
          window.addEventListener("click", s.stopAnchor, true);
          window.open = function (
            this: Window,
            ...args: Parameters<Window["open"]>
          ) {
            const [url, target] = args;
            if (String(url).startsWith("zotero:")) {
              s.passed.push({ url: String(url), target: target ?? null });
              return null;
            }
            return s.native.apply(this, args);
          };
          await app.plugins.enablePlugin("zotlit");
          const timeout = new Promise<string>((resolve) =>
            setTimeout(() => resolve("not indexed"), 20000),
          );
          return await Promise.race([
            zotlit.services.bridge
              .runPromise(zotlit.services.attachmentResolver.indexed)
              .then(() => "indexed"),
            timeout,
          ]);
        },
        undefined,
        { timeoutMs: 60000 },
      ),
      "the Attachment index is built with no lookup asking for it",
    ).toBe("indexed");
  }, 120000);

  afterAll(async () => {
    await obRun(run.vaultId, async ({ app, page }) => {
      const s = page.scratch.links;
      if (!s) return true;
      await app.plugins.disablePlugin("zotlit");
      window.removeEventListener("click", s.stopAnchor, true);
      window.open = s.native;
      delete page.scratch.links;
      await app.plugins.enablePlugin("zotlit");
      return true;
    });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Live Preview", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "live-preview",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Reading view", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in a Properties value", async () => {
    const url = durableLink(ALSO_FIRST_PAGE.key, ALSO_FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [ALSO_FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(
        durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        `---\nsource: "${url}"\n---\n`,
      ),
      url,
      gesture: "properties",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // An Annotation Zotero no longer has still names its Attachment and page,
  // so the click reaches the neighbourhood of the passage, in silence.
  it("lands on the page alone for an Annotation Zotero no longer has", async () => {
    const url = durableLink("ZZZZZZZ2", SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    // `drawn` says the read the Landing was decided against reached the page.
    expect(outcome).toEqual({
      drawn: true,
      reader: lands,
      passed: [],
      notices: [],
    });
  }, 120000);

  // What ZotLit writes is the durable link itself: the inserted passage
  // carries it, not this computer's file path, and following it lands.
  it("inserts an Annotation with its durable link, which lands when clicked", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const inserted = await insertFromCard(FIRST_PAGE.key);

    expect(inserted).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
    expect(inserted).toContain(`${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`);
    expect(inserted).not.toContain("file://");
    expect(inserted).not.toContain("zt-annotation=");

    const outcome = await follow({
      note: inserted,
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // The Annotation Suggester searches the Zotero database with Zotero closed:
  // the trigger, a word of the quote, and a narrowing token in the Library
  // View's grammar find the passage; choosing it writes the quote through
  // the annotation template, durable link and all, in place of the search.
  it.skipIf(!annotationSuggesterEnabled)(
    "searches annotations from the cursor and inserts the chosen one",
    async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await searchAndInsert(
        "[>MESSAGE tag:visualization color:blue",
        FIRST_PAGE.text!,
      );

      expect(outcome.citationOpen).toBe(false);
      // A row names the passage, its page as the Annotation View does, and
      // the paper.
      expect(outcome.rows).toEqual([
        expect.stringContaining(
          `${run.m.annot_view_page({ page: FIRST_PAGE.pageLabel })} · ${annotationItem.title}`,
        ),
      ]);
      expect(outcome.rows[0]).toContain(FIRST_PAGE.text!);
      expect(outcome.text).toContain(FIRST_PAGE.text!);
      expect(outcome.text).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
      expect(outcome.text).toContain(
        `${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`,
      );
      expect(outcome.text).not.toContain("[>");
      expect(outcome.use).toBe("cited");
    },
    120000,
  );

  // A note Annotation quotes nothing: its row shows its comment.
  it.skipIf(!annotationSuggesterEnabled)(
    "finds an Annotation by its comment, and its row shows the comment",
    async () => {
      const outcome = await searchAndInsert(
        "[>figures hard",
        COMMENTED.comment!,
      );

      expect(outcome.rows).toEqual([
        expect.stringContaining(COMMENTED.comment!),
      ]);
    },
    120000,
  );

  // Zotero stores an Annotation's text as its own HTML subset: both the
  // popover and the Annotation Suggester's row draw it, never show it.
  it("draws an Annotation's rich text in its popover", async () => {
    const text = `${RICH.text} E = mc<sup>2</sup>`;
    await using cleanup = new AsyncDisposableStack();
    // Disposed in reverse: the Fixture's text is written back, then read.
    cleanup.defer(() => reread(RICH.key, RICH.text!));
    cleanup.use(rewriteAnnotationText(e2eFixture.databasePath, RICH.key, text));
    await reread(RICH.key, text);

    const hovered = await hover({
      url: durableLink(RICH.key, RICH.pageLabel),
      gesture: "reading",
    });

    expect(hovered).toMatchObject({ popover: true, sup: "2" });
    expect(hovered.text).not.toContain("<sup>");
  }, 180000);

  it.skipIf(!annotationSuggesterEnabled)(
    "draws an Annotation's rich text in its suggestion row",
    async () => {
      const text = `${RICH.text} E = mc<sup>2</sup>`;
      await using cleanup = new AsyncDisposableStack();
      // Disposed in reverse: the Fixture's text is written back, then read.
      cleanup.defer(() => reread(RICH.key, RICH.text!));
      cleanup.use(
        rewriteAnnotationText(e2eFixture.databasePath, RICH.key, text),
      );
      await reread(RICH.key, text);

      // Chosen by the rewritten text as drawn, so a row from an index that
      // still holds the Fixture's text is never chosen.
      const searched = await searchAndInsert(
        "[>classically defined",
        "E = mc2",
      );

      expect(searched.sup).toBe("2");
      expect(searched.rows.join("")).not.toContain("<sup>");
    },
    180000,
  );

  // A one-line template quotes inside a sentence; where the insert lands
  // around the words beside it is the insertion's own rule, tested with it.
  // A trigger typed straight after a word is where the researcher wanted it,
  // so the Annotation Suggester adds no space before it.
  it("places a one-line Annotation from its card right after a word, typing on", async () => {
    const text = await insertFromCard(FIRST_PAGE.key, {
      line: "As argued",
      ch: 9,
      inline: true,
      typeOn: "next",
    });

    expect(text).toBe(`# Draft\n\nAs argued ${inlineOf(FIRST_PAGE)} next`);
  }, 120000);

  it.skipIf(!annotationSuggesterEnabled)(
    "places a one-line Annotation from the Annotation Suggester right after a word, typing on",
    async () => {
      const outcome = await searchAndInsert(
        "[>MESSAGE tag:visualization color:blue",
        FIRST_PAGE.text!,
        { line: "As argued", ch: 9, inline: true, typeOn: "next" },
      );

      expect(outcome.text).toBe(
        `# Draft\n\nAs argued${inlineOf(FIRST_PAGE)} next`,
      );
    },
    120000,
  );

  // The page chip of an Annotation View card opens the Annotation its
  // backlink names the way a followed link does, so it opens Obsidian's
  // reader where this computer holds the PDF.
  it("opens the reader on the Annotation from its card's page chip", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({ note: "", url, gesture: "chip", lands });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // The chip is ZotLit's own gesture, not a note's file link, so the setting
  // that keeps a note's links for the system handler leaves it alone.
  it("opens the reader from a card's page chip while the reader's open-file-links setting is off", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const outcome = await follow({
      note: "",
      url,
      gesture: "chip",
      captureOff: true,
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  // Two Attachments can keep one file, and its path names only one of them.
  // A link to the other one opens Obsidian's reader all the same, bound to
  // that Attachment and selecting its own Annotation, rather than going to
  // Zotero.
  it("opens the reader on the Annotation of the second Attachment of a shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    // The path still names the Fixture's own Attachment, so the link names
    // the one the path does not choose.
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);
    const url = durableLink(SHARED.annotationKey, FIRST_PAGE.pageLabel, {
      attachmentKey: SHARED.attachmentKey,
    });
    const lands = { page: 1, selected: [SHARED.annotationKey] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
      bound: SHARED.attachmentKey,
      reads: true,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
    // The reader held the named Attachment from its first read: the path's
    // own Attachment was never bound, nor read.
    expect(outcome.reads).toEqual([SHARED.attachmentKey]);
  }, 180000);

  // A tab ZotLit found open records no open of its own, but an open that
  // names the file's other Attachment in it is the researcher's own: the
  // tab's read of the path's Attachment ends, and a read of the named one
  // begins. Two tabs on the one file are then two Attachments, and the
  // Annotation View beside each shows that tab's own.
  it("rebinds a tab ZotLit found open to the other Attachment an open names, and the Annotation View follows each of two tabs on the shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);

    const outcome = await sharedTabs();

    // The tab's read of the path's Attachment ends first; the last read
    // recorded is of the Attachment the open named.
    expect(outcome.reads.at(0)).toBe(annotationAttachment.key);
    expect(outcome.reads.at(-1)).toBe(SHARED.attachmentKey);
    expect(outcome).toMatchObject({
      restored: SHARED.attachmentKey,
      besideRestored: [SHARED.annotationKey],
      besideSecond: [...annotationKeys].sort(),
      passed: [],
    });
  }, 180000);

  // The regression guard: the device-local link ZotLit wrote before keeps
  // landing exactly as it did.
  it("still lands an Attachment File Link that carries an Annotation Anchor", async () => {
    const url = `${FILE_URL}#page=2&zt-annotation=${SECOND_PAGE.key}`;
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  describe("hands the click to Zotero", () => {
    // The missing PDF is located and claimed; the reader finds no file as it
    // opens and hands the link on, with no missing-file notice of its own.
    it.each([
      ["a PDF this computer does not hold", MISSING_PDF.key, "ZZZZZZZ2"],
      ["an Attachment Zotero does not know", "ZZZZZZZ3", FIRST_PAGE.key],
    ])(
      "for %s",
      async (_, attachmentKey, annotationKey) => {
        const url = durableLink(annotationKey, "1", { attachmentKey });

        const outcome = await follow({
          note: noteWith(url),
          url,
          gesture: "reading",
        });

        expect(outcome).toEqual({
          drawn: false,
          reader: null,
          passed: [expect.objectContaining({ url })],
          notices: [],
        });
      },
      120000,
    );

    it("while the reader's open-file-links setting is off", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "reading",
        captureOff: true,
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [expect.objectContaining({ url })],
      });
    }, 120000);

    it("while annotation links are set to open in Zotero", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "reading",
        linkSettings: { "reader.open-annotation-links": false },
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [expect.objectContaining({ url })],
      });
    }, 120000);

    // Obsidian's own "Open in default browser" item calls `window.open` with
    // this target, which is the whole of that gesture as Capture sees it.
    it("for Obsidian's explicit external target", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "external",
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [{ url, target: "_external" }],
      });
    }, 120000);
  });

  describe("shows the Annotation a hovered link names", () => {
    it.each(["live-preview", "reading"] as const)(
      "with its text, page label and colour in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
        });

        expect(outcome).toMatchObject({
          popover: true,
          color: FIRST_PAGE.color,
          image: false,
        });
        expect(outcome.text).toContain(FIRST_PAGE.text);
        expect(outcome.text).toContain(
          run.m.annot_view_page({ page: FIRST_PAGE.pageLabel }),
        );
      },
      120000,
    );

    it("with its comment", async () => {
      const outcome = await hover({
        url: durableLink(COMMENTED.key, COMMENTED.pageLabel),
        gesture: "reading",
      });

      expect(outcome.text).toContain(COMMENTED.comment);
    }, 120000);

    // Rendered from the PDF by ZotLit with no reader open: the scenario opens
    // the note alone.
    it.each([
      ["an image", "live-preview", SECOND_PAGE],
      ["an ink", "reading", INK],
    ] as const)(
      "with the Excerpt Image of %s Annotation",
      async (_, gesture, annotation) => {
        const outcome = await hover({
          url: durableLink(annotation.key, annotation.pageLabel),
          gesture,
          image: true,
        });

        expect(outcome).toMatchObject({ popover: true, image: true });
      },
      120000,
    );

    // Page Preview gates the hover as it gates a citation's preview: ZotLit's
    // row in Obsidian's Page preview settings asks for Mod by default.
    it("as the popover under Page Preview, with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("under Page Preview without Mod", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // ZotLit's row in Obsidian's Page preview settings, once the researcher
    // turns its Mod off, lets the hover through without it.
    it("under Page Preview without Mod once ZotLit's Page preview row asks for none", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        hoverAction: "page-preview",
        pagePreviewMod: false,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // Source mode shows the link's Markdown, and the Annotation stays
    // available there.
    it("in Source mode with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // Source mode draws the link's text and its URL as spans of their own; the
    // popover anchors on the whole link, so crossing between them keeps it.
    it("in one place in Source mode while the pointer crosses from the text to the URL", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        mod: true,
        crossToUrl: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
      expect(outcome.crossed).toEqual({
        same: true,
        moved: false,
        text: outcome.text,
      });
    }, 120000);

    it("in Source mode without Mod", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // A Durable Annotation Link is no Pandoc citation: its hover stays when
    // the citation treatment is off.
    it("while Pandoc citations are off", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        pandocOff: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    // Opening is a click's setting alone: the hover stays while a click goes
    // to Zotero.
    it("while annotation links are set to open in Zotero", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        linkSettings: { "reader.open-annotation-links": false },
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it.each(["live-preview", "reading"] as const)(
      "while the citation Hover Action is off, in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
          hoverAction: "off",
        });

        expect(outcome.text).toContain(FIRST_PAGE.text);
      },
      120000,
    );

    it("with nothing for a Zotero link that names no Annotation", async () => {
      const outcome = await hover({
        url: `zotero://select/library/items/${annotationAttachment.key}`,
        gesture: "reading",
        absent: true,
      });

      expect(outcome.popover).toBe(false);
    }, 120000);

    // Zotero answers no list for an Attachment it does not know, and an
    // Attachment's list without the Annotation: both say the link is stale.
    it.each([
      ["an Annotation Zotero no longer has", durableLink("ZZZZZZZ2", "1")],
      [
        "an Attachment Zotero does not know",
        durableLink(FIRST_PAGE.key, "1", { attachmentKey: "ZZZZZZZ3" }),
      ],
    ])(
      "as unavailable for %s",
      async (_, url) => {
        const outcome = await hover({ url, gesture: "live-preview" });

        expect(outcome.popover).toBe(true);
        expect(outcome.text).toContain(run.m.annotation_popover_unavailable());
      },
      120000,
    );
  });
});
