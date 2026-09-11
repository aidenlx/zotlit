// Opt-in citation presentation controls in the graph Display section.

import type { GraphEngine, GraphOptions } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { installToggleRow, rowFlag, toggleRowTarget } from "./rows";

/** The option key the "Color citation links" row persists under. */
export const COLOR_CITATION_LINKS = "zotlit-color-citation-links";

/** Ordinary graphs use native link colors until explicitly changed. */
const DEFAULT = false;

/** The per-view opt-in to citation details on hover. */
export const CITATION_POPOVER = "zotlit-citation-popover";

export interface DisplayRowsOptions {
  /** The options this graph persisted, as `saved-options.ts` reads them. */
  saved: GraphOptions | null;
}

/**
 * Prepends Display rows so Obsidian's last-row rule still hides only the
 * native Animate row's empty label (app.css 1.14.1).
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
  const { childrenEl } = target.section;
  const nativeRowCount = childrenEl.children.length;
  rows.use(
    installToggleRow(target, {
      key: COLOR_CITATION_LINKS,
      name: m.graph_option_color_citation_links_name(),
      tooltip: m.graph_option_color_citation_links_desc(),
      defaultValue: DEFAULT,
    }),
  );
  rows.use(
    installToggleRow(target, {
      key: CITATION_POPOVER,
      name: m.graph_option_citation_popover_name(),
      tooltip: m.graph_option_citation_popover_desc(),
      defaultValue: false,
    }),
  );
  childrenEl.prepend(...Array.from(childrenEl.children).slice(nativeRowCount));
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
