// The reader's wording for what the core reports. The core renders in a
// browser page and inside Obsidian, so it names a problem by code and hands
// over the values that fill it; every code is written here, once for both
// hosts, so a reader outside English reads their own language.

import type { WorkbenchProblem, WorkbenchSliceId } from "#/document/controller";
import type { RenderReport } from "#/render/report";
import type { RenderDiagnostic } from "#/render/result";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";

import { entryPosition } from "#/document/controller";

/** What the Problems strip and the handoff screen read for one problem. */
export interface ProblemText {
  readonly message: string;
  /** What to do about it, absent when the message is the whole answer. */
  readonly recovery?: string;
}

export function problemText(
  m: WorkbenchMessages,
  problem: WorkbenchProblem,
): ProblemText {
  const handoff = (message: string): ProblemText => ({
    message,
    recovery: m.workbench_problem_unsupported_recovery(),
  });
  switch (problem.code) {
    case "unsupported-language":
      return handoff(m.workbench_problem_unsupported_language());
    case "unsupported-partial-language":
      return handoff(
        m.workbench_problem_unsupported_partial({
          name: String(problem.params?.name),
        }),
      );
    case "unsupported-js":
      return handoff(
        problem.params?.key === undefined
          ? m.workbench_problem_unsupported_js_unnamed()
          : m.workbench_problem_unsupported_js({ key: problem.params.key }),
      );
    case "invalid-document":
      return {
        message: m.workbench_problem_invalid_document(),
        recovery: m.workbench_problem_invalid_document_recovery(),
      };
    case "invalid-manifest":
      return {
        // The field the parser named, when it could name one; a YAML syntax
        // failure names no field, and the reveal points at the text instead.
        message:
          problem.params?.field === undefined
            ? m.workbench_problem_invalid_manifest()
            : m.workbench_problem_invalid_manifest_field({
                field: problem.params.field,
              }),
        recovery: m.workbench_problem_invalid_manifest_recovery(),
      };
    case "invalid-managed-block":
      return {
        message: m.workbench_problem_invalid_managed_block(),
        recovery: m.workbench_problem_invalid_managed_block_recovery(),
      };
    case "duplicate-managed-block":
      return {
        message: m.workbench_problem_duplicate_managed_block(),
        recovery: m.workbench_problem_duplicate_managed_block_recovery(),
      };
    case "unknown-section-header":
      return {
        message: m.workbench_problem_unknown_section_header(),
        recovery: m.workbench_problem_unknown_section_header_recovery(),
      };
    case "duplicate-annotation-section":
      return {
        message: m.workbench_problem_duplicate_annotation_section(),
        recovery: m.workbench_problem_duplicate_annotation_section_recovery(),
      };
    case "missing-annotation-section":
      return {
        message: m.workbench_problem_missing_annotation_section(),
        recovery: m.workbench_problem_missing_annotation_section_recovery(),
      };
    case "reserved-annotation-partial":
      return {
        message: m.workbench_problem_reserved_annotation_partial(),
        recovery: m.workbench_problem_reserved_annotation_partial_recovery(),
      };
    case "bundled-partial":
      return {
        message: m.workbench_problem_bundled_partial({
          names: String(problem.params?.names),
        }),
        recovery: m.workbench_problem_bundled_partial_recovery(),
      };
  }
}

/**
 * The button one problem carries beside its recovery line, for a problem the
 * host can repair on the reader's word. Absent for every code whose repair is
 * the reader's own edit.
 */
export function problemAction(
  m: WorkbenchMessages,
  problem: WorkbenchProblem,
): string | null {
  return problem.code === "bundled-partial"
    ? m.workbench_problem_bundled_partial_unpack()
    : null;
}

