// A popover that stands until the user leaves it, on Obsidian's own popover.
// It is the one surface for a control a `Menu` cannot hold, such as a search
// field, rows with dropdowns, or a form. It lives on the document's body with
// Obsidian's other floating surfaces, so tooltips, notices and menus stack
// with it by their layers, and Obsidian places it in its anchor's window.
//
// Callers give an anchor and render the contents; the module owns the rest:
// - Placement beside the anchor, and placing again as the contents resize.
// - Escape, on a Scope. A layer with keys of its own pushes a Scope over this
//   one, and answers Escape itself when it wants the popover shut.
// - A press outside. A popover rendered inside another one counts as inside
//   it, so a press in the outer one shuts the inner one alone. A press on the
//   anchor stays the anchor's, which toggles the popover.
// - Focus: the shell takes it on opening, so Tab reaches the contents. A
//   caller may move it further. Focus held at closing goes back to the anchor.
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
import type { App, HoverParent } from "obsidian";
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

export interface PinnedPopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "popover"
> {
  /** The element the popover opens beside, and hands focus back to. */
  anchor: RefObject<HTMLElement | null>;
  handle?: Ref<PinnedPopoverHandle>;
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
    this.#scope.register([], "Escape", () => {
      this.hide();
      return false;
    });
    app.keymap.pushScope(this.#scope);
    this.register(() => app.keymap.popScope(this.#scope));
    // Obsidian's `watchResize` stops after ten changes; a list filtered by
    // typing goes past that.
    const resize = new ResizeObserver(() => this.position());
    resize.observe(body);
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
    this.hoverEl.focus({ preventScroll: true });
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

const EnclosingPopover = createContext<PopoverNode | null>(null);

export function PinnedPopover({
  anchor,
  handle,
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
    box.className = PINNED_POPOVER_BODY;
    return box;
  });
  const [mounted, setMounted] = useState<{
    doc: Document;
    round: number;
  } | null>(null);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;

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
  }, [anchor, app, body, node, parent]);

  return createPortal(
    <EnclosingPopover.Provider value={node}>
      <div ref={ref} {...rest}>
        {mounted && <Fragment key={mounted.round}>{children}</Fragment>}
      </div>
    </EnclosingPopover.Provider>,
    body,
  );
}
