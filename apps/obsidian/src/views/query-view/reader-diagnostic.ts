// A diagnostic of ZotLit Query as the researcher reads it in the Query View:
// one sentence, and the line of the filter with a caret under the fault. It
// reads the diagnostic's fields; the CLI `report` stays the agent's text.
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
   * The line of the text that holds the fault, as the view shows it: the
   * fault starts `from` characters into `line` and runs `length` characters.
   */
  excerpt?: { line: string; from: number; length: number };
}

export function readerDiagnostic({
  message,
  hint,
  excerpt,
  expected = [],
  suggestions = [],
}: ReaderDiagnosticSource): ReaderDiagnostic {
  // A hint without a correction that names again the forms the message
  // names, such as those a syntax error lacks, adds nothing to it.
  const forms = expected.join(", ");
  const restates =
    suggestions.length === 0 &&
    forms !== "" &&
    message.includes(forms) &&
    hint.includes(forms);
  const sentence = [message, restates ? "" : hint].filter(Boolean).join(" ");
  if (!excerpt) return { sentence };
  // The caret counts characters of the shown line, from its start.
  const head = excerpt.before.slice(excerpt.before.lastIndexOf("\n") + 1);
  const [at = ""] = excerpt.at.split("\n");
  const tail = excerpt.at.includes("\n")
    ? ""
    : (excerpt.after.split("\n")[0] ?? "");
  return {
    sentence,
    excerpt: {
      line: head + at + tail,
      from: [...head].length,
      length: Math.max(1, [...at].length),
    },
  };
}
