// A popover that stands until the user leaves it, on Obsidian's own popover.
// It is the one surface for a control a `Menu` cannot hold, such as a search
// field, rows with dropdowns, or a form. It lives on the document's body with
// Obsidian's other floating surfaces, so tooltips, notices and menus stack
// with it by their layers, and Obsidian places it in its anchor's window.
//
// Callers give an anchor and render the contents; the module owns the rest:
// - Placement beside the anchor, and placing again as the contents resize.
//   With `inset`, it stands inside that element's box at its right edge
//   instead, as tall as the box, and places again as the box resizes. With
//   `beside`, it stands outside that element's box on the side with more
//   room, level with the anchor, and places again as the page scrolls;
//   `within` names the box that room is counted in, and that it stays in.
// - Escape, on a Scope. A layer with keys of its own pushes a Scope over this
//   one, and answers Escape itself when it wants the popover shut. With
//   `onEscape`, the contents take Escape first when they have a use for it.
//   `pageKeys` are keys the contents answer themselves: the Scope keeps them
//   from Obsidian's hotkeys, and the page hears them.
// - A press outside. A popover rendered inside another one counts as inside
//   it, so a press in the outer one shuts the inner one alone. A press on the
//   anchor stays the anchor's, which toggles the popover.
// - Focus: the shell takes it on opening, so Tab reaches the contents, unless
//   `initialFocus` is off. A caller may move it further. Focus held at
//   closing goes back to the anchor.
//
// The element with `className` is the surface, and the caller draws it with
// utilities. The element around it is only a shell for Obsidian to place.
//
// The surface stands in a box that outlasts each opening. The contents mount
// at the first opening, so they start in the document that shows them, and
// stay mounted between openings. They mount anew when the anchor has moved to
// another window, because an editor among them belongs to one document.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import { PopoverState, Scope } from "obsidian";
import type { App, HoverParent, Modifier } from "obsidian";
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { HTMLAttributes, Ref, RefObject } from "react";
import { createPortal } from "react-dom";

import { composing } from "@zotlit/ui";

import { useObsidianApp } from "@/lib/app-context";
import { PopoutAwareHoverPopover } from "@/lib/popout-aware-hover-popover";

import "./pinned-popover.css";

export interface PinnedPopoverHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  /** Whether a node stands in the popover or in a popover inside it. */
  contains(node: Node): boolean;
}

/** One key the contents of a popover answer themselves. */
export interface PageKey {
  readonly modifiers: Modifier[];
  readonly key: string;
}

export interface PinnedPopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "popover"
> {
  /** The element the popover opens beside, and hands focus back to. */
  anchor: RefObject<HTMLElement | null>;
  handle?: Ref<PinnedPopoverHandle>;
  /**
   * In place of a place beside the anchor: the popover stands in this
   * element's box at its right edge, as tall as the box, with Obsidian's
   * `--size-4-2` between it and the box's top, right and bottom edges. It
   * follows the box as it resizes. The surface fills the height it is given.
   */
  inset?: RefObject<HTMLElement | null>;
  /**
   * In place of a place under the anchor: the popover stands outside this
   * element's box, on the side of it with more room in `within`, with
   * `--size-4-2` between them. Its top is level with the anchor's, held
   * inside the box's height, and it is no taller than the box.
   */
  beside?: RefObject<HTMLElement | null>;
  /**
   * The box a popover `beside` another stands in, such as the view it
   * serves, so it never covers a neighbouring leaf; the window by default.
   * Where neither side has room, it overlaps the box it stands beside.
   */
  within?: RefObject<HTMLElement | null>;
  /**
   * Escape reached the popover; `true` when the contents took it, and the
   * popover stays open.
   */
  onEscape?: () => boolean;
  /** Whether the popover takes focus as it opens; on by default. */
  initialFocus?: boolean;
  /**
   * Keys the contents answer in their own handlers, such as Mod+Enter in a
   * search field. No hotkey of Obsidian's takes them while the popover
   * stands, and the page hears them.
   */
  pageKeys?: readonly PageKey[];
  /** Called as the popover opens, and once it has closed. */
  onOpenChange?: (open: boolean) => void;
  ref?: Ref<HTMLDivElement>;
}

