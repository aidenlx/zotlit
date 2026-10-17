// The Library View Document: what the Library View shows, as one plain value
// that plugin data keeps per vault. The view's Query File text derives from
// it (see `query-text.ts`); the document is the only state the view saves.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import * as v from "valibot";

import { librarySelectorSchema } from "@/services/library-scope/scope";
import type { LibrarySelector } from "@/services/library-scope/scope";
import type { QueryFileSort } from "@/views/query-view/query-file";

/** The Reading State facets, in the order the Library Tree shows them. */
export const READING_STATE_FACETS = [
  "unread",
  "annotated",
  "has-note",
  "pdf",
] as const;
export type ReadingStateFacet = (typeof READING_STATE_FACETS)[number];

/** The Layouts the Library View offers. */
export const LIBRARY_LAYOUTS = ["table"] as const;
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number];

/**
 * The node selected in the Library Tree: a Library, or a Collection by its
 * root-first name path in one Library. The path stays a list of names, since
 * a name may hold a `/`.
 */
export type LibraryNode =
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

/**
 * The document as plugin data stores it. Strict: the settings that hold it
 * refuse a value that is not one, and {@link parseLibraryViewDocument} reads
 * each field of a stored value alone.
 */
export const storedLibraryViewDocumentSchema = v.object({
  node: nodeSchema,
  facets: v.array(v.picklist(READING_STATE_FACETS)),
  search: v.string(),
  sort: sortSchema,
  layout: v.picklist(LIBRARY_LAYOUTS),
  order: v.array(v.pipe(v.string(), v.nonEmpty())),
});

export type StoredLibraryViewDocument = v.InferOutput<
  typeof storedLibraryViewDocumentSchema
>;

/** What a new Library View shows: My Library on a Table, newest first. */
export const DEFAULT_LIBRARY_VIEW_DOCUMENT: LibraryViewDocument = Object.freeze(
  {
    node: { kind: "library", library: { type: "personal" } },
    facets: [],
    search: "",
    sort: [{ property: "dateModified", direction: "DESC" }],
    layout: "table",
    order: ["title", "creators", "date.year", "vault.literatureNote"],
  } satisfies LibraryViewDocument,
);

/**
 * Read the document that plugin data holds. A field this build cannot read
 * takes its default and the other fields stay; a facet it does not know
 * drops out.
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
    order: field(
      storedLibraryViewDocumentSchema.entries.order,
      "order",
      defaults.order,
    ),
  };
}

/** What {@link parseLibraryViewDocument} reads back, as JSON data. */
export function serializeLibraryViewDocument(
  doc: LibraryViewDocument,
): StoredLibraryViewDocument {
  return {
    node:
      doc.node.kind === "library"
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
