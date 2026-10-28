import * as v from "valibot";

// The Library View Document: what the Library View shows, as one plain value
// that plugin data keeps per vault, and the one module that reads, changes
// and derives it. Its transitions take a tree selection, the tree nodes
// left open, the Reading Card's width, the facets, the search and a toolbar change; its derivations give the list's query (the
// tree node, the facets and the selected tags become the filters for all views, Recent adds none
// and reads the whole Library Scope, a search becomes its ranked key set, and
// the sort passes through to the one Items view, always in the Papers
// Layout), the tree's paper and unread counts, the tags the Tag Selector
// lists, the Libraries of a node,
// and the text "Save as query file" writes. The Library Tree, the search box,
// the Library View and its storage all call it, so the tree's counts and the
// list are built one way.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
// @see apps/obsidian/docs/adr/0072-the-library-tree-writes-filters.md
// @see apps/obsidian/docs/adr/0073-search-enters-the-library-view-as-an-ordered-key-set.md
// @see apps/obsidian/docs/adr/0076-recent-is-a-library-tree-node-that-writes-a-sort.md
// @see apps/obsidian/docs/adr/0078-the-tag-selector-writes-tag-filters.md
import type { FilterTree } from "@zotlit/filter-expression";

import type {
  QueryViewGroup,
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
  sameSort,
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

/**
 * The Layouts the Library View offers: Papers alone, so it shows no Layout
 * switch. The full Query View is a "Save as query file" away.
 *
 * @see apps/obsidian/docs/adr/0075-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
 */
export const LIBRARY_LAYOUTS = ["papers"] as const;

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
  /**
   * The tags selected in the Tag Selector, each once, sorted by
   * {@link sortTags}: the list holds the Items with every one of them.
   */
  readonly tags: readonly string[];
  /** The text in the search box; empty while the view browses. */
  readonly search: string;
  readonly sort: readonly QueryFileSort[];
  /** Which disclosures of the Reading Card are open, for every Item it shows. */
  readonly card: ReadingCardDisclosures;
  /**
   * The Library Tree nodes left open, each once: the {@link nodeKey} of an
   * open Collection, and `closed:` before the {@link nodeKey} of a Library,
   * which shows its Collections until the researcher closes it.
   */
  readonly expanded: readonly string[];
  /**
   * The Reading Card's width in pixels, as the researcher set it by its
   * inner edge; absent for the default, {@link CARD_WIDTH_DEFAULT}.
   */
  readonly cardWidth?: number;
  /**
   * The Reading Card's height in pixels under a narrow list, as the
   * researcher set it by its top edge; absent for the default,
   * {@link CARD_HEIGHT_DEFAULT}.
   */
  readonly cardHeight?: number;
  /**
   * Whether the researcher turned the item details off, from the Details
   * button, Space on the list, the card's close button or a drag of its edge
   * past the minimum; absent while they show. While on, the details show the
   * selected paper at every pane width.
   */
  readonly cardClosed?: boolean;
  /**
   * The Library Tree's width in pixels, as the researcher set it by its
   * inner edge; absent for the default, {@link TREE_WIDTH_DEFAULT}.
   */
  readonly treeWidth?: number;
  /**
   * Whether the researcher collapsed the Library Tree on a pane wide enough
   * to show it beside the list; absent while it shows.
   */
  readonly treeCollapsed?: boolean;
}

/** The Reading Card's width, in pixels, until the researcher sets one: 24rem. */
export const CARD_WIDTH_DEFAULT = 384;
/** The narrowest the Reading Card can be, in pixels: 18rem. */
export const CARD_WIDTH_MIN = 288;
/** The Reading Card's height under a narrow list until the researcher sets one: 16rem. */
export const CARD_HEIGHT_DEFAULT = 256;
/** The lowest the Reading Card can be under a narrow list, in pixels: 8rem. */
export const CARD_HEIGHT_MIN = 128;
/** The room the list keeps beside the Reading Card, in pixels: 20rem. */
export const CARD_LIST_MIN = 320;
/** The Library Tree's width, in pixels, until the researcher sets one: 14rem. */
export const TREE_WIDTH_DEFAULT = 224;
/** The narrowest the Library Tree can be, in pixels: 10rem. */
export const TREE_WIDTH_MIN = 160;

