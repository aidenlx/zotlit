// The two palette commands that open a Citation Graph: the graph Obsidian's own commands open, with ZotLit's preset applied.

import { Keymap } from "obsidian";
import type { App, Plugin, TFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";

import { GRAPH_CORE_PLUGIN_ID } from "./install";
import type { GraphCitations } from "./service";

const logger = getLogger("graph-citations");

export interface GraphCitationsActionDeps {
  app: App;
  graphCitations: Pick<GraphCitations, "ready" | "enabled" | "applyPreset">;
}

/**
 * Registers "Open citation graph" and "Open local citation graph". Each opens
 * the leaf its native counterpart opens, then hands the leaf to Graph
 * Citations for the preset.
 */
export function addGraphCitationsActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: GraphCitationsActionDeps,
): void {
  plugin.addCommand({
    id: "open-citation-graph",
    name: m.command_open_citation_graph_name(),
    callback: () => openCitationGraph(deps),
  });
  plugin.addCommand({
    id: "open-local-citation-graph",
    name: m.command_open_local_citation_graph_name(),
    checkCallback: (checking) => {
      // A local graph is a graph of one note, so the command is there only
      // while a note is, which is the native command's own condition.
      const file = deps.app.workspace.getActiveFile();
      if (!file) return false;
      if (checking) return true;
      void openLocalCitationGraph(deps, file);
      return true;
    },
  });
}

/**
 * Opens the global graph where the native "Open graph view" opens it: the
 * tab the reader is in, or the new tab, split or window a modifier-held
 * invocation asks for.
 */
async function openCitationGraph(
  deps: GraphCitationsActionDeps,
): Promise<void> {
  if (!(await canOpen(deps))) return;
  const leaf = deps.app.workspace.getLeaf(
    Keymap.isModEvent(deps.app.lastEvent),
  );
  await leaf.setViewState({ type: "graph", active: true, state: {} });
  deps.graphCitations.applyPreset(leaf);
}

/**
 * Opens a local graph where the native "Open local graph" opens it: a vertical
 * split, grouped to the pane it was opened from so the graph follows that
 * pane's file.
 */
async function openLocalCitationGraph(
  deps: GraphCitationsActionDeps,
  file: TFile,
): Promise<void> {
  if (!(await canOpen(deps))) return;
  const { workspace } = deps.app;
  // The leaf the split is taken from, read before the split so the graph joins
  // the pane the reader was in and follows its file. `getLeaf("split", …)` is
  // `splitActiveLeaf`, which splits the most recent leaf (`app.js` 1.14.1) —
  // so that leaf is the one the new graph belongs beside.
  const group = workspace.getMostRecentLeaf() ?? undefined;
  const leaf = workspace.getLeaf("split", "vertical");
  await leaf.setViewState({
    type: "localgraph",
    active: true,
    group,
    state: { file: file.path },
  });
  deps.graphCitations.applyPreset(leaf);
}

/**
 * Both commands rest on the Graph core plugin, which owns the two view types,
 * on Graph Citations, which applies the preset, and on the vault-wide "Show
 * citations in graph view" setting, which is what draws the citations the
 * preset is there to show.
 *
 * @returns whether a Citation Graph can be opened; each way it cannot says so
 *   in a notice, since the reader asked for a graph and would otherwise get
 *   nothing at all.
 */
async function canOpen(deps: GraphCitationsActionDeps): Promise<boolean> {
  if (!deps.app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID)) {
    new BaseNotice(m.graph_citations_core_plugin_disabled());
    logger.debug("Citation Graph not opened; Graph core plugin disabled");
    return false;
  }
  try {
    await deps.graphCitations.ready;
  } catch {
    new BaseNotice(m.graph_citations_unavailable());
    logger.debug("Citation Graph not opened; Graph Citations failed to start");
    return false;
  }
  // Read once `ready` has settled, by which point the first settings snapshot
  // has landed and the flag holds the user's own choice.
  if (!deps.graphCitations.enabled) {
    new BaseNotice(m.graph_citations_disabled());
    logger.debug("Citation Graph not opened; graph citations turned off");
    return false;
  }
  return true;
}