/** The box that holds a popover's surface across its openings. */
export const PINNED_POPOVER_BODY = "zt-pinned-popover-body";

/** Floating surfaces of Obsidian's own, which a press may reach from inside. */
const OBSIDIAN_FLOATING =
  ".menu, .suggestion-container, .popover:not(.zt-pinned-popover)";

interface PinnedHoverPopoverOptions {
  app: App;
  parent: HoverParent;
  anchor: HTMLElement;
  body: HTMLElement;
  /** The box the popover stands inset in, in place of beside the anchor. */
  inset: HTMLElement | null;
  /** The box the popover stands beside, level with the anchor. */
  beside: HTMLElement | null;
  /** The box a popover beside another stays in; the window when null. */
  within: HTMLElement | null;
  /** Whether the contents take an Escape: `true` keeps the popover open. */
  onEscape: () => boolean;
  initialFocus: boolean;
  pageKeys: readonly PageKey[];
  /** Whether a press on this element leaves the popover open. */
  holds: (element: Element) => boolean;
  onHidden: () => void;
}

class PinnedHoverPopover extends PopoutAwareHoverPopover {
  readonly #options: PinnedHoverPopoverOptions;
  readonly #scope: Scope;

  constructor(options: PinnedHoverPopoverOptions) {
    super(options.parent, options.anchor, 0);
    this.#options = options;
    this.#scope = new Scope(options.app.scope);
    this.setIsFocused(true);
    this.hoverEl.addClasses(["zt-root", "zt-pinned-popover"]);
    this.hoverEl.tabIndex = -1;
    this.hoverEl.append(options.body);
  }

