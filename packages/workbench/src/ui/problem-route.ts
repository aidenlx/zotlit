// Which pane repairs a problem: one transition of the view state that both
// hosts apply when the reader opens a problem from the Problems area, a result,
// or a row. It reads the controller for the slices the document has now.

import type {
  WorkbenchDocumentController,
  WorkbenchProblem,
  WorkbenchSliceId,
} from "#/document/controller";

import type { WorkbenchViewState } from "./model";
import type { WorkbenchDiagnosis } from "./problems";
import type { SliceReveal } from "./slice-editor";
import { isProfileProblem } from "./tabs";

import { entryPosition } from "#/document/controller";
import { currentCallSite } from "#/render/locate";

/** The document facts the routing reads. */
export type RoutedDocument = Pick<
  WorkbenchDocumentController,
  "kind" | "sliceRange" | "annotationSection" | "source" | "language"
>;

/** A problem as a host names the place to open. */
export type ProblemTarget = Pick<
  WorkbenchProblem,
  "slice" | "range" | "params"
> & {
  readonly code?: WorkbenchProblem["code"];
};

type Transition = (state: WorkbenchViewState) => WorkbenchViewState;

/** A caret at `from`: the reader goes on typing where the pane opens. */
const caret = (from: number): SliceReveal => ({ from, to: from });

/**
 * Opens the pane that edits `slice`, reveals `reveal` there, and focuses
 * `field` of the Name and folder form. A reveal is a new object each time,
 * so opening the same place twice reveals it again.
 */
function openPane(
  document: RoutedDocument,
  {
    slice,
    reveal,
    field = null,
    profile = false,
  }: {
    readonly slice: WorkbenchSliceId;
    readonly reveal: SliceReveal | null;
    readonly field?: string | null;
    /** Whether the Profile tab, not Name and folder, holds `field`. */
    readonly profile?: boolean;
  },
): Transition {
  return (state) => {
    const revealed = reveal ? { ...reveal } : null;
    // A plain document's every problem is in the one editor it opens with,
    // so its tabs stay as they are.
    if (document.kind !== "profile" || slice === "source")
      return {
        ...state,
        presentation: { ...state.presentation, reveal: revealed },
      };
    const entry = entryPosition(slice);
    return {
      ...state,
      advanced: slice === "advanced",
      tab:
        entry !== null
          ? "properties"
          : profile
            ? "profile"
            : slice === "filename" || slice === "details"
              ? "name"
              : slice === "annotation"
                ? "annotation"
                : slice === "advanced"
                  ? state.tab
                  : "note",
      root:
        slice === "annotation"
          ? "annotation"
          : slice === "filename"
            ? "filename"
            : "note",
      presentation: {
        ...state.presentation,
        selected: entry ?? state.presentation.selected,
        reveal: revealed,
        fieldFocus: field === null ? null : { field },
      },
    };
  };
}

/** The Annotation tab, with the caret at the start of its section. */
function openAnnotation(document: RoutedDocument): Transition {
  const section = document.annotationSection;
  return openPane(document, {
    slice: "annotation",
    reveal: section ? caret(section.source.from) : null,
  });
}

/** The pane that edits a document problem's slice, on the text it names. */
export function routeProblem(
  problem: ProblemTarget,
  document: RoutedDocument,
): Transition {
  // A missing section is added from the Annotation tab.
  if (
    problem.code === "missing-annotation-section" ||
    (problem.slice === "annotation" && problem.range === undefined)
  )
    return openAnnotation(document);
  // The Name and folder form writes its manifest fields through controls, so
  // a problem it owns focuses the control rather than revealing text.
  if (problem.slice === "details")
    return openPane(document, {
      slice: "details",
      reveal: null,
      field: problem.params?.field ?? null,
      profile: isProfileProblem(problem),
    });
  return openPane(document, {
    slice: problem.slice,
    reveal: problem.range ?? null,
  });
}

/**
 * The pane whose own region holds `from`, which is where a verified call is
 * repaired. Advanced holds whatever no editing pane covers.
 */
function sliceHolding(
  document: RoutedDocument,
  from: number,
): WorkbenchSliceId {
  if (document.kind !== "profile") return "source";
  for (const slice of ["note", "annotation", "filename"] as const) {
    const region = document.sliceRange(slice);
    if (region.from <= from && from < region.to) return slice;
  }
  return "advanced";
}

/**
 * The pane one selected problem is repaired in, whichever kind it is.
 * @returns null when a call the failure names is no longer in the source,
 * which the host tells the reader.
 */
export function routeDiagnosis(
  diagnosis: WorkbenchDiagnosis,
  document: RoutedDocument,
): Transition | null {
  if (diagnosis.kind === "document")
    return routeProblem(diagnosis.problem, document);
  const { part, position, callSite, sourceSite } = diagnosis.diagnostic;
  // A verified call outranks the part the engine reported the failure under:
  // a failure inside a called template is repaired where it was called.
  if (callSite || sourceSite) {
    const current = currentCallSite(diagnosis.diagnostic, document);
    if (current === undefined) return null;
    return openPane(document, {
      slice: sliceHolding(document, current.from),
      reveal: current,
    });
  }
  if (position !== undefined)
    return openPane(document, { slice: `entry:${position}`, reveal: null });
  if (document.kind !== "profile")
    return openPane(document, { slice: "source", reveal: null });
  if (part === "annotation") return openAnnotation(document);
  // The note name is repaired in its own tab, whether or not the failure
  // named a place inside it.
  if (part === "filename")
    return openPane(document, {
      slice: "filename",
      reveal: caret(document.sliceRange("filename").from),
    });
  return openPane(document, { slice: "advanced", reveal: null });
}
