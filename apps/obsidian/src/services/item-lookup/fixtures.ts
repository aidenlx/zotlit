import {
  parseItemDate,
  type Creator,
  type Item,
  type JournalArticleItem,
} from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

export interface ItemFixtureOptions {
  key: string;
  libraryID?: number;
  itemType?: string;
  title?: string | null;
  citekey?: string | null;
  date?: string | null;
  /** ISO 8601 instant (e.g. `2024-01-01T00:00:00Z`); defaults to epoch. */
  dateModified?: string;
  creators?: Creator[];
  publicationTitle?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
}

export function makeItem(options: ItemFixtureOptions): Item {
  const itemType = options.itemType ?? "book";
  const base = {
    itemID: options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    title: options.title ?? null,
    citekey: options.citekey ?? null,
    date: parseItemDate(options.date),
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    creators: options.creators ?? [],
  };
  if (itemType === "journalArticle") {
    return {
      ...base,
      itemType: "journalArticle",
      publicationTitle: options.publicationTitle ?? null,
      volume: options.volume ?? null,
      issue: options.issue ?? null,
      pages: options.pages ?? null,
    } satisfies JournalArticleItem;
  }
  return { ...base, itemType };
}

export function makeCreator(firstName: string, lastName: string): Creator {
  return {
    firstName,
    lastName,
    creatorType: "author",
    fieldMode: 0,
  };
}