/** The one line a render diagnostic reads as. */
export function diagnosticText(
  m: WorkbenchMessages,
  diagnostic: RenderDiagnostic,
): string {
  const params = diagnostic.params ?? {};
  switch (diagnostic.code) {
    case "contract-version-mismatch":
      return m.workbench_diagnostic_contract_mismatch({
        found: String(params.found),
        expected: String(params.expected),
      });
    case "citation-style-error":
      return diagnostic.message ?? citationStyleText(m, params);
    case "property-error":
      return m.workbench_diagnostic_property_error({
        key: String(params.key),
        message: diagnostic.message ?? "",
      });
    case "property-javascript":
      return params.key === undefined
        ? m.workbench_diagnostic_property_javascript_unnamed({
            position: String(diagnostic.position),
          })
        : m.workbench_diagnostic_property_javascript({
            key: String(params.key),
          });
    case "missing-partial":
      // The engine's own render failure, which names the partial it could not
      // resolve; ADR 0055 rules out reading a missing partial off a scan.
      return m.workbench_diagnostic_missing_partial({
        name: String(params.name),
      });
    case "citation-data-mismatch":
      // The engine refused the Citation Template's own input, and the source
      // holds the call that handed it over: the caller's data, not the called
      // template, is what went wrong.
      return m.workbench_diagnostic_citation_data_mismatch();
    case "unsupported-dependency":
      // The renderer names the dependency it refused and leaves the words
      // here; a Local Bridge that reports its own bundle failure sends the
      // sentence instead, which falls to the default below.
      return params.name === undefined
        ? (diagnostic.message ?? diagnostic.code)
        : m.workbench_diagnostic_unsupported_dependency({
            name: String(params.name),
          });
    case "property-append-conflict": {
      const conflict = m.workbench_diagnostic_property_append_conflict({
        key: String(params.key),
      });
      // The merge's own recovery line, when it wrote one.
      return diagnostic.message
        ? `${conflict} ${diagnostic.message}`
        : conflict;
    }
    default:
      // The template engine's failure and the Local Bridge's own wording, which
      // this app shows as they stand.
      return diagnostic.message ?? diagnostic.code;
  }
}

function citationStyleText(
  m: WorkbenchMessages,
  params: NonNullable<RenderDiagnostic["params"]>,
): string {
  const styleId = String(params.styleId);
  switch (params.reason) {
    case "parent-missing":
      return m.workbench_diagnostic_citation_style_parent_missing({
        styleId,
        parentId: String(params.parentId),
      });
    case "unreadable":
      return m.workbench_diagnostic_citation_style_unreadable({ styleId });
    case "invalid":
      return m.workbench_diagnostic_citation_style_invalid({ styleId });
    default:
      return m.workbench_diagnostic_citation_style_missing({ styleId });
  }
}

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

/** What the Problems area's button reads: the pane `problem` is repaired in. */
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

/**
 * One problem the reader selects and reads in full. The two vocabularies the
 * Workbench reports in — the parser's own problems and the renderer's
 * diagnostics — reach the Problems area as one kind of thing, so a source
 * marker and the preview's Show problem name the same record.
 */
export type WorkbenchDiagnosis =
  | {
      readonly id: string;
      readonly kind: "document";
      readonly problem: WorkbenchProblem;
    }
  | {
      readonly id: string;
      readonly kind: "render";
      readonly diagnostic: RenderDiagnostic;
    };

/**
 * The object a render diagnostic names, which is what makes two occurrences of
 * one code the same problem rather than two.
 */
function diagnosticSubject(diagnostic: RenderDiagnostic): string {
  const params = diagnostic.params ?? {};
  return String(
    params.name ??
      params.key ??
      params.styleId ??
      // A failure the engine attributed to a template names that template,
      // which is the only object an unclassified one carries.
      diagnostic.engine?.template ??
      "",
  );
}

/**
 * A diagnosis's identity: its code, the object it names, and where it is
 * repaired. Equal message text establishes nothing, so no part of the identity
 * reads one.
 */
export function documentDiagnosis(
  problem: WorkbenchProblem,
): WorkbenchDiagnosis {
  return {
    id: `document:${problem.code}:${problem.slice}:${problem.range?.from ?? ""}`,
    kind: "document",
    problem,
  };
}