/**
 * The widths a pane beside the list, the Reading Card or the Library Tree,
 * can take where it and the list share `pane` pixels: at least `min`, and at
 * most what leaves the list {@link CARD_LIST_MIN}, unless the room is too
 * narrow for both.
 */
export function cardWidthBounds(
  pane: number,
  min = CARD_WIDTH_MIN,
): { min: number; max: number } {
  return {
    min,
    max: Math.max(min, Math.round(pane) - CARD_LIST_MIN),
  };
}

/**
 * `width` within the {@link cardWidthBounds} of a pane `pane` pixels wide,
 * in whole pixels; `pane` absent takes the floor alone.
 */
export function clampCardWidth(
  width: number,
  pane?: number,
  floor = CARD_WIDTH_MIN,
): number {
  const { min, max } = cardWidthBounds(pane ?? Number.POSITIVE_INFINITY, floor);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** The Reading Card's disclosures, open or closed. */
export interface ReadingCardDisclosures {
  /** "All fields": the fields beside the key facts. */
  readonly allFields: boolean;
  /** The Item's Annotation Cards. */
  readonly annotations: boolean;
}

/** Both disclosures closed, so a selected paper draws no Annotation Card. */
const CLOSED_CARD: ReadingCardDisclosures = Object.freeze({
  allFields: false,
  annotations: false,
});

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

/** The document as plugin data stores it: JSON data. */
export type StoredLibraryViewDocument = {
  node: v.InferOutput<typeof nodeSchema>;
  facets: ReadingStateFacet[];
  tags: string[];
  search: string;
  sort: v.InferOutput<typeof sortSchema>;
  card: { allFields: boolean; annotations: boolean };
  expanded: string[];
  cardWidth?: number;
  cardHeight?: number;
  cardClosed?: boolean;
  treeWidth?: number;
  treeCollapsed?: boolean;
};

/**
 * The sort Recent writes: Last Activity, newest first.
 *
 * @see apps/obsidian/docs/adr/0076-recent-is-a-library-tree-node-that-writes-a-sort.md
 */
export const RECENT_SORT: readonly QueryFileSort[] = Object.freeze([
  { property: "lastActivity", direction: "DESC" },
]);

/** What a new Library View shows: Recent as Papers. */
export const DEFAULT_LIBRARY_VIEW_DOCUMENT: LibraryViewDocument = Object.freeze(
  {
    node: { kind: "recent" },
    facets: [],
    tags: [],
    search: "",
    sort: RECENT_SORT,
    card: CLOSED_CARD,
    expanded: [],
  } satisfies LibraryViewDocument,
);

/** One identity for a node, whatever its names hold. */
export function nodeKey(node: LibraryNode): string {
  if (node.kind === "recent") return JSON.stringify(["recent"]);
  return JSON.stringify([
    selectorKey(node.library),
    ...(node.kind === "collection" ? node.path : []),
  ]);
}

/** The Collections above a Collection: what stays open to show it. */
function ancestors(node: LibraryNode): string[] {
  if (node.kind !== "collection") return [];
  return node.path.slice(0, -1).map((_, index) =>
    nodeKey({
      kind: "collection",
      library: node.library,
      path: node.path.slice(0, index + 1),
    }),
  );
}

/** `expanded` with the Collections above `node` open, each once. */
function openTo(expanded: readonly string[], node: LibraryNode): string[] {
  return [...new Set([...expanded, ...ancestors(node)])];
}

/**
 * Read the document that plugin data holds: the one check of its shape. A
 * value that is not an object takes the default document; a field this
 * build cannot read takes its default and the other fields stay; a facet it
 * does not know drops out, and so does a tag that is not a name. A document
 * of an earlier build has no tags, and selects none; nor does it hold open
 * nodes. The Collections above the selected node open
 * on read, as the tree shows a selection. A field it no longer reads, such
 * as the `layout`, `order` and `selected` of an earlier build, is ignored. A card width
 * that is not a finite number is dropped, so the card takes its default; one
 * below {@link CARD_WIDTH_MIN} takes the minimum. The pane, which sets the
 * maximum, clamps it again as the view applies it. The tree width reads
 * the same way against {@link TREE_WIDTH_MIN}. The details are off only
 * where `cardClosed` is `true`, and the tree collapsed only where
 * `treeCollapsed` is `true`.
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
  const tags = field(v.array(v.unknown()), "tags", []);
  const expanded = field(v.array(v.unknown()), "expanded", []);
  const node = field(nodeSchema, "node", defaults.node);
  const cardWidth = stored.cardWidth;
  const cardHeight = stored.cardHeight;
  const treeWidth = stored.treeWidth;
  return {
    node,
    facets: READING_STATE_FACETS.filter((facet) => facets.includes(facet)),
    tags: sortTags(
      tags.filter(
        (tag): tag is string => typeof tag === "string" && tag !== "",
      ),
    ),
    search: field(v.string(), "search", defaults.search),
    sort: field(sortSchema, "sort", defaults.sort),
    card: field(cardSchema, "card", defaults.card),
    expanded: openTo(
      expanded.filter(
        (key): key is string => typeof key === "string" && key !== "",
      ),
      node,
    ),
    ...(typeof cardWidth === "number" &&
      Number.isFinite(cardWidth) && { cardWidth: clampCardWidth(cardWidth) }),
    ...(typeof cardHeight === "number" &&
      Number.isFinite(cardHeight) && {
        cardHeight: clampCardWidth(cardHeight, undefined, CARD_HEIGHT_MIN),
      }),
    ...(stored.cardClosed === true && { cardClosed: true }),
    ...(typeof treeWidth === "number" &&
      Number.isFinite(treeWidth) && {
        treeWidth: clampCardWidth(treeWidth, undefined, TREE_WIDTH_MIN),
      }),
    ...(stored.treeCollapsed === true && { treeCollapsed: true }),
  };
}

/** A disclosure this build cannot read stays closed; the other keeps its state. */
const cardSchema = v.pipe(
  v.unknown(),
  v.transform((raw): ReadingCardDisclosures => {
    const stored =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      allFields: stored.allFields === true,
      annotations: stored.annotations === true,
    };
  }),
);

