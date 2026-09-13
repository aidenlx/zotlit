import type { RenderDiagnostic } from "#/render/result";
import { describe, expect, it } from "vitest";

import { MissingTemplateError, TemplateError } from "@zotlit/templates/facade";
import { PandocCitationError } from "@zotlit/templates/pandoc-citation";

import {
  diagnosisForOccurrence,
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisLocated,
  diagnosisReport,
  diagnosisWhere,
  diagnosticText,
  documentDiagnosis,
  problemText,
  renderDiagnosis,
  workbenchDiagnoses,
} from "./problems";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import {
  DEFAULT_PROFILE_SOURCE,
  captureRenderReport,
  formatRenderReport,
  engineEvidence,
  renderProfile,
  renderFailureDiagnostic,
  SAMPLE_ITEMS,
} from "#/render/index";

describe("problemText", () => {
  it("explains Liquid syntax and exposes its verified source and report", () => {
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "{% for annotation in zt.annotations %}",
      "{% for annotation i zt.annotations %}",
    );
    const failure = renderProfile(source, SAMPLE_ITEMS[0]!).diagnostics[0]!;
    const diagnosis = renderDiagnosis(failure);
    expect(diagnosisExplanation(m, diagnosis)).toMatchObject({
      condition: m.workbench_diagnostic_liquid_syntax_error(),
      suggestion: m.workbench_diagnostic_liquid_for_suggestion(),
    });
    expect(diagnosisWhere(m, diagnosis)).toBe(
      m.workbench_problems_highlight_error(),
    );
    expect(diagnosisLocated(diagnosis)).toBe(true);
    const report = captureRenderReport({
      diagnostic: failure,
      identity: { sourceRevision: "failed-source", snapshotRevision: "sample" },
      trigger: "explicit",
      sequence: 1,
      capturedAt: "2026-09-13T08:00:00Z",
      context: { language: "liquid", document: "Profile.md" },
    });
    expect(report.repairTarget).toBe(
      `offset ${failure.sourceSite!.from}-${failure.sourceSite!.to}`,
    );
    const text = formatRenderReport(report);
    expect(text).toContain("liquid-syntax-error");
    expect(text).toContain(
      "illegal tag: {% for annotation i zt.annotations %}",
    );
    expect(text).toContain(failure.evidence!.stack);
  });

  it("shows an unclassified engine error instead of replacing its cause", () => {
    const diagnosis = renderDiagnosis({
      code: "render-error",
      message:
        "Cannot read properties of undefined (reading 'title')\n    at template:4",
    });
    expect(diagnosisExplanation(m, diagnosis).condition).toBe(
      "Cannot read properties of undefined (reading 'title')",
    );
  });

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

  it("names the bundled partials a vault-side document still carries", () => {
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
    // The recovery is a text suggestion like every other one: unpacking writes
    // files, which the host offers among its ordinary partial operations
    // rather than inside the reading of a problem (ADR 0056).
    expect(problemText(m, problem)).toEqual({
      message: m.workbench_problem_bundled_partial({ names: "authors" }),
      recovery: m.workbench_problem_bundled_partial_recovery(),
    });
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

  it("keeps a short preview notice and exposes the cause in Problems", () => {
    const failure = {
      code: "render-error",
      message: "Unexpected tag",
      part: "render",
    } as const;

    expect(diagnosticText(m, failure)).toBe(
      m.workbench_diagnostic_render_error(),
    );
    // Problems shows the cause without requiring a second disclosure.
    expect(diagnosisExplanation(m, renderDiagnosis(failure))).toEqual({
      object: m.workbench_problems_object_profile(),
      condition: "Unexpected tag",
      suggestion: m.workbench_diagnostic_render_error_suggestion(),
      evidence: "Unexpected tag",
    });
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

  it("locates a missing partial at the first call when several calls name it", () => {
    const source =
      '{% if false %}{% render "venue-line" %}{% endif %}\n{% render "venue-line" %}';
    const failure = renderFailureDiagnostic(
      new MissingTemplateError("venue-line"),
      { source, language: "liquid" },
    );

    expect(failure.callSite).toEqual({ from: 14, to: 39 });
    expect(
      renderFailureDiagnostic(new MissingTemplateError("venue-line"), {
        source: '{% render "venue-line" %}',
        language: "liquid",
      }).callSite,
    ).toEqual({ from: 0, to: '{% render "venue-line" %}'.length });
  });

  it("keeps a Citation Template filter failure unclassified", () => {
    const error = new TemplateError(
      "pandoc_cite requires a Citation Item array",
      "citation",
      {
        cause: new PandocCitationError(
          "invalid-input",
          "pandoc_cite requires a Citation Item array",
          { property: "items" },
        ),
      },
    );
    const diagnostic = renderFailureDiagnostic(error, {
      source: '{{ "bad" | pandoc_cite }}',
      language: "liquid",
    });
    const found = renderDiagnosis({
      ...diagnostic,
      evidence: engineEvidence(error),
      part: "render",
    });

    expect(diagnostic.code).toBe("render-error");
    expect(diagnosisExplanation(m, found)).toEqual({
      object: m.workbench_problems_object_profile(),
      condition: "pandoc_cite requires a Citation Item array",
      suggestion: m.workbench_diagnostic_render_error_suggestion(),
      evidence: "pandoc_cite requires a Citation Item array",
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

  it("keeps a document problem identity when an edit only moves its range", () => {
    const before = documentDiagnosis({
      code: "unknown-section-header",
      params: { section: "wrong" },
      slice: "advanced",
      range: { from: 32, to: 46 },
    });
    const after = documentDiagnosis({
      code: "unknown-section-header",
      params: { section: "wrong" },
      slice: "advanced",
      range: { from: 58, to: 72 },
    });

    expect(after.id).toBe(before.id);
  });

  it("keeps one problem's identity through an edit that moves its call", () => {
    const at = (from: number) =>
      renderDiagnosis({
        code: "missing-partial",
        params: { name: "book-details" },
        part: "render",
        callSite: { from, to: from + 27 },
      }).id;

    // Typing above the call moves every offset below it and changes nothing
    // about the failure, so the reader stays on the problem they are reading.
    expect(at(512)).toBe(at(395));
    // Another partial is another problem, whatever either call's offset is.
    expect(
      renderDiagnosis({
        code: "missing-partial",
        params: { name: "venue-line" },
        part: "render",
        callSite: { from: 395, to: 422 },
      }).id,
    ).not.toBe(at(395));
  });

  it.each([false, true])(
    "keeps named failures distinct when only their template name matches (call: %s)",
    (withCall) => {
      const failure = (line: number): RenderDiagnostic => ({
        code: "render-error",
        part: "render",
        message: `Failure at line ${line}`,
        engine: { template: "citation", line, column: 1 },
        ...(withCall
          ? { callSite: { from: line * 10, to: line * 10 + 8 } }
          : {}),
      });
      expect(renderDiagnosis(failure(2)).id).not.toBe(
        renderDiagnosis(failure(3)).id,
      );
      expect(
        renderDiagnosis({ ...failure(2), part: "annotation" }).id,
      ).not.toBe(renderDiagnosis(failure(2)).id);
    },
  );

  it("selects the second unattributed occurrence by its direct diagnosis id", () => {
    const first: RenderDiagnostic = {
      code: "render-error",
      message: "Failure",
    };
    const second: RenderDiagnostic = { ...first };
    const selectedId = renderDiagnosis(second).id;
    const diagnoses = workbenchDiagnoses([], [first, second]);
    const selected = diagnoses.find(({ id }) => id === selectedId);
    expect(selected?.kind === "render" && selected.diagnostic).toBe(second);
    expect(selected?.occurrences).toHaveLength(1);
    expect(renderDiagnosis(first).id).not.toBe(renderDiagnosis(second).id);
  });

  it("keeps a named missing partial selected without a verified source location", () => {
    const failure = (): RenderDiagnostic => ({
      ...renderFailureDiagnostic(new MissingTemplateError("venue-line"), {
        source: '{% render "summary" %}',
        language: "liquid",
      }),
      part: "render",
    });
    const first = failure();
    const recurrence = failure();
    expect(first.engine).toBeUndefined();
    expect(first.callSite).toBeUndefined();
    expect(renderDiagnosis(recurrence).id).toBe(renderDiagnosis(first).id);
    expect(
      workbenchDiagnoses([], [first, recurrence]).map(
        ({ occurrences }) => occurrences,
      ),
    ).toEqual([[first, recurrence]]);
  });

  it("gives each unattributed failure a problem of its own", () => {
    const failure = (message: string) =>
      ({ code: "render-error", message, part: "render" }) as const;
    const [first, second, ...rest] = workbenchDiagnoses(
      [],
      [failure("Unexpected tag"), failure("Unexpected tag")],
    );

    // Nothing is verified about either, so nothing establishes them as one
    // problem — least of all the words they share. Both explanations, and both
    // reports, stay reachable.
    expect(rest).toEqual([]);
    expect(first!.id).not.toBe(second!.id);
    expect([first, second].map((found) => found!.occurrences.length)).toEqual([
      1, 1,
    ]);
    // A named object and the same verified call make two occurrences one problem.
    expect(
      workbenchDiagnoses(
        [],
        [
          {
            code: "missing-partial",
            params: { name: "venue-line" },
            callSite: { from: 10, to: 30 },
          },
          {
            code: "missing-partial",
            params: { name: "venue-line" },
            callSite: { from: 10, to: 30 },
          },
        ],
      ).map(({ occurrences }) => occurrences.length),
    ).toEqual([2]);
  });

  it("keeps unrelated failures in one template separate", () => {
    const failure = (line: number, from: number) => ({
      code: "render-error" as const,
      message: "Unexpected tag",
      part: "render" as const,
      engine: { template: "shared", line, column: 1 },
      callSite: { from, to: from + 12 },
    });

    expect(
      workbenchDiagnoses([], [failure(2, 20), failure(8, 60)]),
    ).toHaveLength(2);
  });

  it.each([true, false])(
    "keeps branch failures separately selectable (verified call: %s)",
    (withCall) => {
      const failure = (line: number): RenderDiagnostic => ({
        code: "render-error",
        part: "render",
        engine: { template: "shared", line, column: 1 },
        evidence: { name: "RenderError", message: "Unknown filter" },
        ...(withCall
          ? { callSite: { from: 20, to: 32 }, callIdentity: "render shared" }
          : {}),
      });
      const first = failure(2);
      const second = failure(8);
      const diagnoses = workbenchDiagnoses([], [first, second]);
      expect(diagnoses).toHaveLength(2);
      expect(new Set(diagnoses.map(({ id }) => id)).size).toBe(2);
      expect(
        diagnoses.find(({ id }) => id === renderDiagnosis(second).id)
          ?.occurrences,
      ).toEqual([second]);
    },
  );

  it("keeps a verified engine failure selected across checks and caller edits", () => {
    const first: RenderDiagnostic = {
      code: "render-error",
      part: "render",
      engine: { template: "shared", line: 2, column: 1 },
      callSite: { from: 20, to: 32 },
      callIdentity: "render shared",
      evidence: { name: "RenderError", message: "Unknown filter" },
    };
    const afterEdit = { ...first, callSite: { from: 50, to: 62 } };
    expect(renderDiagnosis(afterEdit).id).toBe(renderDiagnosis(first).id);
    expect(
      workbenchDiagnoses([], [first, afterEdit]).map(
        ({ occurrences }) => occurrences,
      ),
    ).toEqual([[first, afterEdit]]);
  });

  it("keeps different engine causes at the same call separately selectable", () => {
    const first: RenderDiagnostic = {
      code: "render-error",
      part: "render",
      engine: { template: "shared", line: 2, column: 1 },
      callIdentity: "render shared",
      evidence: {
        name: "RenderError",
        message: "Invalid value",
        causes: ["Missing title"],
      },
    };
    const second: RenderDiagnostic = {
      ...first,
      evidence: {
        name: "RenderError",
        message: "Invalid value",
        causes: ["Missing author"],
      },
    };
    const diagnoses = workbenchDiagnoses([], [first, second]);
    expect(diagnoses).toHaveLength(2);
    expect(new Set(diagnoses.map(({ id }) => id)).size).toBe(2);
  });

  it("keeps an unattributed survivor's identity when an earlier failure disappears", () => {
    const first = {
      code: "render-error" as const,
      message: "First failure",
      part: "render" as const,
    };
    const survivor = {
      code: "render-error" as const,
      message: "Surviving failure",
      part: "render" as const,
    };
    const before = workbenchDiagnoses([], [first, survivor]);
    const after = workbenchDiagnoses([], [survivor]);

    expect(after[0]!.id).toBe(before[1]!.id);
  });

  it("keeps each grouped preview occurrence's evidence and selects it", () => {
    const report = (selection: string) => ({
      code: "missing-partial",
      capturedAt: "2026-09-13T00:00:00Z",
      trigger: "automatic" as const,
      identity: { sourceRevision: "source", snapshotRevision: selection },
      context: { selection },
    });
    const first = {
      code: "missing-partial" as const,
      params: { name: "book-details" },
      part: "render" as const,
      callSite: { from: 10, to: 30 },
      evidence: { message: "first preview" },
      report: report("item-one"),
    };
    const second = {
      ...first,
      evidence: { message: "second preview" },
      report: report("item-two"),
    };
    const diagnosis = workbenchDiagnoses([], [first, second])[0]!;
    if (diagnosis.kind !== "render")
      throw new Error("Expected a render diagnosis");

    expect(
      diagnosis.occurrences.map((found) => found.report?.context.selection),
    ).toEqual(["item-one", "item-two"]);
    const selected = diagnosisForOccurrence(diagnosis, second);
    if (selected.kind !== "render")
      throw new Error("Expected a render diagnosis");
    expect(selected.diagnostic).toBe(second);
    expect(diagnosisReport(selected)).toBe(second.report);
  });

  it("names a Citation Template for a generic citation render failure", () => {
    const diagnosis = renderDiagnosis({
      code: "render-error",
      message: "Citation Template failed",
      part: "render",
      report: {
        code: "render-error",
        capturedAt: "2026-09-13T00:00:00Z",
        trigger: "automatic",
        identity: { sourceRevision: "source", snapshotRevision: "item" },
        context: { root: "citation" },
      },
    });

    expect(diagnosisExplanation(m, diagnosis).object).toBe(
      m.workbench_problems_object_citation(),
    );
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