export function renderDiagnosis(
  diagnostic: RenderDiagnostic,
): WorkbenchDiagnosis {
  const { code, part, position, callSite } = diagnostic;
  // The verified call joins the identity, so one code naming one object in two
  // places stays two problems. An unverified location adds nothing, which is
  // what leaves an unclassified failure grouping with nothing.
  const repair = callSite ? `@${callSite.from}` : "";
  return {
    id: `render:${code}:${diagnosticSubject(diagnostic)}:${part ?? ""}:${position ?? ""}${repair}`,
    kind: "render",
    diagnostic,
  };
}

/**
 * Every problem one Workbench has found, parser problems first: the document
 * has to parse before a render can say anything about it.
 */
export function workbenchDiagnoses(
  problems: readonly WorkbenchProblem[],
  diagnostics: readonly RenderDiagnostic[],
): WorkbenchDiagnosis[] {
  const found = [
    ...problems.map(documentDiagnosis),
    ...diagnostics.map(renderDiagnosis),
  ];
  const seen = new Set<string>();
  return found.filter(({ id }) => !seen.has(id) && seen.add(id));
}

/** One problem as the Problems area reads it, top to bottom. */
export interface DiagnosisExplanation {
  /** The affected object, which the explanation leads with. */
  readonly object: string;
  /** What went wrong, in plain words. */
  readonly condition: string;
  /** What to check or change. Text only: the reader makes the repair. */
  readonly suggestion: string;
  /** The engine's own wording, kept under Technical details. */
  readonly evidence?: string;
}

/** The object a document problem is about, named as its own pane is. */
function problemObject(
  m: WorkbenchMessages,
  problem: WorkbenchProblem,
): string {
  if (problem.code === "missing-annotation-section") {
    return m.workbench_annotation_label();
  }
  if (entryPosition(problem.slice) !== null)
    return m.workbench_tab_properties();
  switch (problem.slice) {
    case "note":
      return m.workbench_tab_note();
    case "annotation":
      return m.workbench_annotation_label();
    case "filename":
      return m.workbench_name_filename_heading();
    case "details":
      return m.workbench_tab_profile();
    default:
      return m.workbench_advanced();
  }
}

/** The object a render diagnostic is about, named by what the render read. */
function diagnosticObject(
  m: WorkbenchMessages,
  diagnostic: RenderDiagnostic,
): string {
  const params = diagnostic.params ?? {};
  switch (diagnostic.code) {
    case "missing-partial":
      return m.workbench_problems_object_partial({ name: String(params.name) });
    case "citation-data-mismatch":
      return m.workbench_problems_object_citation();
    case "property-error":
    case "property-append-conflict":
      return m.workbench_problems_object_property({ key: String(params.key) });
    case "property-javascript":
      return params.key === undefined
        ? m.workbench_tab_properties()
        : m.workbench_problems_object_property({ key: String(params.key) });
    case "citation-style-error":
      return m.workbench_problems_object_style({
        styleId: String(params.styleId),
      });
    case "missing-dependency":
    case "unsupported-dependency":
      return params.name === undefined
        ? m.workbench_problems_object_profile()
        : m.workbench_problems_object_dependency({ name: String(params.name) });
    case "contract-version-mismatch":
    case "invalid-profile":
      return m.workbench_problems_object_profile();
    default:
      return diagnostic.part === "annotation"
        ? m.workbench_annotation_label()
        : diagnostic.position !== undefined
          ? m.workbench_tab_properties()
          : m.workbench_problems_object_profile();
  }
}

