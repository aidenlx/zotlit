// The shared result controls and render selection, with Markdown supplied by the host.

import type { ProfileRenderResult } from "#/render/result";
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

export interface ResultColumnProps {
  result: ProfileRenderResult | null;
  annotationResult?: ProfileRenderResult | null;
  mode: "note" | "annotation" | "properties";
  stale: boolean;
  showMarkdown: boolean;
  onShowMarkdown: (show: boolean) => void;
  showManaged: boolean;
  onShowManaged: (show: boolean) => void;
  sourceAvailable?: boolean;
  openAnnotation: () => void;
  goToEntry: (position: number) => void;
  openSource: () => void;
  propertiesResult?: ReactNode;
  help?: ReactNode;
}

export function ResultColumn({
  result,
  annotationResult,
  mode,
  stale,
  showMarkdown,
  onShowMarkdown,
  showManaged,
  onShowManaged,
  sourceAvailable = true,
  openAnnotation,
  goToEntry,
  openSource,
  propertiesResult,
  help,
}: ResultColumnProps) {
  const m = useWorkbenchMessages();
  const part = useParts("resultColumn");
  const Markdown = useWorkbenchHost().markdown;
  const selectorTooltip = useTooltip(
    showManaged
      ? m.workbench_result_managed_toggle()
      : m.workbench_preview_whole(),
  );
  const filenameTooltip = useTooltip(result?.filename ?? "");
  const showAnnotation = mode === "annotation";
  const showNote = mode === "note";
  const previewProblem = showAnnotation
    ? (annotationResult?.diagnostics.find(
        ({ part }) => part === "annotation",
      ) ?? annotationResult?.diagnostics[0])
    : result?.diagnostics.find(
        ({ part }) => part !== "annotation" || result.creationBody === null,
      );
  const pending = <p {...part("pending")}>{m.workbench_result_pending()}</p>;
  return (
    <>
      <ResultHeader
        heading={
          showAnnotation
            ? m.workbench_annotation_example()
            : mode === "properties"
              ? m.workbench_result_fold()
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
      {result && stale && (
        <p role="status" {...part("stale")}>
          {m.workbench_preview_stale()}
        </p>
      )}
      <ResultRegion emphasis={false}>
        {result ? (
          <Suspense fallback={pending}>
            {!showAnnotation && (
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
              <p {...part("problem")}>
                <strong {...part("problem-heading")}>
                  {m.workbench_preview_problem()}
                </strong>{" "}
                {diagnosticText(m, previewProblem)}{" "}
                {previewProblem.part === "annotation" && (
                  <button
                    type="button"
                    disabled={!sourceAvailable}
                    onClick={openAnnotation}
                    {...part("problem-open")}
                  >
                    {m.workbench_annotation_edit_format()}
                  </button>
                )}
                {previewProblem.part !== "annotation" &&
                  previewProblem.position === undefined && (
                    <button
                      type="button"
                      disabled={!sourceAvailable}
                      onClick={openSource}
                      {...part("problem-open")}
                    >
                      {m.workbench_problems_where_advanced()}
                    </button>
                  )}
                {previewProblem.position !== undefined && (
                  <button
                    type="button"
                    disabled={!sourceAvailable}
                    onClick={() => goToEntry(previewProblem.position!)}
                    {...part("problem-open")}
                  >
                    {m.workbench_problems_where_entry()}
                  </button>
                )}
              </p>
            )}
            {showAnnotation ? (
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
            ) : mode === "properties" ? (
              propertiesResult
            ) : (
              <Markdown
                markdown={result.creationBody ?? ""}
                // The sheet is the note, so its list is the fold every
                // entry merged into, not each entry's own contribution.
                properties={result.fold}
                showMarkdown={showMarkdown}
                marks={result.annotationRanges}
              />
            )}
          </Suspense>
        ) : (
          pending
        )}
      </ResultRegion>
    </>
  );
}
