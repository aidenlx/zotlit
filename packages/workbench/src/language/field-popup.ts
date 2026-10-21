// The keys of a field's own popup — its completion list, its Signature Hint —
// in every CodeMirror editor with special syntax: the template panes and the
// expression fields. While a popup stands, Tab and Enter take the list's
// selected option and Escape closes the popup, and the key stops there.
// Shift-Tab, a key that belongs to an IME composition, and every key once the
// popup is gone pass on to the editor and its host as before.
//
// A host with a key system of its own, such as Obsidian's keymap Scopes,
// takes the keys through `fieldPopupKeyHost` while a popup stands, so the
// surfaces it stacks above the field never hear them. Elsewhere a CodeMirror
// keymap answers them.
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  selectedCompletionIndex,
} from "@codemirror/autocomplete";
import type { CompletionSource } from "@codemirror/autocomplete";
import { Facet, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";

/** What one popup does with the keys while it stands. */
export interface FieldPopup {
  /** Takes the selected option, for Tab and Enter; a popup without options leaves both keys alone. */
  readonly accept?: (view: EditorView) => boolean;
  /** Closes the popup, for Escape. */
  readonly close: (view: EditorView) => boolean;
}

/** What hands a host's key system back the keys it took. */
export type FieldPopupRelease = () => void;

/**
 * The keys a host routes while a popup of `view` stands. Each runs the popup
 * standing when the key arrives, and returns whether it acted; a key that
 * did not act is the host's to pass on.
 */
export interface FieldPopupKeys {
  readonly view: EditorView;
  /** Tab and Enter. */
  readonly accept: () => boolean;
  /** Escape. */
  readonly close: () => boolean;
}

/**
 * A host's own key system, given the keys when a popup opens in a focused
 * field, and released when the last popup closes, the field loses focus or
 * the editor goes.
 */
export type FieldPopupKeyHost = (keys: FieldPopupKeys) => FieldPopupRelease;

/**
 * The host that takes the popup keys; none leaves them to CodeMirror's
 * keymap alone.
 */
export const fieldPopupKeyHost = Facet.define<
  FieldPopupKeyHost,
  FieldPopupKeyHost | null
>({ combine: (hosts) => hosts[0] ?? null });

/**
 * The keys an open popup answers in CodeMirror, ahead of every other keymap:
 * each unmodified, and none typed into an IME composition.
 */
const popupKeymap = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
        return false;
      if (event.isComposing || event.keyCode === 229) return false;
      if (event.key === "Tab" || event.key === "Enter") return accept(view);
      if (event.key === "Escape") return close(view);
      return false;
    },
  }),
);

/** Hands the keys to the host while a popup stands in the focused field. */
const hostHold = ViewPlugin.fromClass(
  class {
    #release: FieldPopupRelease | null = null;
    constructor(readonly view: EditorView) {
      this.sync();
    }
    update() {
      this.sync();
    }
    sync() {
      const { view } = this;
      const host = view.state.facet(fieldPopupKeyHost);
      const held = host !== null && view.hasFocus && standing(view) !== null;
      if (held && !this.#release)
        this.#release = host({
          view,
          accept: () => accept(view),
          close: () => close(view),
        });
      else if (!held) this.destroy();
    }
    destroy() {
      this.#release?.();
      this.#release = null;
    }
  },
);

/**
 * The popups a field can show, each reading from the view whether it stands.
 * The first that stands answers the keys, so a popup registered at a higher
 * precedence closes first.
 */
export const fieldPopup = Facet.define<(view: EditorView) => FieldPopup | null>(
  { enables: [popupKeymap, hostHold] },
);

/** The popup that answers the keys of `view` now. */
function standing(view: EditorView): FieldPopup | null {
  for (const popup of view.state.facet(fieldPopup)) {
    const shown = popup(view);
    if (shown) return shown;
  }
  return null;
}

/** An IME composition keeps every key until it ends. */
function accept(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  return standing(view)?.accept?.(view) ?? false;
}

function close(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  return standing(view)?.close(view) ?? false;
}

/** CodeMirror's completion list, while it shows options. */
const completionList = Prec.high(
  fieldPopup.of((view) =>
    selectedCompletionIndex(view.state) === null
      ? null
      : { accept: acceptCompletion, close: closeCompletion },
  ),
);

/**
 * How a host draws a completion list and its rows, Template Completion's or
 * Expression Completion's: the classes it adds and the extra cells it renders.
 */
export type CompletionPresentation = Pick<
  NonNullable<Parameters<typeof autocompletion>[0]>,
  "tooltipClass" | "optionClass" | "addToOptions"
>;

/**
 * CodeMirror's completion list over `source`, with the popup keys: Template
 * Completion and Expression Completion both open through it, so both lists
 * answer the same keys. The arrows, Page Up and Page Down move the
 * selection; Ctrl-Space opens the list.
 */
export function syntaxCompletion(
  source: CompletionSource,
  presentation: CompletionPresentation = {},
): Extension {
  return [
    autocompletion({
      override: [source],
      icons: false,
      defaultKeymap: false,
      ...presentation,
    }),
    Prec.highest(
      keymap.of(
        completionKeymap.filter(
          ({ key }) => key !== "Enter" && key !== "Escape",
        ),
      ),
    ),
    completionList,
  ];
}
