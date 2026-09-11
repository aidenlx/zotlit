// The node-hover wrap: a Literature Note or a Cited Work Node answers the Hover Action — the Citation Popover, or a page preview under the shared citekey source — off an anchor at the node; every other node stays native.

import { Keymap, PopoverState } from "obsidian";
import type { App, GraphData } from "obsidian";

import { getLogger } from "@/lib/log";
import type {
  CitationPopover,
  WorkHoverRequest,
} from "@/services/citation-popover/service";
import {
  hoverPreferences,
  triggerCitekeyHover,
} from "@/services/citekey-navigation";
import type { NavigationPane } from "@/services/citekey-navigation";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";

import type { GraphCitationAdditions } from "./adapter";
import { CITATION_POPOVER } from "./display";
import { wrapMember } from "./install";
import type { GraphLeafMembers } from "./install";
import { rowFlag } from "./rows";
import "./style.css";

const logger = getLogger("graph-citations");

/** What one graph leaf's hover wrap reads the world through. */
export interface NodeHoverDeps {
  app: App;
  settings: Pick<SettingsService, "current">;
  citationPopover: CitationPopover;
  /** Opens the exact Item displayed in the popover. */
  open: (indexedKey: string, pane: NavigationPane) => void;
}

/** One graph leaf's hover context, built with the wrap rather than per hover. */
interface NodeHoverContext {
  members: GraphLeafMembers;
  deps: NodeHoverDeps;
  /** What the popover of this leaf's nodes stands on. */
  stand: NodeStand;
  /** What the last facaded render drew, read again on each hover. */
  additions: () => GraphCitationAdditions;
}

/**
 * Gives the nodes of one graph the hover the Hover Action names: the Citation
 * Popover over a Literature Note and over a Cited Work Node, the native hover
 * everywhere else.
 *
 * A node the graph draws no citation identity for calls through, so the rest
 * of the graph keeps the hover Obsidian gives it. A Cited Work Node is typed
 * `"unresolved"`, which the native hover answers with nothing at all, so the
 * popover shown for it can never stack with one of Obsidian's own.
 *
 * @param additions what the last facaded render drew, which is what a node id
 *   is read as a citation through.
 */
export function wrapNodeHover(
  members: GraphLeafMembers,
  deps: NodeHoverDeps,
  additions: () => GraphCitationAdditions,
): Disposable {
  const { renderer } = members;
  const stand = new NodeStand(members);
  const context: NodeHoverContext = { members, deps, stand, additions };
  const stack = new DisposableStack();
  stack.use(
    wrapMember(renderer, "onNodeHover", (native) => (evt, id, type) => {
      if (!hoverNode(context, evt, id)) native(evt, id, type);
    }),
  );
  stack.use(
    wrapMember(renderer, "onNodeUnhover", (native) => () => {
      // The pointer has left the node, so the stand stops holding the popover
      // open, Obsidian's own transition decides what becomes of it, and the
      // anchor goes unless the popover is still standing on it.
      stand.release();
      native();
      stand.retire();
    }),
  );
  stack.use(
    wrapMember(renderer, "setData", (native) => (data) => {
      const result = native(data);
      const enabled = rowFlag(members.engine, CITATION_POPOVER, false);
      stand.retainNodes(enabled ? data.nodes : {});
      if (!enabled) stand.release();
      return result;
    }),
  );
  stack.use(stand);
  return stack;
}

/**
 * @returns whether the hover was answered here. `false` leaves it to the
 *   native hover — which is what every node naming no work is answered by, and
 *   every node at all while the Hover Action is off.
 */
