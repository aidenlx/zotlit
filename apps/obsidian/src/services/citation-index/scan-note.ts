// One worker-safe parse produces the raw citation and annotation facts for one note.
import { InlineContext, parser } from "@lezer/markdown";
import type { BlockContext, Line } from "@lezer/markdown";
import { regex } from "arkregex";
import { decodeHTMLStrict } from "entities/decode";

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";

import type { AnnotationLink } from "@/lib/annotation-link";
import { classifyAnnotationLink } from "@/lib/annotation-link";
import { parseCitationFragment } from "@/lib/citation-fragment";

export interface SourceLocation {
  line: number;
  col: number;
  offset: number;
}

export interface SourcePosition {
  start: SourceLocation;
  end: SourceLocation;
}

export interface NoteCitationOccurrence {
  kind: "citekey" | "wikilink";
  raw: string;
  fragment?: string;
  position: SourcePosition;
}

export interface AnnotationOccurrence extends AnnotationLink {
  /** Source text between the label brackets, or the URI of an autolink. */
  text: string;
  position: SourcePosition;
}

export interface NoteScanRecord {
  /** Transient syntax ranges for whole-document export; never persisted. */
  ranges: (
    | {
        kind:
          | "code"
          | "frontmatter"
          | "link-destination"
          | "comment"
          | "text-dollar";
        from: number;
        to: number;
      }
    | { kind: "fenced-code"; from: number; to: number; lineStart: number }
  )[];
  /** Vault references before citation eligibility, including aliases and embeds. */
  links: {
    kind: "wikilink" | "link";
    embedded: boolean;
    target: string;
    position: SourcePosition;
  }[];
  /** Whole Pandoc spans retain author-in-text groups for rendering and export. */
  citations: {
    start: number;
    end: number;
    keys: { citekey: string; start: number; end: number }[];
  }[];
  citekeys: NoteCitationOccurrence[];
  wikilinks: NoteCitationOccurrence[];
  malformedWikilinks: { occurrence: NoteCitationOccurrence }[];
  annotations: AnnotationOccurrence[];
  malformedAnnotationCitations: {
    destination: string;
    position: SourcePosition;
  }[];
}

// Each paragraph searches a suffix at most once per delimiter width.
const codeRuns = new WeakMap<
  InlineContext,
  Map<number, { positions: number[]; index: number }>
>();
const mathClosers = new WeakMap<InlineContext, number[]>();
const referenceLabelOpeners = new WeakMap<InlineContext, number>();
const exhaustedHighlights = new WeakSet<InlineContext>();

