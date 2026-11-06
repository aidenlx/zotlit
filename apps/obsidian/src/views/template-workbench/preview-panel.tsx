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
  citationExampleLabel,
  citationVariantLabel,
  partialContextLabel,
  ResultBody,
} from "@zotlit/workbench/ui";
import type { ResultMode, TemplateRoot } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { selectionControl } from "@/components/obsidian/selection-control";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import { NativeMarkdown } from "@/views/note-preview/markdown";

import { selectionName } from "./selection";
import { selectionBar, selectionHint, templateWorkbenchButton } from "./theme";
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

/** The panel names its Item and offers its chooser in every placement. */
const panelBar = selectionBar();

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
  const { kind } = useAtomValue(model.document);
  const root = useAtomValue(workbench.root);
  const item = useAtomValue(workbench.item);
  const title = useAtomValue(model.title);
  const { status, error } = useAtomValue(model.read);
  const { example } = useAtomValue(model.examples);
  const { variant, citationExample } = useAtomValue(model.picks);
  const preview = useAtomValue(model.preview);
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
  const choose = () =>
    annotationMode ? view.startAnnotationChoice() : view.startItemChoice();
  const name = citationSet
    ? citationExample === null
      ? title
      : citationExampleLabel(m, citationExample)
    : selectionName({
        item: item && { id: item.id, title },
        annotation: example,
        annotationMode,
      });
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
  const chooseLabel = annotationMode
    ? m.workbench_choose_annotation()
    : m.workbench_choose_item();
  return (
    <div
      data-workbench-scroll="preview"
      data-zotlit-preview-result={result?.sourceRevision}
      className="zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-3 zt:overflow-auto zt:p-3"
    >
      <div className={cn(panelBar.row(), "zt:flex")}>
        {name && <p className={panelBar.caption()}>{name}</p>}
        <button className={panelBar.trigger()} onClick={choose}>
          <Icon name="search" />
          <span>{chooseLabel}</span>
        </button>
      </div>
      {status === "empty" && !ready && (
        <div className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-2">
          <p className={selectionHint}>
            {annotationMode
              ? m.workbench_preview_choose_annotation()
              : m.workbench_preview_choose_item()}
          </p>
          <button
            className={selectionControl({ kind: "trigger" })}
            onClick={choose}
          >
            <Icon name="search" />
            <span>{chooseLabel}</span>
          </button>
        </div>
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
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-baseline zt:justify-between zt:gap-x-3 zt:gap-y-1">
            <h2 className="zt-workbench-preview-heading">{heading}</h2>
            {caption && <p className={selectionHint}>{caption}</p>}
          </div>
          <ResultBody
            result={result}
            annotationResult={result}
            retained={retained}
            mode={mode}
            staleReason={staleReason}
            showMarkdown={preview.showMarkdown}
            showManaged={preview.showManaged}
            onShowProblem={showProblem}
            onRun={() => view.registry.set(workbench.scheduler.run, undefined)}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
