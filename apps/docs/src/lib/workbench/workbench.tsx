// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get. It folds twice:
// under 1024 px the field column becomes the sheet the bottom "Add a field"
// button opens, and under 780 px the pane fills the screen with the result
// behind a tab of its own.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  entryPosition,
  entrySlice,
  WorkbenchDocumentController,
} from "@zotlit/workbench/document";
import type {
  WorkbenchProblem,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  createRenderScheduler,
} from "@zotlit/workbench/render";
import type { ProfileRenderResult } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import {
  AnnotationPointer,
  AnnotationResult,
  AnnotationSectionBar,
  annotationHeaderMark,
} from "./annotation";
import { ConnectionBar } from "./connection-bar";
import { FieldList } from "./field-list";
import type { FieldListProps } from "./field-list";
import {
  insertSnippet,
  rootData,
  templateRootAt,
  triggerHoldsCaret,
} from "./fields";
import type { SampleItem } from "./fields";
import { ProfileHandoff, unsupportedProblems } from "./handoff";
import { NameFolderPane } from "./name-folder";
import { NotePane } from "./note-pane";
import type { NoteEditor } from "./note-pane";
import { diagnosticText, problemText } from "./problems";
import { PropertiesPane, PropertiesResult } from "./properties-tab";
import type { EntryDiagnostic } from "./properties-tab";
import { ResultSheet } from "./reading-view";
import { startRenderWorker } from "./render-client";
import { SliceEditor } from "./slice-editor";
import type { FieldTrigger } from "./slice-editor";
import { ensureTemporal } from "./temporal";
import {
  clearDraft,
  downloadProfile,
  profileFileName,
  readDraft,
  writeDraft,
} from "./transfer";
import type { WorkbenchDraft } from "./transfer";
import { useWorkbenchConnection } from "./use-workbench-connection";

/** The three equal tabs, in the order the pane offers them. */
const TAB_LABEL = {
  note: m.workbench_tab_note,
  properties: m.workbench_tab_properties,
  name: m.workbench_tab_name_and_folder,
};

const TAB_LEDE = {
  note: m.workbench_note_lede,
  properties: m.workbench_properties_lede,
  name: m.workbench_name_lede,
};

/**
 * Where a problem is repaired, named for the reader. Every other slice is one
 * Managed Frontmatter row, which reads as the entry it is.
 */
const PROBLEM_WHERE: Partial<Record<WorkbenchSliceId, () => string>> = {
  advanced: m.workbench_problems_where_advanced,
  note: m.workbench_problems_where_note,
  filename: m.workbench_problems_where_filename,
};

/** The `{{` popup's own box: the size it is drawn at, and its margin. */
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 384;
const POPUP_MARGIN = 8;

/**
 * The document this page keeps a draft for. A standalone reader edits one
 * document at a time, so the page holds one reference of its own; a connected
 * Workbench keys each vault document by the reference the bridge gave it.
 */
const STANDALONE_DOCUMENT = "standalone";

/** Quiet time after the last change before the draft is written. */
const AUTOSAVE_MS = 500;

/** The paper a fresh visit opens on. */
const DEFAULT_SAMPLE = SAMPLE_ITEMS[0]!;

/**
 * The width the result stops being a tab at and becomes the column beside the
 * pane. Every `min-[780px]:` class in this file is the same threshold.
 */
const WIDE_LAYOUT = "(min-width: 780px)";

interface RestoreOffer {
  readonly draft: WorkbenchDraft;
  readonly baseline: DocumentBaseline;
}

interface DocumentBaseline {
  readonly reference: string;
  readonly source: string;
  readonly snapshot: string;
}

const STANDALONE_BASELINE: DocumentBaseline = {
  reference: STANDALONE_DOCUMENT,
  source: DEFAULT_PROFILE_SOURCE,
  snapshot: snapshotIdentity(DEFAULT_SAMPLE),
};

/**
 * Keeps the popup inside the window the `{{` was typed in: a trigger near an
 * edge slides the panel back until it fits, and a window too short for the
 * whole panel leaves it as tall as the window allows, with its list scrolling.
 */
