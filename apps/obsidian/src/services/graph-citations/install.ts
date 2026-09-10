// Per-leaf installation: locate a graph leaf's internal members, and swap one member for the life of a Disposable.

import type {
  App,
  GraphData,
  GraphEngine,
  GraphNodeCallback,
  GraphRenderer,
  GraphView,
  HoverParent,
  LocalGraphView,
  WorkspaceLeaf,
} from "obsidian";

import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";

const logger = getLogger("graph-citations");

/** The core plugin behind both graph views, as `app.internalPlugins` names it. */
export const GRAPH_CORE_PLUGIN_ID = "graph";

/** The two view types Graph Citations install on. */
export const GRAPH_VIEW_TYPES = ["graph", "localgraph"] as const;

/** The internal members one installation wraps, each verified present. */
export interface GraphLeafMembers {
  viewType: string;
  engine: GraphEngine & HoverParent & { app: App; render: () => unknown };
  renderer: GraphRenderer & {
    onNodeClick: GraphNodeCallback;
    onNodeRightClick: GraphNodeCallback;
    setData: (data: GraphData) => unknown;
    onNodeHover: GraphNodeCallback;
    onNodeUnhover: () => void;
    containerEl: HTMLElement;
    nodeLookup: Record<string, { x: number; y: number } | undefined>;
    scale: number;
    panX: number;
    panY: number;
  };
}

/**
 * Reads the engine and renderer off a `graph` or `localgraph` leaf. A leaf
 * missing any member — an Obsidian build that moved one — is reported at
 * `warn` and skipped, so the graph keeps its native behaviour; the service
 * asks once per view, so the report is once per view.
 *
 * @param leaf a loaded graph leaf. A deferred leaf holds a placeholder view
 *   with no members by design, and is the caller's to skip.
 * @returns `null` when the leaf is not a graph leaf or a member is missing.
 */
export function graphMembersOf(leaf: WorkspaceLeaf): GraphLeafMembers | null {
  const viewType = leaf.view.getViewType();
  const engine =
    viewType === "graph"
      ? (leaf.view as GraphView).dataEngine
      : viewType === "localgraph"
        ? (leaf.view as LocalGraphView).engine
        : undefined;
  const renderer = (leaf.view as GraphView).renderer;
  const present = membersPresent(
    "Graph leaf is missing an internal member; left native",
    {
      engine: Boolean(engine),
      "engine.app": Boolean(engine?.app),
      "engine.render": typeof engine?.render === "function",
      // Null until a popover of its own opens, so presence is the check.
      "engine.hoverPopover": engine ? "hoverPopover" in engine : false,
      renderer: Boolean(renderer),
      "renderer.onNodeClick": typeof renderer?.onNodeClick === "function",
      "renderer.onNodeRightClick":
        typeof renderer?.onNodeRightClick === "function",
      "renderer.setData": typeof renderer?.setData === "function",
      "renderer.onNodeHover": typeof renderer?.onNodeHover === "function",
      "renderer.onNodeUnhover": typeof renderer?.onNodeUnhover === "function",
      "renderer.containerEl": Boolean(renderer?.containerEl),
      // The renderer's constructor seeds all four, so an install-time check is
      // the whole check: a node's place needs no guard of its own afterwards.
      "renderer.nodeLookup": Boolean(renderer?.nodeLookup),
      "renderer.scale": typeof renderer?.scale === "number",
      "renderer.panX": typeof renderer?.panX === "number",
      "renderer.panY": typeof renderer?.panY === "number",
    },
    { viewType },
  );
  return present ? ({ viewType, engine, renderer } as GraphLeafMembers) : null;
}

/**
 * The one report an installation makes when an Obsidian build moved an
 * internal member, so the caller can leave that surface native instead of
 * crashing on it.
 *
 * @param present each member this code reads, by name, against whether the
 *   build still has it.
 * @param context what the report names beside the missing members.
 * @returns `true` when every member is there; `false` after one `warn`
 *   naming those that are not.
 */
export function membersPresent(
  message: string,
  present: Record<string, boolean>,
  context: Record<string, unknown>,
): boolean {
  const missing = Object.keys(present).filter((member) => !present[member]);
  if (missing.length === 0) return true;
  logger.warn(message, { ...context, missing });
  return false;
}

/**
 * Replaces `target[key]` with `wrap(original)` until the returned Disposable
 * runs, which puts the object back exactly as found: an inherited member is
 * inherited again, an own member is the same value again.
 *
 * @param wrap receives the member as it was — own or inherited — and returns
 *   its replacement.
 */
export function wrapMember<T extends object, K extends keyof T>(
  target: T,
  key: K,
  wrap: (original: NonNullable<T[K]>) => T[K],
): Disposable {
  const own = Object.hasOwn(target, key);
  const original = target[key] as NonNullable<T[K]>;
  target[key] = wrap(original);
  return disposable(() => {
    if (own) target[key] = original;
    else delete target[key];
  });
}
