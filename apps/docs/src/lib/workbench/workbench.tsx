import {
  ArrowLeft,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get. It folds twice:
// under 1180 px the field column becomes the dialog the toolbar "Add a field"
// button opens, and under 780 px the pane fills the screen with the result
// behind a view switch.
import { useStore } from "zustand";

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
import { snapshotMatchFacts } from "@zotlit/workbench/match";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import { MatchPane } from "@zotlit/workbench/ui";
import {
  EditToolbar,
  StartHere,
  ProblemsFooter,
  PreviewControls,
  ResultColumn,
  tabLabel,
  tabLede,
  TabBar,
  TabPanel,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  createRenderScheduler,
  createWorkbenchStore,
  useRenderState,
  diagnosticText,
  problemText,
  AnnotationPane,
  AnnotationPointer,
  AnnotationSampleBar,
  AnnotationSectionBar,
  annotationSamples,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  PropertiesResult,
  SliceEditor,
} from "@zotlit/workbench/ui";
import type { WorkbenchTab, EntryDiagnostic } from "@zotlit/workbench/ui";

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
import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import { annotationHeaderMark } from "./annotation-mark";
import { ConnectionBar, ConnectionNotice } from "./connection-bar";
import { FieldList } from "./field-list";
import { insertSnippet, rootData, templateRootAt } from "./fields";
import type { SampleItem } from "./fields";
import {
  AddFieldButton,
  ProfileMenuLabel,
  WorkbenchFrame,
  WorkbenchHelp,
} from "./frame";
import { ProfileHandoff } from "./handoff";
import { useWebHost } from "./host";
import { renderInThread } from "./render";
import { SampleBar } from "./sample-bar";
import { ensureTemporal } from "./temporal";
import { WEB_THEME } from "./theme";
import {
  downloadProfile,
  profileFileName,
  openProfileInObsidian,
  createProfileHandoffSource,
} from "./transfer";
import { unsupportedDependencies, unsupportedProblems } from "./unsupported";
import { useWorkbenchConnection } from "./use-workbench-connection";
import type { ProfileHydration } from "./use-workbench-connection";
import { DEFAULT_SAMPLE, useWorkbenchDraft } from "./use-workbench-draft";

/** The result becomes a column once both reading and editing have room. */
const WIDE_LAYOUT = "(min-width: 780px)";

export function Workbench() {
  const [controller, setController] = useState(
    () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  // Where the sheet was opened from, so closing it hands the keyboard back.
  const addField = useRef<HTMLButtonElement>(null);
  // The view state the shared tree reads and writes: the tab strip and the
  // toolbar change it, and what a change does beyond the store is below.
  const [store] = useState(createWorkbenchStore);
  // The one Render Scheduler this editor instance renders through; the page
  // hands it the paper, the annotation example, and the connected bundle.
  const [scheduler] = useState(() =>
    createRenderScheduler({
      render: renderInThread,
      failed: (failure) => failure,
      controller,
      store,
    }),
  );
  const {
    result,
    busy: renderBusy,
    stale: resultStale,
  } = useRenderState(scheduler);
  const [revision, setRevision] = useState(0);
  const [sample, setSample] = useState<SampleItem>(DEFAULT_SAMPLE);
  const [annotationChoice, setAnnotationChoice] = useState<string | null>(null);
  const { current: itemAnnotations, example: selectedAnnotation } = useMemo(
    () => annotationSamples(sample, annotationChoice),
    [sample, annotationChoice],
  );
  useEffect(
    () => setAnnotationChoice(selectedAnnotation.id),
    [selectedAnnotation.id],
  );
  const annotationResult =
    result?.annotationId === selectedAnnotation.id &&
    result.annotationRevision === selectedAnnotation.revision
      ? result
      : null;
  const tab = useStore(store, (state) => state.tab);
  const advanced = useStore(store, (state) => state.advanced);
  const { setTab, setAdvanced } = store.getState();
  // Which of the two the narrow screen is showing, and whether the field list
  // is open over it. Both are the narrow layout's alone: a wide screen shows
  // the pane, the result, and the field list at once.
  const [view, setView] = useState<"edit" | "result">("edit");
  const [sheet, setSheet] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [reveal, setReveal] = useState<WorkbenchSliceRange | null>(null);
  const latestRevision = useRef(0);
  const [pendingAction, setPendingAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [handoffSource] = useState(createProfileHandoffSource);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const replaceConnected = useRef(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showManaged, setShowManaged] = useState(false);
  // The Name and folder control a manifest problem opens, as a fresh object
  // every time, so selecting the same problem twice opens it again.
  const [focusField, setFocusField] = useState<{ field: string } | null>(null);
  const [caret, setCaret] = useState<WorkbenchSliceRange>({ from: 0, to: 0 });
  const noteCaret = useRef(caret);
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
    resumable,
    itemBusy,
    saveBusy,
    message: connectionMessage,
    reconnect,
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
    annotationSelection: selectedAnnotation.id,
    saveTarget,
  });

  /** Opens the Profile a connection hydrated, with what it kept beside it. */
  function openSelectedProfile({
    selected,
    installationId,
    kept,
    retainedExpected,
    snapshot,
  }: ProfileHydration) {
    const opened = {
      reference: selected.document.reference,
      source: selected.source,
      installationId,
      ...(snapshot
        ? {
            snapshot,
            annotationSelection: annotationSamples(snapshot, annotationChoice)
              .example.id,
          }
        : {}),
    };
    // A connection that comes back to the document already open leaves the text
    // and its undo history where they are: the connection was lost, the work
    // was not. The vault counts as part of that identity, so the same reference
    // read out of another vault is another document and opens as one. The
    // vault's own bytes become the saved state the draft is measured against,
    // so an unsaved edit stays an unsaved edit.
    if (
      drafts.location.reference === opened.reference &&
      drafts.location.installationId === opened.installationId &&
      !replaceConnected.current
    ) {
      drafts.rebase(opened);
      if (snapshot) setSample(snapshot);
      // The text on screen still descends from the revision it was read at, so
      // Save answers for that one: the vault moved, this draft did not.
      if (retainedExpected) saveAgainst(retainedExpected);
      return;
    }
    drafts.adopt(opened, replaceConnected.current ? null : kept);
    replaceConnected.current = false;
    loadDocument(selected.source);
    if (snapshot) setSample(snapshot);
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
  useEffect(() => scheduler.attach(controller), [scheduler, controller]);
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
  // rather than through a diagnostic the renderer raises mid-render.
  const unsupported = [
    ...unsupportedProblems(controller.problems),
    ...unsupportedDependencies(resources?.dependencies),
  ];
  const refused = unsupported.length > 0;
  // A draft the parser refuses renders as nothing, so the last good result
  // stands beside the Problems strip while the reader repairs it, rather than
  // emptying the sheet and reporting the same parse error twice.
  const renderable = !refused && controller.document !== null;

  useEffect(
    () =>
      // A Profile the web host refuses is never compiled, so nothing renders
      // it, and a bundle read for another draft would render this one against
      // the wrong partials — the last good result stands until its own bundle
      // lands.
      scheduler.setInput({
        snapshot: sample,
        annotation: selectedAnnotation,
        hold: !renderable || resourcesStale,
        ...(resources ? { resources } : {}),
      }),
    [
      scheduler,
      sample,
      selectedAnnotation,
      renderable,
      resources,
      resourcesStale,
    ],
  );

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
    if (bundledForType)
      setSample((held) =>
        held.provenance.kind === "connected" ? held : bundledForType,
      );
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
              message: diagnosticText(m, diagnostic),
            },
          ],
    ),
    ...controller.problems.flatMap((entry) => {
      const position = entryPosition(entry.slice);
      return position === null
        ? []
        : [{ position, message: problemText(m, entry).message }];
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
        : tab === "annotation"
          ? "annotation"
          : "note";
  // The note itself, which is the one result an update rewrites part of, so the
  // update-only Managed Region is offered beside it and nowhere else.
  const showAnnotation = !advanced && tab === "annotation";
  const { host, overlays } = useWebHost({
    snapshot: sample,
    notice: (text) => toast.add({ title: text, type: "info" }),
    insertTarget: () => ({ slice, range: caret }),
  });
  // The render's complaint about the format alone, shown in the annotation box
  // where the format is edited rather than in the result column.
  const formatProblem = annotationResult?.diagnostics.find(
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
    }
    if (id === "annotation" || problem.code === "missing-annotation-section") {
      openAnnotation();
      return;
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

  function openAnnotation() {
    setView("edit");
    setAdvanced(false);
    setTab("annotation");
    const section = controller.annotationSection;
    setReveal(
      section ? { from: section.source.from, to: section.source.from } : null,
    );
  }

  /**
   * Gives a note that calls the format nowhere its call: the loop over every
   * annotation, put where the reader left the caret, so the box opens in the
   * note. A document that also lacks the section is given one first, and told.
   */
  function insertAnnotations() {
    const { repaired } = controller.insertAnnotationLoop(caret);
    // Both edits have told the subscriber by now, so the sentence is stamped
    // with the revision the reader is looking at.
    if (repaired) {
      toast.add({
        title: m.workbench_annotation_section_added(),
        type: "info",
      });
    }
    setView("edit");
    setAdvanced(false);
    setTab("note");
  }

  // The field list follows the pane the reader is in: the annotation box renders
  // one annotation, the note name renders the filename, and every rule and the
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
    (showAnnotation && !controller.annotationSection) ||
    (!advanced &&
      tab === "properties" &&
      (row === null ||
        (selectedProperty !== undefined &&
          "value" in selectedProperty &&
          typeof selectedProperty.value === "string")));
  const annotationData = useMemo(() => {
    if (!temporal) return null;
    const data = rootData(sample, "annotation", selectedAnnotation)!;
    data.citation = annotationResult?.annotationCitation ?? null;
    return data;
  }, [
    temporal,
    sample,
    selectedAnnotation,
    annotationResult?.annotationCitation,
  ]);
  const fields = useMemo(
    () =>
      !temporal
        ? null
        : root === "annotation"
          ? annotationData
          : rootData(sample, root),
    [temporal, sample, root, annotationData],
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
    const data = !temporal
      ? null
      : currentRoot === "annotation"
        ? annotationData
        : rootData(sample, currentRoot);
    return { root: currentRoot, partials, ...(data ? { sample: data } : {}) };
  };

  /** Puts a snippet where the reader left the caret, then hands focus back. */
  const insert = useCallback(
    (snippet: string) => {
      if (fieldDisabled) return;
      const head = insertSnippet(controller, slice, {
        target: caret,
        snippet,
      });
      // The sheet stands over the pane it writes into, so it leaves with the
      // snippet it put there.
      setSheet(false);
      setReveal({ from: head, to: head });
    },
    [fieldDisabled, controller, slice, caret],
  );

  function trackSelection(selection: WorkbenchSliceRange) {
    setCaret(selection);
  }

  /** Opens `source` as the document being edited, with a history of its own. */
  function loadDocument(source: string) {
    setController(new WorkbenchDocumentController(source));
    setFileMessage(null);
    setShownManifest(null);
    setAdvanced(false);
    setView("edit");
    setSheet(false);
    setTab("note");
    setOpenRow(null);
    setReveal(null);
    noteCaret.current = { from: 0, to: 0 };
    setCaret(noteCaret.current);
  }

  async function openInObsidian() {
    try {
      await openProfileInObsidian(handoffSource(controller.source));
      setFileMessage(m.workbench_open_obsidian_copied());
    } catch {
      setFileMessage(m.workbench_open_obsidian_failed());
    }
  }

  /** Download always returns the exact source, including an unfinished draft. */
  function download() {
    downloadProfile(
      controller.source,
      profileFileName(manifest?.id, { draft: controller.document === null }),
    );
    if (!canSaveToVault)
      drafts.rebase({ ...drafts.location, source: controller.source });
    toast.add({ title: m.workbench_download_complete(), type: "success" });
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

  function openTab(id: WorkbenchTab) {
    setReveal(null);
    if (id === "note") setCaret(noteCaret.current);
  }

  function changeMode(source: boolean) {
    setView("edit");
    setReveal(null);
    if (!source && tab === "note") setCaret(noteCaret.current);
  }

  const draft = controller.document === null;
  const connected = connection.state === "connected";
  const canSaveToVault =
    connected &&
    saveTarget?.reference === drafts.location.reference &&
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
        <DialogTitle className="font-sans text-base font-semibold">
          {m.workbench_replace_heading()}
        </DialogTitle>
        <DialogDescription>
          {m.workbench_replace_body({ name: profile.name })}
        </DialogDescription>
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
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
            size="xs"
            onClick={() => {
              const next = pendingAction;
              setPendingAction(null);
              next?.run();
            }}
          >
            {pendingAction?.label}
          </Button>
          <DialogClose render={<Button variant="ghost" size="xs" />}>
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
          onOpenInObsidian={() => void openInObsidian()}
          onImport={openFile}
          onUndo={controller.canUndo ? () => controller.undo() : undefined}
          message={fileMessage}
        />
      </>
    );
  }

  const page = (
    <WorkbenchFrame
      name={profile.name}
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={connectionBusy || saveBusy}
              render={<Button variant="outline" size="xs" />}
            >
              <ProfileMenuLabel />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" size="xs">
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
              <DropdownMenuItem onClick={() => void openInObsidian()}>
                <ExternalLink aria-hidden />
                {m.workbench_open_obsidian()}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={download}>
                <Download aria-hidden />
                {m.workbench_download_copy()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="xs"
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
        </>
      }
      connection={
        <ConnectionBar
          connection={connection}
          website={window.location.origin}
          busy={connectionBusy}
          resumable={resumable}
          saveBusy={saveBusy}
          editingConnectedProfile={canSaveToVault}
          onReconnect={() => {
            // Reconnecting the current vault document preserves its draft and history.
            if (saveTarget?.reference === drafts.location.reference)
              reconnect();
            else replaceProfile(m.workbench_connection_reconnect(), reconnect);
          }}
          onDisconnect={() => void disconnect()}
        />
      }
      notifications={
        <ConnectionNotice
          connection={connection}
          message={fileMessage ?? connectionMessage}
        />
      }
      strips={
        <>
          {/* The getting-started lede stands over a page Obsidian opened, and
              over that page alone: a standalone reader has no vault to send a
              template to. */}

          {drafts.restorable && (
            <section
              aria-label={m.workbench_restore_heading()}
              className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-s-2 border-b border-s-fd-primary border-b-fd-border bg-fd-accent/40 px-3 py-2 text-xs leading-normal"
            >
              <p className="font-semibold">{m.workbench_restore_heading()}</p>
              <p className="text-pretty text-fd-muted-foreground">
                {m.workbench_restore_body()}
              </p>
              <div className="ms-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    const kept = drafts.restore();
                    if (!kept) return;
                    loadDocument(kept.source);
                    // A tab that closed on a vault paper comes back to the
                    // text alone, so the paper on screen stands.
                    if (kept.snapshot) setSample(kept.snapshot);
                    setAnnotationChoice(kept.annotationSelection ?? null);
                    if (kept.expected) saveAgainst(kept.expected);
                  }}
                >
                  {m.workbench_restore_accept()}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => drafts.startClean()}
                >
                  {m.workbench_restore_decline()}
                </Button>
              </div>
            </section>
          )}
        </>
      }
      status={
        canSaveToVault
          ? draft
            ? m.workbench_save_fix()
            : drafts.dirty
              ? m.workbench_unsaved()
              : m.workbench_saved_profile()
          : m.workbench_browser_draft()
      }
      view={view}
      onView={(next) => {
        setView(next);
        setSheet(false);
      }}
      fields={
        <FieldList
          key={`${root}:${fieldMode}`}
          root={root}
          mode={fieldMode}
          disabled={fieldDisabled}
          data={fields}
          onInsert={insert}
        />
      }
      editor={
        <>
          <EditToolbar onModeChange={changeMode}>
            <AddFieldButton
              ref={addField}
              open={sheet}
              onClick={() => setSheet(true)}
            />
          </EditToolbar>
          <StartHere connected={connected} />
          {advanced && (
            <>
              <div className="mb-2 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-xs font-semibold">
                    {m.workbench_advanced_heading()}
                  </h2>
                  <WorkbenchHelp title={m.workbench_advanced_heading()}>
                    {m.workbench_advanced_lede()}
                  </WorkbenchHelp>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setAdvanced(false)}
                >
                  <ArrowLeft aria-hidden />
                  {m.workbench_back_basic()}
                </Button>
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
          )}
          <div
            hidden={advanced}
            className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
          >
            <div className="mb-2 flex shrink-0 items-center gap-1">
              <TabBar onTabChange={openTab} />
              <WorkbenchHelp title={tabLabel(m, tab)}>
                {tabLede(m, tab)}
              </WorkbenchHelp>
            </div>
            <TabPanel tab="note" keepMounted>
              <h2 className="sr-only">{m.workbench_tab_note()}</h2>
              <NotePane
                controller={controller}
                reveal={!advanced && tab === "note" ? reveal : null}
                suggest={suggest}
                preview={annotationResult?.annotation ?? null}
                annotationSelector={
                  <AnnotationSampleBar
                    id="workbench-inline-annotation-sample"
                    current={itemAnnotations}
                    example={selectedAnnotation}
                    onSelect={setAnnotationChoice}
                  />
                }
                formatProblem={
                  formatProblem ? diagnosticText(m, formatProblem) : null
                }
                onSelection={(selection) => {
                  noteCaret.current = selection;
                  if (!advanced && tab === "note") trackSelection(selection);
                }}
                onOpenAnnotation={openAnnotation}
              />
              {controller.noteRegions.annotationCalls.length === 0 && (
                <AnnotationPointer onInsert={insertAnnotations} />
              )}
            </TabPanel>
            {!advanced && tab !== "note" && (
              <TabPanel tab={tab}>
                <h2 className="sr-only">{tabLabel(m, tab)}</h2>
                {tab === "name" ? (
                  <>
                    <NameFolderPane
                      onOpenSource={() => setAdvanced(true)}
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
                ) : tab === "match" ? (
                  <MatchPane
                    controller={controller}
                    facts={snapshotMatchFacts(sample)}
                    vocabularyRevision={sample.revision}
                  />
                ) : tab === "annotation" ? (
                  <AnnotationPane
                    controller={controller}
                    reveal={reveal}
                    suggest={suggest}
                    problem={
                      formatProblem ? diagnosticText(m, formatProblem) : null
                    }
                    onSelection={trackSelection}
                  />
                ) : tab === "properties" ? (
                  <>
                    {entries === null ? (
                      <p className="text-xs leading-normal text-pretty text-fd-muted-foreground">
                        {m.workbench_properties_source_only()}
                        <Button
                          variant="outline"
                          size="xs"
                          className="mt-2"
                          onClick={() => setAdvanced(true)}
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
                ) : null}
              </TabPanel>
            )}
          </div>
          <Dialog open={sheet} onOpenChange={setSheet}>
            <DialogContent
              finalFocus={addField}
              className="h-[min(42rem,85dvh)]"
            >
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="font-sans text-base font-semibold">
                  {m.workbench_add_field()}
                </DialogTitle>
                <DialogClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
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
        </>
      }
      result={
        <>
          <div className={showAnnotation ? "hidden" : "contents"}>
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
          {showAnnotation && (
            <AnnotationSampleBar
              current={itemAnnotations}
              example={selectedAnnotation}
              onSelect={setAnnotationChoice}
            />
          )}
          <PreviewControls
            busy={renderBusy}
            disabled={!renderable || resourcesStale}
            onRun={() => scheduler.run()}
            onStop={() => scheduler.pause()}
          />
          <ResultColumn
            result={result}
            annotationResult={annotationResult}
            mode={
              showAnnotation
                ? "annotation"
                : !advanced && tab === "properties"
                  ? "properties"
                  : "note"
            }
            stale={resultStale}
            showMarkdown={showMarkdown}
            onShowMarkdown={setShowMarkdown}
            showManaged={showManaged}
            onShowManaged={setShowManaged}
            openAnnotation={openAnnotation}
            goToEntry={goToEntry}
            openSource={() => setAdvanced(true)}
            propertiesResult={
              result && (
                <PropertiesResult
                  entries={entries ?? []}
                  properties={result.properties}
                  fold={result.fold}
                  frontmatterBlock={result.frontmatterBlock}
                  showMarkdown={showMarkdown}
                />
              )
            }
            help={
              <WorkbenchHelp title={m.workbench_result_heading()}>
                {showAnnotation
                  ? m.workbench_annotation_lede()
                  : showManaged
                    ? m.workbench_result_managed_lede()
                    : m.workbench_result_lede()}
              </WorkbenchHelp>
            }
          />
        </>
      }
      footer={<ProblemsFooter problem={problem ?? null} onOpen={goToProblem} />}
    >
      {filePicker}
      {replacementDialog}
      {overlays}
    </WorkbenchFrame>
  );
  return (
    <WorkbenchThemeProvider theme={WEB_THEME}>
      <WorkbenchHostProvider host={host}>
        <WorkbenchEditorProvider
          store={store}
          controller={controller}
          scheduler={scheduler}
        >
          {page}
        </WorkbenchEditorProvider>
      </WorkbenchHostProvider>
    </WorkbenchThemeProvider>
  );
}
