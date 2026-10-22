// The keyboard of a Query View that a note holds: a Query File embed and a
// Query Block. Neither has a leaf of its own, so Obsidian never consults its
// Scope. The view's Scope goes on the keymap while focus is inside it, and the
// card keys act there and nowhere else in the note. The palette's Annotation
// History commands reach the view the researcher last worked in, and a card
// dragged out of it carries the card, not the link that embeds the view.
import type { App, Scope } from "obsidian";

import { disposable } from "@/lib/disposables";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";

/**
 * Where focus goes while the researcher still works in the view: a modal,
 * such as the command palette, opened over it.
 */
const OVER_THE_VIEW = ".modal-container";

interface Held {
  el: HTMLElement;
  surface: HistorySurface;
}

export class QueryCardFocus {
  readonly #app: Pick<App, "keymap">;
  /** The view focus was last in, until focus goes to another part of the workspace. */
  #last: Held | null = null;

  constructor(app: Pick<App, "keymap">) {
    this.#app = app;
  }

  /**
   * Put `scope` on the keymap while focus is inside `el`, and make `surface`
   * the one the palette steps.
   *
   * A text field inside `el` keeps the keymap as it is: a card's comment
   * editor pushes its own Scope, and the card keys do not act in a field.
   *
   * A drag that starts inside `el` stops there. In Live Preview the note's
   * editor answers a drag on a draggable element with the link at the
   * pointer, which is the link that embeds the view.
   *
   * @returns what takes the Scope off the keymap and stops the watch.
   */
  hold(el: HTMLElement, scope: Scope, surface: HistorySurface): Disposable {
    const { keymap } = this.#app;
    let pushed = false;
    const held: Held = { el, surface };
    const release = () => {
      if (pushed) keymap.popScope(scope);
      pushed = false;
    };
    const onFocusIn = (event: FocusEvent) => {
      this.#last = held;
      if (pushed || inTextEntry(event.target)) return;
      keymap.pushScope(scope);
      pushed = true;
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next !== null && el.contains(next)) return;
      release();
      const over =
        next?.instanceOf(HTMLElement) === true &&
        next.closest(OVER_THE_VIEW) !== null;
      if (next !== null && !over && this.#last === held) this.#last = null;
    };
    const onDragStart = (event: DragEvent) => event.stopPropagation();
    // As the focus event comes down, so a layer inside the view that holds a
    // Scope of its own, such as a list editor, pushes it above this one.
    el.addEventListener("focusin", onFocusIn, true);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("dragstart", onDragStart);
    return disposable(() => {
      el.removeEventListener("focusin", onFocusIn, true);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("dragstart", onDragStart);
      release();
      if (this.#last === held) this.#last = null;
    });
  }

  /**
   * The view inside `container` that focus was last in, while it stands
   * there: the one the palette's undo and redo act on.
   */
  surfaceIn(container: HTMLElement): HistorySurface | null {
    const last = this.#last;
    if (!last?.el.isConnected || !container.contains(last.el)) return null;
    return last.surface;
  }
}