function popupPosition(trigger: FieldTrigger) {
  const room = (extent: number, size: number) =>
    Math.max(POPUP_MARGIN, extent - size - POPUP_MARGIN);
  const left = Math.min(trigger.left, room(window.innerWidth, POPUP_WIDTH));
  const top = Math.min(trigger.top, room(window.innerHeight, POPUP_HEIGHT));
  return {
    left,
    top,
    maxHeight: Math.min(POPUP_HEIGHT, window.innerHeight - top - POPUP_MARGIN),
  };
}

/**
 * The field list standing over the pane it writes into: the popup `{{` opens at
 * the caret, and the sheet the narrow layout's "Add a field" button raises. One
 * box, so the list's chrome and its way out read the same wherever it opens.
 */
function FieldDialog({
  className,
  style,
  onClose,
  ...list
}: FieldListProps & {
  /** Where the box is drawn: the popup's panel, or the sheet's bottom strip. */
  className: string;
  style?: CSSProperties;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={m.workbench_fields_heading()}
      style={style}
      className={`fixed z-20 flex flex-col border-fd-border bg-fd-card ${className}`}
    >
      <div className="grid min-h-0 flex-1 grid-cols-1">
        {/* A root of its own opens a list of its own, from the top. */}
        <FieldList key={list.root} {...list} />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 cursor-pointer self-start border border-fd-border px-2 py-1 text-xs"
      >
        {m.workbench_fields_close()}
      </button>
    </div>
  );
}