/** What to check or change for a render diagnostic; never a repair the app performs. */
function diagnosticSuggestion(
  m: WorkbenchMessages,
  diagnostic: RenderDiagnostic,
): string {
  switch (diagnostic.code) {
    case "missing-partial":
      return m.workbench_diagnostic_missing_partial_suggestion();
    case "citation-data-mismatch":
      return m.workbench_diagnostic_citation_data_suggestion();
    case "property-error":
      return m.workbench_diagnostic_property_error_suggestion();
    case "property-javascript":
      return m.workbench_diagnostic_property_javascript_suggestion();
    case "property-append-conflict":
      return m.workbench_diagnostic_property_append_conflict_suggestion();
    case "citation-style-error":
      return m.workbench_diagnostic_citation_style_suggestion();
    case "contract-version-mismatch":
      return m.workbench_diagnostic_contract_mismatch_suggestion();
    case "invalid-profile":
      return m.workbench_diagnostic_invalid_profile_suggestion();
    case "missing-dependency":
      return m.workbench_diagnostic_missing_dependency_suggestion();
    case "unsupported-dependency":
      return m.workbench_problem_unsupported_recovery();
    default:
      // An engine failure this package has not classified: the reader gets an
      // honest next step rather than a guessed repair.
      return m.workbench_diagnostic_render_error_suggestion();
  }
}

/** The whole explanation one diagnosis reads as. */
export function diagnosisExplanation(
  m: WorkbenchMessages,
  diagnosis: WorkbenchDiagnosis,
): DiagnosisExplanation {
  if (diagnosis.kind === "document") {
    const text = problemText(m, diagnosis.problem);
    return {
      object: problemObject(m, diagnosis.problem),
      condition: text.message,
      suggestion:
        text.recovery ?? m.workbench_diagnostic_render_error_suggestion(),
    };
  }
  const { diagnostic } = diagnosis;
  return {
    object: diagnosticObject(m, diagnostic),
    condition: diagnosticText(m, diagnostic),
    suggestion: diagnosticSuggestion(m, diagnostic),
    ...(diagnostic.message === undefined
      ? {}
      : { evidence: diagnostic.message }),
  };
}

/** The pane a diagnosis is repaired in, which its one navigation control opens. */
export function diagnosisWhere(
  m: WorkbenchMessages,
  diagnosis: WorkbenchDiagnosis,
): string {
  if (diagnosis.kind === "document") return problemWhere(m, diagnosis.problem);
  const { part, position, callSite } = diagnosis.diagnostic;
  // A verified call is where the reader repairs it, whichever template the
  // engine reported the failure inside.
  if (callSite) return m.workbench_problems_where_call();
  if (position !== undefined) return m.workbench_problems_where_entry();
  if (part === "annotation") return m.workbench_annotation_edit_format();
  return m.workbench_problems_where_advanced();
}

/**
 * What the engine itself reported, as its own sentence. It names the template
 * the engine failed inside, which a call may have reached from elsewhere, so it
 * is read apart from the suggestion and from the navigation control. Null when
 * the failure named no template.
 */
export function diagnosisEngineSource(
  m: WorkbenchMessages,
  diagnosis: WorkbenchDiagnosis,
): string | null {
  if (diagnosis.kind === "document") return null;
  const { engine } = diagnosis.diagnostic;
  if (!engine) return null;
  return engine.line === undefined
    ? m.workbench_problems_engine_source({ template: engine.template })
    : m.workbench_problems_engine_source_line({
        template: engine.template,
        line: engine.line,
      });
}

/**
 * The failed attempt behind a render diagnosis, as the scheduler captured it
 * with the result. A document problem is re-read from the current source on
 * every check, so the Problems area captures its report instead.
 */
export function diagnosisReport(
  diagnosis: WorkbenchDiagnosis,
): RenderReport | null {
  return diagnosis.kind === "render"
    ? (diagnosis.diagnostic.report ?? null)
    : null;
}

/**
 * Whether the source text behind a diagnosis is named. A reported engine line
 * is not automatically a line in the open document, so an unnamed location is
 * said to be unnamed rather than guessed at.
 */
export function diagnosisLocated(diagnosis: WorkbenchDiagnosis): boolean {
  return diagnosis.kind === "document"
    ? diagnosis.problem.range !== undefined
    : diagnosis.diagnostic.callSite !== undefined ||
        diagnosis.diagnostic.position !== undefined ||
        diagnosis.diagnostic.part === "annotation";
}
