import * as v from "valibot";

// The Library View Document: what the Library View shows, as one plain value
// that plugin data keeps per vault, and the one module that reads, changes
// and derives it. Its transitions take a tree selection, the facets, the
// search and a toolbar change; its derivations give the list's query (the
// tree node and the facets become the filters for all views, Recent adds none
// and reads the whole Library Scope, a search becomes its ranked key set, and
// the sort, the Layout and the Visible Properties pass through to the one
// Items view), the tree's paper and unread counts, the Libraries of a node,
// and the text "Save as query file" writes. The Library Tree, the search box,
// the Library View and its storage all call it, so the tree's counts and the
// list are built one way.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
// @see apps/obsidian/docs/adr/0071-the-library-tree-writes-filters.md
// @see apps/obsidian/docs/adr/0072-search-enters-the-library-view-as-an-ordered-key-set.md
// @see apps/obsidian/docs/adr/0075-recent-is-a-library-tree-node-that-writes-a-sort.md
import type { FilterTree } from "@zotlit/filter-expression";

import type {
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import {
  librarySelectorSchema,
  selectorKey,
} from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import {
  parseQueryFile,
  serializeQueryFile,
} from "@/views/query-view/query-file";
import type { QueryFileSort } from "@/views/query-view/query-file";
import type { LiteratureNotes } from "@/views/query-view/table-notes";
import type { QueryRowPass } from "@/views/query-view/view";

import { searchTerms } from "./search";

/** The Reading State facets, in the order the Library Tree shows them. */
export const READING_STATE_FACETS = [
  "unread",
  "annotated",
  "has-note",
  "pdf",
] as const;
export type ReadingStateFacet = (typeof READING_STATE_FACETS)[number];

/** The Layouts the Library View offers, in the order its view menu lists them. */
export const LIBRARY_LAYOUTS = ["papers", "table"] as const;
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number];

/**
 * The node selected in the Library Tree: Recent, a Library, or a Collection by
 * its root-first name path in one Library. The path stays a list of names,
 * since a name may hold a `/`. Recent reads every Library in the Library Scope.
 */
export type LibraryNode =
  | { readonly kind: "recent" }
  | { readonly kind: "library"; readonly library: LibrarySelector }
  | {
      readonly kind: "collection";
      readonly library: LibrarySelector;
      readonly path: readonly string[];
    };

export interface LibraryViewDocument {
  readonly node: LibraryNode;
  /** The active Reading State facets, in {@link READING_STATE_FACETS} order. */
  readonly facets: readonly ReadingStateFacet[];
  /** The text in the search box; empty while the view browses. */
  readonly search: string;
  readonly sort: readonly QueryFileSort[];
  readonly layout: LibraryLayout;
  /** The Visible Properties, in the order the view shows them. */
  readonly order: readonly string[];
}

const nodeSchema = v.variant("kind", [
  v.object({ kind: v.literal("recent") }),
  v.object({ kind: v.literal("library"), library: librarySelectorSchema }),
  v.object({
    kind: v.literal("collection"),
    library: librarySelectorSchema,
    path: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
  }),
]);

const sortSchema = v.array(
  v.object({
    property: v.pipe(v.string(), v.nonEmpty()),
    direction: v.picklist(["ASC", "DESC"]),
  }),
);

const orderSchema = v.array(v.pipe(v.string(), v.nonEmpty()));

/** The document as plugin data stores it: JSON data. */
export type StoredLibraryViewDocument = {
  node: v.InferOutput<typeof nodeSchema>;
  facets: ReadingStateFacet[];
  search: string;
  sort: v.InferOutput<typeof sortSchema>;
  layout: LibraryLayout;
  order: string[];
};

/**
 * The sort Recent writes: last activity, newest first. Until ZotLit Query
 * reads `lastRead` and the Obsidian usage ledger (#1532, #1533), last
 * activity is the Item's last change in Zotero.
 *
 * @see apps/obsidian/docs/adr/0075-recent-is-a-library-tree-node-that-writes-a-sort.md
 */
export const RECENT_SORT: readonly QueryFileSort[] = Object.freeze([
  { property: "dateModified", direction: "DESC" },
]);

/** What a new Library View shows: Recent as Papers. */
export const DEFAULT_LIBRARY_VIEW_DOCUMENT: LibraryViewDocument = Object.freeze(
  {
    node: { kind: "recent" },
    facets: [],
    search: "",
    sort: RECENT_SORT,
    layout: "papers",
    order: ["title", "creators", "date.year", "vault.literatureNote"],
  } satisfies LibraryViewDocument,
);

