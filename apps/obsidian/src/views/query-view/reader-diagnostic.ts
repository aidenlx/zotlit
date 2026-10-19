// A diagnostic of ZotLit Query as the researcher reads it in the Query View:
// one sentence, the corrections ZotLit Query gives, and the line of the
// filter with a caret under the fault. It reads the diagnostic's fields; the
// CLI `report` stays the agent's text.
import * as m from "@/lib/i18n/generated/messages";
import type { Diagnostic } from "@/services/item-query/contract";

/** The fields of a diagnostic that the view reads. */
export type ReaderDiagnosticSource = Pick<Diagnostic, "message" | "hint"> &
  Partial<Pick<Diagnostic, "excerpt" | "expected" | "suggestions">> & {
    code: string;
  };

export interface ReaderDiagnostic {
  /** The message, with the hint after it where the hint adds to it. */
  sentence: string;
  /**
   * Each correction ZotLit Query gives, where it gives more than the one
   * that a hint names; empty otherwise.
   */
  corrections: readonly string[];
  /**
   * The line of the text that holds the fault, as the view shows it: the
   * fault starts `from` characters into `line` and runs `length` characters.
   */
  excerpt?: { line: string; from: number; length: number };
}

export function readerDiagnostic(
  source: ReaderDiagnosticSource,
): ReaderDiagnostic {
  const { message, hint, excerpt, suggestions = [] } = source;
  const sentence = [message, restates(source) ? "" : hint]
    .filter(Boolean)
    .join(" ");
  // A hint names one correction at most; the others show as a list.
  const corrections = suggestions.length > 1 ? suggestions : [];
  if (!excerpt) return { sentence, corrections };
  // The caret counts characters of the shown line, from its start.
  const head = excerpt.before.slice(excerpt.before.lastIndexOf("\n") + 1);
  const [at = ""] = excerpt.at.split("\n");
  const tail = excerpt.at.includes("\n")
    ? ""
    : (excerpt.after.split("\n")[0] ?? "");
  return {
    sentence,
    corrections,
    excerpt: {
      line: head + at + tail,
      // oxlint-disable-next-line typescript/no-misused-spread -- offsets count code points, not grapheme clusters
      from: [...head].length,
      // oxlint-disable-next-line typescript/no-misused-spread -- offsets count code points, not grapheme clusters
      length: Math.max(1, [...at].length),
    },
  };
}

/**
 * Whether the hint only lists again the forms that end the message, such as
 * the tokens a syntax error lacks: it offers no correction, and it is one
 * word followed by exactly the `expected` list, as the message ends with it.
 */
function restates({
  message,
  hint,
  expected = [],
  suggestions = [],
}: ReaderDiagnosticSource): boolean {
  if (suggestions.length > 0 || expected.length === 0) return false;
  const list = `${expected.join(", ")}.`;
  if (!message.endsWith(` ${list}`) || !hint.endsWith(` ${list}`)) return false;
  const lead = hint.slice(0, -list.length - 1);
  return lead !== "" && !/\s/.test(lead);
}

/** The sentence of a diagnostic, with its corrections after it. */
export function readerText(source: ReaderDiagnosticSource): string {
  const { sentence, corrections } = readerDiagnostic(source);
  return [sentence, correctionsText(corrections)].filter(Boolean).join(" ");
}

/** The corrections of a diagnostic as one sentence; empty where it has none. */
export function correctionsText(corrections: readonly string[]): string {
  if (corrections.length === 0) return "";
  return m.query_view_diagnostic_corrections({
    suggestions: corrections.join(", "),
  });
}
