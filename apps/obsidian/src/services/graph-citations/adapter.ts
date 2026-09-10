// Pure: Citation Index facts -> the link-map additions one graph render draws. No Obsidian imports.

import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";

/** `Record<sourcePath, Record<target, count>>`, the shape of Obsidian's link maps. */
export type LinkMap = Record<string, Record<string, number>>;

/** What the graph's own Filters rows leave for one render to draw. */
export interface GraphCitationFilters {
  /** "Pandoc citations": edges from literal citekey occurrences. */
  pandocCitations: boolean;
  /**
   * "Wikilink citations": the Wikilink Citations a note writes, which the
   * graph draws natively and this render can take away again. `null` while
   * the vault-wide Wikilink Citations setting excludes the syntax: the row is
   * then absent and those links are ordinary links, left alone.
   */
  wikilinkCitations: boolean | null;
  /** "Citation-connected only": every other node leaves the graph. */
  citationConnectedOnly: boolean;
}

export interface GraphCitationInput {
  /**
   * Admitted Citation Occurrences per path, as `CitationIndex.citationsByPath`
   * answers: membership is the Document Citation Set's, so an aliased link, a
   * heading or block link, and a malformed Citation Fragment are no citations
   * here either.
   *
   * @see apps/obsidian/docs/adr/0022-one-document-citation-set-with-independent-controls.md
   */
  occurrences: ReadonlyMap<string, readonly CitationOccurrence[]>;
  /** `null` while the resolution snapshot is not warm: every citekey is then a Cited Work Node. */
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
  /**
   * The path a wikilink's linkpath reaches from its source, as Obsidian's own
   * link resolution answers it; `null` when it resolves to nothing.
   */
  resolveLink: (linkpath: string, sourcePath: string) => string | null;
  /** The Literature Note paths of an Indexed Key in Note Index order; empty when the Item has none. */
  notePathsOf: (indexedKey: string) => readonly string[];
  /** Every Literature Note in the vault, cited or not, as the Note Index holds them. */
  literatureNotes: Iterable<string>;
  /** The vault's own resolved links, so an edge a wikilink already draws is not added twice. */
  resolvedLinks: LinkMap;
  /** The graph's own rows. */
  filters: GraphCitationFilters;
}

export interface GraphCitationAdditions {
  /** Note -> Literature Note edges the vault's link maps do not already carry. */
  resolvedLinks: LinkMap;
  /** Note -> Cited Work Node edges; the target is a node id, never a path. */
  unresolvedLinks: LinkMap;
  /** Every Cited Work Node the additions draw, by node id, with the citekey it stands for. */
  citedWorkNodes: ReadonlyMap<string, string>;
  /**
   * For each node standing for a work, the document whose bibliography holds
   * that work's entry — what the hover reads the entry out of. Every document
   * that cites the work qualifies, so the smallest path is taken and the same
   * node reads under the same Citation Presentation on every render. Keyed by
   * every node a Citation names, whatever the rows leave drawn: the rows
   * decide which edges a render draws, and a work is cited either way.
   */
  citingSources: ReadonlyMap<string, string>;
  /** Every Literature Note path, whatever the rows say. */
  literatureNotes: ReadonlySet<string>;
  /**
   * The links one render takes back out of the vault's own resolved links,
   * counted per source and target: the Wikilink Citations a note wrote, while
   * that row is off. An ordinary link to the same Literature Note is counted
   * in neither, so the edge it draws stays. Empty otherwise.
   */
  hiddenLinks: LinkMap;
  /**
   * The paths one render keeps under "Citation-connected only"; `null` while
   * the row is off and every file stays. A Cited Work Node needs no entry: it
   * enters through a surviving note's unresolved links.
   */
  survivingPaths: ReadonlySet<string> | null;
}

