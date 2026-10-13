import { describe, expect, it } from "vitest";

import { MissingTemplateError } from "@zotlit/templates/facade";

import {
  DIAGNOSTIC_HINTS,
  diagnostic,
  rejectionDiagnostic,
  templateFaultDiagnostic,
} from "./envelope";

describe("DIAGNOSTIC_HINTS", () => {
  it.each(Object.entries(DIAGNOSTIC_HINTS))(
    "%s is non-empty printable ASCII ending with a period",
    (_code, hint) => {
      expect(hint).toMatch(/^[\x20-\x7E]+$/);
      expect(hint.endsWith(".")).toBe(true);
    },
  );
});

// Golden Diagnostic Reports, rendered from fixed fault values with no engine.
describe("Diagnostic Report", () => {
  const noCompileErrors = new Map();

  it("excerpts the line of a render fault at the token the engine reported", () => {
    const source = "# {{ zt.title }}\n{{ zt.creators | bogus: 1 }}\n";
    const error = Object.assign(
      new Error("undefined filter: bogus, line:2, col:1"),
      { token: { input: source, begin: 17, end: 45, file: "note" } },
    );

    expect(
      templateFaultDiagnostic(error, {
        template: "note",
        compileErrors: noCompileErrors,
      }),
    ).toEqual({
      code: "TEMPLATE_RENDER_ERROR",
      message: "undefined filter: bogus, line:2, col:1",
      hint: 'Correct "{{ zt.creators | bogus: 1 }}" at note:2:1, or the selected object, then run the command again.',
      details: {
        template: "note",
        line: 2,
        column: 1,
        context: "{{ zt.creators | bogus: 1 }}\n^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
      },
      location: { span: { from: 17, to: 45 } },
      severity: "error",
      report: [
        "undefined filter: bogus, line:2, col:1",
        "--> note:2:1",
        "{{ zt.creators | bogus: 1 }}",
        "^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
        'Correct "{{ zt.creators | bogus: 1 }}" at note:2:1, or the selected object, then run the command again.',
        DIAGNOSTIC_HINTS.TEMPLATE_RENDER_ERROR,
      ],
      excerpt: { before: "", at: "{{ zt.creators | bogus: 1 }}", after: "" },
      found: "{{ zt.creators | bogus: 1 }}",
      expected: [],
      suggestions: [],
    });
  });

  it("draws a recorded compile error's excerpt from its span, not the engine's text", () => {
    const compileErrors = new Map([
      [
        "note",
        {
          message:
            "note: unclosed tag at line 2 col 5:\n\n  <%= it.title\n      ^",
          at: { source: "# Title\nAbc <%= it.title", from: 12, to: 13 },
        },
      ],
    ]);

    const value = templateFaultDiagnostic(new Error("not compiled"), {
      template: "note",
      compileErrors,
    });

    expect(value).toMatchObject({
      code: "TEMPLATE_COMPILE_ERROR",
      message: "note: unclosed tag at line 2 col 5.",
      hint: "Correct the syntax at note:2:5, then render again.",
      details: { template: "note", line: 2, column: 5 },
      location: { span: { from: 12, to: 13 } },
    });
    expect(value.report).toEqual([
      "note: unclosed tag at line 2 col 5.",
      "--> note:2:5",
      "Abc <%= it.title",
      "    ^",
      "Correct the syntax at note:2:5, then render again.",
      DIAGNOSTIC_HINTS.TEMPLATE_COMPILE_ERROR,
    ]);
    expect(value.details).toHaveProperty("context", "Abc <%= it.title\n    ^");
  });

  it("names the missing partial's file before the registered action", () => {
    expect(
      templateFaultDiagnostic(new MissingTemplateError("authors"), {
        template: "note",
        compileErrors: noCompileErrors,
      }).report,
    ).toEqual([
      'Template "authors" not found',
      "Create zotlit-partial.authors.md in the template folder, or correct the name 'authors' that the template calls.",
      DIAGNOSTIC_HINTS.MISSING_PARTIAL,
    ]);
  });

  it("keeps the valibot path and received value of a rejected parameter", () => {
    expect(
      rejectionDiagnostic({
        kind: "invalid",
        parameter: "root",
        message: "root must be 'note' or 'annotation'.",
        issue: {
          path: "root",
          expected: '"note" | "annotation"',
          received: '"nite"',
          keys: ["root"],
          input: "nite",
          allowed: ["note", "annotation"],
        },
        received: [["root", "nite"]],
      }),
    ).toEqual({
      code: "INVALID_SELECTOR",
      message: "root must be 'note' or 'annotation'.",
      hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
      details: { parameter: "root" },
      location: { argument: "root", path: "root" },
      severity: "error",
      report: [
        "root must be 'note' or 'annotation'.",
        DIAGNOSTIC_HINTS.INVALID_SELECTOR,
      ],
      found: '"nite"',
      expected: ["note", "annotation"],
      suggestions: [],
    });
  });

  it("ends a report with the registered action when nothing is more specific", () => {
    expect(
      diagnostic("TEMPLATE_NOT_READY", "Template compilation did not settle.")
        .report,
    ).toEqual([
      "Template compilation did not settle.",
      DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
    ]);
  });
});