/** `doc` with the Reading Card's disclosure `name` open or closed. */
export function withCardDisclosure(
  doc: LibraryViewDocument,
  name: keyof ReadingCardDisclosures,
  open: boolean,
): LibraryViewDocument {
  return { ...doc, card: { ...doc.card, [name]: open } };
}

/** The sort that selecting `node` writes; `null` for a node that keeps the sort. */
function nodeSort(node: LibraryNode): readonly QueryFileSort[] | null {
  return node.kind === "recent" ? RECENT_SORT : null;
}

/**
 * `doc` with `node` selected in the tree and the Collections above it open.
 * Recent writes its sort, and leaving it clears that sort, so the next node
 * opens unsorted; a sort the researcher changed while on Recent is theirs
 * and stays.
 */
export function withNode(
  doc: LibraryViewDocument,
  node: LibraryNode,
): LibraryViewDocument {
  const left = nodeSort(doc.node);
  const sort =
    nodeSort(node) ?? (left && sameSort(doc.sort, left) ? [] : doc.sort);
  return {
    ...doc,
    node,
    sort,
    expanded: openTo(doc.expanded, node),
  };
}

/** `doc` with `expanded` as the Library Tree nodes left open, each once. */
export function withExpanded(
  doc: LibraryViewDocument,
  expanded: Iterable<string>,
): LibraryViewDocument {
  return { ...doc, expanded: [...new Set(expanded)] };
}

/**
 * `doc` with the Reading Card `width` pixels wide, at least
 * {@link CARD_WIDTH_MIN}; `undefined` returns it to the default.
 */
export function withCardWidth(
  doc: LibraryViewDocument,
  width: number | undefined,
): LibraryViewDocument {
  const { cardWidth: _, ...rest } = doc;
  return width === undefined || !Number.isFinite(width)
    ? rest
    : { ...rest, cardWidth: clampCardWidth(width) };
}

/**
 * `doc` with the Reading Card `height` pixels high under a narrow list, at
 * least {@link CARD_HEIGHT_MIN}; `undefined` returns it to the default.
 */
