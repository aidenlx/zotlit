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
 * The engine a graph leaf draws through: the global view names it
 * `dataEngine`, the local one `engine`.
 *
 * @param viewType the leaf's view type, where the caller already read it.
 * @returns `undefined` for a leaf that is not a graph leaf, for a deferred
 *   leaf whose placeholder view holds no engine, and for a build that moved
 *   the member — all of which the caller reports as it sees fit.
 */
export function graphEngineOf(
  leaf: WorkspaceLeaf,
  viewType: string = leaf.view.getViewType(),
): GraphEngine | undefined {
  return viewType === "graph"
    ? (leaf.view as GraphView).dataEngine
    : viewType === "localgraph"
      ? (leaf.view as LocalGraphView).engine
      : undefined;
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
  const engine = graphEngineOf(leaf, viewType);
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

/** One reading of a graph engine's internals: what it reads, and what it builds. */
export interface MemberProbe<T> {
  /** Tells one probe's report from another's, so each surface is read on its own. */
  key: string;
  /** The one `warn` a build that moved a member gets. */
  message: string;
  /** Each member this probe reads, by name, against whether the build has it. */
  present: Record<string, boolean>;
  /** What the report names beside the missing members. */
  context: Record<string, unknown>;
  /** What the probe answers; read only once every member is there. */
  build: () => T;
}

/** The probes each engine failed, by key, so each report is made once. */
const failures = new WeakMap<GraphEngine, Set<string>>();

/**
 * Reads one surface of a graph engine, and reports a build that moved a member
 * once per engine per probe — an engine lives as long as the view that owns it
 * and is collected with it, so the report is once per graph however many times
 * the surface is read. Each probe keeps a failure of its own, so a build that
 * moved one section leaves every other section readable.
 *
 * @returns what the probe builds, or `null` where a member is missing — and
 *   `null` on every later reading, so the caller leaves that surface native.
 */
export function targetOnce<T>(
  engine: GraphEngine,
  probe: MemberProbe<T>,
): T | null {
  const failed = failures.get(engine);
  if (failed?.has(probe.key)) return null;
  if (!membersPresent(probe.message, probe.present, probe.context)) {
    if (failed) failed.add(probe.key);
    else failures.set(engine, new Set([probe.key]));
    return null;
  }
  return probe.build();
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
