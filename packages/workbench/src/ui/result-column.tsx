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
  /**
   * The last successful output kept for this document and preview selection,
   * which a failed attempt is read against. Null where no matching success
   * stands, which is what an unavailable preview says.
   */
  retained?: TemplateRenderResult | null;
  mode: ResultMode;
  stale: boolean;
  /** Why `result` is stale, or why none exists yet; `null` while it is current. */
  staleReason: "hold" | "invalid" | "demand" | "live" | null;
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
  retained = null,
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
  const outputOf = (source: TemplateRenderResult | null | undefined) =>
    (showPartial
      ? source?.partial
      : showCitation
        ? source?.citation
        : showAnnotation
          ? source?.annotation
          : showManaged
            ? source?.managedRegion
            : source?.creationBody) ?? null;
  const output = outputOf(showAnnotation ? annotationResult : result);
  // A document the parser refuses never reached a render, and its explanation
  // is the editor's; the result on screen is as far behind as a failed one.
  const failed =
    staleReason === "invalid" ||
    (previewProblem !== undefined && output === null);
  // A failure leaves the last successful output standing, so the reader
  // repairs the source against working output rather than an empty pane.
  const kept =
    failed && retained !== null && outputOf(retained) !== null
      ? retained
      : null;
  // What the region paints: retained output wherever a failure kept some.
  const shown = kept ?? result;
  const annotationShown = kept ?? annotationResult ?? null;
  const filenameTooltip = useTooltip(shown?.filename ?? "");
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
        {shown || failed ? (
          <Suspense fallback={pending}>
            {showNote && !failed && shown && (
              <header {...part("filename")} {...filenameTooltip}>
                <p {...part("filename-text")}>
                  <span {...part("label-text")}>
                    {m.workbench_result_filename()}:{" "}
                  </span>
                  {shown.filename}
                </p>
              </header>
            )}
            {(previewProblem || failed) && (
              <div role="status" {...part("problem")}>
                {previewProblem && (
                  <p {...part("problem-text")}>
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
                {failed && (
                  <p
                    {...part(
                      "problem-output",
                      kept === null ? "unavailable" : "retained",
                    )}
                  >
                    {kept === null
                      ? m.workbench_preview_unavailable()
                      : m.workbench_preview_retained()}
                  </p>
                )}
              </div>
            )}
            {(failed && kept === null) ||
            shown === null ? null : showCitation || showPartial ? (
              <Markdown
                markdown={(showPartial ? shown.partial : shown.citation) ?? ""}
                properties={[]}
                showMarkdown={showMarkdown}
              />
            ) : showAnnotation ? (
              annotationShown ? (
                <Markdown
                  markdown={annotationShown.annotation ?? ""}
                  properties={[]}
                  showMarkdown={showMarkdown}
                />
              ) : (
                pending
              )
            ) : showNote && showManaged ? (
              shown.managedRegion === null ? (
                <p {...part("empty")}>{m.workbench_result_managed_none()}</p>
              ) : (
                <Markdown
                  markdown={shown.managedRegion}
                  properties={[]}
                  showMarkdown={showMarkdown}
                />
              )
            ) : (
              <Markdown
                markdown={shown.creationBody ?? ""}
                // The sheet is the note, so its list is the fold every
                // entry merged into, not each entry's own contribution.
                properties={shown.fold}
                frontmatterBlock={shown.frontmatterBlock}
                showMarkdown={showMarkdown}
                marks={shown.annotationRanges}
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
  retained,
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
        retained={retained}
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
