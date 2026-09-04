// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get.

import { useEffect, useMemo, useState } from "react";

import {
  entryPosition,
  entrySlice,
  WorkbenchDocumentController,
} from "@zotlit/workbench/document";
import type {
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
import { FieldList } from "./field-list";
import {
  insertSnippet,
  rootData,
  templateRootAt,
  triggerHoldsCaret,
} from "./fields";
import type { SampleItem } from "./fields";
import { NameFolderPane } from "./name-folder";
import { NotePane } from "./note-pane";
import type { NoteEditor } from "./note-pane";
import { PropertiesPane, PropertiesResult } from "./properties-tab";
import type { EntryDiagnostic } from "./properties-tab";
import { ResultSheet } from "./reading-view";
import { startRenderWorker } from "./render-client";
import { SliceEditor } from "./slice-editor";
import type { FieldTrigger } from "./slice-editor";
import { ensureTemporal } from "./temporal";

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

/** The `{{` popup's own box: the size it is drawn at, and its margin. */
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 384;
const POPUP_MARGIN = 8;

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

export function Workbench() {
  const [controller] = useState(
    () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  );
  const [result, setResult] = useState<ProfileRenderResult | null>(null);
  const [scheduler] = useState(() =>
    createRenderScheduler({
      startWorker: startRenderWorker,
      onResult: setResult,
    }),
  );
  const [revision, setRevision] = useState(0);
  const [sample, setSample] = useState<SampleItem>(SAMPLE_ITEMS[0]!);
  const [tab, setTab] = useState<"note" | "properties" | "name">("note");
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

  useEffect(
    () => controller.subscribe(() => setRevision((n) => n + 1)),
    [controller],
  );
  useEffect(() => () => scheduler[Symbol.dispose](), [scheduler]);
  useEffect(() => {
    void ensureTemporal().then(() => setTemporal(true));
  }, []);
  useEffect(() => {
    if (!trigger) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrigger(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [trigger]);

  useEffect(() => {
    scheduler.request({ source: controller.source, snapshot: sample });
  }, [scheduler, controller, sample, revision]);

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
    ...(result?.diagnostics ?? []).flatMap(({ position, message }) =>
      position === undefined ? [] : [{ position, message }],
    ),
    ...controller.problems.flatMap(({ slice: id, message }) => {
      const position = entryPosition(id);
      return position === null ? [] : [{ position, message }];
    }),
  ];
  const problemRow = problem ? entryPosition(problem.slice) : null;
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
    setAdvanced(false);
    setTab("properties");
    setOpenRow(position);
    // A fresh object every time, so selecting the same problem twice reveals it
    // again.
    setReveal(range ? { ...range } : null);
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
            ? templateRootAt(controller.document, controller.source, caret.from)
            : "note",
    [slice, controller.document, controller.source, caret.from],
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
    setReveal({ from: head, to: head });
  }

  /** A caret that leaves the `{{` it opened on closes the popup that `{{` opened. */
  function trackSelection(selection: WorkbenchSliceRange) {
    setCaret(selection);
    setTrigger((current) =>
      current && triggerHoldsCaret(current.range, selection) ? current : null,
    );
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([controller.source], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `zotlit-profile.${manifest?.id ?? "profile"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function act(run: () => void) {
    return () => {
      setMenuOpen(false);
      run();
    };
  }

  return (
    <div className="flex h-dvh flex-col bg-fd-background text-fd-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-fd-border px-6 py-3">
        <h1 className="font-serif text-xl font-medium">{profile.name}</h1>
        <p className="text-fd-muted-foreground italic">{profile.description}</p>
        <div className="ml-auto flex items-center gap-2">
          <label
            htmlFor="workbench-sample"
            className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-muted-foreground uppercase"
          >
            {m.workbench_showing_label()}
          </label>
          <select
            id="workbench-sample"
            className="max-w-[22rem] truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
            value={sample.item.key}
            onChange={(event) => {
              setSample(
                SAMPLE_ITEMS.find(
                  (item) => item.item.key === event.target.value,
                )!,
              );
            }}
          >
            {SAMPLE_ITEMS.map((item) => (
              <option key={item.item.key} value={item.item.key}>
                {item.item.title ?? item.item.key}
              </option>
            ))}
          </select>
          <span className="border border-fd-border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
            {m.workbench_sample_badge()}
          </span>
          <div className="relative">
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
                className="absolute right-0 z-10 mt-1 flex w-56 flex-col border border-fd-border bg-fd-card p-1 shadow-[4px_4px_0_0_var(--color-fd-border)]"
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
                  {m.workbench_download()}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={advanced}
                  onClick={act(() => {
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
            onClick={download}
            className="cursor-pointer bg-fd-primary px-4 py-1.5 text-sm font-medium text-fd-primary-foreground"
          >
            {m.workbench_download()}
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-5 px-6 py-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,26rem)]">
        <FieldList key={root} root={root} data={fields} onInsert={insert} />

        <section className="flex min-h-0 flex-col">
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
            <div
              role="dialog"
              aria-label={m.workbench_fields_heading()}
              style={popupPosition(trigger)}
              className="fixed z-20 flex w-80 flex-col border border-fd-border bg-fd-card p-3 shadow-[4px_4px_0_0_var(--color-fd-border)]"
            >
              <FieldList root={root} data={fields} onInsert={insert} />
              <button
                type="button"
                onClick={() => setTrigger(null)}
                className="mt-2 cursor-pointer self-start border border-fd-border px-2 py-1 text-xs"
              >
                {m.workbench_fields_close()}
              </button>
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-col">
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
                    {previewProblem.message}{" "}
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
          className="shrink-0 border-t border-fd-border bg-fd-accent/40 px-6 py-3"
        >
          <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase">
            {m.workbench_problems_heading()}
          </p>
          <p className="mt-1 text-sm">
            {problem.message}{" "}
            <span className="text-fd-muted-foreground">{problem.recovery}</span>{" "}
            <button
              type="button"
              onClick={() => {
                if (problemRow !== null) {
                  goToEntry(problemRow, problem.range);
                  return;
                }
                setAdvanced(true);
                // A fresh object every time, so selecting the same problem
                // twice reveals it again.
                setReveal(problem.range ? { ...problem.range } : null);
              }}
              className="cursor-pointer underline underline-offset-2"
            >
              {problemRow === null
                ? m.workbench_problems_where_advanced()
                : m.workbench_problems_where_entry()}
            </button>
          </p>
        </section>
      )}
    </div>
  );
}