export function withCardHeight(
  doc: LibraryViewDocument,
  height: number | undefined,
): LibraryViewDocument {
  const { cardHeight: _, ...rest } = doc;
  return height === undefined || !Number.isFinite(height)
    ? rest
    : {
        ...rest,
        cardHeight: clampCardWidth(height, undefined, CARD_HEIGHT_MIN),
      };
}

/**
 * `doc` with the Library Tree `width` pixels wide, at least
 * {@link TREE_WIDTH_MIN}; `undefined` returns it to the default.
 */
export function withTreeWidth(
  doc: LibraryViewDocument,
  width: number | undefined,
): LibraryViewDocument {
  const { treeWidth: _, ...rest } = doc;
  return width === undefined || !Number.isFinite(width)
    ? rest
    : {
        ...rest,
        treeWidth: clampCardWidth(width, undefined, TREE_WIDTH_MIN),
      };
}

/** `doc` with the Library Tree collapsed beside the list, or shown again. */
export function withTreeCollapsed(
  doc: LibraryViewDocument,
  collapsed: boolean,
): LibraryViewDocument {
  const { treeCollapsed: _, ...rest } = doc;
  return collapsed ? { ...rest, treeCollapsed: true } : rest;
}

/** `doc` with the item details off, or on again. */
export function withCardClosed(
  doc: LibraryViewDocument,
  closed: boolean,
): LibraryViewDocument {
  const { cardClosed: _, ...rest } = doc;
  return closed ? { ...rest, cardClosed: true } : rest;
}

/**
 * `doc` without the open nodes the tree does not `know`, such as a
 * Collection renamed or removed in Zotero; `doc` itself where it knows each.
 */
export function pruneExpanded(
  doc: LibraryViewDocument,
  know: (key: string) => boolean,
): LibraryViewDocument {
  const expanded = doc.expanded.filter(know);
  return expanded.length === doc.expanded.length ? doc : { ...doc, expanded };
}

/**
 * What the view writes itself while `node` is selected: the node's sort and
 * the row limit. The toolbar shows them as not set.
 *
 * @see apps/obsidian/docs/adr/0076-recent-is-a-library-tree-node-that-writes-a-sort.md
 */
export function libraryViewDefaults(node: LibraryNode): {
  sort: readonly QueryFileSort[];
  limit: number;
} {
  return { sort: nodeSort(node) ?? [], limit: LIBRARY_VIEW_ROW_LIMIT };
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

/** `doc` with `tags` as the tags selected in the Tag Selector. */
export function withTags(
  doc: LibraryViewDocument,
  tags: readonly string[],
): LibraryViewDocument {
  return { ...doc, tags: sortTags(tags) };
}

/** `tags` each once, sorted by name as the Tag Selector shows them. */
export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((a, b) => TAG_ORDER.compare(a, b));
}

const TAG_ORDER = new Intl.Collator(undefined, { numeric: true });

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
    tags: [...doc.tags],
    search: doc.search,
    sort: doc.sort.map(({ property, direction }) => ({ property, direction })),
    card: { ...doc.card },
    expanded: [...doc.expanded],
    ...(doc.cardWidth !== undefined && { cardWidth: doc.cardWidth }),
    ...(doc.cardHeight !== undefined && { cardHeight: doc.cardHeight }),
    ...(doc.cardClosed === true && { cardClosed: true }),
    ...(doc.treeWidth !== undefined && { treeWidth: doc.treeWidth }),
    ...(doc.treeCollapsed === true && { treeCollapsed: true }),
  };
}

/** The names the derived query shows: its view's name. */
export interface LibraryViewLabels {
  readonly papers: string;
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
   * The tree node the list shows, which the tree marks as selected; `null`
   * while a search of all libraries reads past it.
   */
  readonly node: LibraryNode | null;
}

/**
 * The most rows the view shows: a Layout draws every row it gets, and a
 * library of 10,000 Items takes about two seconds to draw, 50,000 over
 * half a minute. The toolbar says how many more match; the tree and the
 * search narrow to them.
 */
export const LIBRARY_VIEW_ROW_LIMIT = 1000;

/** What each facet asks of an Item: a filter, a condition in the vault, or both. */
const FACETS: Readonly<
  Record<ReadingStateFacet, { filter?: string; vault?: VaultCondition }>
