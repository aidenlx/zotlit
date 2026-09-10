// Pure: Citation Index facts -> the link-map additions one graph render draws. No Obsidian imports.

import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";

/** `Record<sourcePath, Record<target, count>>`, the shape of Obsidian's link maps. */
export type LinkMap = Record<string, Record<string, number>>;

export interface GraphCitationInput {
  /** Admitted literal-citekey Citation Occurrences per path, as `CitationIndex.citationsByPath` answers. */
  occurrences: ReadonlyMap<string, readonly CitationOccurrence[]>;
  /** `null` while the resolution snapshot is not warm: every citekey is then a Cited Work Node. */
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
  /** The Literature Note paths of an Indexed Key in Note Index order; empty when the Item has none. */
  notePathsOf: (indexedKey: string) => readonly string[];
  /** The vault's own resolved links, so an edge a wikilink already draws is not added twice. */
  resolvedLinks: LinkMap;
}

export interface GraphCitationAdditions {
  /** Note -> Literature Note edges the vault's link maps do not already carry. */
  resolvedLinks: LinkMap;
  /** Note -> Cited Work Node edges; the target is a node id, never a path. */
  unresolvedLinks: LinkMap;
  /** Every Cited Work Node the additions draw, by node id, with the citekey it stands for. */
  citedWorkNodes: ReadonlyMap<string, string>;
}

/** The additions of a render that draws nothing. */
export const NO_ADDITIONS: GraphCitationAdditions = {
  resolvedLinks: {},
  unresolvedLinks: {},
  citedWorkNodes: new Map(),
};

/**
 * A Cited Work Node's id: the citekey behind an `@`, so the label reads as
 * the citation typed. The `@` narrows the collision with an unresolved
 * wikilink from `[[doe2024]]` to the far rarer `[[@doe2024]]`; it does not
 * remove it. The graph labels a node by the text after its last `/`, so a
 * slash inside the citekey is drawn as the division slash instead.
 */
export function citedWorkNodeId(citekey: string): string {
  return `@${citekey.replaceAll("/", "∕")}`;
}

/**
 * Only literal citekey occurrences add edges: a wikilink citation is already a
 * link in `resolvedLinks`, so the graph draws it natively. A citekey that
 * names one Item with a Literature Note links to that note — the one the
 * source already wikilinks when it links any of the Item's notes, else the
 * Item's first — so a source keeps one edge per cited work. Every other
 * citekey — missing, ambiguous, unresolved, or noteless — links to a Cited
 * Work Node, so the graph still shows the work.
 *
 * @returns additions keyed like Obsidian's own link maps; each edge once,
 *   however many times the note cites the work.
 */
export function graphCitationAdditions(
  input: GraphCitationInput,
): GraphCitationAdditions {
  const resolvedLinks: LinkMap = {};
  const unresolvedLinks: LinkMap = {};
  const citedWorkNodes = new Map<string, string>();

  for (const [path, occurrences] of input.occurrences) {
    const linked = input.resolvedLinks[path] ?? {};
    for (const { kind, raw } of occurrences) {
      if (kind !== "citekey") continue;
      const notes = literatureNotesOf(input, raw);
      if (notes.length === 0) {
        const id = citedWorkNodeId(raw);
        citedWorkNodes.set(id, raw);
        (unresolvedLinks[path] ??= {})[id] = 1;
      } else if (!notes.some((note) => linked[note])) {
        (resolvedLinks[path] ??= {})[notes[0]!] = 1;
      }
    }
  }

  return { resolvedLinks, unresolvedLinks, citedWorkNodes };
}

function literatureNotesOf(
  input: GraphCitationInput,
  citekey: string,
): readonly string[] {
  const resolution = input.resolveCitekey(citekey);
  if (resolution?.kind !== "unique") return [];
  return input.notePathsOf(resolution.item.indexedKey);
}