function hoverNode(
  { additions, stand, deps, members }: NodeHoverContext,
  evt: MouseEvent,
  id: string,
): boolean {
  if (!rowFlag(members.engine, CITATION_POPOVER, false)) return false;
  const settings = deps.settings.current;
  if (!settings) return false;
  const drawn = additions();
  const node = hoveredNode(id, drawn, deps);
  if (node === null) return false;
  const { action } = hoverPreferences(settings);
  if (action === "off") return false;
  // ZotLit is desktop-only, so a hover a pen or a finger produced shows
  // nothing — the same guard every other citation surface states, and one the
  // native hover does not make for the graph.
  const { pointerType } = evt as Partial<PointerEvent>;
  if (pointerType !== undefined && pointerType !== "mouse") {
    logger.trace("Graph node hover suppressed", { id, reason: "not-a-mouse" });
    return true;
  }
  if (
    action === "popover" &&
    settings["citation.hover-require-mod-graph"] &&
    !Keymap.isModifier(evt, "Mod")
  ) {
    logger.trace("Graph node hover suppressed", { id, reason: "needs-mod" });
    return true;
  }
  const position = nodeScreenPosition(members.renderer, id);
  if (position === null) {
    // The renderer holds no place for a node it just reported a hover on: a
    // build that moved the lookup out from under the member check.
    logger.warn("Graph node has no place in the renderer; hover left native", {
      id,
    });
    return false;
  }
  if (action === "page-preview") {
    // A Cited Work Node names no file, so Page preview has nothing to show.
    if (node.work.kind === "citekey") return true;
    // A Literature Note is a file Obsidian previews itself. It goes out under
    // the shared citekey source, so the graph is the same row of Obsidian's
    // Page preview settings as every other ZotLit citation surface rather
    // than the graph's own row.
    triggerCitekeyHover(deps.app.workspace, {
      event: evt,
      hoverParent: members.engine,
      targetEl: stand.take(position, id),
      linktext: node.id,
      // The node id is a full vault path, which resolves from anywhere; the
      // graph renders no document to resolve it against.
      sourcePath: "",
    });
    return true;
  }
  logger.debug("Graph node shows its entry", { id, work: node.work });
  deps.citationPopover.showWork({
    event: evt,
    hoverParent: members.engine,
    targetEl: stand.take(position, id),
    work: node.work,
    open: deps.open,
  });
  return true;
}

/** The work one hovered node stands for, and which kind of node stands for it. */
interface HoveredNode {
  id: string;
  work: WorkHoverRequest["work"];
}

/** A graph work carries either its node's Citation Key or its Literature Note's exact Item identity. */
function hoveredNode(
  id: string,
  additions: GraphCitationAdditions,
  deps: NodeHoverDeps,
): HoveredNode | null {
  const citekey = additions.citedWorkNodes.get(id);
  if (citekey !== undefined) return { id, work: { kind: "citekey", citekey } };
  const indexedKey = itemKeyFromFrontmatter(
    deps.app.metadataCache.getCache(id),
  );
  return indexedKey === null
    ? null
    : { id, work: { kind: "item", indexedKey } };
}

/** Where a node sits in its container's own box, in CSS pixels. */
interface NodePosition {
  left: number;
  top: number;
}

/**
 * A node's place in the container, from the world coordinates the renderer
 * holds it at. The lookup and the transform are members the leaf was admitted
 * on, so the one thing left to answer is whether the lookup holds this node.
 *
 * @returns `null` for a node the lookup does not hold, which a renderer that
 *   reported the hover off its own hit test does not produce.
 */
function nodeScreenPosition(
  renderer: GraphLeafMembers["renderer"],
  id: string,
): NodePosition | null {
  const { nodeLookup, scale, panX, panY, containerEl } = renderer;
  const node = nodeLookup[id];
  if (!node) return null;
  const ratio = containerEl.win.devicePixelRatio;
  return {
    left: (node.x * scale + panX) / ratio,
    top: (node.y * scale + panY) / ratio,
  };
}

/**
 * How often the stand states again that the pointer is on the node. Obsidian
 * sweeps twice a second and hides a popover it dropped a third of a second
 * later, so a shorter beat than either is what keeps the popover standing.
 */
const HOLD_INTERVAL_MS = 200;

/**
 * How long the hold waits for the popover it is to hold. The Citation Popover
 * opens with the hover; Obsidian's own page preview opens on a delay of its
 * own, around a third of a second later, and until it does the engine carries
 * whatever the hover before this one left. So a hold that has yet to see a
 * popover of its own waits this long rather than releasing at once.
 */
const HOLD_WAIT_MS = 2000;

/**
 * What a graph node's popover stands on — the Citation Popover and Obsidian's
 * own page preview alike: a zero-size, pointer-transparent anchor placed at
 * the node in the renderer's own container, which the graph keeps
 * `position: relative`, and the hold that keeps the popover open while the
 * pointer is on that node.
 *
 * The graph draws its nodes into a canvas, so a node has no element of its
 * own. The container being the graph's own is what puts the popover in the
 * graph's window rather than in whichever window holds focus — what a graph in
 * a pop-out window rests on.
 *
 * The hold is what an anchor costs. Obsidian sweeps its open popovers twice a
 * second: it reads the element under the pointer and drops `onTarget` for
 * every popover that element does not sit inside, which hides it. The anchor
 * takes no pointer events — the canvas beneath it keeps every gesture the
 * graph reads — so the sweep never finds it, and the popover would go while
 * the pointer is still on the node. Obsidian's own graph hover carries no
 * target element at all, which is how it stays clear of the sweep. So the
 * stand states `onTarget` again after each sweep, until the pointer leaves the
 * node. Both popovers open on a delay of their own, so the hold waits for the
 * one it is to hold before it releases. Verified against Obsidian 1.14.1.
 */
