// The pure wikilink scan: Obsidian's syntax-tree token nodes in, the internal
// links they spell out — plus the conceal group each one belongs to, which is
// what a reveal test has to match.

import type { DocRange } from "@/lib/editor-decoration";

/**
 * One syntax-tree node of Obsidian's Markdown stream parser, reduced to what
 * the scan reads. Offsets are document offsets, and `classes` is
 * `tokenClassNodeProp` split on spaces.
 *
 * @see docs/research/wikilink-editor-styling-hmd-syntax-tree.md — section 1
 */
export interface TokenNode {
  from: number;
  to: number;
  classes: readonly string[];
  /** The document text the node covers. */
  text: string;
}

/** One `[[…]]` construct the scan found, in document offsets. */
export interface WikilinkSpan {
  /** `![[…]]`, which Obsidian replaces wholesale and the Citation Index omits. */
  isEmbed: boolean;
  /** Whether the link carries an explicit display text after a `|`. */
  hasAlias: boolean;
  /**
   * From the end of `[[` to the end of the last interior node — Obsidian's own
   * extent for a wikilink, shared by its `is-unresolved` mark and by
   * `Editor.getClickableTokenAt`.
   */
  inner: DocRange;
  /** The whole construct, both brackets included. */
  outer: DocRange;
  /**
   * The conceal group the construct sits in. Obsidian reveals a concealed run
   * as a whole, so a plugin that reveals against the narrower {@link inner}
   * would show its display text between raw brackets.
   *
   * @see docs/research/wikilink-display-decoration-interaction.md — section 4
   */
  group: DocRange;
  /**
   * The link target: interior text with the alias split off, trimmed and
   * NFC-normalized, the way Obsidian normalizes a wikilink's href.
   */
  linktext: string;
  /**
   * Token classes of the first interior node. A replace decoration deletes the
   * `cm-*` marks Obsidian would have drawn over that node, so the widget
   * reconstructs them from this.
   */
  tokenClasses: readonly string[];
}

/**
 * The token vocabulary of Obsidian's HyperMD mode. It is a fork internal
 * pinned to 1.13 and carries no compatibility contract, so it lives in one
 * place and an unknown vocabulary degrades to "no links found", never to a
 * decoration over the wrong text.
 */
const LINK_START = "formatting-link-start";
const LINK_END = "formatting-link-end";
const EMBED_OPENER = "formatting-embed";
const INTERNAL_LINK = "hmd-internal-link";

/**
 * The two class sets a live-preview conceal group grows across: Obsidian's
 * inline-marker set and its "linkish" set. A node outside both ends the group,
 * which is the same flush rule Obsidian's own conceal builder applies.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 4.1
 */
const GROUP_CLASSES: ReadonlySet<string> = new Set([
  "em",
  "strong",
  "inline-code",
  "strikethrough",
  "highlight",
  "link",
  "image",
  "hmd-internal-link",
  "hmd-embed",
  "formatting-link",
  "footref",
]);

/** The run being accumulated between an opener and its closer. */
interface OpenRun {
  isEmbed: boolean;
  outerFrom: number;
  innerFrom: number;
  innerTo: number;
  raw: string;
  tokenClasses: readonly string[] | null;
}

/**
 * Finds every `[[…]]` in a node run, mirroring the state machine Obsidian's own
 * live-preview pass runs over the same nodes: an opener starts a run, adjacent
 * `hmd-internal-link` nodes accumulate the interior text, and a closer with a
 * non-empty interior emits the link. Code, math, frontmatter, escapes, and
 * Markdown-link URLs never carry the link classes, so they need no exclusion
 * list; an unclosed or line-crossing `[[` is tokenized as a bare link and is
 * likewise never seen here. A wikilink inside a `%%` comment keeps its link
 * classes and is decorated on purpose: Obsidian's metadata cache lists
 * comment-interior links — verified at runtime on 2026-08-08 against Obsidian
 * 1.13, for both the inline and the block `%%` form — so the References
 * Sidebar counts them and a `comment` exclusion would make the editor
 * disagree with it.
 *
 * @param nodes the token nodes of one document region, in document order.
 * @returns the links found, in document order.
 * @see docs/research/wikilink-editor-styling-hmd-syntax-tree.md — sections 1, 3
 */
export function scanWikilinks(nodes: readonly TokenNode[]): WikilinkSpan[] {
  const groups = concealGroups(nodes);
  const spans: WikilinkSpan[] = [];
  let run: OpenRun | null = null;

  for (const node of nodes) {
    const classes = new Set(node.classes);
    if (classes.has(LINK_START)) {
      run = {
        isEmbed: classes.has(EMBED_OPENER),
        outerFrom: node.from,
        innerFrom: node.to,
        innerTo: node.to,
        raw: "",
        tokenClasses: null,
      };
      continue;
    }
    if (run === null) continue;
    if (classes.has(INTERNAL_LINK)) {
      run.raw += node.text;
      run.innerTo = node.to;
      run.tokenClasses ??= node.classes;
      continue;
    }
    // An empty `[[]]` emits no interior node at all, so the non-empty test is
    // the same guard Obsidian applies before it reads the accumulated href.
    if (classes.has(LINK_END) && run.raw !== "") {
      spans.push(closeRun(run, node.to, groups));
    }
    run = null;
  }
  return spans;
}

function closeRun(
  run: OpenRun,
  outerTo: number,
  groups: readonly DocRange[],
): WikilinkSpan {
  const outer = { from: run.outerFrom, to: outerTo };
  return {
    isEmbed: run.isEmbed,
    hasAlias: run.raw.includes("|"),
    inner: { from: run.innerFrom, to: run.innerTo },
    outer,
    group: groupAround(groups, outer),
    linktext: hrefOf(run.raw),
    tokenClasses: run.tokenClasses ?? [],
  };
}

/**
 * The href half of Obsidian's wiki-inner-text split: everything before the
 * first `|`, one character further back when that pipe is backslash-escaped,
 * then trimmed and NFC-normalized. A link with no pipe keeps its whole text.
 */
function hrefOf(raw: string): string {
  const pipe = raw.indexOf("|");
  if (pipe === -1) return raw.trim().normalize("NFC");
  const end = raw.charAt(pipe - 1) === "\\" ? pipe - 1 : pipe;
  return raw.slice(0, end).trim().normalize("NFC");
}

/**
 * The runs Obsidian reveals as a unit: maximal sequences of adjacent nodes that
 * each carry a class in {@link GROUP_CLASSES}. Adjacency is exact — a node
 * starting past the running end, or carrying none of those classes, flushes the
 * group. Two wikilinks written back to back therefore share one group, and so
 * does a link wrapped in emphasis.
 */
function concealGroups(nodes: readonly TokenNode[]): DocRange[] {
  const groups: DocRange[] = [];
  let current: DocRange | null = null;

  for (const node of nodes) {
    const grouped = node.classes.some((name) => GROUP_CLASSES.has(name));
    if (current !== null && (!grouped || node.from !== current.to)) {
      groups.push(current);
      current = null;
    }
    if (!grouped) continue;
    current ??= { from: node.from, to: node.from };
    current.to = node.to;
  }
  if (current !== null) groups.push(current);
  return groups;
}

/**
 * @returns the group covering `outer`, or `outer` itself when the vocabulary
 *   named none — a narrower reveal region, never a wrong one.
 */
function groupAround(groups: readonly DocRange[], outer: DocRange): DocRange {
  const found = groups.find(
    (group) => group.from <= outer.from && group.to >= outer.to,
  );
  return found ?? outer;
}
