// The repair commands: what both hosts do when the reader goes from a problem
// to the place that repairs it. Each one applies a routing transition to the
// view state, reveals the place in the editor, and closes the Fields picker so
// nothing covers it. None of them changes which panels show. The host supplies
// only how a notice reaches the reader, through its adapter.

import type { WorkbenchDocumentController } from "#/document/controller";
import type { RenderDiagnostic } from "#/render/result";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { WorkbenchHost } from "./host";
import type { WorkbenchModel, WorkbenchViewState } from "./model";
import { routeDiagnosis, routeProblem } from "./problem-route";
import type { ProblemTarget, RoutedDocument } from "./problem-route";
import {
  diagnosisForOccurrence,
  diagnosisLocated,
  renderDiagnosis,
} from "./problems";
import type { WorkbenchDiagnosis } from "./problems";
import type { WorkbenchProblemsState } from "./problems-footer";

/** The commands that take the reader to the place a problem is repaired in. */
export interface RepairCommands {
  /**
   * Opens the pane that edits a document problem's slice, on the text it
   * names; an `entry:N` slice opens that Properties row.
   */
  readonly goToProblem: (problem: ProblemTarget) => void;
  /** Opens the pane one problem of the Problems area is repaired in. */
  readonly openDiagnosis: (diagnosis: WorkbenchDiagnosis) => void;
  /**
   * The preview's Show problem: explains the problem in the Problems area and,
   * where its place is known, reveals that place in the editor. A null
   * diagnostic, from a document the parser refused, opens the area alone.
   */
  readonly showProblem: (diagnostic: RenderDiagnostic | null) => void;
  /** Opens the Annotation tab with the caret at the start of its section. */
  readonly openAnnotationBox: () => void;
  /**
   * Adds the loop that lists the annotations to the end of the note, with the
   * section it renders when the document has none, and returns the reader to
   * the Note tab after it.
   */
  readonly insertAnnotationLoop: () => void;
  /**
   * Hands the reader the template back where they left it. The selection each
   * pane reports as the reader moves through it is that place, so returning
   * is revealing it again, with the caret and the focus that go with it.
   */
  readonly returnToTemplate: () => void;
}

export interface RepairCommandsInput {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly model: Pick<WorkbenchModel, "view" | "fieldsPicker">;
  readonly controller: RoutedDocument &
    Pick<WorkbenchDocumentController, "insertAnnotationLoop" | "hasSlice">;
  readonly host: Pick<WorkbenchHost, "notice" | "messages">;
  readonly problems: Pick<
    WorkbenchProblemsState,
    "diagnoses" | "select" | "setOpen"
  >;
}

type Transition = (state: WorkbenchViewState) => WorkbenchViewState;

export function repairCommands({
  registry,
  model,
  controller,
  host,
  problems,
}: RepairCommandsInput): RepairCommands {
  /** Opens the place `transition` names, with nothing over the editor. */
  const go = (transition: Transition) => {
    registry.set(model.fieldsPicker, null);
    registry.update(model.view, transition);
  };
  const goToProblem = (problem: ProblemTarget) =>
    go(routeProblem(problem, controller));
  return {
    goToProblem,
    openDiagnosis(diagnosis) {
      const transition = routeDiagnosis(diagnosis, controller);
      if (transition) go(transition);
      else host.notice(host.messages.workbench_problems_location_unknown());
    },
    showProblem(diagnostic) {
      registry.set(model.fieldsPicker, null);
      if (diagnostic === null) {
        problems.setOpen(true);
        return;
      }
      const id = renderDiagnosis(diagnostic).id;
      problems.select(id);
      const found = problems.diagnoses.find((diagnosis) => diagnosis.id === id);
      if (!found) return;
      // The occurrence the preview reported is the one whose place it shows.
      const shown = diagnosisForOccurrence(found, diagnostic);
      // A problem with no known place keeps the editor where it is: the
      // Problems area says so and offers the pane that holds the rest.
      const transition = diagnosisLocated(shown)
        ? routeDiagnosis(shown, controller)
        : null;
      if (transition) go(transition);
    },
    openAnnotationBox: () => goToProblem({ slice: "annotation" }),
    insertAnnotationLoop() {
      const { repaired, caret } = controller.insertAnnotationLoop();
      goToProblem({ slice: "note", range: { from: caret, to: caret } });
      if (repaired)
        host.notice(host.messages.workbench_annotation_section_added());
    },
    returnToTemplate() {
      const target = registry.get(model.view).presentation.selection;
      const reveal =
        target && controller.hasSlice(target.slice)
          ? { ...target.range, slice: target.slice }
          : { from: 0, to: 0 };
      go((state) => ({
        ...state,
        presentation: { ...state.presentation, reveal },
      }));
    },
  };
}
