// Zotero's annotation comment format: parse, restyle, and paste conversion.
//
// A comment is "plain text flavored with some HTML tags": attribute-free
// `<b>`/`<i>`/`<sub>`/`<sup>` pairs and literal `\n` line breaks. Every edit
// here works on that string itself, so what the editor holds is byte for byte
// what Zotero stores, and anything these functions cannot parse stays text.

/** @see https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L4 */
export const COMMENT_FORMATS = ["b", "i", "sub", "sup"] as const;
export type CommentFormat = (typeof COMMENT_FORMATS)[number];

/** One matched tag pair, in document offsets. */
export interface FormatSpan {
  format: CommentFormat;
  /** Start of the opening tag. */
  from: number;
  contentFrom: number;
  contentTo: number;
  /** End of the closing tag. */
  to: number;
}

/** A replacement of the whole comment, with the selection it leaves. */
export interface CommentEdit {
  text: string;
  anchor: number;
  head: number;
}

/**
 * Every tag pair Zotero renders, outer before inner.
 *
 * Mirrors Zotero's `walkFormat`: in each run of text, the earliest opening tag
 * that has a closing tag after it wins, its content is parsed again on its own,
 * and the text after it is parsed next. An opening tag with no match stays
 * literal text, and so does a pair that crosses another.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L66
 */
export function parseComment(text: string): FormatSpan[] {
  const lower = text.toLowerCase();
  const spans: FormatSpan[] = [];
  const walk = (from: number, to: number): void => {
    let pos = from;
    while (pos < to) {
      const span = nextSpan(lower, pos, to);
      if (!span) return;
      spans.push(span);
      walk(span.contentFrom, span.contentTo);
      pos = span.to;
    }
  };
  walk(0, text.length);
  return spans;
}

function nextSpan(lower: string, from: number, to: number): FormatSpan | null {
  const opens = COMMENT_FORMATS.map((format) => ({
    format,
    at: lower.indexOf(`<${format}>`, from),
  }))
    .filter(({ format, at }) => at >= 0 && at + format.length + 2 <= to)
    .sort((a, b) => a.at - b.at);
  for (const { format, at } of opens) {
    const contentFrom = at + format.length + 2;
    const close = lower.indexOf(`</${format}>`, contentFrom);
    const end = close + format.length + 3;
    if (close < 0 || end > to) continue;
    return { format, from: at, contentFrom, contentTo: close, to: end };
  }
  return null;
}

/**
 * The formats a selection carries: every character in a range has them, or a
 * collapsed caret sits inside (or at the edge of) their content.
 */
export function activeFormats(
  text: string,
  from: number,
  to: number,
): Set<CommentFormat> {
  if (from === to) {
    return new Set(spansAt(parseComment(text), from).map((s) => s.format));
  }
  const chars = charsIn(toChars(text), from, to);
  if (chars.length === 0) return new Set();
  return new Set(
    COMMENT_FORMATS.filter((format) =>
      chars.every((char) => char.formats.has(format)),
    ),
  );
}

/**
 * Bold, italic, subscript or superscript on or off, the way Obsidian toggles
 * Markdown emphasis: a range that already carries the format loses it, any
 * other range gains it. A collapsed caret unwraps the pair it stands in, or
 * opens an empty pair around itself to type into.
 */
export function toggleFormat(
  text: string,
  selection: { anchor: number; head: number },
  format: CommentFormat,
): CommentEdit {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  if (from === to) {
    const span = spansAt(parseComment(text), from).findLast(
      (s) => s.format === format,
    );
    if (span) return unwrap(text, [span], from);
    const open = `<${format}>`;
    const caret = from + open.length;
    return {
      text: `${text.slice(0, from)}${open}</${format}>${text.slice(from)}`,
      anchor: caret,
      head: caret,
    };
  }
  const on = !activeFormats(text, from, to).has(format);
  return restyle(text, selection, (formats) => {
    if (on) formats.add(format);
    else formats.delete(format);
  });
}

/** Every format off across the selection, or off the pairs a caret stands in. */
export function clearFormatting(
  text: string,
  selection: { anchor: number; head: number },
): CommentEdit {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  if (from === to) return unwrap(text, spansAt(parseComment(text), from), from);
  return restyle(text, selection, (formats) => formats.clear());
}

/**
 * Pasted HTML as a comment: the four formats survive, `strong` and `em` read
 * as `b` and `i`, line breaks and block edges turn into `\n`, and every other
 * element leaves only its text. A format pair holding only whitespace is
 * dropped, as Zotero's `walkUnformat` drops it.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L112
 */
