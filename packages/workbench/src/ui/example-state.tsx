import type { RenderDiagnostic, TemplateRenderResult } from "#/render/index";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { useOptionalEditor, useWorkbenchModel } from "./editor";
import { useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { WorkbenchModel } from "./model";
import { useIcon, useParts } from "./theme";

/** A preview surface with a tab of its own that names its condition. */
type ExampleSurface = "filename" | "properties";

interface ExampleState {
  /**
   * What this surface's example is now. `error` names a failure in the item
   * data the example reads, `failed` one this surface's own template caused,
   * and `unavailable` a surface that never rendered because something before
   * it failed — which is no fault of this surface's.
   */
  kind:
    | "ready"
    | "no-selection"
    | "loading"
    | "stale"
    | "error"
    | "failed"
    | "unavailable";
  message: string | null;
  /** The diagnostic that named this surface, which routes to its explanation. */
  failure: RenderDiagnostic | null;
  /**
   * The last attempt that produced this surface, while its own failure stands.
   * Null whenever nothing retained answers for the surface the reader is on.
   */
  retained: TemplateRenderResult | null;
}

/** An example is separate from the configuration that produces it. */
export function useExampleMessage(surface: ExampleSurface): string | null {
  return useExampleState(surface).message;
}

/** Whether this attempt produced this surface's own output at all. */
function produced(
  result: TemplateRenderResult,
  surface: ExampleSurface,
): boolean {
  return surface === "filename"
    ? result.filename !== null
    : result.properties.length > 0;
}

/** The chosen Item and result an example last read, and the old Item's result. */
interface ExampleSelection {
  readonly id: string | undefined;
  readonly result: TemplateRenderResult | null;
  readonly previousResult: TemplateRenderResult | null;
}

const selections = new WeakMap<WorkbenchModel, Atom.Atom<ExampleSelection>>();

/**
 * What the examples of `model` last read. It starts over when no example is
 * on screen, as each example once did on its own.
 */
function exampleSelection(model: WorkbenchModel): Atom.Atom<ExampleSelection> {
  let atom = selections.get(model);
  if (atom === undefined) {
    atom = Atom.make((get): ExampleSelection => {
      const id = get(model.item)?.id;
      const { result } = get(model.scheduler.state);
      const selection = Option.getOrUndefined(get.self<ExampleSelection>());
      if (selection === undefined) return { id, result, previousResult: null };
      const changed = selection.id !== id;
      // Hide the old item's result even before the host has supplied its new data.
      const previousResult = changed
        ? selection.result
        : selection.previousResult;
      return changed || selection.result !== result
        ? { id, result, previousResult }
        : selection;
    });
    selections.set(model, atom);
  }
  return atom;
}

export function useExampleState(surface: ExampleSurface): ExampleState {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const model = useWorkbenchModel();
  const item = useAtomValue(model.item);
  const { retained, busy, stale } = useAtomValue(model.scheduler.state);
  const { result, previousResult } = useAtomValue(exampleSelection(model));
  const state = (
    kind: ExampleState["kind"],
    message: string | null,
    rest: Partial<Pick<ExampleState, "failure" | "retained">> = {},
  ): ExampleState => ({
    kind,
    message,
    failure: null,
    retained: null,
    ...rest,
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
  if (!result) return state("loading", m.workbench_loading_item());
  if (produced(result, surface)) return state("ready", null);
  // A Managed Frontmatter failure names the row it came from and that row
  // carries it, so only a diagnostic naming the whole surface answers for one.
  const failure =
    result.diagnostics.find(
      ({ part, position }) => part === surface && position === undefined,
    ) ?? null;
  // The output this surface last produced, which stands while its own failure
  // is repaired. Another surface's retained output is no comparison for this
  // one, so it reads as nothing kept.
  const kept =
    retained !== null && produced(retained, surface) ? retained : null;
  if (failure !== null) {
    return state(
      "failed",
      kept === null
        ? m.workbench_preview_unavailable()
        : m.workbench_preview_retained(),
      { failure, retained: kept },
    );
  }
  // Nothing names this surface, so whatever failed did so before the render
  // reached it. An engine or host failure this package could not classify is
  // the one that reads as the item's; a named fault is the template's.
  const blocking = result.diagnostics.filter(
    ({ part }) => part === undefined || part === "render" || part === "profile",
  );
  if (blocking.length === 0) return state("ready", null);
  return blocking.some(({ code }) => code === "render-error")
    ? state("error", m.workbench_example_failed())
    : state("unavailable", m.workbench_preview_unavailable());
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
