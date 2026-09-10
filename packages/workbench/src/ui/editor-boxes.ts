// The CodeMirror machinery a pane paints its boxes with: the host element one
// box is portalled into, the full-width block a preview opens in, the click
// that hands the reader back the source the box stands in for, and the
// decoration field that redraws all of it. Every pane that replaces calls with
// boxes — the note body's annotation calls, any slice's Shared Partial calls —
// draws through this; only what counts as a call differs.

import type { WorkbenchSliceRange } from "#/document/index";
import { StateField } from "@codemirror/state";
import type {
  EditorState,
  Extension,
  Range,
  StateEffectType,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

/** The place one box is painted into, held across every redraw. */
export class BoxWidget extends WidgetType {
  constructor(
    readonly box: HTMLElement,
    readonly range: WorkbenchSliceRange,
  ) {
    super();
  }

  eq(other: BoxWidget): boolean {
    return (
      other.box === this.box &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    revealSourceOnClick(this.box, view, this.range);
    return this.box;
  }
}

/** One full-width block, placed after the line containing the open call. */
export class PreviewWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super();
  }

  eq(other: PreviewWidget): boolean {
    return other.host === this.host;
  }

  toDOM(): HTMLElement {
    return this.host;
  }
}

/** The place box `index` is painted into, made on first use and held after. */
export function boxAt(
  boxes: Map<number, HTMLElement>,
  index: number,
): HTMLElement {
  let box = boxes.get(index);
  if (!box) {
    box = document.createElement("span");
    boxes.set(index, box);
  }
  return box;
}

/**
 * Replace each call in `calls` with the box that stands in for it, skipping
 * the ones the selection touches — the raw call reappears there, which is how
 * a reader in Basic mode edits a call.
 */
export function boxRanges(
  calls: readonly WorkbenchSliceRange[],
  boxes: Map<number, HTMLElement>,
  selection: { ranges: readonly { from: number; to: number }[] },
): Range<Decoration>[] {
  return calls.flatMap((call, index) =>
    selection.ranges.some(
      (range) => range.from <= call.to && range.to >= call.from,
    )
      ? []
      : [
          Decoration.replace({
            widget: new BoxWidget(boxAt(boxes, index), call),
          }).range(call.from, call.to),
        ],
  );
}

/**
 * One pane's box decorations, rebuilt whenever the text, the selection, or the
 * open preview moves. `expand` carries the line the preview sits under, in
 * this pane's own offsets; `build` says which boxes that state draws.
 */
export function boxField(
  expand: StateEffectType<number | null>,
  build: (state: EditorState, expanded: number | null) => DecorationSet,
): Extension {
  return StateField.define<{
    expanded: number | null;
    decorations: DecorationSet;
  }>({
    create: (state) => ({ expanded: null, decorations: build(state, null) }),
    update: (value, transaction) => {
      let expanded = value.expanded;
      for (const effect of transaction.effects) {
        if (effect.is(expand)) expanded = effect.value;
      }
      return transaction.docChanged ||
        transaction.selection ||
        expanded !== value.expanded
        ? { expanded, decorations: build(transaction.state, expanded) }
        : value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
}

/** The parts of a box that act on their own rather than reveal the source. */
const INTERACTIVE = "button, [data-annotation-preview], [data-partial-preview]";

/**
 * Selecting the box shows the call it stands in for, which is the one way
 * back to the source a reader in Basic mode has.
 */
export function revealSourceOnClick(
  element: HTMLElement,
  view: EditorView,
  range: WorkbenchSliceRange,
): void {
  element.onclick = (event) => {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE))
      return;
    view.focus();
    view.dispatch({
      selection: { anchor: range.to, head: range.from },
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
  };
}