export function htmlToComment(root: Node): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      return (node.nodeValue ?? "").replaceAll(/\s+/g, " ");
    }
    if (node.nodeType !== 1) return "";
    const name = node.nodeName.toLowerCase();
    if (name === "br") return "\n";
    if (SKIPPED.has(name)) return "";
    const inner = Array.from(node.childNodes, walk).join("");
    const format = PASTE_FORMATS[name];
    if (format) return inner.trim() ? `<${format}>${inner}</${format}>` : inner;
    return BLOCKS.has(name) ? `\n${inner}\n` : inner;
  };
  return walk(root)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replaceAll(/\n{2,}/g, "\n")
    .trim();
}

const PASTE_FORMATS: Record<string, CommentFormat> = {
  b: "b",
  strong: "b",
  i: "i",
  em: "i",
  sub: "sub",
  sup: "sup",
};
const SKIPPED = new Set(["head", "script", "style", "template", "title"]);
const BLOCKS = new Set([
  "address",
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
]);

/** The pairs whose content holds `pos`, outer before inner. */
function spansAt(spans: FormatSpan[], pos: number): FormatSpan[] {
  return spans.filter((s) => s.contentFrom <= pos && pos <= s.contentTo);
}

function unwrap(text: string, spans: FormatSpan[], caret: number): CommentEdit {
  const cuts = spans
    .flatMap((s) => [
      { from: s.from, to: s.contentFrom },
      { from: s.contentTo, to: s.to },
    ])
    .sort((a, b) => b.from - a.from);
  let next = text;
  let pos = caret;
  for (const cut of cuts) {
    next = next.slice(0, cut.from) + next.slice(cut.to);
    if (cut.to <= pos) pos -= cut.to - cut.from;
  }
  return { text: next, anchor: pos, head: pos };
}

/** One visible character of the comment and the formats it renders in. */
interface CommentChar {
  char: string;
  /** Offset of the character in the comment it was read from. */
  at: number;
  formats: Set<CommentFormat>;
}

function toChars(text: string): CommentChar[] {
  const spans = parseComment(text);
  const tags = spans.flatMap((s) => [
    [s.from, s.contentFrom],
    [s.contentTo, s.to],
  ]);
  const chars: CommentChar[] = [];
  for (let at = 0; at < text.length; at++) {
    const tag = tags.find(([from, to]) => from! <= at && at < to!);
    if (tag) {
      at = tag[1]! - 1;
      continue;
    }
    const formats = new Set(
      spans
        .filter((s) => s.contentFrom <= at && at < s.contentTo)
        .map((s) => s.format),
    );
    chars.push({ char: text[at]!, at, formats });
  }
  return chars;
}

function charsIn(chars: CommentChar[], from: number, to: number) {
  return chars.filter((c) => from <= c.at && c.at < to);
}

/**
 * Apply `change` to the formats of every character in the selection, then
 * write the whole comment out again with one tag pair per run. Tags nest in
 * {@link COMMENT_FORMATS} order, the order Zotero's own toolbar never breaks.
 */
function restyle(
  text: string,
  selection: { anchor: number; head: number },
  change: (formats: Set<CommentFormat>) => void,
): CommentEdit {
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const chars = toChars(text);
  const first = chars.findIndex((c) => c.at >= from);
  const start = first < 0 ? chars.length : first;
  let end = start;
  for (const c of chars.slice(start)) {
    if (c.at >= to) break;
    change(c.formats);
    end++;
  }

  let out = "";
  const open: CommentFormat[] = [];
  let selFrom = 0;
  let selTo = 0;
  chars.forEach((c, index) => {
    if (index === end) selTo = out.length;
    const keep = open.findIndex((f) => !c.formats.has(f));
    if (keep >= 0) {
      for (const f of open.splice(keep).reverse()) out += `</${f}>`;
    }
    for (const f of COMMENT_FORMATS) {
      if (c.formats.has(f) && !open.includes(f)) {
        open.push(f);
        out += `<${f}>`;
      }
    }
    if (index === start) selFrom = out.length;
    out += c.char;
  });
  if (end === chars.length) selTo = out.length;
  if (start === chars.length) selFrom = out.length;
  for (const f of open.reverse()) out += `</${f}>`;

  const forward = selection.anchor <= selection.head;
  return {
    text: out,
    anchor: forward ? selFrom : selTo,
    head: forward ? selTo : selFrom,
  };
}
