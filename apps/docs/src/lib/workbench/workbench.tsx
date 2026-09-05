// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get. It folds twice:
// under 1180 px the field column becomes the dialog the toolbar "Add a field"
// button opens, and under 780 px the pane fills the screen with the result
// behind a view switch.

import {
  ArrowLeft,
  ChevronDown,
  Code2,
  Download,
  FilePlus2,
  FolderOpen,
  List,
  Plus,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { m } from "@/paraglide/messages.js";

import {
  AnnotationPointer,
  AnnotationSectionBar,
  annotationHeaderMark,
} from "./annotation";
import { ConnectionBar } from "./connection-bar";
import { FieldList } from "./field-list";
import { insertSnippet, rootData, templateRootAt } from "./fields";
import type { SampleItem } from "./fields";
import {
  ProfileHandoff,
  unsupportedDependencies,
  unsupportedProblems,
} from "./handoff";
import { NameFolderPane } from "./name-folder";
import { NotePane } from "./note-pane";
import type { NoteEditor } from "./note-pane";
import { diagnosticText, problemText } from "./problems";
import { PropertiesPane, PropertiesResult } from "./properties-tab";
import type { EntryDiagnostic } from "./properties-tab";
import { ResultSheet } from "./reading-view";
import { startRenderWorker } from "./render-client";
import { SampleBar } from "./sample-bar";
import { SliceEditor } from "./slice-editor";
import { ensureTemporal } from "./temporal";
import { downloadProfile, profileFileName } from "./transfer";
import { useWorkbenchConnection } from "./use-workbench-connection";
import type { ProfileHydration } from "./use-workbench-connection";
import { DEFAULT_SAMPLE, useWorkbenchDraft } from "./use-workbench-draft";

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
  details: m.workbench_problems_where_details,
};

/** The result becomes a column once both reading and editing have room. */
const WIDE_LAYOUT = "(min-width: 780px)";

/**
 * The call a note without one is given: the format once per highlight, in
 * each language the Profile can be written in.
 */
const HIGHLIGHTS_LOOP =
  "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n";
const ETA_HIGHLIGHTS_LOOP =
  "<% for (const annotation of zt.annotations) { %>\n<%~ renderAnnotation(annotation) %>\n<% } %>\n";

