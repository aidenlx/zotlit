// The Citation Graph preset: the option values both commands apply to the graph they open.

import type { GraphColor, GraphOptions, WorkspaceLeaf } from "obsidian";

import { getLogger } from "@/lib/log";

import {
  AUTHOR_TITLE_LABELS,
  CITATION_POPOVER,
  COLOR_CITATION_LINKS,
} from "./display";
import {
  CITATION_CONNECTED_ONLY,
  PANDOC_CITATIONS,
  WIKILINK_CITATIONS,
} from "./filters";
import { addLiteratureNotesGroup, groupsTarget } from "./groups";
import { graphEngineOf, membersPresent } from "./install";

const logger = getLogger("graph-citations");

export interface CitationGraphPresetOptions {
  /**
   * Whether the vault-wide Wikilink Citations setting admits the syntax. The
   * "Wikilink citations" row stands only while it does, and a section writes
   * only the keys its own rows answer, so the key is named only where a row
   * is there to hear it.
   *
   * @see apps/obsidian/docs/adr/0022-one-document-citation-set-with-independent-controls.md
   */
  wikilinkCitations: boolean;
  /** What the literature notes group starts at, where the preset adds one. */
  color: GraphColor;
}

/**
 * What a Citation Graph reads as: citations drawn in every syntax the vault
 * admits, every node with no citation relationship gone, citation edges in
 * their own colour and pointing the way the citation runs, and the tags,
 * attachments and orphans a research map does not rest on left out. Cited
 * works stay drawn, so "Existing files only" is off.
 *
 * A key this object leaves out is a key the preset never touches, which is
 * what keeps the forces and every other native option as the user had them.
 *
 * `showOrphans` belongs to a row the global graph alone builds — Obsidian's
 * local Filters section has none (verified in `app.js` 1.14.1) — so a local
 * graph answers no listener for it and the key passes through unused.
 */
function citationGraphPreset(
  options: Pick<CitationGraphPresetOptions, "wikilinkCitations">,
): GraphOptions {
  return {
    [PANDOC_CITATIONS]: true,
    ...(options.wikilinkCitations ? { [WIKILINK_CITATIONS]: true } : {}),
    [CITATION_CONNECTED_ONLY]: true,
    [COLOR_CITATION_LINKS]: true,
    [CITATION_POPOVER]: true,
    [AUTHOR_TITLE_LABELS]: true,
    showTags: false,
    showAttachments: false,
    hideUnresolved: false,
    showOrphans: false,
    showArrow: true,
  };
}

/**
 * Applies the preset to one graph leaf, and adds the literature notes group
 * unless a group already carries its query.
 *
 * Every value goes through the engine's set-options path, which hands the
 * object to each section of the controls panel. A section runs only the
 * listeners its own rows registered, so a key no row answers is skipped, and
 * a row already at the preset's value stays as it is: the listener calls
 * `setValue`, which runs the row's change handler — the one that re-renders
 * and saves — only where the value differs (`app.js` 1.14.1, section
 * `setOptions`, `registerOptionListener`, `ToggleComponent.setValue`).
 *
 * The caller installs ZotLit's rows before calling, since a row that is not
 * there yet answers nothing.
 *
 * @returns whether the preset was applied. `false` after one `warn` for a
 *   build that moved the engine or its set-options path, which leaves the
 *   graph as Obsidian opened it.
 */
export function applyCitationGraphPreset(
  leaf: WorkspaceLeaf,
  options: CitationGraphPresetOptions,
): boolean {
  const viewType = leaf.view.getViewType();
  const engine = graphEngineOf(leaf, viewType);
  const present = membersPresent(
    "Graph leaf is missing its set-options path; Citation Graph preset not applied",
    {
      engine: Boolean(engine),
      "engine.setOptions": typeof engine?.setOptions === "function",
    },
    { viewType },
  );
  if (!present) return false;
  engine!.setOptions!(citationGraphPreset(options));
  const target = groupsTarget(engine!);
  const added = target ? addLiteratureNotesGroup(target, options.color) : false;
  logger.debug("Citation Graph preset applied", {
    viewType,
    wikilinkCitations: options.wikilinkCitations,
    groupAdded: added,
  });
  return true;
}
