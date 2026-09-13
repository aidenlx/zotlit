import { describe, expect, it } from "vitest";

import {
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisLocated,
  diagnosisWhere,
  diagnosticText,
  problemAction,
  problemText,
  renderDiagnosis,
} from "./problems";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
  SAMPLE_ITEMS,
} from "#/render/index";

describe("problemText", () => {
  it("writes the web host's own codes in the reader's catalog", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta"),
    );

    expect(problemText(m, controller.problems[0]!)).toEqual({
      message: m.workbench_problem_unsupported_language(),
      recovery: m.workbench_problem_unsupported_recovery(),
    });
  });

  it("names the partial and the property a refused code came from", () => {
    expect(
      problemText(m, {
        code: "unsupported-partial-language",
        params: { name: "summary" },
        slice: "advanced",
      }).message,
    ).toContain("summary");
    expect(
      problemText(m, {
        code: "unsupported-js",
        params: { key: "computed" },
        slice: "advanced",
      }).message,
    ).toContain("computed");
    expect(
      problemText(m, { code: "unsupported-js", slice: "advanced" }).message,
    ).toBe(m.workbench_problem_unsupported_js_unnamed());
  });

  it("writes a parser code in the catalog rather than the parser's English", () => {
    const controller = new WorkbenchDocumentController("not a profile");

    expect(problemText(m, controller.problems[0]!)).toEqual({
      message: m.workbench_problem_invalid_document(),
      recovery: m.workbench_problem_invalid_document_recovery(),
    });
  });

  it("names the bundled partials a vault-side document still carries, with an unpack button", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace(
        "filename:",
        [
          "partials:",
          "  - name: authors",
          "    language: liquid",
          "    source: Authors",
          "filename:",
        ].join("\n"),
      ),
      { runtime: "native" },
    );
    const problem = controller.problems[0]!;

    expect(problem.code).toBe("bundled-partial");
    expect(problemText(m, problem)).toEqual({
      message: m.workbench_problem_bundled_partial({ names: "authors" }),
      recovery: m.workbench_problem_bundled_partial_recovery(),
    });
    expect(problemAction(m, problem)).toBe(
      m.workbench_problem_bundled_partial_unpack(),
    );
    expect(
      problemAction(m, { code: "invalid-document", slice: "advanced" }),
    ).toBeNull();
  });

  it("leaves the web host to read a bundle as the transport it is", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace(
        "filename:",
        [
          "partials:",
          "  - name: authors",
          "    language: liquid",
          "    source: Authors",
          "filename:",
        ].join("\n"),
      ),
    );

    expect(controller.problems).toEqual([]);
  });

  it("names the manifest field a schema failure came from", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace(/^name: .*$/m, "name: 12"),
    );

    expect(problemText(m, controller.problems[0]!).message).toContain("name");
  });
});

describe("diagnosticText", () => {
  it("writes a citation-style failure under the reason it carries", () => {
    const [diagnostic] = renderProfile(
      DEFAULT_PROFILE_SOURCE,
      SAMPLE_ITEMS[0]!,
      {
        resources: {
          dependencies: { templates: [], diagnostics: [] },
          citationStyle: {
            kind: "failed",
            styleId: "apa",
            reason: "parent-missing",
            parentId: "apa-base",
          },
        },
      },
    ).diagnostics;

    expect(diagnosticText(m, diagnostic!)).toBe(
      m.workbench_diagnostic_citation_style_parent_missing({
        styleId: "apa",
        parentId: "apa-base",
      }),
    );
  });

  it("names an Eta dependency the renderer refused, and keeps a bridge's own wording", () => {
    expect(
      diagnosticText(m, {
        code: "unsupported-dependency",
        params: { name: "summary" },
        part: "profile",
      }),
    ).toBe(m.workbench_diagnostic_unsupported_dependency({ name: "summary" }));
    expect(
      diagnosticText(m, {
        code: "unsupported-dependency",
        message: "Template dependency 'summary' uses an unsupported language.",
        part: "profile",
      }),
    ).toBe("Template dependency 'summary' uses an unsupported language.");
  });

  it("names the Shared Partial the engine could not resolve", () => {
    expect(
      diagnosticText(m, {
        code: "missing-partial",
        params: { name: "venue-line" },
        part: "render",
      }),
    ).toBe(m.workbench_diagnostic_missing_partial({ name: "venue-line" }));
  });

  it("shows the engine's own failure text for a render error", () => {
    expect(
      diagnosticText(m, {
        code: "render-error",
        message: "Unexpected tag",
        part: "render",
      }),
    ).toBe("Unexpected tag");
  });
});

describe("attribution", () => {
  /** A Note calling Citation text with the note's own data: the engine fails
   *  inside the Citation Template, and the call in the note is the repair. */
  const callerData = renderDiagnosis({
    code: "citation-data-mismatch",
    message:
      "pandoc_cite requires a Citation Item array, file:citation, line:4, col:3",
    part: "render",
    engine: { template: "citation", line: 4, column: 3 },
    callSite: { from: 395, to: 418 },
  });

  it("reads the engine's own location apart from the call it sends the reader to", () => {
    expect(diagnosisEngineSources(m, callerData)).toEqual([
      m.workbench_problems_engine_source_line({
        template: "citation",
        line: 4,
      }),
    ]);
    expect(diagnosisWhere(m, callerData)).toBe(
      m.workbench_problems_where_call(),
    );
    expect(diagnosisLocated(callerData)).toBe(true);
  });

  it("explains the caller's data rather than the template the engine named", () => {
    expect(diagnosisExplanation(m, callerData)).toEqual({
      object: m.workbench_problems_object_citation(),
      condition: m.workbench_diagnostic_citation_data_mismatch(),
      suggestion: m.workbench_diagnostic_citation_data_suggestion(),
      evidence:
        "pandoc_cite requires a Citation Item array, file:citation, line:4, col:3",
    });
  });

  it("leaves an unclassified failure without a repair location and says so", () => {
    const unknown = renderDiagnosis({
      code: "render-error",
      message: "undefined filter: bogus_filter, file:paper:body, line:5, col:1",
      part: "render",
      engine: { template: "paper:body", line: 5, column: 1 },
    });

    expect(diagnosisLocated(unknown)).toBe(false);
    expect(diagnosisWhere(m, unknown)).toBe(
      m.workbench_problems_where_advanced(),
    );
    // The engine's claim survives; it is not promoted into a repair location.
    expect(diagnosisEngineSources(m, unknown)).toEqual([
      m.workbench_problems_engine_source_line({
        template: "paper:body",
        line: 5,
      }),
    ]);
    expect(diagnosisExplanation(m, unknown).suggestion).toBe(
      m.workbench_diagnostic_render_error_suggestion(),
    );
  });

  it("keeps one code naming one partial at two calls as two problems", () => {
    const at = (from: number) =>
      renderDiagnosis({
        code: "missing-partial",
        params: { name: "book-details" },
        part: "render",
        callSite: { from, to: from + 27 },
      }).id;

    expect(at(395)).not.toBe(at(512));
    expect(at(395)).toBe(at(395));
  });

  it("says no verified location for a failure the engine reported nowhere", () => {
    expect(
      diagnosisEngineSources(
        m,
        renderDiagnosis({ code: "render-error", message: "boom" }),
      ),
    ).toEqual([]);
  });
});
