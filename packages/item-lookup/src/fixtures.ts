import {
  type BaseItem,
  type Creator,
  type IndexedItem,
  type Item,
  type ItemOfType,
} from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

export interface ItemFixtureOptions {
  key: string;
  libraryID?: number;
  itemType?: Item["itemType"];
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

export function makeIndexedItem(options: ItemFixtureOptions): IndexedItem {
  const creators = options.creators ?? [];
  return {
    itemID: options.key.charCodeAt(0),
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

export function makeItem(options: ItemFixtureOptions): Item {
  const itemType = options.itemType ?? "book";
  const base: BaseItem = {
    itemID: options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    creators: options.creators ?? [],
    primaryCreatorType: options.primaryCreatorType ?? null,
    customFields: new Map<string, string | null>(),
  };
  const fields = {
    title: options.title ?? null,
    citationKey: options.citationKey ?? null,
    date: options.date ?? null,
    language: options.language ?? null,
  };
  if (itemType === "journalArticle") {
    return {
      ...base,
      itemType: "journalArticle",
      ...fields,
      publicationTitle: options.publicationTitle ?? null,
      volume: options.volume ?? null,
      issue: options.issue ?? null,
      pages: options.pages ?? null,
    } satisfies ItemOfType<"journalArticle">;
  }
  return { ...base, itemType, ...fields } as Item;
}

export function makeCreator(firstName: string, lastName: string): Creator {
  return {
    firstName,
    lastName,
    creatorType: "author",
    fieldMode: 0,
  };
}
