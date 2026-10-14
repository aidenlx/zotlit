import { regex } from "arkregex";

/** Wraps the auto-generated ("managed") region of a literature note body. */
export const MARKER_START = "%%zt-managed%%";
export const MARKER_END = "%%/zt-managed%%";

/**
 * A blank line keeps the closing marker a block of its own: directly after a
 * callout it would be a lazy continuation line, hidden inside the rendered
 * callout in Live Preview.
 */
export function formatManagedRegion(content: string): string {
  const body = content.trim();
  return body
    ? `${MARKER_START}\n${body}\n\n${MARKER_END}`
    : `${MARKER_START}\n\n${MARKER_END}`;
}

/**
 * Build a {@link TemplateEngine} `transformRender` that wraps the content
 * template's output in Obsidian managed-region markers. The engine applies it
 * to every named `render()`/`include()`, so the content template wraps
 * identically by either path and every other name passes through. The template
 * name is the host's vault convention, not something this package knows — a
 * consumer that omits `transformRender` (the playground) renders verbatim.
 *
 * @param contentTemplate name of the template whose output gets wrapped
 * @returns a `transformRender` callback for {@link TemplateEngineOptions}
 */
export const managedRegionTransform =
  (contentTemplate: string) =>
  (name: string, output: string): string =>
    name === contentTemplate ? formatManagedRegion(output) : output;

const MANAGED_REGION = new RegExp(
  `${RegExp.escape(MARKER_START)}[\\s\\S]*?${RegExp.escape(MARKER_END)}`,
);
const MANAGED_REGION_GLOBAL = new RegExp(MANAGED_REGION, "g");

export interface ManagedRegionReplacement {
  /** `content` with its first managed region replaced; unchanged when none is present. */
  content: string;
  /** Whether a managed region was found and replaced. */
  replaced: boolean;
  /** Managed regions beyond the first; `0` when at most one is present. */
  duplicateCount: number;
}

/**
 * Replace the first `%%zt-managed%%` region in `content` with `region()`.
 * A Query Block the region holds keeps its text: the n-th ` ```zotquery `
 * block of the new region takes the text of the n-th one in the old region,
 * so a change the researcher made in the block's toolbar survives an update.
 *
 * `region` is invoked at most once, and only when a managed region is
 * present, so callers can defer expensive rendering (and any side effects
 * it triggers) until it's known to be needed.
 *
 * Uses a function replacer so `$` sequences in the rendered region (e.g.
 * `$$…$$` display math, `$&`, `$'`) are inserted verbatim instead of being
 * interpreted as `String.prototype.replace` substitution patterns.
 */
export function replaceManagedRegion(
  content: string,
  region: () => string,
): ManagedRegionReplacement {
  const matches = content.match(MANAGED_REGION_GLOBAL) ?? [];
  const duplicateCount = Math.max(0, matches.length - 1);
  if (matches.length === 0) return { content, replaced: false, duplicateCount };
  const rendered = keepQueryBlocks(matches[0]!, region());
  return {
    content: content.replace(MANAGED_REGION, () => rendered),
    replaced: true,
    duplicateCount,
  };
}

/** The language of a Query Block's fence. */
const QUERY_BLOCK_LANGUAGE = "zotquery";

/** A fence that opens a code block, as CommonMark reads one. */
const OPENING_FENCE = regex(
  "^ {0,3}(?<fence>`{3,}|~{3,})[ \\t]*(?<info>[^\\n]*)$",
);

/** Whether `line` closes a code block that `fence` opened. */
function closesFence(line: string, fence: string): boolean {
  const indent = line.length - line.trimStart().length;
  const body = line.trim();
  return (
    indent <= 3 &&
    body.length >= fence.length &&
    body === fence[0]!.repeat(body.length)
  );
}

/** The code blocks of `lines` in order, each with its line span and language. */
function codeBlocks(
  lines: readonly string[],
): { start: number; end: number; language: string }[] {
  const blocks: { start: number; end: number; language: string }[] = [];
  for (let start = 0; start < lines.length; start++) {
    const open = OPENING_FENCE.exec(lines[start]!);
    if (!open) continue;
    const { fence, info } = open.groups;
    // A backtick fence's info string holds no backtick.
    if (fence.startsWith("`") && info.includes("`")) continue;
    let end = start + 1;
    while (end < lines.length && !closesFence(lines[end]!, fence)) end++;
    blocks.push({ start, end, language: info.trim().split(/\s/)[0]! });
    start = end;
  }
  return blocks;
}

/**
 * `next` with each of its Query Blocks in place of the text of the Query Block
 * at the same position in `previous`. A block `previous` lacks keeps the
 * rendered text.
 */
function keepQueryBlocks(previous: string, next: string): string {
  const queryBlocks = (lines: readonly string[]) =>
    codeBlocks(lines).filter(
      ({ language }) => language === QUERY_BLOCK_LANGUAGE,
    );
  const oldLines = previous.split("\n");
  const kept = queryBlocks(oldLines);
  if (kept.length === 0) return next;
  const lines = next.split("\n");
  const rendered = queryBlocks(lines);
  // From the last block back, so earlier line spans stay valid.
  for (
    let index = Math.min(kept.length, rendered.length) - 1;
    index >= 0;
    index--
  ) {
    const from = kept[index]!;
    const to = rendered[index]!;
    lines.splice(
      to.start,
      to.end - to.start + 1,
      ...oldLines.slice(from.start, from.end + 1),
    );
  }
  return lines.join("\n");
}
