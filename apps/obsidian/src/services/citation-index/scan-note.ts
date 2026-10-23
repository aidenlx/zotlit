// One worker-safe parse produces the raw citation and annotation facts for one note.
import { parser } from "@lezer/markdown";
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
  position: SourcePosition;
}

export interface AnnotationOccurrence extends AnnotationLink {
  position: SourcePosition;
}

export interface NoteScanRecord {
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

const markdown = parser.configure({
  // Trim only inline presentation nodes: these cannot move exclusion boundaries.
  // Keep every block parser, including headings, rules and reference definitions,
  // so a following indented code block stays separate from paragraph text.
  remove: ["Emphasis", "HardBreak", "Entity"],
  // Keep HTMLBlock: remark-obsidian/test/parity/corpus.ts, html/passthrough,
  // records a raw HTML section whose [[not a wikilink]] produces no link.
  defineNodes: ["WikiLink", "Math"],
  parseBlock: [
    {
      name: "DisplayMath",
      before: "FencedCode",
      parse(cx, line) {
        if (!line.text.startsWith("$$", line.pos)) return false;
        const from = cx.lineStart + line.pos;
        let at = line.pos + 2;
        for (;;) {
          for (; at < line.text.length; at++) {
            if (line.text[at] === "\\") at++;
            else if (line.text.startsWith("$$", at)) {
              const end = at + 2;
              cx.addElement(cx.elt("Math", from, cx.lineStart + end));
              addTrailingParagraph(cx, line, end);
              cx.nextLine();
              return true;
            }
          }
          const to = cx.lineStart + line.text.length;
          if (!cx.nextLine()) {
            cx.addElement(cx.elt("Math", from, to));
            return true;
          }
          at = line.pos;
        }
      },
    },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const open = next === 33 ? pos + 1 : pos;
        if (cx.char(open) !== 91 || cx.char(open + 1) !== 91) return -1;
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
        for (let at = pos + size; at < cx.end; at++) {
          if (cx.char(at) === 92) at++;
          else if (cx.char(at) === 36) {
            if (
              size === 2
                ? cx.char(at + 1) === 36
                : cx.char(at - 1) !== 32 && cx.char(at - 1) !== 9
            ) {
              return cx.addElement(cx.elt("Math", pos, at + size));
            }
          }
        }
        return -1;
      },
    },
  ],
});

// Decode in one pass so an escaped ampersand cannot open a character reference.
const MARKDOWN_ESCAPE_OR_REFERENCE = regex(
  "\\\\([!-/:-@\\[-`{-~])|&(?:#(?:[0-9]{1,7}|x[0-9a-f]{1,6})|[a-z0-9]{1,31});",
  "gi",
);

/** @returns Raw, unresolved occurrences with half-open UTF-16 source positions. */
export function scanNote(text: string): NoteScanRecord {
  const record: NoteScanRecord = {
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
        mask(body, from, to);
        return false;
      }
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
    mask(body, from, to);
    from = commentText.indexOf("%%", to);
  }
  let commentIndex = 0;
  tree.iterate({
    enter({ name, from, to, node }) {
      // A link's label stays masked, but its nested images are embeds.
      if (
        node.parent?.name === "Link" &&
        node.parent.getChild("URL") &&
        name !== "Image"
      )
        return false;
      while (comments[commentIndex] && comments[commentIndex]!.to <= from)
        commentIndex++;
      const comment = comments[commentIndex];
      if (
        ["WikiLink", "Link", "Image", "Autolink"].includes(name) &&
        comment &&
        comment.from < to &&
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
        ].includes(name)
      ) {
        mask(body, from, to);
        return false;
      }
      if (name === "WikiLink") {
        const raw = text.slice(from, to);
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
              record.wikilinks.push(occurrence);
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
        if (name !== "Autolink")
          destination = destination.replace(
            MARKDOWN_ESCAPE_OR_REFERENCE,
            (match, escaped) => escaped ?? decodeHTMLStrict(match),
          );
        const marks = node.getChildren("LinkMark");
        const classified = classifyAnnotationLink(
          destination,
          name === "Autolink"
            ? { kind: "autolink" }
            : name === "Image"
              ? { kind: "image" }
              : { kind: "link", text: text.slice(from + 1, marks[1]!.from) },
        );
        if (classified?.form === "malformed") {
          record.malformedAnnotationCitations.push({
            destination,
            position: position(from, to),
          });
        } else if (classified) {
          record.annotations.push({
            ...classified,
            position: position(from, to),
          });
        }
        mask(body, from, to);
        return name === "Link" ? undefined : false;
      }
    },
  });
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
