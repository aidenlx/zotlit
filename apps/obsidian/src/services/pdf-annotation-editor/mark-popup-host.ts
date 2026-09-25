// The one Mark Popup of a PDF view, opened, moved and closed from the floating
// surface of the Reader Surface State alone.
//
// Each variant's owner keeps its row and its anchor geometry; the host only
// asks them, so the rule that one floating surface stands at a time is the
// union's, not the order in which two classes hand gestures to each other.
//
// @see apps/obsidian/docs/adr/0056-reader-surface-state-is-one-vanilla-store-per-pdf-view.md
import type { HoverParent } from "obsidian";

import { getLogger } from "@/lib/log";
import { hasActiveMenu } from "@/lib/menu";

import type { Point } from "./hit-test";
import { MarkPopup } from "./mark-popup";
import {
  sameFlat,
  sameFlatList,
  selectCreateRow,
  selectFloatingHead,
  selectSelectedRow,
} from "./reader-surface-state";
import type {
  Floating,
  FloatingHead,
  ReaderSurfaceState,
  ReaderSurfaceStore,
} from "./reader-surface-state";

const logger = getLogger("pdf-annotation-editor");

/** One floating variant, as its owner hands it to the host. */
export interface MarkPopupVariant {
  /**
   * Where the popup hangs, read from the page as it stands now, in client
   * coordinates. `null` while the target is off screen, which hides the popup
   * and keeps what floats.
   */
  anchor: () => Point | null;
  /**
   * Fills the popup's content. A rebuild hands it an empty element; a refresh
   * hands it the content as it last left it, to patch in place.
   */
  render: (content: HTMLElement) => void;
  /**
   * Runs as the content this variant last filled goes: before a rebuild
   * empties it, and as the popup hides. What the variant mounted in it, such
   * as a Preact root, is let go here.
   */
  release?: () => void;
  /**
   * Runs once the anchor reads `null` and the popup has hidden, for a variant
   * that cannot outlive its place on screen.
   */
  unanchored?: () => void;
}

export interface MarkPopupHostDeps {
  /** The hover parent, which is the binding rather than the PDF view. */
  parent: HoverParent;
  store: ReaderSurfaceStore;
  /**
   * What each floating kind draws, and where it hangs. An image capture and a
   * Text Draft have no popup.
   */
  variants: Record<
    Exclude<Floating["kind"], "none" | "capture" | "text-draft">,
    MarkPopupVariant
  >;
}

/**
 * Opens the popup for a floating variant with an anchor, and hides it for
 * none, an image capture, a Text Draft, a quiet selection, a selection whose grip is held
 * and not yet saving, or an anchor of `null`. A change of variant kind, of
 * selected key, of commenting, or of tagging rebuilds the row; any other change to what
 * floats or to its row refreshes it, which is what keeps an editor alive.
 *
 * A rebuild releases what the variant mounted in the content, such as the tag
 * section's Preact root, before it empties it; a hide releases it too. A
 * refresh keeps that root: the variant renders it again, in place while an
 * editor is open, or moved into the new column the refresh builds.
 */
export class MarkPopupHost implements Disposable {
  readonly #deps;
  readonly #unsubscribe;
  #popup: MarkPopup | null = null;
  /** The head the popup's row was last built for. */
  #built: FloatingHead | null = null;

  constructor(deps: MarkPopupHostDeps) {
    this.#deps = deps;
    this.#unsubscribe = deps.store.subscribe((state, previous) => {
      if (
        state.floating !== previous.floating ||
        !sameFlatList(rowOf(state), rowOf(previous))
      )
        this.#place({ refresh: true });
    });
    this.#place({ refresh: false });
  }

  /**
   * Whether a press on a node belongs to the popup: one inside it, or any press
   * while a menu opened from inside it stands. That press picks a menu item or
   * closes the menu, so it does not leave the popup.
   */
  contains(node: Node | null): boolean {
    const hoverEl = this.#popup?.hoverEl;
    if (!hoverEl) return false;
    return hoverEl.contains(node) || hasActiveMenu(hoverEl);
  }

  /** The pages moved: the popup re-hangs from its anchor, or hides. */
  sync(): void {
    this.#place({ refresh: false });
  }

  [Symbol.dispose](): void {
    this.#unsubscribe();
    this.#hide();
  }

  #place({ refresh }: { refresh: boolean }): void {
    const state = this.#deps.store.getState();
    const { floating } = state;
    // A press on a grip hides the popup, so it never covers the edge being
    // placed; the release hangs it again from the mark as it then stands.
    const variant =
      floating.kind === "none" ||
      floating.kind === "capture" ||
      floating.kind === "text-draft" ||
      (floating.kind === "selected" &&
        (floating.quiet ||
          (floating.adjust !== undefined &&
            floating.adjust.phase !== "saving")))
        ? null
        : this.#deps.variants[floating.kind];
    const anchor = variant?.anchor() ?? null;
    const head = selectFloatingHead(state);
    const action = !anchor
      ? this.#popup && "hide"
      : !this.#popup
        ? "open"
        : !refresh
          ? null
          : sameFlat(this.#built, head)
            ? "refresh"
            : "rebuild";
    if (action)
      logger.debug("Mark Popup placed", {
        action,
        kind: head.kind,
        key: head.key,
        commenting: head.commenting,
        tagging: head.tagging,
      });
    if (!anchor) {
      this.#hide();
      if (variant) variant.unanchored?.();
      return;
    }
    if (this.#popup) {
      // Redraw first: the popup centres on its anchor by the row's width.
      if (refresh) this.#popup.refresh();
      this.#popup.retarget(anchor);
      return;
    }
    const popup = new MarkPopup({
      parent: this.#deps.parent,
      anchor,
      render: (content) => this.#render(content),
    });
    popup.register(() => {
      if (this.#popup !== popup) return;
      const built = this.#built;
      this.#popup = null;
      this.#built = null;
      this.#release(built);
    });
    this.#popup = popup;
  }

  #render(content: HTMLElement): void {
    const state = this.#deps.store.getState();
    const { floating } = state;
    if (
      floating.kind === "none" ||
      floating.kind === "capture" ||
      floating.kind === "text-draft"
    )
      return;
    const head = selectFloatingHead(state);
    const built = this.#built;
    if (!sameFlat(built, head)) {
      this.#built = head;
      this.#release(built);
      content.empty();
    }
    this.#deps.variants[floating.kind].render(content);
  }

  /**
   * The fields are cleared before the release: letting go of the content can
   * end an editor's session, and the store change that follows must find no
   * popup to refresh.
   */
  #hide(): void {
    const popup = this.#popup;
    const built = this.#built;
    this.#popup = null;
    this.#built = null;
    this.#release(built);
    popup?.hide();
  }

  /** Lets the variant the content was built for go of what it holds. */
  #release(built: FloatingHead | null): void {
    const kind = built?.kind;
    if (kind === "selected" || kind === "create")
      this.#deps.variants[kind].release?.();
  }
}

/** The row of whatever floats, as flat records. */
function rowOf(state: ReaderSurfaceState): readonly object[] {
  return state.floating.kind === "create"
    ? selectCreateRow(state)
    : selectSelectedRow(state);
}
