// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get. It folds twice:
// under 1180 px the field column becomes the dialog the toolbar "Add a field"
// button opens, and under 780 px the pane fills the screen with the result
// behind a view switch.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import type { Layer } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
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
import type { ReactNode } from "react";

import { entryPosition, entrySlice } from "@zotlit/workbench/document";
import type {
  WorkbenchProblem,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  currentCallSite,
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import type {
  RenderDiagnostic,
  WorkbenchReportContext,
} from "@zotlit/workbench/render";
import { MatchPane } from "@zotlit/workbench/ui";
import {
  EditToolbar,
  ProblemsFooter,
  WorkbenchDiagnosticsProvider,
  tabLabel,
  tabLede,
  TabBar,
  TabPanel,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  setAdvanced as setViewAdvanced,
  setTab as setViewTab,
  diagnosticText,
  fieldSnippet,
  problemText,
  renderDiagnosis,
  useParts,
  useWorkbenchProblems,
  workbenchDiagnoses,
  AnnotationPane,
  AnnotationPointer,
  AnnotationSampleBar,
  AnnotationSectionBar,
  annotationSamples,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  SliceEditor,
} from "@zotlit/workbench/ui";
import type {
  WorkbenchTab,
  EntryDiagnostic,
  WorkbenchDiagnosis,
  WorkbenchHost,
  WorkbenchInsertTarget,
} from "@zotlit/workbench/ui";

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
import {
  AddFieldButton,
  ProfileMenuLabel,
  WorkbenchFrame,
  WorkbenchHelp,
} from "./frame";
import { ProfileHandoff } from "./handoff";
import { useWebHost } from "./host";
import { makeWebPage } from "./page-model";
import type { WebPage, WebWorkbench } from "./page-model";
import { WebPreview } from "./preview";
import { PageRuntime, usePageBridge } from "./runtime";
import type { PageServices } from "./runtime";
import { SampleBar } from "./sample-bar";
import { WEB_THEME } from "./theme";
import {
  downloadProfile,
  profileFileName,
  createProfileHandoffSource,
} from "./transfer";
import { unsupportedDependencies, unsupportedProblems } from "./unsupported";
import { useWorkbenchConnection } from "./use-workbench-connection";
import { useWorkbenchDraft } from "./use-workbench-draft";
import type { ProfileHydration } from "./workbench-connection";

/** The result becomes a column once both reading and editing have room. */
const WIDE_LAYOUT = "(min-width: 780px)";

/** The Workbench on a page runtime of its own, which closing the page disposes. */
export function Workbench({
  layer,
}: {
  /** The page's services; tests hand a layer over fakes. */
  layer?: Layer.Layer<PageServices>;
}) {
  return (
    <PageRuntime layer={layer}>
      <WorkbenchPage />
    </PageRuntime>
  );
}

/** Where the host inserts, read from the editor at the moment it asks. */
interface EditorReads {
  insertTarget: () => WorkbenchInsertTarget | null;
}

/** The page's atoms, its host, and the one editor they serve. */
function WorkbenchPage() {
  const bridge = usePageBridge();
  const [page] = useState(() => makeWebPage(bridge));
  const sample = useAtomValue(page.chosen);
  // The editor's caret, read when the host asks for it.
  const reads = useRef<EditorReads>({ insertTarget: () => null });
  const { host, overlays } = useWebHost({
    snapshot: sample,
    notice: (text) => toast.add({ title: text, type: "info" }),
    insertTarget: () => reads.current.insertTarget(),
  });
  const workbench = useAtomValue(page.workbench);
  return (
    <WorkbenchSession
      page={page}
      workbench={workbench}
      host={host}
      overlays={overlays}
      reads={reads.current}
    />
  );
}

function WorkbenchSession({
  page,
  workbench,
  host,
  overlays,
  reads,
}: {
  page: WebPage;
  workbench: WebWorkbench;
  host: WorkbenchHost;
  overlays: ReactNode;
  reads: EditorReads;
}) {
  const { editor, model, show, chooseAnnotation } = workbench;
  const registry = editor.registry;
  const controller = useAtomValue(model.controller);
  const revision = useAtomValue(model.document.revision);
  const sample = useAtomValue(page.chosen);
  const read = useAtomValue(page.read);
  const retained = useAtomValue(page.retained);
  // The paper's data is restored the way the renderer restores it, so the
  // field list waits for the same read the render does.
  const ready = AsyncResult.isSuccess(read);
  const readSample = Option.getOrNull(AsyncResult.value(read));
  const fileInput = useRef<HTMLInputElement>(null);
  // Where the sheet was opened from, so closing it hands the keyboard back.
  const addField = useRef<HTMLButtonElement>(null);
  const { result, trigger, attempt } = useAtomValue(model.scheduler.state);
  const { current: itemAnnotations, example: selectedAnnotation } =
    useAtomValue(workbench.annotations);
  const annotationResult =
    result?.annotationId === selectedAnnotation.id &&
    result.annotationRevision === selectedAnnotation.revision
      ? result
      : null;
  const tab = useAtomValue(model.tab);
  const advanced = useAtomValue(model.advanced);
  const setTab = (next: WorkbenchTab) =>
    registry.update(model.view, setViewTab(next));
  const setAdvanced = (next: boolean) =>
    registry.update(model.view, setViewAdvanced(next));
  const openInObsidianCommand = useAtomSet(workbench.openInObsidian);
  const loadSelectedItem = useAtomSet(workbench.loadItem);
  const fileMessage = useAtomValue(workbench.notice);
  const setFileMessage = workbench.say;
  const shownManifest = useAtomValue(workbench.manifest);
  const { present } = workbench;
  // What the editor reveals, which row is open, and where the caret is: the
  // model's presentation, so every pane reads one place.
  const presentation = useAtomValue(model.view, (state) => state.presentation);
  const openRow = presentation.selected;
  const reveal = presentation.reveal;
  const focusField = presentation.fieldFocus;
  const caret: WorkbenchSliceRange = presentation.selection?.range ?? {
    from: 0,
    to: 0,
  };
  const setOpenRow = (selected: number | null) => present({ selected });
  const setReveal = (next: WorkbenchSliceRange | null) =>
    present({ reveal: next });
  const setFocusField = (fieldFocus: { field: string } | null) =>
    present({ fieldFocus });
  const setCaret = (range: WorkbenchSliceRange) =>
    present({ selection: { slice, range } });
  const importFileCommand = useAtomSet(page.importFile);
  // Which of the two the narrow screen is showing, and whether the field list
  // is open over it. Both are the narrow layout's alone: a wide screen shows
  // the pane, the result, and the field list at once.
  const [view, setView] = useState<"edit" | "result">("edit");
  const [sheet, setSheet] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [handoffSource] = useState(createProfileHandoffSource);
  const replaceConnected = useRef(false);
  const noteCaret = useRef(caret);
  const {
    connection,
    saveTarget,
    resources,
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
    save,
  } = useWorkbenchConnection({
    page,
    onHydrate: openSelectedProfile,
    onSaved: ({ reference, source }) => drafts.rebase({ reference, source }),
  });
  const drafts = useWorkbenchDraft({
    location: page.location,
    controller,
    revision,
    sample,
    annotationSelection: selectedAnnotation.id,
    saveTarget,
  });
  /** The document, language, and paper behind whatever attempt fails next. */
  const reportContext = useCallback(
    (root: string): WorkbenchReportContext => ({
      document: drafts.location.reference,
      language: controller.language,
      root,
      selection: sample.item.indexedKey,
      ...(connection.state === "connected"
        ? { zotlitVersion: connection.pluginVersion }
        : {}),
    }),
    [connection, drafts.location.reference, controller, sample],
  );
  reads.insertTarget = () => ({ slice, range: caret });

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
            annotationSelection: annotationSamples(
              snapshot,
              selectedAnnotation.id,
            ).example.id,
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
      if (snapshot) show(snapshot);
      // The text on screen still descends from the revision it was read at, so
      // Save answers for that one: the vault moved, this draft did not.
      if (retainedExpected) saveAgainst(retainedExpected);
      return;
    }
    drafts.adopt(opened, replaceConnected.current ? null : kept);
    replaceConnected.current = false;
    loadDocument(selected.source);
    if (snapshot) show(snapshot);
  }

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
  // gets, and the render it never starts (the model's Item data holds the
  // render). A connected bundle is read before any compilation, so a partial
  // the vault holds in Eta refuses the Profile here rather than through a
  // diagnostic the renderer raises mid-render.
  const unsupported = [
    ...unsupportedProblems(controller.problems),
    ...unsupportedDependencies(resources?.dependencies),
  ];

  const manifest = controller.document?.manifest;
  const profile = {
    name: shownManifest?.name ?? m.workbench_title(),
    description: shownManifest?.description ?? "",
  };

  // The paper this Profile is written for is the model's to choose; a type no
  // bundled Item carries leaves the paper on screen, and the header says which
  // type went unanswered.
  const sampleItemType = shownManifest?.sampleItemType;
  const bundledForType = SAMPLE_ITEMS.find(
    (item) => item.item.itemType === sampleItemType,
  );

  // What the editors complete and explain against: every partial this Profile
  // can call, whether the manifest carries it or a connected bundle answers it.
  const partials = useMemo(
    () => [
      ...(shownManifest?.partials ?? []).map(({ name }) => name),
      ...(resources?.dependencies.templates ?? []).map(({ name }) => name),
    ],
    [shownManifest, resources],
  );

  const diagnoses = workbenchDiagnoses(
    controller.problems,
    result?.diagnostics ?? [],
  );
  const problems = useWorkbenchProblems({
    diagnoses,
    trigger,
    attempt,
    // A parser problem never reached a render, so the area captures its report
    // itself, naming this Workbench the way a failed render's report does.
    capture: {
      messages: m,
      source: controller.source,
      context: () =>
        reportContext(
          !advanced && tab === "annotation" ? "annotation" : "note",
        ),
    },
  });
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
    if (id === "filename" || id === "details") {
      setTab(
        id === "details" &&
          [
            "name",
            "description",
            "version",
            "author",
            "sampleItemType",
            "language",
          ].includes(problem.params?.field ?? "")
          ? "profile"
          : "name",
      );
    }
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

  /**
   * Reads one problem the result named. The explanation belongs to the editor,
   * so a narrow screen showing the result switches to it rather than leaving
   * the reader on a control whose answer is in the other view.
   */
  function showProblem(id: string | null) {
    setView("edit");
    if (id === null) problems.setOpen(true);
    else problems.select(id);
  }

  /**
   * Hands the reader the template back where they left it. Every pane reports
   * its selection as the reader moves through it, so returning is revealing
   * that place again — with the caret and the focus that go with it.
   */
  function returnToTemplate() {
    setView("edit");
    setReveal({ ...caret });
  }

  /** The pane one selected problem is repaired in, whichever kind it is. */
  function openDiagnosis(diagnosis: WorkbenchDiagnosis) {
    if (diagnosis.kind === "document") {
      goToProblem(diagnosis.problem);
      return;
    }
    const { part, position, callSite, sourceSite } = diagnosis.diagnostic;
    // A verified call outranks the part the engine reported the failure under:
    // a failure inside a called template is repaired where it was called.
    if (callSite || sourceSite) {
      const current = currentCallSite(diagnosis.diagnostic, controller);
      if (current === undefined) {
        toast.add({
          title: m.workbench_problems_location_unknown(),
          type: "info",
        });
        return;
      }
      // The pane whose own region holds the call; Advanced holds whatever no
      // editing pane covers.
      const slice =
        (["note", "annotation", "filename"] as const).find((id) => {
          const region = controller.sliceRange(id);
          return region.from <= current.from && current.from < region.to;
        }) ?? "advanced";
      setView("edit");
      setAdvanced(slice === "advanced");
      if (slice !== "advanced") setTab(slice === "filename" ? "name" : slice);
      setReveal({ ...current });
      return;
    }
    if (position !== undefined) {
      goToEntry(position);
      return;
    }
    if (part === "annotation") {
      openAnnotation();
      return;
    }
    // The note name is repaired in its own tab, whether or not the failure
    // named a place inside it. The pane takes the caret with the reveal, so
    // the reader goes on typing where the Problems area left them.
    if (part === "filename") {
      setView("edit");
      setAdvanced(false);
      setTab("name");
      const slice = controller.sliceRange("filename");
      setReveal({ from: slice.from, to: slice.from });
      return;
    }
    setView("edit");
    setAdvanced(true);
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

  function insertAnnotations() {
    const { repaired, caret } = controller.insertAnnotationLoop();
    setReveal({ from: caret, to: caret });
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
  const fieldMode: "template" | "expression" | "json-e" =
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
    if (!ready) return null;
    const data = rootData(sample, "annotation", selectedAnnotation)!;
    data.citation = annotationResult?.annotationCitation ?? null;
    return data;
  }, [ready, sample, selectedAnnotation, annotationResult?.annotationCitation]);
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
    const data = !ready
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

  const insertion = useRef({ insert, mode: fieldMode });
  insertion.current = { insert, mode: fieldMode };
  const insertNode = useCallback((node: DisplayNode) => {
    const current = insertion.current;
    current.insert(fieldSnippet(node, current.mode));
  }, []);

  function trackSelection(selection: WorkbenchSliceRange) {
    setCaret(selection);
  }

  /** Opens `source` as the document being edited, with a history of its own. */
  function loadDocument(source: string) {
    workbench.load(source);
    setFileMessage(null);
    setAdvanced(false);
    setView("edit");
    setSheet(false);
    setTab("note");
    setOpenRow(null);
    setReveal(null);
    noteCaret.current = { from: 0, to: 0 };
    setCaret(noteCaret.current);
  }

  function openInObsidian() {
    openInObsidianCommand(handoffSource(controller.source));
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
    importFileCommand({
      file,
      read: (source) =>
        replaceProfile(m.workbench_import(), () => openStandalone(source)),
      failed: () => setFileMessage(m.workbench_import_failed()),
    });
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
          onOpenInObsidian={openInObsidian}
          onImport={openFile}
          onUndo={controller.canUndo ? () => controller.undo() : undefined}
          message={fileMessage}
        />
      </>
    );
  }

  const frame = (
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
              <DropdownMenuItem onClick={openInObsidian}>
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
            onClick={canSaveToVault ? () => save(controller.source) : download}
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
          onDisconnect={disconnect}
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
                    if (kept.snapshot) show(kept.snapshot);
                    if (kept.annotationSelection)
                      chooseAnnotation(kept.annotationSelection);
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
          root={root}
          sample={readSample}
          annotation={selectedAnnotation}
          citation={annotationResult?.annotationCitation}
          ready={ready}
          mode={fieldMode}
          disabled={fieldDisabled}
          onInsertNode={insertNode}
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
          {/* Everything the reader edits, as one region. A reading that takes
              the whole pane leaves it no height, and it shows nothing rather
              than spilling its tabs and source over the explanation. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
              <TabPanel tab="note" description={!advanced}>
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
                      onSelect={chooseAnnotation}
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
              <TabPanel tab="match" modeActive={!advanced}>
                <h2 className="sr-only">{tabLabel(m, "match")}</h2>
                <MatchPane
                  controller={controller}
                  vocabularyRevision={sample.revision}
                />
              </TabPanel>
              <TabPanel tab="annotation" modeActive={!advanced}>
                <h2 className="sr-only">{tabLabel(m, "annotation")}</h2>
                {formatProblem && (
                  <AnnotationProblemMarker
                    diagnostic={formatProblem}
                    onShow={showProblem}
                  />
                )}
                <AnnotationPane
                  controller={controller}
                  reveal={reveal}
                  suggest={suggest}
                  problem={
                    formatProblem ? diagnosticText(m, formatProblem) : null
                  }
                  onSelection={trackSelection}
                />
              </TabPanel>
              {(["name", "profile"] as const).map((section) => (
                <TabPanel key={section} tab={section} modeActive={!advanced}>
                  <h2 className="sr-only">{tabLabel(m, section)}</h2>
                  <NameFolderPane
                    section={section}
                    onOpenSource={() => setAdvanced(true)}
                    controller={controller}
                    manifest={shownManifest}
                    filename={result?.filename ?? null}
                    notePath={result?.notePath ?? null}
                    citationStyles={citationStyles}
                    focus={focusField}
                    suggest={suggest}
                    {...(connection.state === "connected"
                      ? { defaults: connection.profileDefaults }
                      : {})}
                    reveal={reveal}
                    onSelection={trackSelection}
                    onShowProblem={showProblem}
                  />
                </TabPanel>
              ))}
              <TabPanel tab="properties" modeActive={!advanced}>
                <h2 className="sr-only">{tabLabel(m, "properties")}</h2>
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
                    onShowProblem={showProblem}
                  />
                )}
              </TabPanel>
            </div>
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
                root={root}
                sample={readSample}
                annotation={selectedAnnotation}
                citation={annotationResult?.annotationCitation}
                ready={ready}
                mode={fieldMode}
                disabled={fieldDisabled}
                onInsertNode={insertNode}
              />
            </DialogContent>
          </Dialog>
        </>
      }
      result={
        <WebPreview
          annotations={{
            current: itemAnnotations,
            example: selectedAnnotation,
          }}
          onAnnotationChoice={chooseAnnotation}
          mode={showAnnotation ? "annotation" : "note"}
          onShowProblem={showProblem}
          sampleBar={
            <SampleBar
              sample={sample}
              retained={retained}
              connection={connection}
              {...(sampleItemType !== undefined && !bundledForType
                ? { unmatchedItemType: sampleItemType }
                : {})}
              busy={itemBusy}
              onShow={show}
              onLoad={loadSelectedItem}
            />
          }
        />
      }
      problems={
        <ProblemsFooter
          problems={problems}
          onOpen={openDiagnosis}
          onReturn={returnToTemplate}
        />
      }
    >
      {filePicker}
      {replacementDialog}
      {overlays}
    </WorkbenchFrame>
  );
  return (
    <WorkbenchThemeProvider theme={WEB_THEME}>
      <WorkbenchHostProvider host={host}>
        <WorkbenchDiagnosticsProvider
          value={problems.diagnoses}
          onReveal={showProblem}
        >
          <WorkbenchEditorProvider editor={editor}>
            {frame}
          </WorkbenchEditorProvider>
        </WorkbenchDiagnosticsProvider>
      </WorkbenchHostProvider>
    </WorkbenchThemeProvider>
  );
}

function AnnotationProblemMarker({
  diagnostic,
  onShow,
}: {
  diagnostic: RenderDiagnostic;
  onShow: (id: string) => void;
}) {
  const part = useParts("resultColumn");
  return (
    <button
      type="button"
      {...part("problem-open")}
      onClick={() => onShow(renderDiagnosis(diagnostic).id)}
    >
      {m.workbench_problem_show()}
    </button>
  );
}