  override onload(): void {
    const { app, anchor, holds, body } = this.#options;
    this.#scope.register([], "Escape", (event) => {
      // Escape that drops an input method's candidate is the method's.
      if (composing(event)) return;
      if (!this.#options.onEscape()) this.hide();
      return false;
    });
    // A keyed registration ends the search, so no hotkey behind it runs; an
    // answer other than `false` leaves the key to the page.
    for (const { modifiers, key } of this.#options.pageKeys)
      this.#scope.register(modifiers, key, () => true);
    app.keymap.pushScope(this.#scope);
    this.register(() => app.keymap.popScope(this.#scope));
    // Obsidian's `watchResize` stops after ten changes; a list filtered by
    // typing goes past that.
    const resize = new ResizeObserver(() => this.position());
    resize.observe(body);
    if (this.#options.inset) resize.observe(this.#options.inset);
    if (this.#options.beside) {
      resize.observe(this.#options.beside);
      // The anchor moves with the list it scrolls in.
      this.registerDomEvent(this.hoverEl.doc, "scroll", () => this.position(), {
        capture: true,
      });
    }
    this.register(() => resize.disconnect());
    this.registerDomEvent(
      this.hoverEl.doc,
      "pointerdown",
      ({ target }) => {
        if (!(target as Node | null)?.instanceOf(Element)) return;
        const element = target as Element;
        if (anchor.contains(element) || holds(element)) return;
        if (!element.closest(OBSIDIAN_FLOATING)) this.hide();
      },
      { capture: true },
    );
    if (this.#options.initialFocus) this.hoverEl.focus({ preventScroll: true });
  }

  override position(): void {
    super.position();
    if (this.#options.beside) {
      this.#placeBeside(this.#options.beside);
      return;
    }
    const box = this.#options.inset;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const gap = gapOf(box);
    const { style } = this.hoverEl;
    style.top = `${rect.top + gap}px`;
    style.height = `${Math.max(rect.height - 2 * gap, 0)}px`;
    style.maxWidth = `${Math.max(rect.width - 2 * gap, 0)}px`;
    style.left = `${rect.right - gap - this.hoverEl.offsetWidth}px`;
  }

  /**
   * Outside `box` on its roomier side within the bounds, level with the
   * anchor and within the box's height; held inside the bounds.
   */
  #placeBeside(box: HTMLElement): void {
    const rect = box.getBoundingClientRect();
    const row = this.#options.anchor.getBoundingClientRect();
    const bounds = this.#options.within?.getBoundingClientRect() ?? {
      left: 0,
      right: box.win.innerWidth,
    };
    const gap = gapOf(box);
    const { style } = this.hoverEl;
    // The surface reads it to scroll inside that height.
    style.setProperty("--zt-pinned-max-height", `${rect.height}px`);
    const width = this.hoverEl.offsetWidth;
    const height = Math.min(this.hoverEl.offsetHeight, rect.height);
    const leftRoom = rect.left - bounds.left;
    const rightRoom = bounds.right - rect.right;
    const left =
      leftRoom >= rightRoom ? rect.left - gap - width : rect.right + gap;
    style.left = `${Math.max(bounds.left, Math.min(left, bounds.right - width))}px`;
    style.top = `${Math.max(rect.top, Math.min(row.top, rect.bottom - height))}px`;
  }

  override hide(): void {
    if (this.state === PopoverState.Hidden) return;
    const { anchor, onHidden } = this.#options;
    const held = this.hoverEl.contains(this.hoverEl.doc.activeElement);
    super.hide();
    if (held) anchor.focus({ preventScroll: true });
    onHidden();
  }
}

/** Obsidian's `--size-4-2`, the gap a popover keeps to the box it stands in or beside. */
function gapOf(box: HTMLElement): number {
  return Number.parseFloat(
    box.win.getComputedStyle(box).getPropertyValue("--size-4-2"),
  );
}

/** One open or closed popover in the tree of popovers inside one another. */
class PopoverNode {
  readonly children = new Set<PopoverNode>();
  live: PinnedHoverPopover | null = null;

  contains(node: Node): boolean {
    return (
      this.live?.hoverEl.contains(node) === true ||
      [...this.children].some((child) => child.contains(node))
    );
  }
}

const NO_PAGE_KEYS: readonly PageKey[] = [];

const EnclosingPopover = createContext<PopoverNode | null>(null);

export function PinnedPopover({
  anchor,
  handle,
  inset,
  beside,
  within,
  onEscape,
  initialFocus = true,
  pageKeys = NO_PAGE_KEYS,
  onOpenChange,
  ref,
  children,
  ...rest
}: PinnedPopoverProps) {
  const app = useObsidianApp();
  const enclosing = useContext(EnclosingPopover);
  const [node] = useState(() => new PopoverNode());
  const [parent] = useState<HoverParent>(() => ({ hoverPopover: null }));
  const [body] = useState(() => {
    const box = document.createElement("div");
    // Inset in a box, the popover takes the box's height: the surface fills it.
    box.className = inset
      ? `${PINNED_POPOVER_BODY} zt:h-full`
      : PINNED_POPOVER_BODY;
    return box;
  });
  const [mounted, setMounted] = useState<{
    doc: Document;
    round: number;
  } | null>(null);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    enclosing?.children.add(node);
    return () => {
      enclosing?.children.delete(node);
      node.live?.hide();
    };
  }, [enclosing, node]);

  useImperativeHandle(handle, () => {
    const show = () => {
      if (node.live || !anchor.current) return;
      const { doc } = anchor.current;
      setMounted((last) =>
        last?.doc === doc ? last : { doc, round: (last?.round ?? 0) + 1 },
      );
      node.live = new PinnedHoverPopover({
        app,
        parent,
        anchor: anchor.current,
        body,
        inset: inset?.current ?? null,
        beside: beside?.current ?? null,
        within: within?.current ?? null,
        onEscape: () => escape.current?.() ?? false,
        initialFocus,
        pageKeys,
        holds: (element) => node.contains(element),
        onHidden: () => {
          node.live = null;
          notify.current?.(false);
        },
      });
      notify.current?.(true);
      node.live.showNow();
    };
    const hide = () => node.live?.hide();
    return {
      show,
      hide,
      toggle: () => (node.live ? hide() : show()),
      contains: (target) => node.contains(target),
    };
  }, [
    anchor,
    app,
    beside,
    body,
    initialFocus,
    inset,
    node,
    pageKeys,
    parent,
    within,
  ]);

  return createPortal(
    <EnclosingPopover.Provider value={node}>
      <div ref={ref} {...rest}>
        {mounted && <Fragment key={mounted.round}>{children}</Fragment>}
      </div>
    </EnclosingPopover.Provider>,
    body,
  );
}
