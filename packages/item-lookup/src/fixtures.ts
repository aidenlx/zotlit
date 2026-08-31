import { itemBaseFields, resolveVenue } from "@zotlit/db";
import type { BaseItem, Creator, IndexedItem, Item } from "@zotlit/db";
import type { ItemFields, JournalArticleFields } from "@zotlit/zotero-types";

/** The fields Zotero records for one item type, minus its discriminant. */
type FieldsOf<TType extends ItemFields["itemType"]> = Omit<
  Extract<ItemFields, { itemType: TType }>,
  "itemType"
>;

export interface ItemFixtureOptions {
  key: string;
  /**
   * Set it where one key repeats across Libraries.
   * @default key.charCodeAt(0)
   */
  itemID?: number;
  libraryID?: number;
  itemType?: ItemFields["itemType"];
  title?: string | null;
  citationKey?: string | null;
  date?: string | null;
  /** ISO 8601 instant (e.g. `2024-01-01T00:00:00Z`); defaults to epoch. */
  dateModified?: string;
  creators?: Creator[];
  primaryCreatorType?: string | null;
  language?: string | null;
  publicationTitle?: string | null;
  shortTitle?: string | null;
  court?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
}

/**
 * {@link makeItem} options that also carry raw per-type fields. Naming the
 * fields obliges the caller to name the item type, and the type admits only
 * the fields Zotero records for it, so a fixture cannot state a shape the
 * query never emits.
 */
export type TypedItemFixtureOptions<TType extends ItemFields["itemType"]> =
  ItemFixtureOptions & {
    itemType: TType;
    /**
     * Fields named as Zotero names them for {@link TypedItemFixtureOptions.itemType} —
     * `{ repository: "arXiv" }` on a Preprint, `{ bookTitle: "..." }` on a Book
     * Section. The base-field view and the Venue derive from them.
     */
    fields?: FieldsOf<TType>;
  };

export function makeIndexedItem(options: ItemFixtureOptions): IndexedItem {
  const creators = options.creators ?? [];
  return {
    itemID: options.itemID ?? options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    itemType: options.itemType ?? "book",
    primaryCreator: creators[0] ?? null,
    creators,
    language: options.language ?? null,
    title: options.title ?? null,
    publicationTitle: options.publicationTitle ?? null,
    shortTitle: options.shortTitle ?? null,
    court: options.court ?? null,
    citationKey: options.citationKey ?? null,
    date: options.date ?? null,
  };
}

export function makeItem(options: ItemFixtureOptions): Item;
export function makeItem<TType extends ItemFields["itemType"]>(
  options: TypedItemFixtureOptions<TType>,
): Item;
export function makeItem(
  options: ItemFixtureOptions & {
    fields?: Readonly<Record<string, string | null>>;
  },
): Item {
  const itemType = options.itemType ?? "book";
  const base: BaseItem = {
    itemID: options.itemID ?? options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    dateAdded: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    creators: options.creators ?? [],
    primaryCreatorType: options.primaryCreatorType ?? null,
    customFields: new Map<string, string | null>(),
  };
  const common = {
    title: options.title ?? null,
    citationKey: options.citationKey ?? null,
    date: options.date ?? null,
    language: options.language ?? null,
  };
  const fields = (
    itemType === "journalArticle"
      ? ({
          itemType: "journalArticle",
          ...common,
          publicationTitle: options.publicationTitle ?? null,
          volume: options.volume ?? null,
          issue: options.issue ?? null,
          pages: options.pages ?? null,
          ...options.fields,
        } satisfies JournalArticleFields)
      : { itemType, ...common, ...options.fields }
  ) as ItemFields;
  const baseFields = itemBaseFields(fields);
  return {
    ...base,
    groupID: null,
    fields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

export function makeCreator(firstName: string, lastName: string): Creator {
  return {
    firstName,
    lastName,
    creatorType: "author",
    fieldMode: 0,
  };
}