export function Workbench() {
  const [controller, setController] = useState(
    () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  );
  const [baseline, setBaseline] = useState(STANDALONE_BASELINE);
  const [activeDocumentReference, setActiveDocumentReference] =
    useState(STANDALONE_DOCUMENT);
  // Read once, before the first autosave, so the record the last visit left is
  // the one the reader is offered.
  const [restorable, setRestorable] = useState<RestoreOffer | null>(() => {
    const draft = readDraft(STANDALONE_DOCUMENT);
    return draft
      ? {
          draft,
          baseline: STANDALONE_BASELINE,
        }
      : null;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  // Where the sheet was opened from, so closing it hands the keyboard back.
  const addField = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<ProfileRenderResult | null>(null);
  const [scheduler] = useState(() =>
    createRenderScheduler({
      startWorker: startRenderWorker,
      onResult: setResult,
    }),
  );
  const [revision, setRevision] = useState(0);
  const [sample, setSample] = useState<SampleItem>(DEFAULT_SAMPLE);
  const [tab, setTab] = useState<"note" | "properties" | "name">("note");
  // Which of the two the narrow screen is showing, and whether the field list
  // is open over it. Both are the narrow layout's alone: a wide screen shows
  // the pane, the result, and the field list at once.
  const [view, setView] = useState<"edit" | "result">("edit");
  const [sheet, setSheet] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [reveal, setReveal] = useState<WorkbenchSliceRange | null>(null);
  // Which of the note tab's two editors the reader is in, and where the
  // highlight box opens when they are sent to it from elsewhere.
  const [noteEditor, setNoteEditor] = useState<NoteEditor>("note");
  const [highlight, setHighlight] = useState<WorkbenchSliceRange | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [caret, setCaret] = useState<WorkbenchSliceRange>({ from: 0, to: 0 });
  const [trigger, setTrigger] = useState<FieldTrigger | null>(null);
  // The field list restores the snapshot the way the renderer does, so it waits
  // for the same Temporal the restoration needs.
  const [temporal, setTemporal] = useState(
    () => globalThis.Temporal !== undefined,
  );
  const [profile, setProfile] = useState<{
    name: string;
    description: string;
  }>({ name: m.workbench_title(), description: "" });
  const {
    connection,
    saveTarget,
    resources,
    citationStyles,
    connectionBusy,
    connectionCancellable,
    itemBusy,
    saveBusy,
    message: connectionMessage,
    connectFromPage,
    cancelConnection,
    disconnect,
    loadSelectedItem,
    save,
  } = useWorkbenchConnection({
    controller,
    sample,
    onHydrate: ({ selected, kept }) => {
      const nextBaseline = {
        reference: selected.document.reference,
        source: selected.source,
        snapshot: snapshotIdentity(sample),
      };
      setActiveDocumentReference(selected.document.reference);
      setBaseline(nextBaseline);
      loadDocument(selected.source);
      setRestorable(kept ? { draft: kept, baseline: nextBaseline } : null);
    },
    onItemLoaded: setSample,
    onSaved: ({ reference, source }) =>
      setBaseline({
        reference,
        source,
        snapshot: snapshotIdentity(sample),
      }),
  });

  useEffect(
    () => controller.subscribe(() => setRevision((n) => n + 1)),
    [controller],
  );
  useEffect(() => () => scheduler[Symbol.dispose](), [scheduler]);
  useEffect(() => {
    void ensureTemporal().then(() => setTemporal(true));
  }, []);
  useEffect(() => {
    if (!trigger && !sheet) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTrigger(null);
      if (sheet) closeSheet();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [trigger, sheet]);
  // The Editor and Result tabs stand under 780 px alone, so a window that grows
  // past them leaves the reader in the pane rather than on a result no tab
  // reads as chosen.
  useEffect(() => {
    const wide = window.matchMedia(WIDE_LAYOUT);
    const settle = () => {
      if (wide.matches) setView("edit");
    };
    wide.addEventListener("change", settle);
    return () => wide.removeEventListener("change", settle);
  }, []);

  // One reading of the problems behind both gates: the screen a refused Profile
  // gets, and the render it never starts.
  const unsupported = unsupportedProblems(controller.problems);
  const refused = unsupported.length > 0;

  useEffect(() => {
    // A Profile the web host refuses is never compiled, so nothing renders it.
    if (refused) return;
    scheduler.request({
      source: controller.source,
      snapshot: sample,
      ...(resources ? { resources } : {}),
    });
  }, [scheduler, controller, sample, revision, refused, resources]);

  const documentReference = activeDocumentReference;
  const atBaseline =
    documentReference === baseline.reference &&
    controller.source === baseline.source &&
    snapshotIdentity(sample) === baseline.snapshot;

  // The draft and the paper it is shown against are kept together, so a reload
  // offers both or neither.
  useEffect(() => {
    // The prompt stands over an untouched page alone: the first change answers
    // it the way Start clean does, so what the reader writes before answering
    // is kept, and Restore never lands on top of it.
    if (restorable) {
      const stillWaiting =
        documentReference === restorable.baseline.reference &&
        controller.source === restorable.baseline.source &&
        snapshotIdentity(sample) === restorable.baseline.snapshot;
      if (stillWaiting) return;
      setRestorable(null);
      return;
    }
    const source = controller.source;
    const timer = setTimeout(() => {
      if (atBaseline) clearDraft(documentReference);
      else
        writeDraft(documentReference, {
          source,
          snapshot: sample,
          ...(connection.state === "connected" && saveTarget
            ? { expected: saveTarget.expected }
            : {}),
        });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [
    restorable,
    atBaseline,
    documentReference,
    connection.state,
    saveTarget,
    controller,
    sample,
    revision,
  ]);

  // The header keeps the last name the document parsed with, so repairing an
  // invalid draft does not blank the page it is on.
  const manifest = controller.document?.manifest;
  useEffect(() => {
    if (manifest) {
      setProfile({
        name: manifest.name,
        description: manifest.description ?? "",
      });
    }
  }, [manifest]);

  const problem = controller.problems[0];
  const previewProblem = result?.diagnostics[0];
  // Null while the manifest's list is one the rows cannot edit, which is what
  // sends the reader to Advanced with the source intact.
  const entries = controller.managedEntries;
  // An entry that left the list owns no slice, so its row closes with it and
  // nothing addresses the text it used to hold.
  const row =
    openRow !== null && entries !== null && openRow <= entries.length
      ? openRow
      : null;
  // A row carries every problem that names it: the renderer's own, and the
  // manifest errors the parser pinned to one entry.
  const rowProblems: EntryDiagnostic[] = [
    ...(result?.diagnostics ?? []).flatMap((diagnostic) =>
      diagnostic.position === undefined
        ? []
        : [
            {
              position: diagnostic.position,
              message: diagnosticText(diagnostic),
            },
          ],
    ),
    ...controller.problems.flatMap((entry) => {
      const position = entryPosition(entry.slice);
      return position === null
        ? []
        : [{ position, message: problemText(entry).message }];
    }),
  ];
  // The Name and folder tab writes the note name; a manifest that holds that
  // value in a form no one-line pane can own leaves the caret in the note.
  const slice: WorkbenchSliceId = advanced
    ? "advanced"
    : tab === "properties" && row !== null
      ? entrySlice(row)
      : tab === "name" && controller.filenameSlice
        ? "filename"
        : tab === "note" && noteEditor === "annotation"
          ? "annotation"
          : "note";
  // The highlight box is the note tab's second editor, so the result column
  // shows the one highlight while the reader is in it.
  const showAnnotation = !advanced && slice === "annotation";

  /** Opens the row a diagnostic named, wherever the reader was. */
  function goToEntry(position: number, range?: WorkbenchSliceRange) {
    setView("edit");
    setAdvanced(false);
    setTab("properties");
    setOpenRow(position);
    // A fresh object every time, so selecting the same problem twice reveals it
    // again.
    setReveal(range ? { ...range } : null);
  }

  /**
   * Opens the pane a problem is repaired in — the row, the note name, the note
   * body, or Advanced — and reveals the text the parser pointed at.
   */
  function goToProblem({ slice: id, range }: WorkbenchProblem) {
    const position = entryPosition(id);
    if (position !== null) {
      goToEntry(position, range);
      return;
    }
    setView("edit");
    setAdvanced(id === "advanced");
    if (id === "note") {
      setTab("note");
      setNoteEditor("note");
    }
    if (id === "filename") setTab("name");
    // A fresh object every time, so selecting the same problem twice reveals it
    // again.
    setReveal(range ? { ...range } : null);
  }

  /** Leaves the sheet, and the reader on the button that raised it. */
  function closeSheet() {
    setSheet(false);
    addField.current?.focus();
  }

  /** Leaves the note tab, so its second editor does not follow the reader out. */
  function openTab(id: "note" | "properties" | "name") {
    setTab(id);
    if (id !== "note") setNoteEditor("note");
  }

  /**
   * Opens the one editor over the Annotation Section: the highlight box at the
   * first render call, and the section in Advanced when the note body calls it
   * nowhere — which is also where a document missing the section is repaired.
   */
  function openHighlight() {
    setView("edit");
    const section = controller.annotationSection;
    if (!section || controller.noteRegions.annotationCalls.length === 0) {
      setAdvanced(true);
      setReveal(section ? { ...section.header } : null);
      return;
    }
    setAdvanced(false);
    setTab("note");
    setNoteEditor("annotation");
    setHighlight({ from: section.source.from, to: section.source.from });
  }

  // The field list follows the pane the reader is in: the highlight box renders
  // one highlight, the note name renders the filename, and every rule and the
  // note itself render the note. Advanced holds the whole file, so there alone
  // the caret says which root the reader is writing against.
  const root = useMemo(
    () =>
      slice === "annotation"
        ? "annotation"
        : slice === "filename"
          ? "filename"
          : slice === "advanced"
            ? templateRootAt(
                controller.document,
                controller.filenameSlice,
                caret.from,
              )
            : "note",
    [slice, controller.document, controller.filenameSlice, caret.from],
  );
  const fields = useMemo(
    () => (temporal ? rootData(sample, root) : null),
    [temporal, sample, root],
  );

  /** Puts a snippet where the reader left the caret, then hands focus back. */
  function insert(snippet: string) {
    const head = insertSnippet(controller, slice, {
      target: trigger?.range ?? caret,
      snippet,
    });
    setTrigger(null);
    // The sheet stands over the pane it writes into, so it leaves with the
    // snippet it put there.
    setSheet(false);
    setReveal({ from: head, to: head });
  }

  /** A caret that leaves the `{{` it opened on closes the popup that `{{` opened. */
  function trackSelection(selection: WorkbenchSliceRange) {
    setCaret(selection);
    setTrigger((current) =>
      current && triggerHoldsCaret(current.range, selection) ? current : null,
    );
  }

  /** Opens `source` as the document being edited, with a history of its own. */
  function loadDocument(source: string) {
    setController(new WorkbenchDocumentController(source));
    setAdvanced(false);
    setView("edit");
    setSheet(false);
    setTab("note");
    setNoteEditor("note");
    setOpenRow(null);
    setReveal(null);
    setHighlight(null);
    setTrigger(null);
    setCaret({ from: 0, to: 0 });
  }

  /** Hands the reader their own bytes back, draft or not. */
  function download() {
    downloadProfile(
      controller.source,
      profileFileName(manifest?.id, { draft: controller.document === null }),
    );
  }

  function importFile(file: File | undefined) {
    if (!file) return;
    void file.text().then(loadDocument);
  }

  function act(run: () => void) {
    return () => {
      setMenuOpen(false);
      run();
    };
  }

  const draft = controller.document === null;
  const connected = connection.state === "connected";
  const connectedSnapshot = sample.provenance.kind === "connected";
  const currentConnectedSnapshot =
    connectedSnapshot &&
    connected &&
    sample.provenance.installationId === connection.installation.id &&
    sample.item.key === connection.selectedItem.key;
  // One input serves both screens, because the handoff is where a reader who
  // cannot edit this Profile reaches for another one.
  const filePicker = (
    <input
      ref={fileInput}
      type="file"
      accept=".md,text/markdown"
      aria-label={m.workbench_import_label()}
      className="hidden"
      onChange={(event) => {
        importFile(event.target.files?.[0]);
        // Cleared, so opening the same file twice opens it twice.
        event.target.value = "";
      }}
    />
  );
  const openFile = () => fileInput.current?.click();

  if (unsupported.length > 0) {
    return (
      <>
        {filePicker}
        <ProfileHandoff
          problems={unsupported}
          onDownload={download}
          onImport={openFile}
        />
      </>
    );
  }

  return (
    // The page sits under the site's banner strip, so its height is the window
    // less whatever that strip takes; a dismissed strip leaves the whole window.
    <div className="flex h-[calc(100dvh-var(--fd-banner-height,0px))] flex-col bg-fd-background text-fd-foreground">
      {filePicker}
      {/* The menu below hangs from this header's own right edge, so a header
          that wraps under 780 px never carries it off the screen. */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-fd-border px-4 py-3 min-[780px]:px-6">
        <h1 className="font-serif text-xl font-medium">{profile.name}</h1>
        <p className="text-fd-muted-foreground italic">{profile.description}</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label
            htmlFor="workbench-sample"
            className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-muted-foreground uppercase"
          >
            {m.workbench_showing_label()}
          </label>
          {connectedSnapshot && connected ? (
            <span
              id="workbench-sample"
              className="max-w-[22rem] min-w-0 truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
            >
              {sample.item.title ?? sample.item.key}
            </span>
          ) : (
            <select
              id="workbench-sample"
              className="max-w-[22rem] min-w-0 truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
              value={
                connectedSnapshot
                  ? `connected:${sample.item.key}`
                  : sample.item.key
              }
              onChange={(event) => {
                const selected = SAMPLE_ITEMS.find(
                  (item) => item.item.key === event.target.value,
                );
                if (selected) setSample(selected);
              }}
            >
              {connectedSnapshot && (
                <option value={`connected:${sample.item.key}`}>
                  {sample.item.title ?? sample.item.key}
                </option>
              )}
              {SAMPLE_ITEMS.map((item) => (
                <option key={item.item.key} value={item.item.key}>
                  {item.item.title ?? item.item.key}
                </option>
              ))}
            </select>
          )}
          <span className="border border-fd-border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
            {connectedSnapshot
              ? currentConnectedSnapshot
                ? m.workbench_connected_badge()
                : m.workbench_retained_badge()
              : m.workbench_sample_badge()}
          </span>
          {connected && (
            <button
              type="button"
              disabled={itemBusy}
              onClick={() => void loadSelectedItem()}
              className="cursor-pointer border border-fd-border px-3 py-1.5 text-sm font-medium disabled:cursor-wait disabled:text-fd-muted-foreground"
            >
              {itemBusy
                ? m.workbench_loading_item()
                : connectedSnapshot &&
                    sample.item.key === connection.selectedItem.key
                  ? m.workbench_refresh_item()
                  : m.workbench_load_item()}
            </button>
          )}
          <div>
            <button
              type="button"
              aria-label={m.workbench_more_actions()}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="cursor-pointer border border-transparent px-2 py-1.5 text-fd-muted-foreground hover:border-fd-border"
            >
              <span aria-hidden>···</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label={m.workbench_more_actions()}
                className="absolute top-full right-4 z-10 mt-1 flex w-56 flex-col border border-fd-border bg-fd-card p-1 shadow-[4px_4px_0_0_var(--color-fd-border)] min-[780px]:right-6"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!controller.canUndo}
                  onClick={act(() => controller.undo())}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent disabled:cursor-default disabled:text-fd-muted-foreground"
                >
                  {m.workbench_undo()}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={act(download)}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
                >
                  {draft
                    ? m.workbench_download_draft()
                    : m.workbench_download()}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={act(openFile)}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
                >
                  {m.workbench_import()}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={advanced}
                  onClick={act(() => {
                    // Advanced stands over the pane, so opening it from the
                    // narrow layout's result tab carries the reader to what it
                    // opened rather than leaving the press reading as nothing.
                    if (!advanced) setView("edit");
                    // A reveal belongs to the problem the reader clicked, so
                    // reopening Advanced from here starts on the caret instead.
                    setReveal(null);
                    setAdvanced((on) => !on);
                  })}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
                >
                  {m.workbench_advanced()}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={
              saveBusy ||
              (connected && (!saveTarget || controller.document === null))
            }
            onClick={connected ? () => void save(controller.source) : download}
            className="cursor-pointer bg-fd-primary px-4 py-1.5 text-sm font-medium text-fd-primary-foreground"
          >
            {connected
              ? saveBusy
                ? m.workbench_saving()
                : m.workbench_save()
              : draft
                ? m.workbench_download_draft()
                : m.workbench_download()}
          </button>
        </div>
      </header>

      <ConnectionBar
        connection={connection}
        website={window.location.origin}
        busy={connectionBusy}
        cancellable={connectionCancellable}
        message={connectionMessage}
        onConnect={connectFromPage}
        onCancel={cancelConnection}
        onDisconnect={() => void disconnect()}
      />

      {restorable && (
        <section
          aria-label={m.workbench_restore_heading()}
          className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-fd-border bg-fd-accent/40 px-4 py-3 min-[780px]:px-6"
        >
          <p className="text-sm font-medium">{m.workbench_restore_heading()}</p>
          <p className="text-sm text-fd-muted-foreground">
            {m.workbench_restore_body()}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                loadDocument(restorable.draft.source);
                setSample(restorable.draft.snapshot);
                setRestorable(null);
              }}
              className="cursor-pointer bg-fd-primary px-3 py-1 text-sm font-medium text-fd-primary-foreground"
            >
              {m.workbench_restore_accept()}
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft(restorable.baseline.reference);
                setRestorable(null);
              }}
              className="cursor-pointer border border-fd-border px-3 py-1 text-sm"
            >
              {m.workbench_restore_decline()}
            </button>
          </div>
        </section>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 min-[780px]:grid min-[780px]:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] min-[780px]:gap-5 min-[780px]:px-6 min-[780px]:py-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,26rem)]">
        {/* The two the narrow screen shows one of. The pane and the result are
            columns of their own once there is room for both. */}
        <div
          role="tablist"
          aria-label={m.workbench_view_label()}
          className="flex gap-5 border-b border-fd-border min-[780px]:hidden"
        >
          {(["edit", "result"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => {
                setView(id);
                setSheet(false);
              }}
              className="-mb-px cursor-pointer pb-1.5 font-mono text-[0.68rem] font-semibold tracking-widest text-fd-muted-foreground uppercase aria-selected:border-b-2 aria-selected:border-fd-primary aria-selected:text-fd-foreground"
            >
              {id === "edit"
                ? m.workbench_view_editor()
                : m.workbench_view_result()}
            </button>
          ))}
        </div>

        {/* A column of its own where three fit; under that width the same list
            is what "Add a field" opens. */}
        <div className="hidden min-h-0 min-w-0 grid-cols-1 lg:grid">
          <FieldList key={root} root={root} data={fields} onInsert={insert} />
        </div>

        <section
          className={`min-h-0 flex-1 flex-col ${
            view === "result" ? "hidden min-[780px]:flex" : "flex"
          }`}
        >
          {advanced ? (
            <>
              <h2 className="font-serif text-[1.06rem] font-medium">
                {m.workbench_advanced_heading()}
              </h2>
              <p className="mt-1 mb-2.5 text-xs text-fd-muted-foreground">
                {m.workbench_advanced_lede()}
              </p>
            </>
          ) : (
            <>
              <div
                role="tablist"
                aria-label={m.workbench_title()}
                className="flex gap-5 border-b border-fd-border"
              >
                {(["note", "properties", "name"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => openTab(id)}
                    className="-mb-px cursor-pointer pb-1.5 font-serif text-[1.06rem] font-medium text-fd-muted-foreground aria-selected:border-b-2 aria-selected:border-fd-primary aria-selected:text-fd-foreground"
                  >
                    {TAB_LABEL[id]()}
                  </button>
                ))}
              </div>
              <p className="mt-2 mb-2.5 text-xs text-fd-muted-foreground">
                {TAB_LEDE[tab]()}
              </p>
            </>
          )}
          {advanced ? (
            <>
              <AnnotationSectionBar controller={controller} onGo={setReveal} />
              <div className="flex min-h-0 flex-1 flex-col border border-fd-border bg-fd-card [&_.zt-section-header]:bg-fd-accent/60 [&_.zt-section-header]:shadow-[inset_2px_0_0_0_var(--color-fd-primary)]">
                <SliceEditor
                  controller={controller}
                  slice="advanced"
                  label={m.workbench_advanced_heading()}
                  extensions={annotationHeaderMark}
                  reveal={reveal}
                  onSelection={trackSelection}
                  onFieldTrigger={setTrigger}
                />
              </div>
            </>
          ) : tab === "name" ? (
            <>
              <NameFolderPane
                controller={controller}
                manifest={manifest ?? null}
                filename={result?.filename ?? null}
                citationStyles={citationStyles}
                reveal={reveal}
                onSelection={trackSelection}
                onFieldTrigger={setTrigger}
              />
              <AnnotationPointer onOpen={openHighlight} />
            </>
          ) : tab === "properties" ? (
            <>
              {entries === null ? (
                <p className="text-sm text-fd-muted-foreground">
                  {m.workbench_properties_source_only()}
                </p>
              ) : (
                <PropertiesPane
                  controller={controller}
                  entries={entries}
                  properties={result?.properties ?? []}
                  fold={result?.fold ?? []}
                  diagnostics={rowProblems}
                  selected={row}
                  onSelect={setOpenRow}
                  reveal={reveal}
                  onSelection={trackSelection}
                  onFieldTrigger={setTrigger}
                />
              )}
              <AnnotationPointer onOpen={openHighlight} />
            </>
          ) : (
            <NotePane
              controller={controller}
              reveal={reveal}
              highlight={highlight}
              onSelection={trackSelection}
              onFieldTrigger={setTrigger}
              onOpenHighlight={openHighlight}
              onEditing={setNoteEditor}
            />
          )}
          {/* Next to the editor in tab order, because that is where it opens. */}
          {trigger && (
            <FieldDialog
              root={root}
              data={fields}
              onInsert={insert}
              onClose={() => setTrigger(null)}
              style={popupPosition(trigger)}
              className="w-80 border p-3 shadow-[4px_4px_0_0_var(--color-fd-border)]"
            />
          )}
          {/* The field list's way in where it has no column: the same list, the
              same insertion, opened over the pane it writes into. */}
          <button
            ref={addField}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
            className="mt-3 cursor-pointer border border-fd-border bg-fd-card px-3 py-2 text-sm font-medium lg:hidden"
          >
            {m.workbench_add_field()}
          </button>
          {sheet && (
            <FieldDialog
              root={root}
              data={fields}
              onInsert={insert}
              onClose={closeSheet}
              className="inset-x-0 bottom-0 max-h-[75dvh] border-t p-4 shadow-[0_-4px_0_0_var(--color-fd-border)] lg:hidden"
            />
          )}
        </section>

        <section
          className={`min-h-0 flex-1 flex-col ${
            view === "result" ? "flex" : "hidden min-[780px]:flex"
          }`}
        >
          <div className="flex items-baseline gap-3">
            <h2 className="font-serif text-[1.06rem] font-medium">
              {showAnnotation
                ? m.workbench_highlight_heading()
                : m.workbench_result_heading()}
            </h2>
            <button
              type="button"
              aria-pressed={showMarkdown}
              onClick={() => setShowMarkdown((on) => !on)}
              className="ml-auto cursor-pointer border border-fd-border px-2 py-0.5 font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase aria-pressed:border-fd-primary aria-pressed:text-fd-primary"
            >
              {m.workbench_result_markdown_toggle()}
            </button>
          </div>
          <p className="mt-1 mb-2.5 text-xs text-fd-muted-foreground">
            {showAnnotation
              ? m.workbench_highlight_result_lede()
              : m.workbench_result_lede()}
          </p>
          <div className="min-h-0 flex-1 overflow-auto border border-fd-border bg-fd-card p-5 shadow-[6px_6px_0_0_var(--color-fd-border)]">
            {result ? (
              <>
                {!showAnnotation && (
                  <p className="mb-3 font-mono text-xs text-fd-muted-foreground">
                    <span className="sr-only">
                      {m.workbench_result_filename()}:{" "}
                    </span>
                    {result.filename}
                  </p>
                )}
                {previewProblem && (
                  <p className="mb-3 border-l-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs">
                    <strong className="font-medium">
                      {m.workbench_preview_problem()}
                    </strong>{" "}
                    {diagnosticText(previewProblem)}{" "}
                    {previewProblem.position !== undefined && (
                      <button
                        type="button"
                        onClick={() => goToEntry(previewProblem.position!)}
                        className="cursor-pointer underline underline-offset-2"
                      >
                        {m.workbench_problems_where_entry()}
                      </button>
                    )}
                  </p>
                )}
                {showAnnotation ? (
                  <AnnotationResult
                    markdown={result.annotation}
                    showMarkdown={showMarkdown}
                  />
                ) : !advanced && tab === "properties" ? (
                  <PropertiesResult
                    entries={entries ?? []}
                    properties={result.properties}
                    fold={result.fold}
                  />
                ) : (
                  <ResultSheet
                    markdown={result.creationBody ?? ""}
                    // The sheet is the note, so its list is the fold every
                    // entry merged into, not each entry's own contribution.
                    properties={result.fold}
                    showMarkdown={showMarkdown}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-fd-muted-foreground">
                {m.workbench_result_pending()}
              </p>
            )}
          </div>
        </section>
      </main>

      {problem && (
        <section
          aria-label={m.workbench_problems_heading()}
          className="shrink-0 border-t border-fd-border bg-fd-accent/40 px-4 py-3 min-[780px]:px-6"
        >
          <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase">
            {m.workbench_problems_heading()}
          </p>
          <p className="mt-1 text-sm">
            {problemText(problem).message}{" "}
            <span className="text-fd-muted-foreground">
              {problemText(problem).recovery}
            </span>{" "}
            <button
              type="button"
              onClick={() => goToProblem(problem)}
              className="cursor-pointer underline underline-offset-2"
            >
              {entryPosition(problem.slice) === null
                ? (
                    PROBLEM_WHERE[problem.slice] ??
                    m.workbench_problems_where_advanced
                  )()
                : m.workbench_problems_where_entry()}
            </button>
          </p>
        </section>
      )}
    </div>
  );
}

function snapshotIdentity(snapshot: SampleItem): string {
  const provenance =
    snapshot.provenance.kind === "sample"
      ? `sample:${snapshot.provenance.id}`
      : `connected:${snapshot.provenance.installationId}`;
  return `${provenance}:${snapshot.item.key}:${snapshot.revision}`;
}
