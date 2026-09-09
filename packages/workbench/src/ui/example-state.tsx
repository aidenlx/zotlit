import { useState } from "react";

import { useOptionalEditor, useRenderState, useWorkbenchStore } from "./editor";
import { useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";

interface ExampleState {
  kind: "ready" | "no-selection" | "loading" | "stale" | "error";
  message: string | null;
}

/** An example is separate from the configuration that produces it. */
export function useExampleMessage(
  surface: "filename" | "properties",
): string | null {
  return useExampleState(surface).message;
}

export function useExampleState(
  surface: "filename" | "properties",
): ExampleState {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const item = useWorkbenchStore((state) => state.item);
  const { result, busy, stale } = useRenderState();
  const [selection, setSelection] = useState({
    id: item?.id,
    result,
    previousResult: null as typeof result,
  });
  const changed = selection.id !== item?.id;
  // Hide the old item's result even before the host has supplied its new data.
  const previousResult = changed ? selection.result : selection.previousResult;
  if (changed || selection.result !== result)
    setSelection({ id: item?.id, result, previousResult });
  const state = (
    kind: ExampleState["kind"],
    message: string | null,
  ): ExampleState => ({
    kind,
    message,
  });
  if (!editor) return state("ready", null);
  if (!item)
    return state(
      "no-selection",
      surface === "filename"
        ? m.workbench_name_choose_item()
        : m.workbench_properties_choose_item(),
    );
  if (busy || result === previousResult)
    return state("loading", m.workbench_loading_item());
  if (stale) return state("stale", m.workbench_example_awaiting_run());
  if (
    result?.diagnostics.some(
      (problem) =>
        problem.code === "render-error" &&
        (problem.part === undefined ||
          problem.part === "render" ||
          problem.part === "profile" ||
          (surface === "properties" && problem.part === "properties")),
    )
  )
    return state("error", m.workbench_example_failed());
  if (!result) return state("loading", m.workbench_loading_item());
  return state("ready", null);
}

/** Local actions name the task the selected Item will be used for. */
export function ExampleActions({
  chooseLabel,
  onChooseItem,
  onRetry,
}: {
  chooseLabel: string;
  onChooseItem?: () => void;
  onRetry?: () => void;
}) {
  const m = useWorkbenchMessages();
  const host = useOptionalHost();
  const part = useParts("sampleSuggester");
  const icon = useIcon();
  return (
    <>
      {onChooseItem && (
        <button
          type="button"
          {...part("text-trigger")}
          data-action="choose-item"
          aria-label={chooseLabel}
          {...(host?.tooltip(chooseLabel) ?? { title: chooseLabel })}
          onClick={onChooseItem}
        >
          {icon("choose-sample")}
          <span>{chooseLabel}</span>
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          {...part("trigger")}
          data-action="retry-example"
          aria-label={m.workbench_example_retry()}
          {...(host?.tooltip(m.workbench_example_retry()) ?? {
            title: m.workbench_example_retry(),
          })}
          onClick={onRetry}
        >
          {icon("reset")}
        </button>
      )}
    </>
  );
}
