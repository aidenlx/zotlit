// One document's Citation Occurrences: the shared grammar over a masked body, merged with the link cache.

import { parseLinktext, type LinkCache, type Loc, type Pos } from "obsidian";

import { scanCitekeys } from "@/lib/citation-grammar";

/** Which syntax wrote a Citation Occurrence. */
export type CitationSyntax = "citekey" | "wikilink";

/**
 * One appearance of a Citation in one document. Raw and unresolved by design:
 * what it cites is answered at query time.
 */
export interface CitationOccurrence {
  kind: CitationSyntax;
  /** The literal citekey, or the wikilink's linkpath with its subpath stripped. */
  raw: string;
  position: Pos;
}

/**
 * Exclusion is masking plus the grammar's own rules: the body is blanked
 * wherever Markdown puts text out of reach — frontmatter, fenced and indented
 * code, inline code, math, and `%%` comments — and the grammar reads what
 * remains. Blanking keeps every offset, so positions stay those of the source.
 *
 * @returns the literal `@citekey` occurrences of `text`, in document order.
 */
export function scanCitekeyOccurrences(text: string): CitationOccurrence[] {
  const lineStarts = lineStartsOf(text);
  const occurrences: CitationOccurrence[] = [];
  for (const { citekey, start, end } of scanCitekeys(maskExclusions(text))) {
    occurrences.push({
      kind: "citekey",
      raw: citekey,
      position: {
        start: locAt(lineStarts, start),
        end: locAt(lineStarts, end),
      },
    });
  }
  return occurrences;
}

/**
 * Wikilink occurrences derive from Obsidian's own link cache, which already
 * omits links inside code, so they need no masking and are never stored.
 *
 * @returns `stored` and the link cache's occurrences in one document-ordered list.
 */
export function documentOccurrences(
  stored: readonly CitationOccurrence[],
  links: readonly LinkCache[],
): CitationOccurrence[] {
  const occurrences = [...stored];
  for (const link of links) {
    const { path } = parseLinktext(link.link);
    if (path === "") continue;
    occurrences.push({ kind: "wikilink", raw: path, position: link.position });
  }
  return occurrences.sort(
    (a, b) => a.position.start.offset - b.position.start.offset,
  );
}

/**
 * Structural equality. A `changed` event also fires on a content-identical
 * touch, so this is what keeps such a touch from waking the index's listeners.
 */
export function occurrencesEqual(
  prev: readonly CitationOccurrence[],
  next: readonly CitationOccurrence[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((occurrence, index) => {
    const other = next[index]!;
    return (
      occurrence.kind === other.kind &&
      occurrence.raw === other.raw &&
      occurrence.position.start.offset === other.position.start.offset &&
      occurrence.position.end.offset === other.position.end.offset
    );
  });
}

/** A list item opens a list; its indented content is no code block. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;

/** Columns a tab advances, as CommonMark counts indentation. */
const TAB_WIDTH = 4;

/** The indentation an indented code block needs. */
const CODE_INDENT = 4;

/**
 * Blank every region the Citation Index must not read, keeping each character's
 * offset and every line break so the grammar still sees the document's shape.
 */
function maskExclusions(text: string): string {
  const body = text.split("");
  maskBlocks(text, body);
  maskInline(body);
  return body.join("");
}

function mask(body: string[], from: number, to: number): void {
  for (let at = from; at < to; at += 1) {
    if (body[at] !== "\n") body[at] = " ";
  }
}

/**
 * Frontmatter, fenced code, and indented code, all of which a line reading
 * decides. An unterminated frontmatter block or fence is no block at all to
 * Obsidian, so it stays readable here too.
 */
function maskBlocks(text: string, body: string[]): void {
  const lines = text.split("\n");
  const starts = lineStartsOf(text);
  const maskLine = (index: number): void => {
    mask(body, starts[index]!, starts[index]! + lines[index]!.length);
  };

  let from = 0;
  const frontmatterEnd = frontmatterLine(lines);
  if (frontmatterEnd !== null) {
    for (let line = 0; line <= frontmatterEnd; line += 1) maskLine(line);
    from = frontmatterEnd + 1;
  }

  let fence: string | null = null;
  let inCode = false;
  let afterBlank = true;
  let inList = false;
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence !== null) {
      maskLine(index);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (isBlank(line)) {
      afterBlank = true;
      continue;
    }
    const indent = indentWidth(line);
    if (inCode && indent >= CODE_INDENT) {
      maskLine(index);
      continue;
    }
    inCode = false;

    const opening = openingFence(line);
    if (opening !== null) {
      maskLine(index);
      fence = opening;
    } else if (indent >= CODE_INDENT && afterBlank && !inList) {
      maskLine(index);
      inCode = true;
    } else if (LIST_MARKER.test(line)) {
      inList = true;
    } else if (indent === 0) {
      inList = false;
    }
    afterBlank = false;
  }
}