const markdown = parser.configure({
  // Trim only inline presentation nodes: these cannot move exclusion boundaries.
  // Keep every block parser, including headings, rules and reference definitions,
  // so a following indented code block stays separate from paragraph text.
  remove: ["Emphasis", "HardBreak", "Entity"],
  // Keep HTMLBlock: remark-obsidian/test/parity/corpus.ts, html/passthrough,
  // records a raw HTML section whose [[not a wikilink]] produces no link.
  defineNodes: [
    "WikiLink",
    "Math",
    "FootnoteMark",
    "InlineFootnote",
    "Highlight",
    {
      name: "FootnoteDefinition",
      composite(_cx, line, indent) {
        if (line.indent < indent && line.pos < line.text.length) return false;
        line.moveBaseColumn(indent);
        return true;
      },
    },
  ],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      before: "LinkReference",
      parse(cx, line) {
        if (!line.text.startsWith("[^", line.pos)) return false;
        const end = line.text.indexOf("]", line.pos + 2);
        if (end < 0 || line.text[end + 1] !== ":") return false;
        const from = cx.lineStart + line.pos;
        cx.startComposite("FootnoteDefinition", from, line.indent + 4);
        line.addMarker(cx.elt("FootnoteMark", from, cx.lineStart + end + 2));
        line.moveBase(end + 2);
        return null;
      },
    },
    {
      name: "DisplayMath",
      before: "FencedCode",
      endLeaf(cx, line) {
        return displayMathOpener(cx, line) >= 0;
      },
      parse(cx, line) {
        const opener = displayMathOpener(cx, line);
        if (opener < 0) return false;
        const from = cx.lineStart + opener;
        let at = displayMathStart(line.text, opener);
        if (opener > line.pos) {
          const start = cx.lineStart + line.pos;
          cx.addElement(
            cx.elt(
              "Paragraph",
              start,
              from,
              cx.parser.parseInline(line.text.slice(line.pos, opener), start),
            ),
          );
        }
        const indent = line.baseIndent;
        let markers = 0;
        for (let depth = 0; depth < cx.depth; depth++)
          if (cx.parentType(depth).name === "Blockquote") markers++;
        const inContainer = cx.depth > 1;
        const indentedContainer = cx.parentType().name !== "Blockquote";
        const hasContent = line.text.slice(at).trim().length > 0;
        const lines = [line.text.slice(opener)];
        let to = cx.lineStart + line.text.length;
        for (;;) {
          const close = displayMathClose(line.text, at);
          if (close >= 0) {
            cx.addElement(
              cx.elt("Math", from, cx.lineStart + line.text.trimEnd().length),
            );
            cx.nextLine();
            return true;
          }
          to = cx.lineStart + line.text.length;
          if (
            !cx.nextLine() ||
            (inContainer &&
              hasContent &&
              ((indentedContainer && line.baseIndent < indent) ||
                line.markers.length < markers))
          ) {
            if (inContainer && hasContent) {
              // An unclosed container opener is prose. Restore block structure
              // too, so a following fence or indented block still excludes code.
              const prose = cx.parser
                .configure({ remove: ["DisplayMath"] })
                .parse(lines.join("\n"));
              for (
                let child = prose.topNode.firstChild;
                child;
                child = child.nextSibling
              )
                cx.addElement(cx.elt(child.toTree(), from + child.from));
            } else cx.addElement(cx.elt("Math", from, to));
            return true;
          }
          lines.push(" ".repeat(line.basePos) + line.text.slice(line.basePos));
          at = line.pos;
        }
      },
    },
  ],
  parseInline: [
    {
      name: "InlineCode",
      parse(cx, next, pos) {
        if (next !== 96) return -1;
        let runs = codeRuns.get(cx);
        if (!runs) {
          runs = new Map();
          for (let at = pos; at < cx.end; at++) {
            if (cx.char(at) !== 96) continue;
            const start = at;
            while (cx.char(at + 1) === 96) at++;
            const width = at + 1 - start;
            let run = runs.get(width);
            if (!run) runs.set(width, (run = { positions: [], index: 0 }));
            run.positions.push(start);
          }
          codeRuns.set(cx, runs);
        }
        let end = pos + 1;
        while (cx.char(end) === 96) end++;
        for (let width = end - pos; width > 0; width--) {
          const run = runs.get(width);
          if (!run) continue;
          while (
            run.positions[run.index] !== undefined &&
            run.positions[run.index]! < end
          )
            run.index++;
          const close = run.positions[run.index];
          if (close !== undefined)
            return cx.addElement(
              cx.elt("InlineCode", end - width, close + width),
            );
        }
        return end;
      },
    },
    {
      name: "Highlight",
      before: "Link",
      parse(cx, next, pos) {
        if (
          next !== 61 ||
          cx.char(pos + 1) !== 61 ||
          exhaustedHighlights.has(cx)
        )
          return -1;
        let end = pos + 2;
        for (; end < cx.end; end++) {
          if (cx.char(end) === 92) end++;
          else if (cx.char(end) === 61 && cx.char(end + 1) === 61) break;
        }
        if (end >= cx.end) {
          exhaustedHighlights.add(cx);
          return -1;
        }
        return cx.addElement(
          cx.elt(
            "Highlight",
            pos,
            end + 2,
            cx.parser.parseInline(cx.slice(pos + 2, end), pos + 2),
          ),
        );
      },
    },
    {
      name: "ReferenceLabel",
      before: "LinkEnd",
      parse(cx, next, pos) {
        if (next !== 93 || cx.char(pos + 1) !== 91) return -1;
        const start =
          cx.findOpeningDelimiter(InlineContext.linkStart) ??
          cx.findOpeningDelimiter(InlineContext.imageStart);
        if (start !== null && cx.char(cx.getDelimiterAt(start)!.to) !== 94)
          referenceLabelOpeners.set(cx, pos + 1);
        return -1;
      },
    },
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        const outer = balancedBracketEnd(cx, pos);
        if (
          outer >= 0 &&
          (cx.char(outer + 1) === 40 || cx.char(outer + 1) === 91)
        )
          return -1;
        for (let end = pos + 2; end < cx.end; end++) {
          const char = cx.char(end);
          if (char === 32 || (char >= 9 && char <= 13)) return -1;
          if (char === 93)
            return cx.addElement(cx.elt("FootnoteMark", pos, end + 1));
        }
        return -1;
      },
    },
    {
      name: "InlineFootnote",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 94 || cx.char(pos + 1) !== 91) return -1;
        const end = balancedBracketEnd(cx, pos + 1);
        if (end >= 0)
          return cx.addElement(
            cx.elt(
              "InlineFootnote",
              pos,
              end + 1,
              cx.parser.parseInline(cx.slice(pos + 2, end), pos + 2),
            ),
          );
        return -1;
      },
    },
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const open = next === 33 ? pos + 1 : pos;
        if (cx.char(open) !== 91 || cx.char(open + 1) !== 91) return -1;
        if (referenceLabelOpeners.get(cx) === open) return -1;
        for (let at = open + 2; at < cx.end; at++) {
          const char = cx.char(at);
          if (char === 10 || char === 13) return -1;
          if (char === 91 && cx.char(at + 1) === 91) return -1;
          if (char === 93 && cx.char(at + 1) === 93 && at > open + 2) {
            return cx.addElement(cx.elt("WikiLink", pos, at + 2));
          }
        }
        return -1;
      },
    },
    {
      name: "Math",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        const size = cx.char(pos + 1) === 36 ? 2 : 1;
        const first = cx.char(pos + size);
        if (
          size === 1 &&
          (first === 32 || first === 9 || (first >= 48 && first <= 57))
        )
          return -1;
        let closers = mathClosers.get(cx);
        if (!closers) mathClosers.set(cx, (closers = [-1, -1]));
        if (closers[size - 1]! >= pos + size) {
          const close = closers[size - 1]!;
          return close < cx.end
            ? cx.addElement(cx.elt("Math", pos, close + size))
            : -1;
        }
        for (let at = pos + size; at < cx.end; at++) {
          if (cx.char(at) === 92) at++;
          else if (cx.char(at) === 36) {
            if (
              size === 2
                ? cx.char(at + 1) === 36
                : cx.char(at - 1) !== 32 && cx.char(at - 1) !== 9
            ) {
              closers[size - 1] = at;
              return cx.addElement(cx.elt("Math", pos, at + size));
            }
          }
        }
        closers[size - 1] = cx.end;
        return -1;
      },
    },
  ],
});

