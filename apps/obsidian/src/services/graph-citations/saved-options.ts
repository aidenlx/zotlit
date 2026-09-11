// What a graph persisted before a plugin row existed to hear it: the Graph core plugin's own options, a deferred leaf's state, and the workspace file.

import type { App, GraphOptions, WorkspaceLeaf } from "obsidian";

import { getLogger } from "@/lib/log";

import { GRAPH_CORE_PLUGIN_ID, GRAPH_VIEW_TYPES } from "./install";

const logger = getLogger("graph-citations");

/**
 * The options the global graph persists, which its view applies on load —
 * before a plugin row exists to hear them.
 *
 * @returns the Graph core plugin's own options, or `null` while the plugin is
 *   disabled or holds none.
 */
export function savedGlobalOptions(app: App): GraphOptions | null {
  const graph = app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID);
  return optionsOf((graph as { options?: unknown } | null)?.options);
}

/**
 * The options a local graph persists, read while its leaf is still deferred:
 * the placeholder view holds the saved state until the leaf loads, and the
 * load applies it before a plugin row exists to hear it.
 *
 * @returns the leaf's saved graph options, or `null` when it carries none.
 */
export function deferredLeafOptions(leaf: WorkspaceLeaf): GraphOptions | null {
  const state = leaf.view.getState() as { options?: unknown } | null;
  return optionsOf(state?.options);
}

/**
 * The graph options every leaf carried at the last app exit, by leaf id, read
 * from the workspace file Obsidian restored the layout from. A local graph
 * that the layout loaded straight away — the visible one — applied its saved
 * state before any plugin row existed to hear it, and never passed through
 * the deferred placeholder that would still carry it, so the file is what is
 * left to read.
 *
 * @returns an empty map when the build moved the reader, the file is absent,
 *   or no leaf in it is a graph.
 */
export async function savedLeafOptions(
  app: App,
): Promise<Map<string, GraphOptions>> {
  const saved = new Map<string, GraphOptions>();
  if (typeof app.workspace.readWorkspaceFile !== "function") {
    logger.warn("Workspace file reader missing; local graph rows start fresh");
    return saved;
  }
  collectLeafOptions(await app.workspace.readWorkspaceFile(), saved);
  logger.debug("Saved graph leaf options read", { leaves: saved.size });
  return saved;
}

/** Walks the serialized layout, whose splits nest to any depth. */
function collectLeafOptions(
  node: unknown,
  saved: Map<string, GraphOptions>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectLeafOptions(child, saved);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const { id, type, state } = node as {
    id?: unknown;
    type?: unknown;
    state?: { type?: unknown; state?: { options?: unknown } };
  };
  const graphLeaf =
    type === "leaf" &&
    typeof id === "string" &&
    GRAPH_VIEW_TYPES.includes(state?.type as (typeof GRAPH_VIEW_TYPES)[number]);
  const options = graphLeaf ? optionsOf(state?.state?.options) : null;
  if (options) saved.set(id as string, options);
  for (const child of Object.values(node)) collectLeafOptions(child, saved);
}

function optionsOf(value: unknown): GraphOptions | null {
  return typeof value === "object" && value !== null
    ? (value as GraphOptions)
    : null;
}
