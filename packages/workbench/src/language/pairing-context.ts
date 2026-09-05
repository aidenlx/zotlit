// Literal-aware template context for input, including Eta delimiters inside JS literals.
import { parser as javascriptParser } from "@lezer/javascript";

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

function closedLiteral(text: string, name: string): boolean {
  if (name === "BlockComment") return text.endsWith("*/");
  if (name === "LineComment") return false;
  if (name !== "RegExp") {
    let index = text.length - 2;
    while (text[index] === "\\") index--;
    return (
      text.length > 1 &&
      text.at(-1) === text[0] &&
      (text.length - 2 - index) % 2 === 0
    );
  }
  let characterClass = false;
  for (let index = 1; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") index++;
    else if (char === "[") characterClass = true;
    else if (char === "]") characterClass = false;
    else if (char === "/" && !characterClass) return true;
  }
  return false;
}

function etaContext(
  source: string,
  position: number,
  expression = false,
): Context {
  let from = expression ? 0 : source.indexOf("<%");
  while (from >= 0 && (from < position || expression)) {
    let body = expression ? 0 : from + 2;
    if (!expression) {
      if (source[body] === "-" || source[body] === "_") body++;
      if (source[body] === "=" || source[body] === "~") body++;
    }
    const code = source.slice(body);
    const literals: {
      from: number;
      to: number;
      name: string;
      unfinished?: boolean;
    }[] = [];
    javascriptParser.parse(code).iterate({
      enter(node) {
        // Lezer reports an unfinished regex character class as a stray slash.
        if (node.type.isError && code.slice(node.from, node.to) === "/") {
          const lineEnd = code.indexOf("\n", node.from);
          literals.push({
            from: body + node.from,
            to: body + (lineEnd < 0 ? code.length : lineEnd),
            name: "RegExp",
            unfinished: true,
          });
          return false;
        }
        if (
          [
            "String",
            "TemplateString",
            "RegExp",
            "LineComment",
            "BlockComment",
          ].includes(node.name)
        ) {
          literals.push({
            from: body + node.from,
            to: body + node.to,
            name: node.name,
            unfinished:
              node.node.lastChild?.type.isError &&
              node.node.lastChild.from === node.to,
          });
          return false;
        }
      },
    });
    let close = expression ? -1 : source.indexOf("%>", body);
    while (
      close >= 0 &&
      literals.some((literal) => close >= literal.from && close < literal.to)
    )
      close = source.indexOf("%>", close + 2);
    if (close < 0 || position <= close) {
      if (position < body) return "literal";
      const literal = literals.find(
        (entry) => position > entry.from && position <= entry.to,
      );
      if (!literal) return "code";
      const text = source.slice(literal.from, position);
      const closed = !literal.unfinished && closedLiteral(text, literal.name);
      return position === literal.to && closed ? "code" : "literal";
    }
    if (position < close + 2) return "literal";
    from = source.indexOf("<%", close + 2);
  }
  return "text";
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
  if (config.language === "eta")
    return etaContext(source, position, config.mode === "expression");
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