class NodeStand implements Disposable {
  readonly #members: GraphLeafMembers;
  /** Every anchor still in the container, oldest first. */
  readonly #anchors = new Map<HTMLElement, string>();
  #hold = 0;
  /**
   * The window the hold was armed on, which is the one that cancels it: a
   * graph moved to a pop-out window answers a new `containerEl.win`, and an
   * interval is the window's own (apps/obsidian/policies/hover-popover.md).
   */
  #holdWin: Window | null = null;

  constructor(members: GraphLeafMembers) {
    this.#members = members;
  }

  /**
   * Places an anchor of this node's own at `position` and answers it, holding
   * the popover that is about to stand on it open until the pointer leaves
   * the node.
   *
   * A node gets an anchor rather than the stand holding one, because
   * Obsidian's own page preview reads a hover it has a popover on that same
   * element for as the hover it is already showing, and shows nothing for the
   * second node (`app.js` 1.14.1, Page preview `onLinkHover`). Moving between
   * Literature Notes before the first preview has finished hiding is exactly
   * that hover, so each one stands on an element of its own.
   */
  take(position: NodePosition, id: string): HTMLElement {
    this.retire();
    const element = this.#build();
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    this.#anchors.set(element, id);
    this.#startHold(element);
    return element;
  }

  /** Stops holding the popover open: the pointer has left the node. */
  release(): void {
    if (this.#hold === 0) return;
    this.#holdWin?.clearInterval(this.#hold);
    this.#hold = 0;
    this.#holdWin = null;
  }

  /**
   * Takes the anchors out of the container, except the one a popover still
   * stands on — a popover hiding on its own delay reads its anchor's place
   * again as its entries land.
   */
  retire(): void {
    const standing = this.#members.engine.hoverPopover?.targetEl ?? null;
    for (const anchor of this.#anchors.keys()) {
      if (anchor === standing) continue;
      anchor.remove();
      this.#anchors.delete(anchor);
    }
  }

  /** Retires removed nodes even after the pointer has moved into their popovers. */
  retainNodes(nodes: GraphData["nodes"]): void {
    for (const [anchor, id] of this.#anchors) {
      if (Object.hasOwn(nodes, id)) continue;
      const popover = this.#members.engine.hoverPopover;
      if (popover?.targetEl === anchor) popover.hide();
      anchor.remove();
      this.#anchors.delete(anchor);
    }
  }

  [Symbol.dispose](): void {
    this.release();
    for (const anchor of this.#anchors.keys()) anchor.remove();
    this.#anchors.clear();
  }

  #startHold(anchor: HTMLElement): void {
    this.release();
    const { engine, renderer } = this.#members;
    let stood = false;
    let waited = 0;
    const win = renderer.containerEl.win;
    this.#holdWin = win;
    this.#hold = win.setInterval(() => {
      const popover = engine.hoverPopover;
      if (!this.#anchors.has(anchor)) {
        this.release();
        return;
      }
      if (!popover || popover.state === PopoverState.Hidden) {
        // A popover that stood on the anchor and has gone releases the hold,
        // which is how a popover hidden with no unhover is let go. One that
        // has yet to stand is waited for instead.
        waited += HOLD_INTERVAL_MS;
        if (stood || waited > HOLD_WAIT_MS) this.release();
        return;
      }
      stood = true;
      // Stated rather than restored: `transition` acts on a popover the sweep
      // put on its way out and leaves every other state as it found it.
      popover.onTarget = true;
      popover.transition();
    }, HOLD_INTERVAL_MS);
  }

  #build(): HTMLElement {
    // Built through the container so it lands in the container's own document,
    // which for a graph in a pop-out window is that window's. Its box and its
    // pointer transparency are `style.css`'s; only the place is set per hover.
    return this.#members.renderer.containerEl.createDiv(
      "zt-graph-hover-anchor",
    );
  }
}
