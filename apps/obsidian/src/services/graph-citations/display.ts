// ZotLit's Display row, and the flag the citation edge colour reads back out of it.

import type { GraphEngine, GraphOptions } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { installToggleRow, rowFlag, toggleRowTarget } from "./rows";

/** The option key the "Color citation links" row persists under. */
export const COLOR_CITATION_LINKS = "zotlit-color-citation-links";

/** Citation edges told apart from ordinary links: the graph a first-time reader gets. */
const DEFAULT = true;

export interface DisplayRowsOptions {
  /** The options this graph persisted, as `saved-options.ts` reads them. */
  saved: GraphOptions | null;
}

/**
 * Builds the Display rows into the graph's own Display section, below the
 * native rows, each persisting like a native row.
 *
 * @returns a Disposable that leaves the section as found. Empty when the
 *   section could not be read; the graph then draws ZotLit's default.
 */
export function installDisplayRows(
  engine: GraphEngine,
  options: DisplayRowsOptions,
): Disposable {
  const rows = new DisposableStack();
  const target = toggleRowTarget(engine, {
    section: "display",
    saved: options.saved,
  });
  if (!target) return rows;
  rows.use(
    installToggleRow(target, {
      key: COLOR_CITATION_LINKS,
      name: m.graph_option_color_citation_links_name(),
      tooltip: m.graph_option_color_citation_links_desc(),
      defaultValue: DEFAULT,
    }),
  );
  return rows;
}

/**
 * Whether this graph draws its citation edges in ZotLit's own colour, as its
 * row leaves it. A key the row never wrote — an engine whose Display section
 * could not be read — reads as the default.
 */
export function colorCitationLinks(engine: {
  options?: GraphOptions;
}): boolean {
  return rowFlag(engine, COLOR_CITATION_LINKS, DEFAULT);
}
