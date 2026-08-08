import type { CachedMetadata } from "obsidian";

import { isIndexedKey } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import {
  FIELD_ZOTERO_KEY,
  FIELD_ZOTERO_LASTMOD,
  FIELD_ZOTERO_NOTE_KEY,
} from "@/lib/constants";

export interface FileContributions {
  itemKey: string | null;
  citationKey: string | null;
  noteKey: string | null;
}

export interface ContribDiff {
  empty: boolean;
  itemKey: { remove: string | null; add: string | null };
  citationKey: { remove: string | null; add: string | null };
  noteKey: { remove: string | null; add: string | null };
}

export const EMPTY_CONTRIBUTIONS: FileContributions = {
  itemKey: null,
  citationKey: null,
  noteKey: null,
};

export function fileContributions(
  cache: CachedMetadata,
  citationKeyProperty: string | null,
): FileContributions {
  const itemKey = itemKeyFromFrontmatter(cache);
  return {
    itemKey,
    citationKey:
      itemKey === null
        ? null
        : citationKeyFromFrontmatter(cache, citationKeyProperty),
    noteKey: noteKeyFromFrontmatter(cache),
  };
}

export function itemKeyFromFrontmatter(
  cache: CachedMetadata | null | undefined,
): string | null {
  const value = cache?.frontmatter?.[FIELD_ZOTERO_KEY];
  if (typeof value !== "string") return null;
  return isIndexedKey(value) ? value : null;
}

export function noteKeyFromFrontmatter(
  cache: CachedMetadata | null | undefined,
): string | null {
  const value = cache?.frontmatter?.[FIELD_ZOTERO_NOTE_KEY];
  if (typeof value !== "string") return null;
  return isIndexedKey(value) ? value : null;
}

export function diffContributions(
  prev: FileContributions,
  next: FileContributions,
): ContribDiff {
  const itemKeyChanged = prev.itemKey !== next.itemKey;
  const citationKeyChanged = prev.citationKey !== next.citationKey;
  const noteKeyChanged = prev.noteKey !== next.noteKey;

  return {
    empty: !itemKeyChanged && !citationKeyChanged && !noteKeyChanged,
    itemKey: {
      remove: itemKeyChanged ? prev.itemKey : null,
      add: itemKeyChanged ? next.itemKey : null,
    },
    citationKey: {
      remove: citationKeyChanged ? prev.citationKey : null,
      add: citationKeyChanged ? next.citationKey : null,
    },
    noteKey: {
      remove: noteKeyChanged ? prev.noteKey : null,
      add: noteKeyChanged ? next.noteKey : null,
    },
  };
}

export function citationKeyFromFrontmatter(
  cache: CachedMetadata | null | undefined,
  property: string | null,
): string | null {
  if (property === null) return null;
  const value = cache?.frontmatter?.[property];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Handles ISO strings with offset/Z suffix (parsed directly), offset-less
 * local datetimes (assumed local timezone), and YAML 1.1 `Date` objects.
 */
export function lastmodFromFrontmatter(
  cache: CachedMetadata | null | undefined,
): Temporal.Instant | null {
  const value = cache?.frontmatter?.[FIELD_ZOTERO_LASTMOD];
  if (value == null) return null;
  if (value instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  }
  if (typeof value !== "string") return null;
  try {
    return Temporal.Instant.from(value);
  } catch {
    try {
      return Temporal.PlainDateTime.from(value)
        .toZonedDateTime(Temporal.Now.timeZoneId())
        .toInstant();
    } catch {
      return null;
    }
  }
}
