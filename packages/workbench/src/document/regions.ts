// The boxes a note pane draws over its own source: the Managed Block the note
// update rewrites, and the annotation render calls the highlight editor opens
// at. Both are read from the source alone, so a draft the parser refuses keeps
// the boxes the reader is working in.

import type { LiquidRange } from "#/language/liquid";
import { regex } from "arkregex";

import type { WorkbenchSliceRange } from "./manifest-patch";

import { liquidRanges } from "#/language/liquid";

/** One annotation render call in the note body, in master offsets. */
export interface AnnotationRenderSite {
  /** The call's own text, which a box takes the place of. */
  readonly call: WorkbenchSliceRange;
  /**
   * The whole line the call sits on when only whitespace shares it, so a box
   * can own that line; null when the call is written inside a line of prose.
   * The end excludes the line break, which the line keeps.
   */
  readonly line: WorkbenchSliceRange | null;
}

/** The Managed Block as a pane draws it, in master offsets. */
export interface ManagedBlockRegion {
  /**
   * The marked box: the block with its line-owning tags, so the region reads
   * as the lines a note update rewrites.
   */
  readonly range: WorkbenchSliceRange;
  /** The `{% managed %}` tag itself. */
  readonly open: WorkbenchSliceRange;
  /** The `{% endmanaged %}` tag itself. */
  readonly close: WorkbenchSliceRange;
}

export interface NoteRegions {
  /** Every annotation render call, in source order. */
  readonly annotationCalls: readonly AnnotationRenderSite[];
  readonly managedBlock: ManagedBlockRegion | null;
}

/** The Liquid tag names that render one annotation through the section. */
const ANNOTATION_CALL_TAGS: readonly string[] = ["render", "render_annotation"];

/** The section the native call form names, in either quote the author wrote. */
const ANNOTATION_PARTIALS: readonly string[] = ['"annotation"', "'annotation'"];

const FENCE = regex("^ {0,3}(?<marker>`{3,}|~{3,})");

/**
 * The boxes the note body carries, in master offsets. `note` is the body's own
 * range, so a call spelled inside the manifest or the Annotation Section is
 * out of scope by construction.
 * @see docs/adr/0034-template-rendering-shortcut-is-annotation-specific.md
 */
export function noteRegions(
  source: string,
  note: WorkbenchSliceRange,
): NoteRegions {
  const body = source.slice(note.from, note.to);
  const code = codeRanges(body);
  // `liquidRanges` skips a `raw` or `comment` body whole; a Markdown code
  // region is prose about a call rather than a call, so it is skipped here.
  const tags = liquidRanges(body).filter(
    (range) =>
      range.closed &&
      !code.some(({ from, to }) => from <= range.from && range.from < to),
  );
  const annotationCalls = tags.flatMap((range) => {
    if (range.kind !== "tag" || !isAnnotationCall(body, range)) return [];
    const call = { from: note.from + range.from, to: note.from + range.to };
    return [{ call, line: ownedLine(source, call) }];
  });
  return { annotationCalls, managedBlock: managedBlock(source, note, tags) };
}

/**
 * True for the annotation shortcut, and for the native call that renders the
 * `annotation` section under a variable name the author chose.
 */
function isAnnotationCall(body: string, { from, to, name }: LiquidRange) {
  if (!ANNOTATION_CALL_TAGS.includes(name)) return false;
  if (name === "render_annotation") return true;
  const tag = body.slice(from, to);
  const argument = tag.slice(tag.indexOf(name) + name.length).trimStart();
  return ANNOTATION_PARTIALS.some((partial) => argument.startsWith(partial));
}

/** The first complete `{% managed %}` block, which is the one the parser keeps. */
function managedBlock(
  source: string,
  note: WorkbenchSliceRange,
  tags: readonly LiquidRange[],
): ManagedBlockRegion | null {
  const structural = tags.filter((range) => range.kind === "structural");
  const open = structural.find((range) => range.name === "managed");
  const close = structural.find(
    (range) => range.name === "endmanaged" && open && range.from >= open.to,
  );
  if (!open || !close) return null;
  const shift = ({ from, to }: LiquidRange) => ({
    from: note.from + from,
    to: note.from + to,
  });
  const openRange = shift(open);
  const closeRange = shift(close);
  return {
    range: {
      from: ownedLine(source, openRange)?.from ?? openRange.from,
      to: ownedLine(source, closeRange)?.to ?? closeRange.to,
    },
    open: openRange,
    close: closeRange,
  };
}

/**
 * The line `range` sits on when only whitespace shares it, with the line break
 * left outside so the line keeps it. A carriage return belongs to the break.
 */
function ownedLine(
  source: string,
  range: WorkbenchSliceRange,
): WorkbenchSliceRange | null {
  const from = source.lastIndexOf("\n", range.from - 1) + 1;
  const breakAt = source.indexOf("\n", range.to);
  const end = breakAt === -1 ? source.length : breakAt;
  const to = source[end - 1] === "\r" ? end - 1 : end;
  return /^[ \t]*$/.test(source.slice(from, range.from)) &&
    /^[ \t]*$/.test(source.slice(range.to, to))
    ? { from, to }
    : null;
}

/**
 * The Markdown code regions of `text`: fenced blocks, and the code spans inside
 * one line. A call written in one is documentation about the call.
 */
function codeRanges(text: string): WorkbenchSliceRange[] {
  const ranges: WorkbenchSliceRange[] = [];
  let fence: { marker: string; from: number } | undefined;
  for (const line of lineRanges(text)) {
    const marker = FENCE.exec(text.slice(line.from, line.to))?.groups.marker;
    if (fence) {
      if (
        marker &&
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length
      ) {
        ranges.push({ from: fence.from, to: line.to });
        fence = undefined;
      }
    } else if (marker) {
      fence = { marker, from: line.from };
    } else {
      ranges.push(...codeSpans(text, line));
    }
  }
  if (fence) ranges.push({ from: fence.from, to: text.length });
  return ranges;
}

/** Every line of `text` as a range, with its line break left outside. */
function* lineRanges(text: string): Generator<WorkbenchSliceRange> {
  let from = 0;
  while (from <= text.length) {
    const breakAt = text.indexOf("\n", from);
    const end = breakAt === -1 ? text.length : breakAt;
    yield { from, to: text[end - 1] === "\r" ? end - 1 : end };
    if (breakAt === -1) return;
    from = breakAt + 1;
  }
}

/** The code spans on one line: a run of backticks closed by a run as long. */
function codeSpans(
  text: string,
  line: WorkbenchSliceRange,
): WorkbenchSliceRange[] {
  const spans: WorkbenchSliceRange[] = [];
  let index = line.from;
  while (index < line.to) {
    const open = backtickRun(text, index, line.to);
    if (open === 0) {
      index += 1;
      continue;
    }
    let close = index + open;
    while (close < line.to) {
      // A run of another length is not the closer, and none of its backticks
      // can be: the span closes on a run of exactly the opening length.
      const run = backtickRun(text, close, line.to);
      if (run === open) break;
      close += run === 0 ? 1 : run;
    }
    if (close >= line.to) return spans;
    spans.push({ from: index, to: close + open });
    index = close + open;
  }
  return spans;
}

/** The length of the backtick run starting at `index`, or 0 when none does. */
function backtickRun(text: string, index: number, end: number): number {
  let length = 0;
  while (index + length < end && text[index + length] === "`") length += 1;
  return length;
}
