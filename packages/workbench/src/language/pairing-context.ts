// Template context for input, using each language’s delimiter rules.
import { etaRange } from "./eta-syntax";
import { liquidCodeRange, liquidRanges } from "./liquid-ranges";
import type { SuggestionConfig } from "./suggestions";

type Context = "text" | "code" | "literal";

function quoted(source: string): boolean {
  let quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === "'" || char === '"') quote = char;
  }
  return quote !== "";
}

export function pairingContext(
  document: string,
  cursor: number,
  config: Pick<SuggestionConfig, "language" | "mode" | "scope">,
): Context {
  const start = config.scope?.from ?? 0;
  const end = config.scope?.to ?? document.length;
  if (cursor < start || cursor > end) return "literal";
  const source = document.slice(start, end);
  const position = cursor - start;
  if (config.language === "eta") {
    const range = etaRange(source, position);
    return range
      ? range.inLiteral || range.kind === "comment"
        ? "literal"
        : "code"
      : "text";
  }
  if (config.mode === "expression")
    return quoted(source.slice(0, position)) ? "literal" : "code";
  const ranges = liquidRanges(source);
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (
      range.name === "raw" &&
      position >= range.to &&
      position < (ranges[i + 1]?.from ?? source.length + 1)
    )
      return "literal";
    if (position > range.from && position < range.to) {
      if (range.kind === "comment") return "literal";
      const code = liquidCodeRange(source, position);
      if (!code || code.name === "#" || code.name === "comment")
        return "literal";
      return quoted(source.slice(code.from, position)) ? "literal" : "code";
    }
  }
  // An unfinished output/tag includes the cursor at its end.
  const last = ranges.at(-1);
  if (last && !last.closed && position === last.to) {
    const code = liquidCodeRange(source, position);
    return !code ||
      last.kind === "comment" ||
      code.name === "#" ||
      quoted(source.slice(code.from, position))
      ? "literal"
      : "code";
  }
  return "text";
}
