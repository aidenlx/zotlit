// Shared plumbing for the editors that draw their own token marks.
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import type { Span } from "./span";

/**
 * Calls `put` for each part of `span` that no hole covers, in document order.
 * @param holes Sorted by `from`; they may overlap.
 */
export function gapsAround(
  { from, to }: Span,
  holes: readonly Span[],
  put: (from: number, to: number) => void,
): void {
  let start = from;
  for (const hole of holes) {
    if (hole.to <= start || hole.from >= to) continue;
    if (start < hole.from) put(start, hole.from);
    start = Math.max(start, hole.to);
  }
  if (start < to) put(start, to);
}

/**
 * Draws the marks `build` returns, rebuilt after each update `rebuild`
 * accepts. The plugin keeps the default precedence, so it reads the state
 * after the other plugins update; `precedence` applies to the marks alone.
 */
export function decorationLayer(
  build: (view: EditorView) => DecorationSet,
  {
    precedence = (extension) => extension,
    rebuild = (update) => update.docChanged,
  }: {
    precedence?: (extension: Extension) => Extension;
    rebuild?: (update: ViewUpdate) => boolean;
  } = {},
): Extension {
  const plugin = ViewPlugin.define((view) => ({
    decorations: build(view),
    update(update: ViewUpdate) {
      if (rebuild(update)) this.decorations = build(update.view);
    },
  }));
  return [
    plugin,
    precedence(
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
    ),
  ];
}
