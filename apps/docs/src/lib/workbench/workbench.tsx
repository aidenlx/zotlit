// The standalone Template Workbench: one master Profile document behind a
// header, in three columns: the fields, the pane, and the result the reader
// would get, as the Template Workbench View in Obsidian lays them out.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import type { Layer } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  PanelLeft,
  PanelRight,
  Save,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { entrySlice } from "@zotlit/workbench/document";
import type {
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { RenderDiagnostic } from "@zotlit/workbench/render";
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
  patch,
  setAdvanced as setViewAdvanced,
  setTab as setViewTab,
  diagnosticText,
  entryDiagnostics,
  fieldSnippet,
  renderDiagnosis,
  routeDiagnosis,
  routeProblem,
  useParts,
  useWorkbenchProblems,
  workbenchDiagnoses,
  AnnotationPane,
  AnnotationPointer,
  AnnotationSampleBar,
  AnnotationSectionBar,
  NameFolderPane,
  NotePane,
  PropertiesPane,
  SliceEditor,
  SidePanels,
  showPanel,
} from "@zotlit/workbench/ui";
import type {
  PanelSide,
  ViewSize,
  WorkbenchTab,
  WorkbenchDiagnosis,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchViewState,
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
import { ProfileMenuLabel, WorkbenchFrame, WorkbenchHelp } from "./frame";
import { ProfileHandoff } from "./handoff";
import { useWebHost } from "./host";
import { makeWebPage } from "./page-model";
import type {
  PageLayout,
  Replacement,
  WebPage,
  WebWorkbench,
} from "./page-model";
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

/** The result becomes a column once both reading and editing have room. */

/** The Workbench on a page runtime of its own, which closing the page disposes. */
export function Workbench({
  layer,
  viewSize,
}: {
  /** The page's services; tests hand a layer over fakes. */
  layer?: Layer.Layer<PageServices>;
  /**
   * The frame's size, which places the side panels. Tests hand one, since
   * their document lays nothing out; the page otherwise measures its frame.
   */
  viewSize?: Atom.Atom<ViewSize | null>;
}) {
  return (
    <PageRuntime layer={layer}>
      <WorkbenchPage viewSize={viewSize} />
    </PageRuntime>
  );
}

/** Where the host inserts, read from the editor at the moment it asks. */
interface EditorReads {
  insertTarget: () => WorkbenchInsertTarget | null;
}

/** The page's atoms, its host, and the one editor they serve. */
function WorkbenchPage({
  viewSize,
}: {
  viewSize: Atom.Atom<ViewSize | null> | undefined;
}) {
  const bridge = usePageBridge();
  const [page] = useState(() => makeWebPage(bridge, viewSize));
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
  const sample = useAtomValue(page.chosen);
  const read = useAtomValue(page.read);
  const retained = useAtomValue(page.retained);
  // The paper's data is restored the way the renderer restores it, so the
  // field list waits for the same read the render does.
  const ready = AsyncResult.isSuccess(read);
  const readSample = Option.getOrNull(AsyncResult.value(read));
  const fileInput = useRef<HTMLInputElement>(null);
  const { result, trigger, attempt } = useAtomValue(model.scheduler.state);
  const { current: itemAnnotations, example: selectedAnnotation } =
    useAtomValue(model.examples);
  const annotationResult = useAtomValue(model.annotationResult);
  const tab = useAtomValue(model.tab);
  const advanced = useAtomValue(model.advanced);
  const setTab = (next: WorkbenchTab) =>
    registry.update(model.view, setViewTab(next));
  const setAdvanced = (next: boolean) =>
    registry.update(model.view, setViewAdvanced(next));
  const openInObsidianCommand = useAtomSet(workbench.openInObsidian);
  const loadSelectedItem = useAtomSet(workbench.loadItem);
  const fileMessage = useAtomValue(workbench.notice);
  // The last manifest that parsed, so repairing a draft blanks neither the
  // header nor the Name and folder form.
  const shownManifest = useAtomValue(model.document.manifest);
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
  const setCaret = (range: WorkbenchSliceRange) =>
    present({ selection: { slice, range } });
  const importFileCommand = useAtomSet(workbench.importFile);
  const save = useAtomSet(workbench.save);
  const { drafts, layout: layoutAtom } = workbench;
  const panels = useAtomValue(model.panels);
  const togglePanel = (side: PanelSide) =>
    registry.update(model.panels, (state) =>
      showPanel(side, !state[side].shown)(state),
    );
  // The frame's content box is the view the panels share. A frame laid out
  // at no size, such as one in a hidden tab, keeps the size it last had.
  const { viewSize } = page;
  const measureFrame = useCallback(
    (main: HTMLElement | null) => {
      const view = main?.ownerDocument.defaultView;
      if (!main || !view || !Atom.isWritable(viewSize)) return;
      const observer = new view.ResizeObserver(([entry]) => {
        const { width, height } = entry!.contentRect;
        if (width > 0 && height > 0)
          registry.set(viewSize, {
            width: Math.round(width),
            height: Math.round(height),
          });
      });
      observer.observe(main);
      return () => observer.disconnect();
    },
    [registry, viewSize],
  );
  const dirty = useAtomValue(drafts.dirty);
  const restorable = useAtomValue(drafts.restorable);
  const location = useAtomValue(page.location);
  const layout = useAtomValue(layoutAtom);
  const { pending } = layout;
  const arrange = (changes: Partial<PageLayout>) =>
    registry.update(layoutAtom, patch<PageLayout>(changes));
  const noteCaret = {
    get current() {
      return registry.get(layoutAtom).noteCaret;
    },
    set current(range: WorkbenchSliceRange) {
      arrange({ noteCaret: range });
    },
  };
  const [handoffSource] = useState(createProfileHandoffSource);
  const {
    connection,
    saveTarget,
    resources,
    citationStyles,
    connectionBusy,
    resumable,
    itemBusy,
    saveBusy,
    message: connectionMessage,
    reconnect,
    disconnect,
  } = useWorkbenchConnection(page);
  reads.insertTarget = () => ({ slice, range: caret });

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
      context: workbench.reportContext,
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
  const rowProblems = entryDiagnostics(
    m,
    result?.diagnostics ?? [],
    controller.problems,
  );
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

  /** Opens the pane a routing transition names, in the model's view state. */
  const route = (
    transition: (state: WorkbenchViewState) => WorkbenchViewState,
  ) => registry.update(model.view, transition);

  /** Reads one problem the result named, in the editor's Problems area. */
  function showProblem(id: string | null) {
    if (id === null) problems.setOpen(true);
    else problems.select(id);
  }

  /**
   * Hands the reader the template back where they left it. Every pane reports
   * its selection as the reader moves through it, so returning is revealing
   * that place again — with the caret and the focus that go with it.
   */
  function returnToTemplate() {
    setReveal({ ...caret });
  }

  /** The pane one selected problem is repaired in, whichever kind it is. */
  function openDiagnosis(diagnosis: WorkbenchDiagnosis) {
    const transition = routeDiagnosis(diagnosis, controller);
    if (transition) route(transition);
    else
      toast.add({
        title: m.workbench_problems_location_unknown(),
        type: "info",
      });
  }

  function openAnnotation() {
    route(routeProblem({ slice: "annotation" }, controller));
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
    const data = rootData(
      sample,
      "annotation",
      selectedAnnotation ?? undefined,
    )!;
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
      drafts.rebase({ ...location, source: controller.source });
    toast.add({ title: m.workbench_download_complete(), type: "success" });
  }

  function importFile(file: File | undefined) {
    if (file) importFileCommand(file);
  }

  function openTab(id: WorkbenchTab) {
    setReveal(null);
    if (id === "note") setCaret(noteCaret.current);
  }

  function changeMode(source: boolean) {
    setReveal(null);
    if (!source && tab === "note") setCaret(noteCaret.current);
  }

  const draft = controller.document === null;
  const connected = connection.state === "connected";
  const canSaveToVault =
    connected &&
    saveTarget?.reference === location.reference &&
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
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) workbench.settle(false);
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
              workbench.settle(true);
            }}
          >
            {m.workbench_replace_download()}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => workbench.settle(true)}
          >
            {pending && replacementLabel(pending)}
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
                onClick={() => workbench.replace({ kind: "default" })}
              >
                <FilePlus2 aria-hidden />
                {m.workbench_start_default()}
              </DropdownMenuItem>
              {connected && (
                <DropdownMenuItem
                  onClick={() => workbench.replace({ kind: "reload" })}
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
          {/* The view actions, as the Obsidian view has them: each shows or
              hides its panel, wherever the panel goes at this width. */}
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={panels.fields.shown}
            className="aria-pressed:bg-fd-muted"
            onClick={() => togglePanel("fields")}
          >
            <PanelLeft aria-hidden className="rtl:-scale-x-100" />
            {m.workbench_show_fields()}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={panels.preview.shown}
            className="aria-pressed:bg-fd-muted"
            onClick={() => togglePanel("preview")}
          >
            <PanelRight aria-hidden className="rtl:-scale-x-100" />
            {m.workbench_show_preview()}
          </Button>
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
            if (saveTarget?.reference === location.reference) reconnect();
            else workbench.replace({ kind: "reconnect" });
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

          {restorable && (
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
                  onClick={workbench.restoreDraft}
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
            : dirty
              ? m.workbench_unsaved()
              : m.workbench_saved_profile()
          : m.workbench_browser_draft()
      }
      fields={
        <FieldList
          root={root}
          sample={readSample}
          annotation={selectedAnnotation ?? undefined}
          citation={annotationResult?.annotationCitation}
          ready={ready}
          mode={fieldMode}
          disabled={fieldDisabled}
          onInsertNode={insertNode}
        />
      }
      editor={
        <>
          <EditToolbar onModeChange={changeMode} />
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
      mainRef={measureFrame}
      arrange={({ fields, edit, result }) => (
        <SidePanels
          panels={{
            fields: {
              label: m.workbench_view_fields(),
              resizeLabel: m.workbench_fields_resize(),
              content: fields,
            },
            preview: {
              label: m.workbench_view_preview(),
              resizeLabel: m.workbench_preview_resize(),
              content: result,
            },
          }}
        >
          {edit}
        </SidePanels>
      )}
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

/** The action a held replacement runs, as the dialog's button names it. */
function replacementLabel(next: Replacement): string {
  switch (next.kind) {
    case "import":
      return m.workbench_import();
    case "default":
      return m.workbench_start_default();
    case "reload":
      return m.workbench_reload_profile();
    case "reconnect":
      return m.workbench_connection_reconnect();
  }
}