function balancedBracketEnd(cx: InlineContext, pos: number): number {
  let depth = 1;
  for (let end = pos + 1; end < cx.end; end++) {
    const char = cx.char(end);
    if (char === 92) end++;
    else if (char === 91) depth++;
    else if (char === 93 && --depth === 0) return end;
  }
  return -1;
}

function displayMathOpener(cx: BlockContext, line: Line): number {
  const opener = line.text.indexOf("$$", line.pos);
  if (opener < 0 || (opener !== line.pos && cx.depth === 1)) return -1;
  if (line.text.indexOf("$$", displayMathStart(line.text, opener)) >= 0)
    return -1;
  if (opener !== line.pos) {
    // Inline code, links and escapes own their dollar signs.
    const elements = cx.parser.parseInline(line.text.slice(line.pos), line.pos);
    if (
      elements.some((element) => element.from <= opener && element.to > opener)
    )
      return -1;
  }
  return opener;
}

function displayMathStart(text: string, from: number): number {
  let end = from;
  while (text[end] === "$") end++;
  return end;
}

function displayMathClose(text: string, from: number): number {
  const at = text.indexOf("$", from);
  if (at < 0 || text[at + 1] !== "$") return -1;
  const end = displayMathStart(text, at);
  return text.slice(end).trim() === "" ? at : -1;
}

function decodeLinkTarget(destination: string): string {
  try {
    return decodeURIComponent(destination);
  } catch {
    // Obsidian keeps a destination containing an invalid percent escape literal.
    return destination;
  }
}

