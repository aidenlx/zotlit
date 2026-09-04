import { describe, expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { diagnosticText, problemText } from "./problems";

describe("problemText", () => {
  it("writes the web host's own codes in the reader's catalog", () => {
    const controller = new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta"),
    );

    expect(problemText(controller.problems[0]!)).toEqual({
      message: m.workbench_problem_unsupported_language(),
      recovery: m.workbench_problem_unsupported_recovery(),
    });
  });

  it("names the partial and the property a refused code came from", () => {
    expect(
      problemText({
        code: "unsupported-partial-language",
        params: { name: "summary" },
        slice: "advanced",
      }).message,
    ).toContain("summary");
    expect(
      problemText({
        code: "unsupported-js",
        params: { key: "computed" },
        slice: "advanced",
      }).message,
    ).toContain("computed");
    expect(
      problemText({ code: "unsupported-js", slice: "advanced" }).message,
    ).toBe(m.workbench_problem_unsupported_js_unnamed());
  });

  it("shows the parser's own wording for every other code", () => {
    const controller = new WorkbenchDocumentController("not a profile");

    const [problem] = controller.problems;
    expect(problemText(problem!)).toEqual({
      message: problem!.message,
      recovery: problem!.recovery,
    });
  });
});

describe("diagnosticText", () => {
  it("writes a citation-style failure under the reason it carries", () => {
    const [diagnostic] = renderProfile(
      DEFAULT_PROFILE_SOURCE,
      SAMPLE_ITEMS[0]!,
      {
        dependencies: { templates: [], diagnostics: [] },
        citationStyle: {
          kind: "failed",
          styleId: "apa",
          reason: "parent-missing",
          parentId: "apa-base",
        },
      },
    ).diagnostics;

    expect(diagnosticText(diagnostic!)).toBe(
      m.workbench_diagnostic_citation_style_parent_missing({
        styleId: "apa",
        parentId: "apa-base",
      }),
    );
  });

  it("keeps the deadline the scheduler stopped a render at", () => {
    expect(
      diagnosticText({
        code: "render-timeout",
        params: { deadlineMs: 2000 },
        part: "render",
      }),
    ).toBe(m.workbench_diagnostic_render_timeout({ deadlineMs: "2000" }));
  });

  it("shows the engine's own failure text for a render error", () => {
    expect(
      diagnosticText({
        code: "render-error",
        message: "Unexpected tag",
        part: "render",
      }),
    ).toBe("Unexpected tag");
  });
});