/** The additions of a render that draws nothing. */
export const NO_ADDITIONS: GraphCitationAdditions = {
  resolvedLinks: {},
  unresolvedLinks: {},
  citedWorkNodes: new Map(),
  citingSources: new Map(),
  literatureNotes: new Set(),
  hiddenLinks: {},
  survivingPaths: null,
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
 * Only literal citekey occurrences add edges: a Wikilink Citation is already a
 * link in `resolvedLinks`, so the graph draws it natively. A citekey that
 * names one Item with a Literature Note links to that note — the one the
 * source already wikilinks when it links any of the Item's notes, else the
 * Item's first — so a source keeps one edge per cited work. Every other
 * citekey — missing, ambiguous, unresolved, or noteless — links to a Cited
 * Work Node, so the graph still shows the work.
 *
 * The rows decide the rest: "Pandoc citations" off adds no edge at all;
 * "Wikilink citations" off takes each note's own Wikilink Citations away, and
 * with them the reason to leave a citekey edge out; "Citation-connected only"
 * names the paths that survive.
 *
 * Both syntaxes also name a citing source, which is what a hover reads a
 * work's entry out of, and a Wikilink Citation is the one way a Literature
 * Note is cited with no edge added for it. One walk of each syntax answers
 * every node, so a hover pays no walk of its own.
 *
 * @returns additions keyed like Obsidian's own link maps; each edge once,
 *   however many times the note cites the work.
 */
export function graphCitationAdditions(
  input: GraphCitationInput,
): GraphCitationAdditions {
  const { filters } = input;
  const resolvedLinks: LinkMap = {};
  const unresolvedLinks: LinkMap = {};
  const citedWorkNodes = new Map<string, string>();
  const citingSources = new Map<string, string>();
  const literatureNotes = new Set(input.literatureNotes);
  /** Paths that cite a work, whether or not the citation adds an edge. */
  const citingPaths = new Set<string>();
  const wikilinks = wikilinkCitationEdges(
    input,
    literatureNotes,
    citingSources,
  );
  const hiddenLinks = filters.wikilinkCitations === false ? wikilinks : {};
  // A note that cites only by wikilink is citation-connected only while those
  // edges are drawn; with the row off they are gone, and so is the note.
  if (filters.wikilinkCitations === true) {
    for (const path of Object.keys(wikilinks)) citingPaths.add(path);
  }

  for (const [path, occurrences] of input.occurrences) {
    const linked = input.resolvedLinks[path] ?? {};
    for (const { kind, raw } of occurrences) {
      if (kind !== "citekey") continue;
      const notes = literatureNotesOf(input, raw);
      // Every node the work is drawn as reads its entry out of this document:
      // each Literature Note of the cited Item, or the Cited Work Node the
      // key stands for. The rows take edges away, not the citation itself.
      const nodes = notes.length > 0 ? notes : [citedWorkNodeId(raw)];
      for (const node of nodes) keepSmallest(citingSources, node, path);
      if (!filters.pandocCitations) continue;
      citingPaths.add(path);
      if (notes.length === 0) {
        const id = nodes[0]!;
        citedWorkNodes.set(id, raw);
        (unresolvedLinks[path] ??= {})[id] = 1;
        continue;
      }
      const note = notes.find((candidate) => linked[candidate]) ?? notes[0]!;
      // An edge this render still draws for the source is one the citekey
      // must not duplicate; one it is about to take away is an edge the
      // citekey draws itself.
      const drawn = (linked[note] ?? 0) - (hiddenLinks[path]?.[note] ?? 0);
      if (drawn > 0) continue;
      (resolvedLinks[path] ??= {})[note] = 1;
    }
  }

  return {
    resolvedLinks,
    unresolvedLinks,
    citedWorkNodes,
    citingSources,
    literatureNotes,
    hiddenLinks,
    survivingPaths: filters.citationConnectedOnly
      ? new Set([...literatureNotes, ...citingPaths])
      : null,
  };
}

/** Keeps the smallest path a node is cited from, which is what makes the choice deterministic. */
function keepSmallest(
  sources: Map<string, string>,
  node: string,
  path: string,
): void {
  const held = sources.get(node);
  if (held === undefined || path < held) sources.set(node, path);
}

/**
 * The vault's own edges that a Wikilink Citation drew, counted per source and
 * target: an occurrence the Citation Index admitted, whose linkpath resolves
 * to a Literature Note. Every other link into that note — aliased, to a
 * heading or a block, or from a note the index does not cover — is counted in
 * none of them and keeps its native Obsidian meaning.
 *
 * @param citingSources the sources under build, which this walk names the
 *   citing document of every note a Wikilink Citation reaches in.
 * @returns an empty map while the vault-wide setting excludes the syntax,
 *   when the index reports no wikilink occurrence at all.
 */
function wikilinkCitationEdges(
  input: GraphCitationInput,
  literatureNotes: ReadonlySet<string>,
  citingSources: Map<string, string>,
): LinkMap {
  const edges: LinkMap = {};
  for (const [path, occurrences] of input.occurrences) {
    for (const { kind, raw } of occurrences) {
      if (kind !== "wikilink") continue;
      const target = input.resolveLink(raw, path);
      if (target === null || !literatureNotes.has(target)) continue;
      const targets = (edges[path] ??= {});
      targets[target] = (targets[target] ?? 0) + 1;
      keepSmallest(citingSources, target, path);
    }
  }
  return edges;
}

function literatureNotesOf(
  input: GraphCitationInput,
  citekey: string,
): readonly string[] {
  const resolution = input.resolveCitekey(citekey);
  if (resolution?.kind !== "unique") return [];
  return input.notePathsOf(resolution.item.indexedKey);
}