// Decode in one pass so an escaped ampersand cannot open a character reference.
const MARKDOWN_ESCAPE_OR_REFERENCE = regex(
  "\\\\([!-/:-@\\[-`{-~])|&(?:#(?:[0-9]{1,7}|x[0-9a-f]{1,6})|[a-z0-9]{1,31});",
  "gi",
);

/** @returns Raw, unresolved occurrences with half-open UTF-16 source positions. */
export function scanNote(text: string): NoteScanRecord {
  const record: NoteScanRecord = {
    ranges: [],
    links: [],
    citations: [],
    citekeys: [],
    wikilinks: [],
    malformedWikilinks: [],
    annotations: [],
    malformedAnnotationCitations: [],
  };
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    starts.push(at + 1);
  const position = (from: number, to: number): SourcePosition => ({
    start: location(starts, from),
    end: location(starts, to),
  });
  const body = text.split("");
  const tree = noteParser(text).parse(text);
  tree.iterate({
    enter({ name, from, to }) {
      if (
        ["FencedCode", "CodeBlock", "InlineCode", "Frontmatter"].includes(name)
      ) {
        record.ranges.push(
          name === "FencedCode"
            ? {
                kind: "fenced-code",
                from,
                to,
                lineStart: starts[location(starts, from).line]!,
              }
            : {
                kind: name === "Frontmatter" ? "frontmatter" : "code",
                from,
                to,
              },
        );
        mask(body, from, to);
        return false;
      }
      if (name === "URL")
        record.ranges.push({ kind: "link-destination", from, to });
    },
  });
  // Pair markers after parsing: comments can cross quote and list boundaries,
  // while a marker inside code cannot open or close one.
  const commentText = body.join("");
  const comments: { from: number; to: number }[] = [];
  for (let from = commentText.indexOf("%%"); from >= 0; ) {
    const close = commentText.indexOf("%%", from + 2);
    const to = close < 0 ? text.length : close + 2;
    comments.push({ from, to });
    record.ranges.push({ kind: "comment", from, to });
    mask(body, from, to);
    from = commentText.indexOf("%%", to);
  }
  let commentIndex = 0;
  tree.iterate({
    enter({ name, from, to, node }) {
      // A link's label stays masked; nested wikilinks and images are references.
      if (
        node.parent?.name === "Link" &&
        node.parent.getChild("URL") &&
        name !== "Image" &&
        name !== "WikiLink" &&
        name !== "Highlight"
      )
        return false;
      while (comments[commentIndex] && comments[commentIndex]!.to <= from)
        commentIndex++;
      const comment = comments[commentIndex];
      if (
        ["WikiLink", "Link", "Image", "Autolink"].includes(name) &&
        comment &&
        comment.from <= from &&
        comment.to > from
      ) {
        mask(body, from, to);
        return false;
      }
      if (
        [
          "FencedCode",
          "CodeBlock",
          "InlineCode",
          "Math",
          "Frontmatter",
          "HTMLBlock",
          "HTMLTag",
          "Comment",
          "CommentBlock",
          "ProcessingInstruction",
          "ProcessingInstructionBlock",
          "LinkReference",
          "FootnoteMark",
        ].includes(name)
      ) {
        mask(body, from, to);
        return false;
      }
      if (name === "WikiLink") {
        const raw = text.slice(from, to);
        const embedded = raw.startsWith("!");
        let target = raw.slice(embedded ? 3 : 2, -2).split("|")[0]!;
        if (target.endsWith("\\")) target = target.slice(0, -1);
        target = target.replaceAll("\u00a0", " ").trim();
        record.links.push({
          kind: "wikilink",
          embedded,
          target,
          position: position(from, to),
        });
        if (raw.startsWith("[[") && !raw.includes("|")) {
          const link = raw.slice(2, -2).trim();
          const hash = link.indexOf("#");
          const path = hash < 0 ? link : link.slice(0, hash);
          const subpath = hash < 0 ? "" : link.slice(hash);
          const occurrence: NoteCitationOccurrence = {
            kind: "wikilink",
            raw: path,
            position: position(from, to),
          };
          if (path && subpath === "") record.wikilinks.push(occurrence);
          else if (path && subpath.startsWith("#cite:")) {
            if (parseCitationFragment(subpath.slice(6)).ok)
              record.wikilinks.push({
                ...occurrence,
                fragment: subpath.slice(6),
              });
            else record.malformedWikilinks.push({ occurrence });
          }
        }
        mask(body, from, to);
        return false;
      }
      if (name === "Link" || name === "Image" || name === "Autolink") {
        const url = node.getChild("URL");
        if (!url) return;
        let destination = text.slice(url.from, url.to);
        if (destination.startsWith("<")) destination = destination.slice(1, -1);
        else if (name !== "Autolink") {
          // Obsidian treats a no-break space before a quoted title as whitespace.
          const titleAt = destination.lastIndexOf("\u00a0");
          const quote = destination[titleAt + 1];
          if (
            titleAt > 0 &&
            (quote === '"' || quote === "'") &&
            destination.endsWith(quote) &&
            destination.length > titleAt + 2
          )
            destination = destination.slice(0, titleAt);
        }
        if (name !== "Autolink")
          destination = destination.replace(
            MARKDOWN_ESCAPE_OR_REFERENCE,
            (match, escaped) => escaped ?? decodeHTMLStrict(match),
          );
        if (
          name !== "Autolink" &&
          destination &&
          (!destination.includes(":") ||
            destination.startsWith("./") ||
            destination.startsWith("../"))
        )
          record.links.push({
            kind: "link",
            embedded: name === "Image",
            target: decodeLinkTarget(destination),
            position: position(from, to),
          });
        const marks = node.getChildren("LinkMark");
        const linkText =
          name === "Autolink"
            ? text.slice(url.from, url.to)
            : text.slice(from + (name === "Image" ? 2 : 1), marks[1]!.from);
        const classified = classifyAnnotationLink(
          destination,
          name === "Autolink"
            ? { kind: "autolink" }
            : name === "Image"
              ? { kind: "image" }
              : { kind: "link", text: linkText },
        );
        if (classified?.form === "malformed") {
          record.malformedAnnotationCitations.push({
            destination,
            position: position(from, to),
          });
        } else if (classified) {
          record.annotations.push({
            ...classified,
            text: linkText,
            position: position(from, to),
          });
        }
        mask(body, from, to);
        return name === "Link" ? undefined : false;
      }
    },
  });
  for (let at = 0; at < body.length; at++) {
    if (body[at] === "\\") at++;
    else if (body[at] === "$")
      record.ranges.push({ kind: "text-dollar", from: at, to: at + 1 });
  }
  for (const citation of scanPandocCitations(body.join(""))) {
    record.citations.push({
      start: citation.start,
      end: citation.end,
      keys: citation.items.map(({ citationKey, start, end }) => ({
        citekey: citationKey,
        start,
        end,
      })),
    });
    for (const item of citation.items)
      record.citekeys.push({
        kind: "citekey",
        raw: item.citationKey,
        position: position(item.start, item.end),
      });
  }
  return record;
}

