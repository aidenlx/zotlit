// The web Preview: the result of the editor's one render, with the display
// choices the Workbench model keeps.
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import type { RenderDiagnostic } from "@zotlit/workbench/render";
import {
  AnnotationSampleBar,
  PreviewControls,
  ResultColumn,
  setPreview,
  useWorkbenchModel,
} from "@zotlit/workbench/ui";
import type {
  AnnotationExamples,
  ResultColumnProps,
} from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";

import { WorkbenchHelp } from "./frame";

export function WebPreview({
  mode,
  sampleBar,
  annotations: { current, example },
  onAnnotationChoice,
  onShowProblem,
}: {
  mode: ResultColumnProps["mode"];
  sampleBar: ReactNode;
  /** The chosen paper's Annotations, and the one chosen among them. */
  annotations: AnnotationExamples;
  onAnnotationChoice: (choice: string) => void;
  /**
   * The shared Show problem command: reads the problem in the editor's
   * Problems area and reveals its place in the editor; a null diagnostic opens
   * the area on whatever the editor's own checks found.
   */
  onShowProblem: (diagnostic: RenderDiagnostic | null) => void;
}) {
  const model = useWorkbenchModel();
  const { result, retained, busy, staleReason } = useAtomValue(
    model.scheduler.state,
  );
  const settings = useAtomValue(model.preview);
  const hold = useAtomValue(model.itemData, (data) => data.hold ?? false);
  const choose = useAtomSet(model.choices);
  const run = useAtomSet(model.scheduler.run);
  const annotationResult = useAtomValue(model.annotationResult);
  return (
    <>
      <div className={mode === "annotation" ? "hidden" : "contents"}>
        {sampleBar}
      </div>
      {mode === "annotation" && (
        <AnnotationSampleBar
          current={current}
          example={example}
          onSelect={onAnnotationChoice}
        />
      )}
      <PreviewControls
        preview={{ mode: settings.mode, live: settings.live }}
        onChange={(next) => choose(setPreview(next))}
        busy={busy}
        disabled={hold !== false}
        onRun={() => run()}
      />
      <ResultColumn
        result={result}
        annotationResult={annotationResult}
        retained={retained}
        mode={mode}
        staleReason={staleReason}
        showMarkdown={settings.showMarkdown}
        onShowMarkdown={(showMarkdown) => choose(setPreview({ showMarkdown }))}
        showManaged={settings.showManaged}
        onShowManaged={(showManaged) => choose(setPreview({ showManaged }))}
        onShowProblem={onShowProblem}
        help={
          <WorkbenchHelp title={m.workbench_result_heading()}>
            {mode === "annotation"
              ? m.workbench_annotation_lede()
              : settings.showManaged
                ? m.workbench_result_managed_lede()
                : m.workbench_result_lede()}
          </WorkbenchHelp>
        }
      />
    </>
  );
}
