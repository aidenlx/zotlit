// A YAML scalar shows the text it reads as, and the manifest stores that text as a YAML scalar.
import { parseDocument } from "yaml";

/** The flow spellings a scalar is stored in. */
export type ScalarStyle = "plain" | "single" | "double";

/**
 * The value `source` reads as where it stands: after `prefix`, the text before
 * it on its first line. A sequence marker in the prefix reads as the indent it
 * stands for, so a block scalar's indentation keeps its meaning.
 * @returns undefined when YAML cannot read the value there.
 */
export function yamlValue(source: string, prefix: string): unknown {
  const lead = prefix.replace(/^(?:\s*-(?=\s))*/, (markers) =>
    " ".repeat(markers.length),
  );
  let value: unknown;
  try {
    const yaml = parseDocument(lead + source, { uniqueKeys: true });
    if (yaml.errors.length > 0) return undefined;
    // An alias to an anchor the text never sets throws here, not as an error.
    value = yaml.toJS();
  } catch {
    return undefined;
  }
  if (lead.trim() === "") return value;
  // The key on the line makes a one-entry mapping, whose value is the slice's.
  const values =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.values(value)
      : [];
  return values.length === 1 ? values[0] : undefined;
}

/**
 * The text a pane shows for `source`, a stored YAML scalar after `prefix` on
 * its line. A scalar YAML reads as a string shows that string; any other text
 * shows as written.
 */
export function scalarDisplay(source: string, prefix: string): string {
  if (source === "") return "";
  const value = yamlValue(source, prefix);
  return typeof value === "string" ? value : source;
}

/** The flow spelling `source` is written in. */
export function scalarStyle(source: string): ScalarStyle {
  if (source.startsWith("'")) return "single";
  if (source.startsWith('"')) return "double";
  return "plain";
}

/** How `text` is spelled in `style`: its quotes, and one source piece per code point. */
function spell(text: string, style: ScalarStyle) {
  const pieces = Array.from(text, (char) => {
    if (style === "single") return char === "'" ? "''" : char;
    if (style === "double") return JSON.stringify(char).slice(1, -1);
    return char;
  });
  const quote = style === "single" ? "'" : style === "double" ? '"' : "";
  return { quote, pieces, source: quote + pieces.join("") + quote };
}

/**
 * Store `text` as a YAML scalar that reads back as exactly `text`. The scalar
 * keeps the `prefer` style while that style holds the text, and otherwise takes
 * the first of plain, single-quoted, and double-quoted that does. A
 * double-quoted scalar escapes every character, so it holds any text.
 */
export function scalarSource(text: string, prefer: ScalarStyle): string {
  for (const style of new Set([prefer, "plain", "single"] as const)) {
    const { source } = spell(text, style);
    if (source !== "" && yamlValue(source, "k: ") === text) return source;
  }
  return spell(text, "double").source;
}

/**
 * Offsets into `source` for each code unit boundary of `display`, or null when
 * `source` is not the spelling {@link scalarSource} writes for it.
 */
function sourceOffsets(display: string, source: string): number[] | null {
  const {
    quote,
    pieces,
    source: spelled,
  } = spell(display, scalarStyle(source));
  if (spelled !== source) return null;
  const offsets = [quote.length];
  let at = quote.length;
  for (const [index, char] of Array.from(display).entries()) {
    const piece = pieces[index]!;
    // A surrogate pair is one code point and two code units; its inside maps to its start.
    if (char.length === 2) offsets.push(at);
    at += piece.length;
    offsets.push(at);
  }
  return offsets;
}

/** Map a caret in the shown text to its stored scalar. */
export function scalarToSource(
  display: string,
  source: string,
  position: number,
): number {
  const offsets = sourceOffsets(display, source);
  if (!offsets) return Math.min(position, source.length);
  return offsets[Math.min(Math.max(position, 0), display.length)]!;
}

/** Map a caret in the stored scalar to the shown text. */
export function scalarToDisplay(
  source: string,
  display: string,
  position: number,
): number {
  const offsets = sourceOffsets(display, source);
  if (!offsets) return Math.min(position, display.length);
  let index = 0;
  while (index < display.length && offsets[index + 1]! <= position) index++;
  return index;
}