function noteParser(text: string) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return markdown;
  const close = /\n---\r?(?=\n|$)/.exec(text);
  if (!close) return markdown;
  const to = close.index + close[0].length;
  return markdown.configure({
    defineNodes: ["Frontmatter"],
    parseBlock: [
      {
        name: "Frontmatter",
        before: "FencedCode",
        parse(cx, line) {
          if (cx.lineStart !== 0) return false;
          while (cx.lineStart + line.text.length < to) cx.nextLine();
          cx.addElement(cx.elt("Frontmatter", 0, to));
          addTrailingParagraph(cx, line, to - cx.lineStart);
          cx.nextLine();
          return true;
        },
      },
    ],
  });
}

function addTrailingParagraph(
  cx: BlockContext,
  line: Line,
  from: number,
): void {
  if (from >= line.text.length) return;
  const start = cx.lineStart + from;
  cx.addElement(
    cx.elt(
      "Paragraph",
      start,
      cx.lineStart + line.text.length,
      cx.parser.parseInline(line.text.slice(from), start),
    ),
  );
}

function mask(body: string[], from: number, to: number): void {
  for (let at = from; at < to; at++)
    if (body[at] !== "\n" && body[at] !== "\r") body[at] = " ";
}

function location(starts: readonly number[], offset: number): SourceLocation {
  let low = 0,
    high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! > offset) high = mid - 1;
    else low = mid;
  }
  return { line: low, col: offset - starts[low]!, offset };
}
