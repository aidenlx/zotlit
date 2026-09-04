// The reader's wording for what the core reports. `@zotlit/workbench` renders
// inside a Worker and inside Obsidian, so it names a problem by code and hands
// over the values that fill it; every code is written here, in this app's own
// catalog, so a reader outside English reads their own language.

import type { WorkbenchProblem } from "@zotlit/workbench/document";
import type { RenderDiagnostic } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

/** What the Problems strip and the handoff screen read for one problem. */
export interface ProblemText {
  readonly message: string;
  /** What to do about it, absent when the message is the whole answer. */
  readonly recovery?: string;
}

export function problemText(problem: WorkbenchProblem): ProblemText {
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
  }
}

/** The one line a render diagnostic reads as. */
export function diagnosticText(diagnostic: RenderDiagnostic): string {
  const params = diagnostic.params ?? {};
  switch (diagnostic.code) {
    case "contract-version-mismatch":
      return m.workbench_diagnostic_contract_mismatch({
        found: String(params.found),
        expected: String(params.expected),
      });
    case "render-timeout":
      return m.workbench_diagnostic_render_timeout({
        deadlineMs: String(params.deadlineMs),
      });
    case "citation-style-error":
      return citationStyleText(params);
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
