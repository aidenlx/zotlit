// The editor's Problems area: one detected problem, led by the object it is
// about, and the disclosure the reader controls. Automatic checks leave that
// choice alone; Show problem, a source marker, and a failed explicit Run open
// it. Its controls navigate and disclose — every repair is the reader's own
// edit, described in the suggestion.

import type { WorkbenchProblem } from "#/document/controller";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useWorkbenchMessages } from "./messages";
import type { WorkbenchDiagnosis } from "./problems";
import {
  diagnosisEngineSource,
  diagnosisExplanation,
  diagnosisLocated,
  diagnosisWhere,
  problemAction,
} from "./problems";
import type { RenderTrigger } from "./scheduler";
import { useParts } from "./theme";

export { problemWhere } from "./problems";

/** The Problems area's own state: which problem is read, and whether in full. */
export interface WorkbenchProblemsState {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  /** The problem the area explains; `null` once every one is resolved. */
  readonly selected: WorkbenchDiagnosis | null;
  /** The reader's own open-or-collapsed choice, which checks never change. */
  readonly open: boolean;
  /** Reads one problem in full, which a source marker and Show problem do. */
  readonly select: (id: string) => void;
  readonly setOpen: (open: boolean) => void;
}

export function useWorkbenchProblems({
  diagnoses,
  trigger,
  attempt,
}: {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  /** How the attempt behind the newest result started. */
  readonly trigger: RenderTrigger | null;
  /** Counts published results, so one deliberate failure opens the area once. */
  readonly attempt: number;
}): WorkbenchProblemsState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Selection keys on the problem's identity rather than its place in the
  // list, so a check that finds the same problem keeps the reader's place.
  const selected =
    diagnoses.find(({ id }) => id === selectedId) ?? diagnoses[0] ?? null;
  const opened = useRef(attempt);
  const failed = diagnoses.length > 0;
  useEffect(() => {
    if (attempt === opened.current) return;
    opened.current = attempt;
    // A deliberate attempt that failed is the reader asking what happened; an
    // automatic one during typing leaves the area as they left it.
    if (trigger === "explicit" && failed) setOpen(true);
  }, [attempt, trigger, failed]);
  return {
    diagnoses,
    selected,
    open,
    select(id) {
      setSelectedId(id);
      setOpen(true);
    },
    setOpen,
  };
}

export function ProblemsFooter({
  problems,
  onOpen,
  onAction,
}: {
  /** The area's state, from `useWorkbenchProblems`. */
  problems: WorkbenchProblemsState;
  /** Opens the pane the selected problem is repaired in. */
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  /**
   * Performs the repair a document problem carries its own button for. A host
   * that supplies none leaves the reader with the pane button alone.
   */
  onAction?: (problem: WorkbenchProblem) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("problemsFooter");
  const headingId = useId();
  const bodyId = useId();
  const { selected, open, setOpen } = problems;
  // The space an open explanation used, so a check that finds nothing leaves
  // the source the reader is editing exactly where it stands. Collapsing is
  // what gives that space back.
  const area = useRef<HTMLElement | null>(null);
  const [space, setSpace] = useState<number | null>(null);
  const reading = open && selected !== null;
  useEffect(() => {
    if (!open) setSpace(null);
    else if (reading)
      setSpace(area.current?.getBoundingClientRect().height ?? null);
  }, [open, reading, selected?.id]);
  // Nothing found and nothing open: the area gives its space back to the
  // source rather than reporting its own emptiness.
  if (selected === null && !open) return null;
  const held: CSSProperties | undefined =
    open && selected === null && space !== null
      ? { minBlockSize: space }
      : undefined;
  const explanation = selected && diagnosisExplanation(m, selected);
  const engineSource = selected && diagnosisEngineSource(m, selected);
  const action =
    onAction && selected?.kind === "document"
      ? problemAction(m, selected.problem)
      : null;
  return (
    <section
      ref={area}
      style={held}
      aria-labelledby={headingId}
      {...part("problems", open ? "open" : "compact")}
    >
      <div {...part("problems-summary")}>
        <p id={headingId} {...part("problems-heading")}>
          {m.workbench_problems_heading()}
        </p>
        {explanation === null ? (
          <p {...part("problems-text")}>{m.workbench_problems_none()}</p>
        ) : (
          !open && <p {...part("problems-text")}>{explanation.condition}</p>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen(!open)}
          {...part("problems-toggle")}
        >
          {open ? m.workbench_problems_collapse() : m.workbench_problem_show()}
        </button>
      </div>
      {open && selected && explanation && (
        <div id={bodyId} {...part("problems-body")}>
          <p {...part("problems-object")}>{explanation.object}</p>
          <p {...part("problems-text")}>{explanation.condition}</p>
          <p {...part("problems-recovery")}>{explanation.suggestion}</p>
          {/* Where the engine said it happened and where the reader repairs it
              are different places, so they are read as separate lines rather
              than folded into one claim. */}
          {engineSource !== null && (
            <p {...part("problems-location")}>{engineSource}</p>
          )}
          {!diagnosisLocated(selected) && (
            <p {...part("problems-location")}>
              {m.workbench_problems_location_unknown()}
            </p>
          )}
          <details {...part("problems-details")}>
            <summary {...part("problems-details-label")}>
              {m.workbench_problems_technical()}
            </summary>
            <p {...part("problems-evidence")}>
              {explanation.evidence ?? m.workbench_problems_evidence_none()}
            </p>
          </details>
          <div {...part("problems-controls")}>
            <button
              type="button"
              onClick={() => onOpen(selected)}
              {...part("problems-open")}
            >
              {diagnosisWhere(m, selected)}
            </button>
            {action !== null && selected.kind === "document" && (
              <button
                type="button"
                onClick={() => onAction?.(selected.problem)}
                {...part("problems-action")}
              >
                {action}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
