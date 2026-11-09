// The Preview panel on the right of the Template Workbench View: the note,
// annotation, citation, or partial the editor's own render made from the
// chosen Item, read from the leaf's scheduler and host model. It owns no
// model, scheduler, or runner; its settings live in the editor's pane menu.
import "./preview-panel.css";
import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";
import {
  DEFAULT_PARTIAL_CONTEXT,
  isPartialContext,
} from "@zotlit/workbench/render";
import type {
  PartialContext,
  RenderDiagnostic,
} from "@zotlit/workbench/render";
import {
  citationVariantLabel,
  partialContextLabel,
  PreviewFilenameLabel,
  previewFilename,
  ResultBody,
  setPreview,
} from "@zotlit/workbench/ui";
import type { ResultMode, TemplateRoot } from "@zotlit/workbench/ui";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";
import { NativeMarkdown } from "@/views/template-workbench/preview/markdown";

import { selectionHint, templateWorkbenchButton } from "./theme";
import type { TemplateWorkbenchView } from "./view";

/**
 * What the Preview renders for the document kind and root: which result, the
 * caller a Shared Partial is rendered as called from, and whether the render
 * reads a Citation set or an annotation. The panel and its pane-menu settings
 * both read it.
 */
export function previewTarget(
  kind: WorkbenchDocumentKind,
  root: TemplateRoot,
): {
  readonly mode: ResultMode;
  readonly caller: PartialContext;
  readonly citationSet: boolean;
  readonly annotationMode: boolean;
} {
  const mode: ResultMode =
    kind === "citation"
      ? "citation"
      : kind === "partial"
        ? "partial"
        : root === "annotation"
          ? "annotation"
          : "note";
  const caller = isPartialContext(root) ? root : DEFAULT_PARTIAL_CONTEXT;
  // A partial reads the root its chosen caller reads, so the set it is shown
  // against and the chooser it offers are that caller's, not the document's.
  return {
    mode,
    caller,
    citationSet:
      mode === "citation" || (mode === "partial" && caller === "citation"),
    annotationMode:
      mode === "annotation" || (mode === "partial" && caller === "annotation"),
  };
}

/**
 * The host sheet of the leaf's render. A failed attempt keeps the last output,
 * so the sheet reads the metadata of the result that output came from; it opens
 * its Properties block while the editor is on the Properties tab.
 */
export function WorkbenchMarkdown({
  view,
  ...props
}: Omit<ComponentProps<typeof NativeMarkdown>, "app" | "result"> & {
  view: TemplateWorkbenchView;
}) {
  const { result, retained } = useAtomValue(view.workbench.scheduler.state);
  const tab = useAtomValue(view.workbench.tab);
  const advanced = useAtomValue(view.workbench.advanced);
  const { markdown, surface = "note" } = props;
  const kept =
    retained === null
      ? null
      : surface === "partial"
        ? retained.partial
        : surface === "citation"
          ? retained.citation
          : surface === "annotation"
            ? retained.annotation
            : retained.creationBody === markdown ||
                retained.managedRegion === markdown
              ? markdown
              : null;
  return (
    <NativeMarkdown
      {...props}
      app={view.app}
      result={kept === markdown ? retained : result}
      expandProperties={!advanced && tab === "properties"}
    />
  );
}

/**
 * The Preview pane's actions, as Obsidian's Markdown view has them: the mode
 * toggle names what a press shows, and More options holds the settings the
 * view's Preview submenu lists.
 */
function PreviewActions({
  view,
  showMarkdown,
}: {
  view: TemplateWorkbenchView;
  showMarkdown: boolean;
}) {
  const toggle = showMarkdown
    ? m.workbench_show_reading_view()
    : m.workbench_show_markdown();
  return (
    <div className="zt:flex zt:shrink-0 zt:items-center">
      <IconButton
        icon={showMarkdown ? "book-open" : "code"}
        onClick={() =>
          view.registry.update(
            view.workbench.choices,
            setPreview({ showMarkdown: !showMarkdown }),
          )
        }
        {...tooltipAttrs(toggle)}
      />
      <IconButton
        icon="more-horizontal"
        aria-haspopup="menu"
        onClick={(event) => view.showPreviewMenu(event.currentTarget)}
        {...tooltipAttrs(m.workbench_pane_more_options())}
      />
    </div>
  );
}