/**
 * Read the document that plugin data holds: the one check of its shape. A
 * value that is not an object takes the default document; a field this
 * build cannot read takes its default and the other fields stay; a facet it
 * does not know drops out.
 */
export function parseLibraryViewDocument(raw: unknown): LibraryViewDocument {
  const stored =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const field = <T>(
    schema: v.GenericSchema<unknown, T>,
    key: keyof LibraryViewDocument,
    fallback: T,
  ): T => {
    const result = v.safeParse(schema, stored[key]);
    return result.success ? result.output : fallback;
  };
  const defaults = DEFAULT_LIBRARY_VIEW_DOCUMENT;
  const facets = field(v.array(v.unknown()), "facets", []);
  return {
    node: field(nodeSchema, "node", defaults.node),
    facets: READING_STATE_FACETS.filter((facet) => facets.includes(facet)),
    search: field(v.string(), "search", defaults.search),
    sort: field(sortSchema, "sort", defaults.sort),
    layout: field(v.picklist(LIBRARY_LAYOUTS), "layout", defaults.layout),
    order: field(orderSchema, "order", defaults.order),
  };
}

/**
 * `doc` with `node` selected in the tree. Recent writes its sort; a later
 * sort change stays until the researcher selects Recent again.
 */
export function withNode(
  doc: LibraryViewDocument,
  node: LibraryNode,
): LibraryViewDocument {
  return node.kind === "recent"
    ? { ...doc, node, sort: RECENT_SORT }
    : { ...doc, node };
}

/** `doc` with `facets` as the active Reading State facets. */
export function withFacets(
  doc: LibraryViewDocument,
  facets: readonly ReadingStateFacet[],
): LibraryViewDocument {
  return {
    ...doc,
    facets: READING_STATE_FACETS.filter((facet) => facets.includes(facet)),
  };
}

/** `doc` with `search` as the text in the search box. */
export function withSearch(
  doc: LibraryViewDocument,
  search: string,
): LibraryViewDocument {
  return { ...doc, search };
}

/** What {@link parseLibraryViewDocument} reads back, as JSON data. */
export function serializeLibraryViewDocument(
  doc: LibraryViewDocument,
): StoredLibraryViewDocument {
  return {
    node:
      doc.node.kind === "recent"
        ? { kind: "recent" }
        : doc.node.kind === "library"
          ? { kind: "library", library: { ...doc.node.library } }
          : {
              kind: "collection",
              library: { ...doc.node.library },
              path: [...doc.node.path],
            },
    facets: [...doc.facets],
    search: doc.search,
    sort: doc.sort.map(({ property, direction }) => ({ property, direction })),
    layout: doc.layout,
    order: [...doc.order],
  };
}