/** Inline code, math, and `%%` comments, over the body the block pass left. */
function maskInline(body: string[]): void {
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (char === "\\") {
      at += 1;
    } else if (char === "`") {
      at = maskCodeSpan(body, at);
    } else if (char === "%" && body[at + 1] === "%") {
      at = maskComment(body, at);
    } else if (char === "$") {
      at = maskMath(body, at);
    }
  }
}

/**
 * @returns the offset the inline scan continues from: the last masked character
 *   when the span closes, or the last of the opening run when it does not.
 */
function maskCodeSpan(body: string[], open: number): number {
  let content = open;
  while (body[content] === "`") content += 1;
  const ticks = content - open;
  for (let at = content; at < body.length && body[at] !== "\n"; at += 1) {
    if (body[at] !== "`") continue;
    let end = at;
    while (body[end] === "`") end += 1;
    if (end - at === ticks) {
      mask(body, open, end);
      return end - 1;
    }
    at = end - 1;
  }
  return content - 1;
}

/** @returns the offset the inline scan continues from, as {@link maskCodeSpan} does. */
function maskComment(body: string[], open: number): number {
  for (let at = open + 2; at < body.length - 1; at += 1) {
    if (body[at] !== "%" || body[at + 1] !== "%") continue;
    mask(body, open, at + 2);
    return at + 1;
  }
  return open + 1;
}

/**
 * `$$` spans lines; `$` stays on one and needs its content to touch both
 * delimiters, so a price pair such as `$5 and $6` is prose.
 *
 * @returns the offset the inline scan continues from, as {@link maskCodeSpan} does.
 */
function maskMath(body: string[], open: number): number {
  const display = body[open + 1] === "$";
  const content = open + (display ? 2 : 1);
  for (let at = content; at < body.length; at += 1) {
    if (body[at] === "\n" && !display) break;
    if (body[at] !== "$") continue;
    if (display) {
      if (body[at + 1] !== "$") continue;
      mask(body, open, at + 2);
      return at + 1;
    }
    if (at === content || isSpace(body[at - 1]!) || isDigit(body[at + 1])) {
      continue;
    }
    mask(body, open, at + 1);
    return at;
  }
  return content - 1;
}

/** @returns the index of the line closing the frontmatter block, or `null` when there is none. */
function frontmatterLine(lines: readonly string[]): number | null {
  if (lines[0]?.trim() !== "---") return null;
  for (let line = 1; line < lines.length; line += 1) {
    if (lines[line]!.trim() === "---") return line;
  }
  return null;
}

/** @returns the backtick or tilde run opening a fenced block, or `null` for any other line. */
function openingFence(line: string): string | null {
  const indent = leadingSpaces(line);
  if (indent > 3) return null;
  const char = line[indent];
  if (char !== "`" && char !== "~") return null;
  let end = indent;
  while (line[end] === char) end += 1;
  if (end - indent < 3) return null;
  // A backtick fence's info string may hold no backtick of its own.
  if (char === "`" && line.includes("`", end)) return null;
  return line.slice(indent, end);
}

function closesFence(line: string, fence: string): boolean {
  const indent = leadingSpaces(line);
  if (indent > 3) return false;
  let end = indent;
  while (line[end] === fence[0]) end += 1;
  return end - indent >= fence.length && line.slice(end).trim() === "";
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function leadingSpaces(line: string): number {
  let at = 0;
  while (line[at] === " ") at += 1;
  return at;
}

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += TAB_WIDTH;
    else break;
  }
  return width;
}

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

function locAt(lineStarts: readonly number[], offset: number): Loc {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle]! > offset) high = middle - 1;
    else low = middle;
  }
  return { line: low, col: offset - lineStarts[low]!, offset };
}
