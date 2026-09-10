// ZotLit's three Filters rows, and the flags one render reads back out of them.

import type { GraphEngine, GraphOptions } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { GraphCitationFilters } from "./adapter";
import { installToggleRow, toggleRowTarget } from "./rows";

/** The option key the "Pandoc citations" row persists under. */
export const PANDOC_CITATIONS = "zotlit-pandoc-citations";
/** The option key the "Wikilink citations" row persists under. */
export const WIKILINK_CITATIONS = "zotlit-wikilink-citations";
/** The option key the "Citation-connected only" row persists under. */
export const CITATION_CONNECTED_ONLY = "zotlit-citation-connected-only";

/** Citations drawn, every node kept: the graph a first-time reader gets. */
const DEFAULTS = {
  [PANDOC_CITATIONS]: true,
  [WIKILINK_CITATIONS]: true,
  [CITATION_CONNECTED_ONLY]: false,
} as const;

export interface FilterRowsOptions {
  /**
   * Whether the vault-wide Wikilink Citations setting admits the syntax. Its
   * row is absent while it does not, because a wikilink to a Literature Note
   * is then an ordinary link the graph already draws.
   *
   * @see apps/obsidian/docs/adr/0022-one-document-citation-set-with-independent-controls.md
   */
  wikilinkCitations: boolean;
  /** The options this graph persisted, as `saved-options.ts` reads them. */
  saved: GraphOptions | null;
}

/**
 * Builds the Filters rows into the graph's own Filters section, below the
 * native rows, each persisting like a native row.
 *
 * @returns a Disposable that leaves the section as found. Empty when the
 *   section could not be read; the graph then draws ZotLit's defaults.
 */
export function installFilterRows(
  engine: GraphEngine,
  options: FilterRowsOptions,
): Disposable {
  const rows = new DisposableStack();
  const target = toggleRowTarget(engine, { saved: options.saved });
  if (!target) return rows;
  rows.use(
    installToggleRow(target, {
      key: PANDOC_CITATIONS,
      name: m.graph_option_pandoc_citations_name(),
      tooltip: m.graph_option_pandoc_citations_desc(),
      defaultValue: DEFAULTS[PANDOC_CITATIONS],
    }),
  );
  if (options.wikilinkCitations) {
    rows.use(
      installToggleRow(target, {
        key: WIKILINK_CITATIONS,
        name: m.graph_option_wikilink_citations_name(),
        tooltip: m.graph_option_wikilink_citations_desc(),
        defaultValue: DEFAULTS[WIKILINK_CITATIONS],
      }),
    );
  }
  rows.use(
    installToggleRow(target, {
      key: CITATION_CONNECTED_ONLY,
      name: m.graph_option_citation_connected_only_name(),
      tooltip: m.graph_option_citation_connected_only_desc(),
      defaultValue: DEFAULTS[CITATION_CONNECTED_ONLY],
    }),
  );
  return rows;
}

export interface GraphCitationFiltersOptions {
  /**
   * Whether the vault-wide setting admits the syntax; see
   * {@link FilterRowsOptions.wikilinkCitations}.
   */
  wikilinkCitations: boolean;
}

/**
 * What one render of this graph draws, as its rows leave it. A key the rows
 * never wrote — an engine whose section could not be read, or a render before
 * the rows are built — reads as its default.
 */
export function graphCitationFilters(
  engine: { options?: GraphOptions },
  options: GraphCitationFiltersOptions,
): GraphCitationFilters {
  const live = engine.options ?? {};
  return {
    pandocCitations: flag(live, PANDOC_CITATIONS),
    wikilinkCitations: options.wikilinkCitations
      ? flag(live, WIKILINK_CITATIONS)
      : null,
    citationConnectedOnly: flag(live, CITATION_CONNECTED_ONLY),
  };
}

function flag(options: GraphOptions, key: keyof typeof DEFAULTS): boolean {
  const value = options[key];
  return typeof value === "boolean" ? value : DEFAULTS[key];
}