export function PreviewPanel({
  view,
  showProblem,
}: {
  view: TemplateWorkbenchView;
  /** Reads one problem in the editor's Problems area; null opens the area. */
  showProblem: (diagnostic: RenderDiagnostic | null) => void;
}) {
  const { workbench, model } = view;
  const { result, retained, busy, staleReason } = useAtomValue(
    workbench.scheduler.state,
  );
  const kind = useAtomValue(workbench.document.kind);
  const root = useAtomValue(workbench.root);
  const { status, error } = useAtomValue(model.read);
  const { example } = useAtomValue(workbench.examples);
  const { variant, citationExample, preview } = useAtomValue(workbench.choices);
  const {
    mode,
    caller: partialContext,
    citationSet,
    annotationMode,
  } = previewTarget(kind, root);
  // A Citation example carries its own data, so its preview is ready the moment
  // the reader has one selected — no Item Snapshot to wait on.
  const ready =
    status === "ready" ||
    (annotationMode && example !== null) ||
    (citationSet && citationExample !== null);
  const heading =
    mode === "partial"
      ? m.workbench_partial_result_heading()
      : mode === "citation"
        ? m.workbench_citation_result_heading()
        : mode === "annotation"
          ? m.workbench_annotation_example()
          : m.workbench_result_heading();
  const caption = [
    ...(mode === "partial" ? [partialContextLabel(m, partialContext)] : []),
    ...(citationSet ? [citationVariantLabel(m, variant)] : []),
    ...(mode === "note"
      ? [
          preview.showManaged
            ? m.workbench_result_managed_toggle()
            : preview.mode === "update"
              ? m.workbench_preview_existing_note()
              : m.workbench_preview_new_note(),
        ]
      : []),
    ...(!preview.live ? [m.workbench_preview_on_demand()] : []),
  ].join(m.workbench_selection_separator());
  // The header row's file name and the body read the same render.
  const reading = {
    result,
    annotationResult: result,
    retained,
    mode,
    staleReason,
    showManaged: preview.showManaged,
  };
  const filename = previewFilename(reading);
  return (
    // The scroll padding keeps a control the reader tabs to clear of the
    // sticky header row, so it stays at least as tall as that row: change
    // one with the other.
    <div
      data-workbench-scroll="preview"
      data-zotlit-preview-result={result?.sourceRevision}
      className="zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:scroll-pt-20 zt:flex-col zt:gap-3 zt:overflow-auto zt:p-3"
    >
      {/* The view's item row above holds the chooser this hint points at. */}
      {status === "empty" && !ready && (
        <p className={selectionHint}>
          {annotationMode
            ? m.workbench_preview_choose_annotation()
            : m.workbench_preview_choose_item()}
        </p>
      )}
      {status === "loading" && (
        <p role="status" className={selectionHint}>
          {m.workbench_loading_item()}
        </p>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5"
        >
          <p className={selectionHint}>
            {error ?? m.workbench_example_missing_item()}
          </p>
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2">
            <button
              className={templateWorkbenchButton}
              onClick={() => view.refresh()}
            >
              {m.workbench_example_retry()}
            </button>
            <button
              className={templateWorkbenchButton}
              onClick={() => view.startItemChoice()}
            >
              {m.template_data_explorer_choose_item()}
            </button>
          </div>
        </div>
      )}
      {ready && (
        <>
          {/* The header row stays at the top of the scroll area, so the
              reader always sees which note and file name the preview shows.
              It bleeds over the panel's padding to cover what scrolls under. */}
          <header
            data-workbench-preview-header=""
            className="zt:sticky zt:-top-3 zt:z-10 zt:-mx-3 zt:-mt-3 zt:flex zt:min-w-0 zt:flex-col zt:gap-1 zt:border-b zt:border-border zt:bg-background zt:px-3 zt:pt-3 zt:pb-2"
          >
            {/* The pane's actions keep the row's inline end, as a view
                header's do; what the preview shows reads under the heading. */}
            <div className="zt:flex zt:min-w-0 zt:items-center zt:gap-2">
              <h2 className="zt-workbench-preview-heading zt:min-w-0 zt:flex-1">
                {heading}
              </h2>
              <PreviewActions view={view} showMarkdown={preview.showMarkdown} />
            </div>
            {caption && <p className={selectionHint}>{caption}</p>}
            {filename !== null && <PreviewFilenameLabel filename={filename} />}
          </header>
          <ResultBody
            {...reading}
            showMarkdown={preview.showMarkdown}
            showFilename={false}
            onShowProblem={showProblem}
            onRun={() => view.registry.set(workbench.scheduler.run, undefined)}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
