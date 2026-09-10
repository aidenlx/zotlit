// The web Preview owns its display choices and render lifetime.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { RenderResources } from "@zotlit/workbench/render";
import {
  AnnotationSampleBar,
  annotationSamples,
  createRenderScheduler,
  PreviewControls,
  ResultColumn,
  useRenderState,
  useWorkbenchHost,
} from "@zotlit/workbench/ui";
import type {
  PreviewMode,
  ResultColumnProps,
  RenderScheduler,
} from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { WorkbenchHelp } from "./frame";

interface PreviewState {
  mode: PreviewMode;
  live: boolean;
  showMarkdown: boolean;
  showManaged: boolean;
  annotationChoice: string | null;
}

export function WebPreview({
  source,
  sample,
  resources,
  hold,
  mode,
  sampleBar,
  annotationChoice,
  onAnnotationChoice,
  openAnnotation,
  goToEntry,
  openSource,
}: {
  source: string;
  sample: SampleItem;
  resources: RenderResources | undefined;
  hold: boolean;
  mode: ResultColumnProps["mode"];
  sampleBar: ReactNode;
  annotationChoice: string;
  onAnnotationChoice: (choice: string) => void;
  openAnnotation: () => void;
  goToEntry: (position: number) => void;
  openSource: () => void;
}) {
  const host = useWorkbenchHost();
  const [store] = useState(() =>
    createStore<PreviewState>()(() => ({
      mode: "create",
      live: true,
      showMarkdown: false,
      showManaged: false,
      annotationChoice,
    })),
  );
  const state = useStore(store);
  useEffect(() => {
    if (store.getState().annotationChoice !== annotationChoice)
      store.setState({ annotationChoice });
  }, [store, annotationChoice]);
  const { current, example } = useMemo(
    () => annotationSamples(sample, state.annotationChoice),
    [sample, state.annotationChoice],
  );
  useEffect(() => {
    if (
      state.annotationChoice === annotationChoice &&
      example.id !== annotationChoice
    )
      onAnnotationChoice(example.id);
  }, [
    example.id,
    state.annotationChoice,
    annotationChoice,
    onAnnotationChoice,
  ]);
  const [scheduler, setScheduler] = useState<RenderScheduler | null>(null);
  useEffect(() => {
    const owner = createRenderScheduler({
      input: { source: "", snapshot: null, mode: "create", live: true },
      render: (request) => host.render(request),
      failed: (result) => result,
    });
    setScheduler(owner);
    return () => owner[Symbol.dispose]();
  }, [host]);
  useEffect(() => {
    scheduler?.setInput({
      source,
      snapshot: sample,
      annotation: example,
      resources,
      hold,
      mode: state.mode,
      live: state.live,
    });
  }, [
    scheduler,
    source,
    sample,
    example,
    resources,
    hold,
    state.mode,
    state.live,
  ]);
  const { result, busy, stale, staleReason } = useRenderState(scheduler);
  const annotationResult =
    result?.annotationId === example.id &&
    result.annotationRevision === example.revision
      ? result
      : null;
  return (
    <>
      <div className={mode === "annotation" ? "hidden" : "contents"}>
        {sampleBar}
      </div>
      {mode === "annotation" && (
        <AnnotationSampleBar
          current={current}
          example={example}
          onSelect={(annotationChoice) => {
            store.setState({ annotationChoice });
            onAnnotationChoice(annotationChoice);
          }}
        />
      )}
      <PreviewControls
        preview={{ mode: state.mode, live: state.live }}
        onChange={(next) => store.setState(next)}
        busy={busy}
        disabled={hold || scheduler === null}
        onRun={() => scheduler?.run()}
      />
      <ResultColumn
        result={result}
        annotationResult={annotationResult}
        mode={mode}
        stale={stale}
        staleReason={staleReason}
        showMarkdown={state.showMarkdown}
        onShowMarkdown={(showMarkdown) => store.setState({ showMarkdown })}
        showManaged={state.showManaged}
        onShowManaged={(showManaged) => store.setState({ showManaged })}
        openAnnotation={openAnnotation}
        goToEntry={goToEntry}
        openSource={openSource}
        help={
          <WorkbenchHelp title={m.workbench_result_heading()}>
            {mode === "annotation"
              ? m.workbench_annotation_lede()
              : state.showManaged
                ? m.workbench_result_managed_lede()
                : m.workbench_result_lede()}
          </WorkbenchHelp>
        }
      />
    </>
  );
}
