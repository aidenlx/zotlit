// The Query View reads a diagnostic of ZotLit Query as one sentence and the
// line of the filter with a caret under the fault, from the diagnostic's
// fields rather than from the CLI report.
import { expect, it } from "vitest";

import { readerDiagnostic } from "./reader-diagnostic";
import type { ReaderDiagnosticSource } from "./reader-diagnostic";

const SYNTAX_FORMS = ["!", "(", "a name", "a string"];

/** A syntax fault as ZotLit Query gives it, without a correction. */
function syntaxFault(
  excerpt?: ReaderDiagnosticSource["excerpt"],
): ReaderDiagnosticSource {
  return {
    code: "invalid-filter",
    message: `Found end of filter where the filter takes ${SYNTAX_FORMS.join(", ")}.`,
    hint: `Use ${SYNTAX_FORMS.join(", ")}.`,
    found: "end of filter",
    expected: SYNTAX_FORMS,
    suggestions: [],
    ...(excerpt && { excerpt }),
  } as ReaderDiagnosticSource;
}

/** The line and the caret under it, as the view shows them. */
function shown(source: ReaderDiagnosticSource): string[] {
  const { excerpt } = readerDiagnostic(source);
  if (!excerpt) return [];
  return [excerpt.line, " ".repeat(excerpt.from) + "^".repeat(excerpt.length)];
}

it("puts the caret under the fault after a quoted string, in the shown text", () => {
  const before = 'tags.contains("figure") && title == "a" && ';
  expect(
    shown({
      code: "unknown-field",
      message: "colourName is not a field of Annotations.",
      hint: "Use colorName.",
      excerpt: { before, at: "colourName", after: ' == "yellow"' },
    }),
  ).toEqual([
    'tags.contains("figure") && title == "a" && colourName == "yellow"',
    `${" ".repeat(before.length)}${"^".repeat("colourName".length)}`,
  ]);
});

it("puts one caret at the end of the filter where the fault is its end", () => {
  const before = 'tags.contains("figure") && place !=';
  expect(shown(syntaxFault({ before, at: "", after: "" }))).toEqual([
    before,
    `${" ".repeat(before.length)}^`,
  ]);
});

it("shows only the line of the text that holds the fault", () => {
  expect(
    shown({
      code: "unknown-field",
      message: "nope is not a field of Items.",
      hint: "",
      excerpt: {
        before: "title != null\n&& ",
        at: "nope",
        after: " > 1\n|| x",
      },
    }),
  ).toEqual(["&& nope > 1", "   ^^^^"]);
});

it("names the forms a syntax error lacks once", () => {
  expect(readerDiagnostic(syntaxFault()).sentence).toBe(
    "Found end of filter where the filter takes !, (, a name, a string.",
  );
});

it("gives the correction of a syntax error after its message", () => {
  expect(
    readerDiagnostic({
      ...syntaxFault(),
      hint: "Try: a && b",
      suggestions: ["a && b"],
    }).sentence,
  ).toBe(
    "Found end of filter where the filter takes !, (, a name, a string. Try: a && b",
  );
});

it("keeps a hint that adds to the message", () => {
  expect(
    readerDiagnostic({
      code: "wrong-argument-type",
      message:
        "Argument 1 of contains is number; contains takes a string there.",
      hint: "Call contains(value: string).",
      expected: ["a string"],
      suggestions: [],
    }).sentence,
  ).toBe(
    "Argument 1 of contains is number; contains takes a string there. Call contains(value: string).",
  );
  expect(
    readerDiagnostic({
      code: "query-failed",
      message: "The database is locked.",
      hint: "",
    }).sentence,
  ).toBe("The database is locked.");
});