export function Workbench() {
  const [controller, setController] = useState(
    () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  );
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
  // The reader is at the highlight box, so the result column points at every
  // highlight the one format produced.
  const [emphasis, setEmphasis] = useState(false);
  // A sentence about the edit just made, which the next edit retires. It is
  // stamped with the revision it belongs to, because the edit that earns it
  // and the sentence itself land in one render.
  const [notice, setNotice] = useState<{
    text: string;
    revision: number;
  } | null>(null);
  const latestRevision = useRef(0);
  // The first time the sheet shows what the format produced, the result column
  // brings the first of those into view, once per visit; after that the column
  // stays where the reader left it.
  const resultRegion = useRef<HTMLDivElement>(null);
  const scrolledToOutput = useRef(false);
  const [pendingAction, setPendingAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const replaceConnected = useRef(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showManaged, setShowManaged] = useState(false);
  // The Name and folder control a manifest problem opens, as a fresh object
  // every time, so selecting the same problem twice opens it again.
  const [focusField, setFocusField] = useState<{ field: string } | null>(null);
  const [caret, setCaret] = useState<WorkbenchSliceRange>({ from: 0, to: 0 });
  // The field list restores the snapshot the way the renderer does, so it waits
  // for the same Temporal the restoration needs.
  const [temporal, setTemporal] = useState(
    () => globalThis.Temporal !== undefined,
  );
  const {
    connection,
    saveTarget,
    resources,
    resourcesStale,
    citationStyles,
    saveAgainst,
    connectionBusy,
    connectionCancellable,
    itemBusy,
    saveBusy,
    message: connectionMessage,
    connectFromPage,
    cancelConnection,
    disconnect,
    reloadProfile,
    loadSelectedItem,
    save,
  } = useWorkbenchConnection({
    controller,
    sample,
    onHydrate: openSelectedProfile,
    onItemLoaded: setSample,
    onSaved: ({ reference, source }) => drafts.rebase({ reference, source }),
  });
  const drafts = useWorkbenchDraft({
    controller,
    revision,
    sample,
    saveTarget,
  });

  /** Opens the Profile a connection hydrated, with what it kept beside it. */
  function openSelectedProfile({
    selected,
    kept,
    retainedExpected,
  }: ProfileHydration) {
    const opened = {
      reference: selected.document.reference,
      source: selected.source,
    };
    // A connection that comes back to the document already open leaves the text
    // and its undo history where they are: the connection was lost, the work
    // was not. The vault's own bytes become the saved state the draft is
    // measured against, so an unsaved edit stays an unsaved edit.
    if (drafts.reference === opened.reference && !replaceConnected.current) {
      drafts.rebase(opened);
      // The text on screen still descends from the revision it was read at, so
      // Save answers for that one: the vault moved, this draft did not.
      if (retainedExpected) saveAgainst(retainedExpected);
      return;
    }
    drafts.adopt(opened, replaceConnected.current ? null : kept);
    replaceConnected.current = false;
    loadDocument(selected.source);
  }

  useEffect(
    () =>
      controller.subscribe(() => {
        latestRevision.current += 1;
        setRevision(latestRevision.current);
      }),
    [controller],
  );
  useEffect(() => setFileMessage(null), [revision]);
  useEffect(() => {
    if (scrolledToOutput.current || advanced || tab !== "note") return;
    const first = resultRegion.current?.querySelector<HTMLElement>(
      '[data-zt="highlight-output"]',
    );
    if (!first) return;
    scrolledToOutput.current = true;
    first.scrollIntoView?.({ block: "nearest" });
  }, [result, advanced, tab]);
  useEffect(() => () => scheduler[Symbol.dispose](), [scheduler]);
  useEffect(() => {
    void ensureTemporal().then(() => setTemporal(true));
  }, []);
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
  // gets, and the render it never starts. A connected bundle is read before any
  // compilation, so a partial the vault holds in Eta refuses the Profile here
  // rather than through a diagnostic the Worker raises mid-render.
  const unsupported = [
    ...unsupportedProblems(controller.problems),
    ...unsupportedDependencies(resources?.dependencies),
  ];
  const refused = unsupported.length > 0;
  // A draft the parser refuses renders as nothing, so the last good result
  // stands beside the Problems strip while the reader repairs it, rather than
  // emptying the sheet and reporting the same parse error twice.
  const renderable = !refused && controller.document !== null;

  useEffect(() => {
    // A Profile the web host refuses is never compiled, so nothing renders it,
    // and a bundle read for another draft would render this one against the
    // wrong partials — the last good result stands until its own bundle lands.
    if (!renderable || resourcesStale) return;
    scheduler.request({
      source: controller.source,
      snapshot: sample,
      ...(resources ? { resources } : {}),
    });
  }, [
    scheduler,
    controller,
    sample,
    revision,
    renderable,
    resources,
    resourcesStale,
  ]);

  // The last manifest the document parsed with. The header and the Name and
  // folder form read it, so repairing an invalid draft blanks neither.
  const manifest = controller.document?.manifest;
  const [shownManifest, setShownManifest] = useState(manifest ?? null);
  useEffect(() => {
    if (manifest) setShownManifest(manifest);
  }, [manifest]);
  const profile = {
    name: shownManifest?.name ?? m.workbench_title(),
    description: shownManifest?.description ?? "",
  };

  // The paper this Profile is written for: the bundled Item carrying its sample
  // item type. A type no bundled Item carries leaves the paper on screen, and
  // the header says which type went unanswered.
  const sampleItemType = shownManifest?.sampleItemType;
  const bundledForType = SAMPLE_ITEMS.find(
    (item) => item.item.itemType === sampleItemType,
  );
  useEffect(() => {
    if (bundledForType) setSample(bundledForType);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- one selection per named type, not per parse of the same manifest
  }, [sampleItemType]);

  // What the editors complete and explain against: every partial this Profile
  // can call, whether the manifest carries it or a connected bundle answers it.
  const partials = useMemo(
    () => [
      ...(shownManifest?.partials ?? []).map(({ name }) => name),
      ...(resources?.dependencies.templates ?? []).map(({ name }) => name),
    ],
    [shownManifest, resources],
  );

  const problem = controller.problems[0];
  // The format's own complaint is shown in the highlight box, so the result
  // column reports everything else.
  const previewProblem = result?.diagnostics.find(
    ({ part }) => part !== "annotation",
  );
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
  // The note itself, which is the one result an update rewrites part of, so the
  // update-only Managed Region is offered beside it and nowhere else.
  const showNote = !(!advanced && tab === "properties");
  // The render's complaint about the format alone, shown in the highlight box
  // where the format is edited rather than in the result column.
  const formatProblem = result?.diagnostics.find(
    ({ part }) => part === "annotation",
  );

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
  function goToProblem(problem: WorkbenchProblem) {
    const { slice: id, range } = problem;
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
    if (id === "filename" || id === "details") setTab("name");
    // A fresh object every time, so selecting the same problem twice reveals it
    // again. The Name and folder form writes its manifest fields through
    // controls rather than an editor, so a problem it owns opens the control
    // holding the field the parser named instead of revealing text.
    setReveal(range && id !== "details" ? { ...range } : null);
    setFocusField(
      id === "details" && problem.params?.field !== undefined
        ? { field: problem.params.field }
        : null,
    );
  }

  /** Leaves the note tab, so its second editor does not follow the reader out. */
  function openTab(id: "note" | "properties" | "name") {
    setTab(id);
    setReveal(null);
    if (id !== "note") setNoteEditor("note");
  }

  /**
   * Opens the one editor over the Annotation Section: the highlight box at the
   * first render call, with the format's source showing.
   */
  function openHighlight() {
    const section = controller.annotationSection;
    if (!section || controller.noteRegions.annotationCalls.length === 0) return;
    setView("edit");
    setAdvanced(false);
    setTab("note");
    setNoteEditor("annotation");
    setHighlight({ from: section.source.from, to: section.source.from });
  }

  /**
   * Gives a note that calls the format nowhere its call: the loop over every
   * highlight, put where the reader left the caret, so the box opens in the
   * note. A document that also lacks the section is given one first, and told.
   */
  function insertHighlights() {
    const repaired = controller.repairAnnotationSection();
    const language = controller.document?.manifest.language;
    insertSnippet(controller, "note", {
      target: caret,
      snippet: language === "eta" ? ETA_HIGHLIGHTS_LOOP : HIGHLIGHTS_LOOP,
    });
    // Both edits have told the subscriber by now, so the sentence is stamped
    // with the revision the reader is looking at.
    if (repaired) {
      setNotice({
        text: m.workbench_highlight_section_added(),
        revision: latestRevision.current,
      });
    }
    setView("edit");
    setAdvanced(false);
    setTab("note");
  }

  /** Opens the Annotation Section as source, in Source mode, at its header. */
  function openSource() {
    const section = controller.annotationSection;
    setView("edit");
    setAdvanced(true);
    setReveal(section ? { ...section.header } : null);
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
  const sourceRegion = advanced
    ? controller.templateRegions.find(
        (region) => caret.from >= region.from && caret.to <= region.to,
      )
    : undefined;
  const propertyLanguage =
    !advanced && tab === "properties"
      ? entries?.find((entry) => entry.position === row)?.language
      : undefined;
  const fieldMode =
    sourceRegion?.language === "json-e" || propertyLanguage === "value"
      ? "json-e"
      : sourceRegion?.expression || propertyLanguage === "expr"
        ? "expression"
        : "template";
  const selectedProperty =
    row === null
      ? undefined
      : controller.document?.manifest.frontmatter?.[row - 1];
  const fieldDisabled =
    !advanced &&
    tab === "properties" &&
    (row === null ||
      (selectedProperty !== undefined &&
        "value" in selectedProperty &&
        typeof selectedProperty.value === "string"));
  const fields = useMemo(
    () => (temporal ? rootData(sample, root) : null),
    [temporal, sample, root],
  );
  /**
   * What the editor's own completion and hover resolve against: the root the
   * pane the reader is in writes, the partials this Profile can call, and this
   * paper's values for that root. It is read per keystroke, so no pane is
   * rebuilt when the reader changes paper or moves between roots.
   */
  const suggest = (position: number) => {
    const currentRoot = templateRootAt(
      controller.document,
      controller.filenameSlice,
      position,
    );
    const data = rootData(sample, currentRoot);
    return { root: currentRoot, partials, ...(data ? { sample: data } : {}) };
  };

  /** Puts a snippet where the reader left the caret, then hands focus back. */
  function insert(snippet: string) {
    if (fieldDisabled) return;
    const head = insertSnippet(controller, slice, {
      target: caret,
      snippet,
    });
    // The sheet stands over the pane it writes into, so it leaves with the
    // snippet it put there.
    setSheet(false);
    setReveal({ from: head, to: head });
  }

  function trackSelection(selection: WorkbenchSliceRange) {
    setCaret(selection);
  }

  /** Opens `source` as the document being edited, with a history of its own. */
  function loadDocument(source: string) {
    setController(new WorkbenchDocumentController(source));
    setResult(null);
    setFileMessage(null);
    setShownManifest(null);
    setAdvanced(false);
    setView("edit");
    setSheet(false);
    setTab("note");
    setNoteEditor("note");
    setOpenRow(null);
    setReveal(null);
    setHighlight(null);
    setCaret({ from: 0, to: 0 });
  }

  /** Download always returns the exact source, including an unfinished draft. */
  function download() {
    downloadProfile(
      controller.source,
      profileFileName(manifest?.id, { draft: controller.document === null }),
    );
    if (!canSaveToVault)
      drafts.rebase({ reference: drafts.reference, source: controller.source });
    setFileMessage(m.workbench_download_complete());
  }

  function replaceProfile(label: string, run: () => void) {
    if (drafts.dirty) setPendingAction({ label, run });
    else run();
  }

  function openStandalone(source: string) {
    drafts.adopt({ reference: "standalone", source }, null);
    loadDocument(source);
  }

  function importFile(file: File | undefined) {
    if (!file) return;
    void file.text().then(
      (source) =>
        replaceProfile(m.workbench_import(), () => openStandalone(source)),
      () => setFileMessage(m.workbench_import_failed()),
    );
  }

  function changeMode(source: boolean) {
    setView("edit");
    setReveal(null);
    setAdvanced(source);
  }

  const draft = controller.document === null;
  const connected = connection.state === "connected";
  const canSaveToVault =
    connected &&
    saveTarget?.reference === drafts.reference &&
    connection.capabilities.includes("selected-profile:save");
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

  const replacementDialog = (
    <Dialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open) setPendingAction(null);
      }}
    >
      <DialogContent>
        <DialogTitle>{m.workbench_replace_heading()}</DialogTitle>
        <DialogDescription>
          {m.workbench_replace_body({ name: profile.name })}
        </DialogDescription>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              download();
              const next = pendingAction;
              setPendingAction(null);
              next?.run();
            }}
          >
            {m.workbench_replace_download()}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const next = pendingAction;
              setPendingAction(null);
              next?.run();
            }}
          >
            {pendingAction?.label}
          </Button>
          <DialogClose render={<Button variant="ghost" />}>
            {m.workbench_keep_editing()}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (unsupported.length > 0) {
    return (
      <>
        {filePicker}
        {replacementDialog}
        <ProfileHandoff
          reasons={unsupported}
          onDownload={download}
          onImport={openFile}
          onUndo={controller.canUndo ? () => controller.undo() : undefined}
          message={fileMessage}
        />
      </>
    );
  }

  return (
    // The page sits under the site's banner strip, so its height is the window
    // less whatever that strip takes; a dismissed strip leaves the whole window.
    <div className="flex min-h-[calc(100dvh-var(--fd-banner-height,0px))] flex-col bg-fd-background text-fd-foreground min-[780px]:h-[calc(100dvh-var(--fd-banner-height,0px))] min-[780px]:min-h-[40rem]">
      <a
        href="#workbench-editor"
        className="sr-only focus:not-sr-only focus:p-3"
      >
        {m.workbench_skip_editor()}
      </a>
      {filePicker}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-fd-border px-4 py-3 min-[780px]:px-6">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-fd-muted-foreground">
            {m.workbench_title()}
          </p>
          <h1 className="font-serif text-xl font-medium break-words">
            {profile.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={connectionBusy || saveBusy}
              render={<Button variant="outline" />}
            >
              <FolderOpen aria-hidden />
              {m.workbench_profile_menu()}
              <ChevronDown aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openFile}>
                <FolderOpen aria-hidden />
                {m.workbench_import()}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  replaceProfile(m.workbench_start_default(), () =>
                    openStandalone(DEFAULT_PROFILE_SOURCE),
                  )
                }
              >
                <FilePlus2 aria-hidden />
                {m.workbench_start_default()}
              </DropdownMenuItem>
              {connected && (
                <DropdownMenuItem
                  onClick={() =>
                    replaceProfile(m.workbench_reload_profile(), () => {
                      replaceConnected.current = true;
                      reloadProfile();
                    })
                  }
                >
                  <FolderOpen aria-hidden />
                  {m.workbench_reload_profile()}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={download}>
                <Download aria-hidden />
                {m.workbench_download_copy()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            disabled={saveBusy || (canSaveToVault && draft)}
            onClick={
              canSaveToVault ? () => void save(controller.source) : download
            }
          >
            {canSaveToVault ? <Save aria-hidden /> : <Download aria-hidden />}
            {canSaveToVault
              ? saveBusy
                ? m.workbench_saving()
                : m.workbench_save()
              : draft
                ? m.workbench_download_draft()
                : m.workbench_download()}
          </Button>
        </div>
      </header>

      {replacementDialog}

      <ConnectionBar
        connection={connection}
        website={window.location.origin}
        busy={connectionBusy}
        cancellable={connectionCancellable}
        message={connectionMessage}
        saveBusy={saveBusy}
        editingConnectedProfile={canSaveToVault}
        onConnect={() => {
          // Reconnecting the current vault document preserves its draft and history.
          if (saveTarget?.reference === drafts.reference) connectFromPage();
          else
            replaceProfile(m.workbench_connection_connect(), connectFromPage);
        }}
        onCancel={cancelConnection}
        onDisconnect={() => void disconnect()}
      />

      {drafts.restorable && (
        <section
          aria-label={m.workbench_restore_heading()}
          className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-fd-border bg-fd-accent/40 px-4 py-3 min-[780px]:px-6"
        >
          <p className="text-sm font-medium">{m.workbench_restore_heading()}</p>
          <p className="text-sm text-fd-muted-foreground">
            {m.workbench_restore_body()}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const kept = drafts.restore();
                if (!kept) return;
                loadDocument(kept.source);
                setSample(kept.snapshot);
                if (kept.expected) saveAgainst(kept.expected);
              }}
            >
              {m.workbench_restore_accept()}
            </Button>
            <Button variant="ghost" onClick={() => drafts.startClean()}>
              {m.workbench_restore_decline()}
            </Button>
          </div>
        </section>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 min-[780px]:px-6">
        <SampleBar
          sample={sample}
          connection={connection}
          {...(sampleItemType !== undefined && !bundledForType
            ? { unmatchedItemType: sampleItemType }
            : {})}
          busy={itemBusy}
          onShow={setSample}
          onLoad={() => void loadSelectedItem()}
        />
      </div>
      <p
        role="status"
        className="px-4 pt-2 text-xs text-fd-muted-foreground min-[780px]:px-6"
      >
        {(notice?.revision === revision ? notice.text : null) ??
          fileMessage ??
          (canSaveToVault
            ? draft
              ? m.workbench_save_fix()
              : drafts.dirty
                ? m.workbench_unsaved()
                : m.workbench_saved_profile()
            : m.workbench_browser_draft())}
      </p>

      <main
        id="workbench-editor"
        className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 min-[780px]:grid min-[780px]:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] min-[780px]:gap-5 min-[780px]:px-6 min-[1180px]:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1fr)_minmax(0,0.85fr)]"
      >
        {/* The two the narrow screen shows one of. The pane and the result are
            columns of their own once there is room for both. */}
        <div
          role="group"
          aria-label={m.workbench_view_label()}
          className="flex gap-1 rounded-md bg-fd-muted p-1 min-[780px]:hidden"
        >
          {(["edit", "result"] as const).map((id) => (
            <Button
              key={id}
              variant={view === id ? "outline" : "ghost"}
              aria-pressed={view === id}
              aria-controls={`workbench-${id}-pane`}
              className="flex-1"
              onClick={() => {
                setView(id);
                setSheet(false);
              }}
            >
              {id === "edit"
                ? m.workbench_view_editor()
                : m.workbench_view_result()}
            </Button>
          ))}
        </div>

        {/* A column of its own where three fit; under that width the same list
            is what "Add a field" opens. */}
        <div className="hidden min-h-0 min-w-0 grid-cols-1 min-[1180px]:grid">
          <FieldList
            key={`${root}:${fieldMode}`}
            root={root}
            mode={fieldMode}
            disabled={fieldDisabled}
            data={fields}
            onInsert={insert}
          />
        </div>

        <section
          id="workbench-edit-pane"
          className={`min-h-80 min-w-0 flex-1 flex-col min-[780px]:min-h-0 ${
            view === "result" ? "hidden min-[780px]:flex" : "flex"
          }`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={m.workbench_editing_mode()}
            >
              <Button
                variant={advanced ? "ghost" : "outline"}
                size="sm"
                aria-pressed={!advanced}
                onClick={() => changeMode(false)}
              >
                <List aria-hidden />
                {m.workbench_basic()}
              </Button>
              <Button
                variant={advanced ? "outline" : "ghost"}
                size="sm"
                aria-pressed={advanced}
                onClick={() => changeMode(true)}
              >
                <Code2 aria-hidden />
                {m.workbench_advanced()}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.workbench_undo()}
                title={m.workbench_undo()}
                disabled={!controller.canUndo}
                onClick={() => controller.undo()}
              >
                <Undo2 aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.workbench_redo()}
                title={m.workbench_redo()}
                disabled={!controller.canRedo}
                onClick={() => controller.redo()}
              >
                <Redo2 aria-hidden />
              </Button>
              <Button
                ref={addField}
                variant="outline"
                size="sm"
                onClick={() => setSheet(true)}
                aria-haspopup="dialog"
                aria-expanded={sheet}
                className="min-[1180px]:hidden"
              >
                <Plus aria-hidden />
                {m.workbench_add_field()}
              </Button>
            </div>
          </div>
          {advanced ? (
            <>
              <div className="mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-serif text-lg font-medium">
                    {m.workbench_advanced_heading()}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => changeMode(false)}
                  >
                    <ArrowLeft aria-hidden />
                    {m.workbench_back_basic()}
                  </Button>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
                  {m.workbench_advanced_lede()}
                </p>
              </div>
              <>
                <AnnotationSectionBar
                  controller={controller}
                  onGo={setReveal}
                />
                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-fd-border bg-fd-card [&_.zt-section-header]:bg-fd-accent/60 [&_.zt-section-header]:shadow-[inset_2px_0_0_0_var(--color-fd-primary)]">
                  <SliceEditor
                    controller={controller}
                    slice="advanced"
                    label={m.workbench_advanced_heading()}
                    extensions={annotationHeaderMark}
                    reveal={reveal}
                    suggest={suggest}
                    onSelection={trackSelection}
                  />
                </div>
              </>
            </>
          ) : (
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              value={tab}
              onValueChange={(value) =>
                openTab(value as "note" | "properties" | "name")
              }
            >
              <TabsList aria-label={m.workbench_title()} className="mb-3">
                {(["note", "properties", "name"] as const).map((id) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className="min-w-0 flex-1 px-2"
                  >
                    {TAB_LABEL[id]()}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={tab} className="flex min-h-0 flex-1 flex-col">
                <h2 className="sr-only">{TAB_LABEL[tab]()}</h2>
                <p className="mb-3 text-sm leading-relaxed text-fd-muted-foreground">
                  {TAB_LEDE[tab]()}
                </p>
                {tab === "name" ? (
                  <>
                    <NameFolderPane
                      onOpenSource={() => changeMode(true)}
                      controller={controller}
                      manifest={shownManifest}
                      filename={result?.filename ?? null}
                      citationStyles={citationStyles}
                      focus={focusField}
                      suggest={suggest}
                      {...(connection.state === "connected"
                        ? { defaults: connection.profileDefaults }
                        : {})}
                      reveal={reveal}
                      onSelection={trackSelection}
                    />
                  </>
                ) : tab === "properties" ? (
                  <>
                    {entries === null ? (
                      <p className="text-sm text-fd-muted-foreground">
                        {m.workbench_properties_source_only()}
                        <Button
                          variant="outline"
                          className="mt-3"
                          onClick={() => changeMode(true)}
                        >
                          {m.workbench_open_source()}
                        </Button>
                      </p>
                    ) : (
                      <PropertiesPane
                        suggest={suggest}
                        controller={controller}
                        entries={entries}
                        properties={result?.properties ?? []}
                        fold={result?.fold ?? []}
                        diagnostics={rowProblems}
                        selected={row}
                        onSelect={setOpenRow}
                        reveal={reveal}
                        onSelection={trackSelection}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <NotePane
                      controller={controller}
                      reveal={reveal}
                      highlight={highlight}
                      suggest={suggest}
                      preview={result?.annotation ?? null}
                      formatProblem={
                        formatProblem ? diagnosticText(formatProblem) : null
                      }
                      count={sample.roots.annotations.length}
                      onSelection={trackSelection}
                      onOpenHighlight={openHighlight}
                      onOpenSource={openSource}
                      onEmphasis={setEmphasis}
                      onEditing={setNoteEditor}
                    />
                    {controller.noteRegions.annotationCalls.length === 0 && (
                      <AnnotationPointer onInsert={insertHighlights} />
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
          <Dialog open={sheet} onOpenChange={setSheet}>
            <DialogContent
              finalFocus={addField}
              className="h-[min(42rem,85dvh)]"
            >
              <div className="flex items-center justify-between gap-3">
                <DialogTitle>{m.workbench_add_field()}</DialogTitle>
                <DialogClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.workbench_fields_close()}
                    />
                  }
                >
                  <X aria-hidden />
                </DialogClose>
              </div>
              <FieldList
                key={`${root}:${fieldMode}`}
                root={root}
                mode={fieldMode}
                disabled={fieldDisabled}
                data={fields}
                onInsert={insert}
              />
            </DialogContent>
          </Dialog>
        </section>

        <section
          id="workbench-result-pane"
          className={`min-h-80 min-w-0 flex-1 flex-col min-[780px]:min-h-0 ${
            view === "result" ? "flex" : "hidden min-[780px]:flex"
          }`}
        >
          <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-medium">
              {!advanced && tab === "properties"
                ? m.workbench_result_fold()
                : m.workbench_result_heading()}
            </h2>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">{m.workbench_preview_format()}</span>
              <NativeSelect
                value={showMarkdown ? "markdown" : "reading"}
                onChange={(event) =>
                  setShowMarkdown(event.target.value === "markdown")
                }
                size="sm"
              >
                <NativeSelectOption value="reading">
                  {m.workbench_preview_reading()}
                </NativeSelectOption>
                <NativeSelectOption value="markdown">
                  {m.workbench_result_markdown_toggle()}
                </NativeSelectOption>
              </NativeSelect>
            </label>
          </div>
          {showNote && (
            <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fd-muted-foreground">
                {m.workbench_preview_show()}
              </span>
              <NativeSelect
                value={showManaged ? "managed" : "whole"}
                onChange={(event) =>
                  setShowManaged(event.target.value === "managed")
                }
                size="sm"
              >
                <NativeSelectOption value="whole">
                  {m.workbench_preview_whole()}
                </NativeSelectOption>
                <NativeSelectOption value="managed">
                  {m.workbench_result_managed_toggle()}
                </NativeSelectOption>
              </NativeSelect>
            </label>
          )}
          <p className="mb-3 text-sm leading-relaxed text-fd-muted-foreground">
            {showManaged
              ? m.workbench_result_managed_lede()
              : m.workbench_result_lede()}
          </p>
          {result && !renderable && (
            <p role="status" className="mb-3 text-sm font-medium">
              {m.workbench_preview_stale()}
            </p>
          )}
          <div
            role="region"
            tabIndex={0}
            aria-label={m.workbench_view_result()}
            ref={resultRegion}
            data-emphasis={emphasis || undefined}
            className="group min-h-0 flex-1 overflow-auto rounded-md border border-fd-border bg-fd-card p-4 shadow-sm sm:p-6"
          >
            {result ? (
              <>
                <p className="mb-4 font-mono text-xs break-words text-fd-muted-foreground">
                  <span className="sr-only">
                    {m.workbench_result_filename()}:{" "}
                  </span>
                  {result.filename}
                </p>
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
                {showNote && showManaged ? (
                  result.managedRegion === null ? (
                    <p className="text-sm text-fd-muted-foreground">
                      {m.workbench_result_managed_none()}
                    </p>
                  ) : (
                    <ResultSheet
                      markdown={result.managedRegion}
                      properties={[]}
                      showMarkdown={showMarkdown}
                    />
                  )
                ) : !advanced && tab === "properties" ? (
                  <PropertiesResult
                    entries={entries ?? []}
                    properties={result.properties}
                    fold={result.fold}
                    frontmatterBlock={result.frontmatterBlock}
                    showMarkdown={showMarkdown}
                  />
                ) : (
                  <ResultSheet
                    markdown={result.creationBody ?? ""}
                    // The sheet is the note, so its list is the fold every
                    // entry merged into, not each entry's own contribution.
                    properties={result.fold}
                    showMarkdown={showMarkdown}
                    marks={result.annotationRanges}
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
