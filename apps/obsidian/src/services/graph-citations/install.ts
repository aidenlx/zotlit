// Per-leaf installation: locate a graph leaf's internal members, and swap one member for the life of a Disposable.

import type {
  App,
  GraphEngine,
  GraphNodeCallback,
  GraphRenderer,
  GraphView,
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
  engine: GraphEngine & { app: App; render: () => unknown };
  renderer: GraphRenderer & {
    onNodeClick: GraphNodeCallback;
    onNodeRightClick: GraphNodeCallback;
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
  const missing = [
    engine ? null : "engine",
    engine?.app ? null : "engine.app",
    typeof engine?.render === "function" ? null : "engine.render",
    renderer ? null : "renderer",
    typeof renderer?.onNodeClick === "function" ? null : "renderer.onNodeClick",
    typeof renderer?.onNodeRightClick === "function"
      ? null
      : "renderer.onNodeRightClick",
  ].filter((member) => member !== null);
  if (missing.length > 0) {
    logger.warn("Graph leaf is missing an internal member; left native", {
      viewType,
      missing,
    });
    return null;
  }
  return { viewType, engine, renderer } as GraphLeafMembers;
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
