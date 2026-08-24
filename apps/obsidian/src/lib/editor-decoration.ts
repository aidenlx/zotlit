// Editor-decoration plumbing the citekey and wikilink editor treatments share.
// Both decorate Live Preview from data that lives outside the document, so
// they meet the editor the same three ways: the Live Preview probe, Obsidian's
// selection-overlap reveal test, and the fan-out that asks the open Markdown
// editors to build their decorations again.

import type { EditorState, StateEffect } from "@codemirror/state";
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
