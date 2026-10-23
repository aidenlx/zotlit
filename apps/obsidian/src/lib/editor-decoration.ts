// Editor-decoration plumbing the citekey and wikilink editor treatments share.
// Both decorate Live Preview from data that lives outside the document, so
// they meet the editor the same three ways: the Live Preview probe, Obsidian's
// selection-overlap reveal test, and the fan-out that asks the open Markdown
// editors to build their decorations again. Links are read off Obsidian's
// syntax tree the same way too: its token nodes, line by visible line.

import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editorLivePreviewField, MarkdownView } from "obsidian";
import type { App } from "obsidian";

/**
 * A half-open range of document offsets — a decoration's extent, a selection
 * range, a visible region. One name for all three, since the reveal test and
 * the decoration builder compare them against each other.
 */
export interface DocRange {
  from: number;
  to: number;
}

/** Whether this editor renders Live Preview; Source mode keeps raw text. */
export function livePreviewOf(state: EditorState): boolean {
  return state.field(editorLivePreviewField, false) ?? false;
}

/**
 * Obsidian's own reveal test, which counts a touch at either end: a collapsed
 * cursor exactly at a widget's start or end brings the raw text back.
 *
 * @param ranges the selection ranges, which a blurred editor reports as none —
 *   blur conceals everything, the way Obsidian's own live preview reads it.
 * @see docs/research/pandoc-citekey-cm6-live-preview.md — section 6.2
 */
export function overlapsSelection(
  ranges: readonly DocRange[],
  from: number,
  to: number,
): boolean {
  return ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Dispatches one effect to every open Markdown editor, which is how a service
 * asks their decorations to be built again when something outside the
 * documents changed what a decoration should say.
 *
 * @param options.path the one document to reach; omitted, every editor is.
 * @returns how many editors the effect reached.
 */
export function dispatchToMarkdownEditors(
  app: App,
  effect: StateEffect<unknown>,
  options: { path?: string } = {},
): number {
  let reached = 0;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const { view } = leaf;
    if (!(view instanceof MarkdownView)) continue;
    if (options.path !== undefined && view.file?.path !== options.path) {
      continue;
    }
    view.editor.cm.dispatch({ effects: effect });
    reached += 1;
  }
  return reached;
}

/**
 * One syntax-tree node of Obsidian's Markdown stream parser, reduced to what
 * a link scan reads. Offsets are document offsets, and `classes` is
 * `tokenClassNodeProp` split on spaces. The parser merges adjacent tokens of
 * the same classes into one node.
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

/**
 * The token nodes of one region, in document order. Line-class nodes are left
 * out: they span a whole line and would break the node adjacency a scan reads.
 */
export function tokenNodes(state: EditorState, range: DocRange): TokenNode[] {
  const nodes: TokenNode[] = [];
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined) return;
      nodes.push({
        from: node.from,
        to: node.to,
        classes: classes.split(" "),
        text: state.doc.sliceString(node.from, node.to),
      });
    },
  });
  return nodes;
}

/**
 * The visible ranges widened to whole lines and merged, so a link straddling a
 * range edge is scanned once and in full. A link never crosses a line, so
 * whole lines are enough, and the merge keeps the ranges disjoint and ordered —
 * which is what a `RangeSetBuilder` requires of the additions built from them.
 */
export function visibleLineRanges(view: EditorView): DocRange[] {
  const { doc } = view.state;
  const ranges: DocRange[] = [];
  for (const range of view.visibleRanges) {
    const from = doc.lineAt(range.from).from;
    const to = doc.lineAt(range.to).to;
    const last = ranges.at(-1);
    if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}