/** The names the derived query shows: its view's name and Recent's reason. */
export interface LibraryViewLabels {
  readonly papers: string;
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
 * @param keys the ranked Indexed Keys that the words of `doc.search` found;
 * absent while the view browses, and for a search of tags alone.
 * @param everywhere the Libraries a search of all libraries reads, in place
 * of the tree node; absent while the search keeps to the node.
 */
export function libraryViewQuery(
  doc: LibraryViewDocument,
  {
    labels,
    scope,
    keys,
    everywhere,
  }: {
    labels: LibraryViewLabels;
    scope: LibraryScope;
    keys?: readonly string[];
    everywhere?: readonly LibrarySelector[];
  },
): LibraryViewQuery {
  const { node } = doc;
  // A search of every Library leaves the node's Collection behind.
  const { filters, vault } = selectionConditions(
    everywhere === undefined ? node : null,
    doc.facets,
  );
  if (keys !== undefined)
    filters.push(
      `[${keys.map((key) => JSON.stringify(key)).join(", ")}].contains(indexedKey)`,
    );
  for (const tag of searchTerms(doc.search).tags)
    filters.push(`tags.contains(${JSON.stringify(tag)})`);
  const recent = node.kind === "recent";
  const text = serializeQueryFile({
    ...(filters.length > 0 && { filters: filterTree(filters) }),
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
    libraries: everywhere
      ? { mode: "selected", libraries: [...everywhere] }
      : librariesOf(node, scope),
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
export function withText(
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

/**
 * The Libraries `node` reads: its own Library, or for Recent the Library
 * Scope in force, `scope`.
 */
export function librariesOf(
  node: LibraryNode,
  scope: LibraryScope,
): LibraryScope {
  return node.kind === "recent"
    ? scope
    : { mode: "selected", libraries: [node.library] };
}

/**
 * The request that counts the papers of `library` for the tree: its Items,
 * each by its Indexed Key alone, grouped by the Collections they are filed
 * in. One Library each, since a path names a Collection only inside its
 * Library.
 */
export function paperCountRequest(library: LibrarySelector): QueryViewRequest {
  return {
    from: "items",
    fields: [],
    group: "collections[]",
    limit: null,
    libraries: { mode: "selected", libraries: [library] },
  };
}

/**
 * How the header counts the unread Items of `node`: the request with no
 * facet or search beside Unread, as the paper count reads them (ADR 0071),
 * and the rows of its answer that the vault leaves unread. `null` for
 * Recent, which counts nothing.
 */
export function unreadCount(
  node: LibraryNode,
  notes: Pick<LiteratureNotes, "find">,
): {
  request: QueryViewRequest;
  count: (rows: readonly QueryViewRow[]) => number;
} | null {
  if (node.kind === "recent") return null;
  const { filters, vault } = selectionConditions(node, ["unread"]);
  const pass = vaultPass(vault, notes);
  return {
    request: {
      from: "items",
      fields: [],
      filter: filters.join(" && "),
      limit: null,
      libraries: librariesOf(node, { mode: "all" }),
    },
    count: (rows) =>
      rows.filter(({ indexedKey }) => pass?.keeps(indexedKey) ?? true).length,
  };
}

/**
 * What the Items of `node` with `facets` pass: the conditions of the query,
 * and those the vault answers after it. `null`: no node narrows them.
 */
export function selectionConditions(
  node: LibraryNode | null,
  facets: readonly ReadingStateFacet[],
): { filters: string[]; vault: VaultCondition[] } {
  const filters: string[] = [];
  if (node?.kind === "collection")
    filters.push(`collections.within(${JSON.stringify(node.path.join("/"))})`);
  const vault: VaultCondition[] = [];
  for (const facet of facets) {
    const { filter, vault: condition } = FACETS[facet];
    if (filter !== undefined) filters.push(filter);
    if (condition !== undefined) vault.push(condition);
  }
  return { filters, vault };
}

/**
 * The rows that pass every one of `vault` as the Note Index has it now;
 * `null` for no condition.
 */
export function vaultPass(
  vault: readonly VaultCondition[],
  notes: Pick<LiteratureNotes, "find">,
): QueryRowPass | null {
  if (vault.length === 0) return null;
  return {
    key: vault.join(" "),
    keeps: (indexedKey) => {
      const noted = notes.find(indexedKey) !== null;
      return vault.every((condition) =>
        condition === "has-literature-note" ? noted : !noted,
      );
    },
  };
}

/**
 * The Query File that "Save as query file" writes for `doc`: the query of
 * `doc` with the Library of its tree node as a filter, since a Query File
 * tab reads every Library in the Library Scope. Recent, which reads the
 * Library Scope too, needs none. The search stays out; a Query File cannot
 * express it (ADR 0072).
 */
export function libraryViewQueryFileText(
  doc: LibraryViewDocument,
  { labels }: { labels: LibraryViewLabels },
): string {
  // The text names no Libraries: the Query File tab reads its own.
  const { text } = libraryViewQuery(
    { ...doc, search: "" },
    { labels, scope: { mode: "all" } },
  );
  if (doc.node.kind === "recent") return text;
  const file = parseQueryFile(text);
  const library = `library == ${JSON.stringify(selectorKey(doc.node.library))}`;
  const rest =
    file.filters === undefined
      ? []
      : typeof file.filters === "object" && "and" in file.filters
        ? file.filters.and
        : [file.filters];
  return serializeQueryFile({
    ...file,
    filters: rest.length === 0 ? library : { and: [library, ...rest] },
  });
}

/**
 * What "Save as query file" leaves out of `doc`, for the dialog to say: the
 * search, and the facets whose Literature Note check the vault answers after
 * the query. A Query File can hold neither (ADR 0072).
 */
export function libraryViewQueryFileLeftOut(doc: LibraryViewDocument): {
  facets: ReadingStateFacet[];
  search: boolean;
} {
  return {
    facets: doc.facets.filter((facet) => FACETS[facet].vault !== undefined),
    search: doc.search.trim() !== "",
  };
}

function filterTree(filters: readonly string[]): FilterTree {
  return filters.length === 1 ? filters[0]! : { and: [...filters] };
}
