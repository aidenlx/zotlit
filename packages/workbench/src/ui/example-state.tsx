import { useOptionalEditor, useRenderState, useWorkbenchStore } from "./editor";
import { useWorkbenchMessages } from "./messages";

/** An example is separate from the configuration that produces it. */
export function useExampleMessage(
  surface: "filename" | "properties",
): string | null {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const item = useWorkbenchStore((state) => state.item);
  const { result, busy, stale } = useRenderState();
  if (!editor) return null;
  if (!item) return m.workbench_example_select_item();
  if (busy) return m.workbench_loading_item();
  if (stale) return m.workbench_preview_stale();
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
    return m.workbench_example_failed();
  if (!result) return m.workbench_loading_item();
  return null;
}
