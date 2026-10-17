// The Query View's text, as the Library View Document derives it: the tree
// node and the Reading State facets become the filters for all views (Recent
// adds none and reads the whole Library Scope), a
// search becomes its ranked key set, and the sort, the Layout and the Visible
// Properties pass through to the one Items view. A toolbar change comes back
// the other way through `documentWithText`.
//
// @see apps/obsidian/docs/adr/0071-the-library-tree-writes-filters.md
// @see apps/obsidian/docs/adr/0072-search-enters-the-library-view-as-an-ordered-key-set.md
// @see apps/obsidian/docs/adr/0075-recent-is-a-library-tree-node-that-writes-a-sort.md
import type { FilterTree } from "@zotlit/filter-expression";
import { nameDictionary } from "@zotlit/item-query";

import type { LibraryScope } from "@/services/library-scope/scope";
import {
  parseQueryFile,
  serializeQueryFile,
} from "@/views/query-view/query-file";

import { LIBRARY_LAYOUTS } from "./document";
import type {
  LibraryLayout,
  LibraryViewDocument,
  ReadingStateFacet,
} from "./document";

/** The names the derived query shows: its view's name, two Display Names and Recent's reason. */
export interface LibraryViewLabels {
  readonly papers: string;
  readonly creators: string;
  readonly year: string;
  /** Recent's reason for an Item Zotero changed last. */
  readonly editedInZotero: string;
}

/**
 * A condition on a row that the vault answers, not the query: the view
 * applies it to the rows the query returns (#1531 decides whether the
 * engine takes it over).
 */
export type VaultCondition = "has-literature-note" | "no-literature-note";

/** What the Library View runs for its document. */
export interface LibraryViewQuery {
  /** The Query File text the Query View reads. */
  readonly text: string;
  /** The Libraries the query reads: the Library of the tree node, or the Library Scope for Recent. */
  readonly libraries: LibraryScope;
  /**
   * The Indexed Keys of a search, best match first: the order the view shows
   * the rows in, in place of the sort. `null` while the view browses.
   */
  readonly rank: readonly string[] | null;
  /** The conditions every row passes in the vault, after the query. */
  readonly vault: readonly VaultCondition[];
  /**
   * Why each row is in the list: on Recent, its last activity; `null`
   * elsewhere. Until ZotLit Query reads `lastRead` and the Obsidian usage
   * ledger (#1532, #1533), every Item is on Recent for its last change in
   * Zotero; the reason then names the source and the time of each row.
   */
  readonly reason: string | null;
}

/**
 * The most rows the view shows: the Table draws every row it gets, and a
 * library of 10,000 Items takes about two seconds to draw, 50,000 over
 * half a minute. The toolbar says how many more match; the tree and the
 * search narrow to them.
 */
export const LIBRARY_VIEW_ROW_LIMIT = 1000;

/** What each facet asks of an Item: a filter, a condition in the vault, or both. */
const FACETS: Readonly<
  Record<ReadingStateFacet, { filter?: string; vault?: VaultCondition }>
> = {
  // `lastRead` joins this once ZotLit Query reads it (#1532, #1533).
  unread: { filter: "annotations.isEmpty()", vault: "no-literature-note" },
  annotated: { filter: "annotations.length > 0" },
  "has-note": { vault: "has-literature-note" },
  pdf: {
    filter:
      'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
  },
};

/**
 * The query of `doc`.
 * @param scope the Library Scope in force, which Recent reads.
 * @param keys the ranked Indexed Keys that the search of `doc.search` found;
 * absent while the view browses.
 */
export function libraryViewQuery(
  doc: LibraryViewDocument,
  {
    labels,
    scope,
    keys,
  }: {
    labels: LibraryViewLabels;
    scope: LibraryScope;
    keys?: readonly string[];
  },
): LibraryViewQuery {
  const { node } = doc;
  const filters: string[] = [];
  if (node.kind === "collection")
    filters.push(`collections.within(${JSON.stringify(node.path.join("/"))})`);
  const vault: VaultCondition[] = [];
  for (const facet of doc.facets) {
    const { filter, vault: condition } = FACETS[facet];
    if (filter !== undefined) filters.push(filter);
    if (condition !== undefined) vault.push(condition);
  }
  if (keys !== undefined)
    filters.push(
      `[${keys.map((key) => JSON.stringify(key)).join(", ")}].contains(indexedKey)`,
    );
  const recent = node.kind === "recent";
  const text = serializeQueryFile({
    ...(filters.length > 0 && { filters: filterTree(filters) }),
    properties: nameDictionary(
      new Map([
        ["creators", { displayName: labels.creators }],
        ["date.year", { displayName: labels.year }],
      ]),
    ),
    views: [
      {
        type: doc.layout,
        name: labels.papers,
        from: "items",
        ...(doc.sort.length > 0 && { sort: doc.sort }),
        limit: LIBRARY_VIEW_ROW_LIMIT,
        order: doc.order,
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
  return {
    text,
    libraries: recent ? scope : { mode: "selected", libraries: [node.library] },
    rank: keys ?? null,
    vault,
    reason: recent ? labels.editedInZotero : null,
  };
}

/**
 * `doc` with what a toolbar change set in `text`: the sort, the Layout and
 * the Visible Properties of its view. The tree node, the facets and the
 * search stay as `doc` holds them.
 */
export function documentWithText(
  doc: LibraryViewDocument,
  text: string,
): LibraryViewDocument {
  const view = parseQueryFile(text).views[0];
  if (!view) return doc;
  return {
    ...doc,
    sort: view.sort ?? [],
    layout: LIBRARY_LAYOUTS.includes(view.type as LibraryLayout)
      ? (view.type as LibraryLayout)
      : doc.layout,
    order: view.order ?? [],
  };
}

function filterTree(filters: readonly string[]): FilterTree {
  return filters.length === 1 ? filters[0]! : { and: [...filters] };
}
