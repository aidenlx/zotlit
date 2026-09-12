// The shared result controls and render selection, with Markdown supplied by the host.

import type { RenderDiagnostic, TemplateRenderResult } from "#/render/result";
import { Suspense, useId } from "react";
import type { ReactNode, Ref } from "react";

import { HiddenName, useWorkbenchHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import { diagnosticText } from "./problems";
import { WorkbenchSelect, WorkbenchOption } from "./select";
import { useParts } from "./theme";

/** The result pane's heading beside the reading-or-Markdown choice. */
export function ResultHeader({
  heading,
  showMarkdown,
  onShowMarkdown,
  controls,
  help,
}: {
  heading: string;
  showMarkdown: boolean;
  onShowMarkdown?: (showMarkdown: boolean) => void;
  controls?: ReactNode;
  help?: ReactNode;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("resultHeader");
  return (
    <div {...part("header")}>
      <h2 {...part("heading")}>{heading}</h2>
      <div {...part("controls")}>
        {controls}
        <label {...part("label")}>
          <span {...part("label-text")}>{m.workbench_preview_format()}</span>
          <WorkbenchSelect
            value={showMarkdown ? "markdown" : "reading"}
            disabled={onShowMarkdown === undefined}
            onInput={(event) =>
              onShowMarkdown?.(event.currentTarget.value === "markdown")
            }
          >
            <WorkbenchOption value="reading">
              {m.workbench_preview_reading()}
            </WorkbenchOption>
            <WorkbenchOption value="markdown">
              {m.workbench_result_markdown_toggle()}
            </WorkbenchOption>
          </WorkbenchSelect>
        </label>
        {help}
      </div>
    </div>
  );
}

/** The box the rendered note is read in. */
export function ResultRegion({
  ref,
  emphasis,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  emphasis?: boolean;
  children: ReactNode;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("resultRegion");
  const nameId = useId();
  return (
    <div
      role="region"
      tabIndex={0}
      aria-labelledby={nameId}
      ref={ref}
      data-emphasis={emphasis || undefined}
      {...part("region")}
    >
      <HiddenName id={nameId}>{m.workbench_view_result()}</HiddenName>
      {children}
    </div>
  );
}

/** Which of the four outputs a preview shows, which picks its heading and body. */
export type ResultMode = "note" | "annotation" | "citation" | "partial";

export interface ResultBodyProps {
  result: TemplateRenderResult | null;
  annotationResult?: TemplateRenderResult | null;
  mode: ResultMode;
  stale: boolean;
  /** Why `result` is stale, or why none exists yet; `null` while it is current. */
  staleReason: "hold" | "demand" | "live" | null;
  showMarkdown: boolean;
  showManaged: boolean;
  sourceAvailable?: boolean;
  /**
   * Reads the failure behind this preview in the editor's Problems area. A
   * preview with no editor to reach leaves it out, and Show problem is absent.
   */
  onShowProblem?: (diagnostic: RenderDiagnostic) => void;
  /** Runs a render now; on demand, this is how the stale-behind notice offers Run. */
  onRun?: () => void;
  busy?: boolean;
}

/** The stale notice and rendered result, without the heading `ResultColumn` adds. */
export function ResultBody({
  result,
  annotationResult,
  mode,
  staleReason,
  showMarkdown,
  showManaged,
  sourceAvailable = true,
  onShowProblem,
  onRun,
  busy,
}: ResultBodyProps) {
  const m = useWorkbenchMessages();
  const part = useParts("resultColumn");
  const Markdown = useWorkbenchHost().markdown;
  const filenameTooltip = useTooltip(result?.filename ?? "");
  const showAnnotation = mode === "annotation";
  const showNote = mode === "note";
  const showCitation = mode === "citation";
  const showPartial = mode === "partial";
  const previewProblem = showAnnotation
    ? (annotationResult?.diagnostics.find(
        ({ part }) => part === "annotation",
      ) ?? annotationResult?.diagnostics[0])
    : result?.diagnostics.find(
        ({ part }) => part !== "annotation" || result.creationBody === null,
      );
  // What this mode shows. A render that failed produced nothing at all, which
  // is not the same as a template that produced an empty result, so the
  // failure reads as a failure rather than as empty content.
  const output = showPartial
    ? result?.partial
    : showCitation
      ? result?.citation
      : showAnnotation
        ? annotationResult?.annotation
        : showManaged
          ? result?.managedRegion
          : result?.creationBody;
  const failed = previewProblem !== undefined && (output ?? null) === null;
  const pending = <p {...part("pending")}>{m.workbench_result_pending()}</p>;
  // "Rendering…" is honest only while a render is on its way: on demand the
  // notice below says Run starts one, and a hold shows its own problem.
  const showPending = staleReason === "live";
  return (
    <>
      {staleReason === "hold" && result && (
        <p role="status" {...part("stale")}>
          {m.workbench_preview_stale()}
        </p>
      )}
      {staleReason === "demand" && (
        <div role="status" {...part("behind")}>
          <span {...part("behind-text")}>
            {result ? m.workbench_preview_behind() : m.workbench_preview_none()}
          </span>
          {onRun && (
            <button
              type="button"
              disabled={busy}
              onClick={onRun}
              {...part("run")}
            >
              {m.workbench_preview_run()}
            </button>
          )}
        </div>
      )}
      <ResultRegion emphasis={false}>
        {result ? (
          <Suspense fallback={pending}>
            {showNote && !failed && (
              <header {...part("filename")} {...filenameTooltip}>
                <p {...part("filename-text")}>
                  <span {...part("label-text")}>
                    {m.workbench_result_filename()}:{" "}
                  </span>
                  {result.filename}
                </p>
              </header>
            )}
            {previewProblem && (
              <p role="status" {...part("problem")}>
                <strong {...part("problem-heading")}>
                  {m.workbench_preview_problem()}
                </strong>{" "}
                {diagnosticText(m, previewProblem)}{" "}
                {onShowProblem && (
                  <button
                    type="button"
                    disabled={!sourceAvailable}
                    onClick={() => onShowProblem(previewProblem)}
                    {...part("problem-open")}
                  >
                    {m.workbench_problem_show()}
                  </button>
                )}
              </p>
            )}
            {failed ? null : showCitation || showPartial ? (
              <Markdown
                markdown={
                  (showPartial ? result.partial : result.citation) ?? ""
                }
                properties={[]}
                showMarkdown={showMarkdown}
              />
            ) : showAnnotation ? (
              annotationResult ? (
                <Markdown
                  markdown={annotationResult.annotation ?? ""}
                  properties={[]}
                  showMarkdown={showMarkdown}
                />
              ) : (
                pending
              )
            ) : showNote && showManaged ? (
              result.managedRegion === null ? (
                <p {...part("empty")}>{m.workbench_result_managed_none()}</p>
              ) : (
                <Markdown
                  markdown={result.managedRegion}
                  properties={[]}
                  showMarkdown={showMarkdown}
                />
              )
            ) : (
              <Markdown
                markdown={result.creationBody ?? ""}
                // The sheet is the note, so its list is the fold every
                // entry merged into, not each entry's own contribution.
                properties={result.fold}
                frontmatterBlock={result.frontmatterBlock}
                showMarkdown={showMarkdown}
                marks={result.annotationRanges}
              />
            )}
          </Suspense>
        ) : showPending ? (
          pending
        ) : null}
      </ResultRegion>
    </>
  );
}

export interface ResultColumnProps extends ResultBodyProps {
  showMarkdown: boolean;
  onShowMarkdown: (show: boolean) => void;
  showManaged: boolean;
  onShowManaged: (show: boolean) => void;
  help?: ReactNode;
}

export function ResultColumn({
  result,
  annotationResult,
  mode,
  stale,
  staleReason,
  showMarkdown,
  onShowMarkdown,
  showManaged,
  onShowManaged,
  sourceAvailable = true,
  onShowProblem,
  onRun,
  busy,
  help,
}: ResultColumnProps) {
  const m = useWorkbenchMessages();
  const part = useParts("resultColumn");
  const selectorTooltip = useTooltip(
    showManaged
      ? m.workbench_result_managed_toggle()
      : m.workbench_preview_whole(),
  );
  const showNote = mode === "note";
  const showAnnotation = mode === "annotation";
  return (
    <>
      <ResultHeader
        heading={
          showAnnotation
            ? m.workbench_annotation_example()
            : m.workbench_result_heading()
        }
        showMarkdown={showMarkdown}
        onShowMarkdown={onShowMarkdown}
        controls={
          showNote && (
            <label {...part("label")}>
              <span {...part("label-text")}>{m.workbench_preview_show()}</span>
              <WorkbenchSelect
                value={showManaged ? "managed" : "whole"}
                onInput={(event) =>
                  onShowManaged(event.currentTarget.value === "managed")
                }
                {...selectorTooltip}
              >
                <WorkbenchOption value="whole">
                  {m.workbench_preview_whole()}
                </WorkbenchOption>
                <WorkbenchOption value="managed">
                  {m.workbench_result_managed_toggle()}
                </WorkbenchOption>
              </WorkbenchSelect>
            </label>
          )
        }
        help={help}
      />
      <ResultBody
        result={result}
        annotationResult={annotationResult}
        mode={mode}
        stale={stale}
        staleReason={staleReason}
        showMarkdown={showMarkdown}
        showManaged={showManaged}
        sourceAvailable={sourceAvailable}
        onShowProblem={onShowProblem}
        onRun={onRun}
        busy={busy}
      />
    </>
  );
}