> = {
  unread: {
    filter: "annotations.isEmpty() && lastRead == null",
    vault: "no-literature-note",
  },
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
  filters.push(...tagFilters(doc.tags));
  if (keys !== undefined)
    filters.push(
      `[${keys.map((key) => JSON.stringify(key)).join(", ")}].contains(indexedKey)`,
    );
  for (const tag of searchTerms(doc.search).tags)
    filters.push(`tags.contains(${JSON.stringify(tag)})`);
  const text = serializeQueryFile({
    ...(filters.length > 0 && { filters: filterTree(filters) }),
    views: [
      {
        type: LIBRARY_LAYOUTS[0],
        name: labels.papers,
        from: "items",
        ...(doc.sort.length > 0 && { sort: doc.sort }),
        limit: LIBRARY_VIEW_ROW_LIMIT,
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
    // Recent reads every Library of the Library Scope already.
    node: everywhere === undefined || node.kind === "recent" ? node : null,
  };
}

/**
 * `doc` with what a toolbar change set in `text`: the sort of its view, the
 * one toolbar change the document keeps. The tree node, the facets and the
 * search stay as `doc` holds them.
 */
export function withText(
  doc: LibraryViewDocument,
  text: string,
): LibraryViewDocument {
  const view = parseQueryFile(text).views[0];
  if (!view) return doc;
  return { ...doc, sort: view.sort ?? [] };
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
 * The request that lists the tags of the Tag Selector: the Items `node`
 * lists with no facet and no search, as the paper count reads them, grouped
 * by tag. While `tags` are selected, only the Items with every one of them,
 * so selecting a listed tag never empties the list. A group's rows go
 * unread, so each holds one.
 *
 * @see apps/obsidian/docs/adr/0078-the-tag-selector-writes-tag-filters.md
 */
export function tagListRequest(
  node: LibraryNode,
  tags: readonly string[],
  scope: LibraryScope,
): QueryViewRequest {
  const { filters } = selectionConditions(node, []);
  filters.push(...tagFilters(tags));
  return {
    from: "items",
    fields: [],
    group: "tags[].name",
    ...(filters.length > 0 && { filter: filters.join(" && ") }),
    limit: 1,
    libraries: librariesOf(node, scope),
  };
}

/**
 * The tag names the Tag Selector lists from the answer to
 * {@link tagListRequest}, sorted by name, with every one of `selected`, which
 * always shows. `groups` is `null` while the answer is unknown.
 */
export function tagNames(
  groups: readonly Pick<QueryViewGroup, "value">[] | null,
  selected: readonly string[],
): string[] {
  const names = (groups ?? []).flatMap(({ value }) =>
    typeof value === "string" ? [value] : [],
  );
  return sortTags([...names, ...selected]);
}

/** The filters of the selected tags: an Item has every one. */
function tagFilters(tags: readonly string[]): string[] {
  return tags.map((tag) => `tags.contains(${JSON.stringify(tag)})`);
}

/**
 * How the header counts the unread Items of `node`: the request with no
 * facet or search beside Unread, as the paper count reads them (ADR 0072),
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
  return nodeCount(node, ["unread"], { scope: { mode: "all" }, notes });
}

/**
 * How to count the Items of `node` that pass every one of `facets`, with
 * no tag or search beside them, as the paper count reads them (ADR 0072):
 * the request, and the rows of its answer the vault keeps. Recent counts
 * the Library Scope it lists, `scope`.
 */
export function nodeCount(
  node: LibraryNode,
  facets: readonly ReadingStateFacet[],
  {
    scope,
    notes,
  }: { scope: LibraryScope; notes: Pick<LiteratureNotes, "find"> },
): {
  request: QueryViewRequest;
  count: (rows: readonly QueryViewRow[]) => number;
} {
  const { filters, vault } = selectionConditions(node, facets);
  const pass = vaultPass(vault, notes);
  return {
    request: {
      from: "items",
      fields: [],
      ...(filters.length > 0 && { filter: filters.join(" && ") }),
      limit: null,
      libraries: librariesOf(node, scope),
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
 * express it (ADR 0073).
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
 * the query. A Query File can hold neither (ADR 0073).
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
