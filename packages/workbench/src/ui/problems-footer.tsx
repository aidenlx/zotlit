// The strip under the editor that names the first problem the parser found,
// what to do about it, and the pane it is repaired in. Pressing the pane's
// name asks the host to open it there.

import type { WorkbenchProblem, WorkbenchSliceId } from "#/document/controller";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";
import { useWorkbenchMessages } from "./messages";
import { problemText } from "./problems";
import { useParts } from "./theme";

import { entryPosition } from "#/document/controller";

/**
 * Where a problem is repaired, named for the reader. Every other slice is one
 * Managed Frontmatter row, which reads as the entry it is.
 */
const PROBLEM_WHERE: Partial<Record<WorkbenchSliceId, WorkbenchMessageLabel>> =
  {
    advanced: "workbench_problems_where_advanced",
    note: "workbench_problems_where_note",
    filename: "workbench_problems_where_filename",
    details: "workbench_problems_where_details",
    annotation: "workbench_annotation_label",
  };

/** What the footer's button reads: the pane `problem` is repaired in. */
export function problemWhere(
  m: WorkbenchMessages,
  problem: WorkbenchProblem,
): string {
  if (problem.code === "missing-annotation-section") {
    return m.workbench_annotation_label();
  }
  if (entryPosition(problem.slice) !== null) {
    return m.workbench_problems_where_entry();
  }
  return m[
    PROBLEM_WHERE[problem.slice] ?? "workbench_problems_where_advanced"
  ]();
}

export function ProblemsFooter({
  problem,
  onOpen,
}: {
  /** The problem to name; nothing is drawn for `null`. */
  problem: WorkbenchProblem | null;
  /** Opens the pane the problem is repaired in. */
  onOpen: (problem: WorkbenchProblem) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("problemsFooter");
  if (problem === null) return null;
  const text = problemText(m, problem);
  return (
    <section aria-label={m.workbench_problems_heading()} {...part("problems")}>
      <p {...part("problems-heading")}>{m.workbench_problems_heading()}</p>
      <p {...part("problems-text")}>
        {text.message}{" "}
        <span {...part("problems-recovery")}>{text.recovery}</span>{" "}
        <button
          type="button"
          onClick={() => onOpen(problem)}
          {...part("problems-open")}
        >
          {problemWhere(m, problem)}
        </button>
      </p>
    </section>
  );
}
