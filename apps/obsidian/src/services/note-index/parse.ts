import { type CachedMetadata } from "obsidian";

import {
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
  PATTERN_ZOTERO_KEY,
} from "@/lib/constants";

export interface FileContributions {
  itemKey: string | null;
  citekey: string | null;
}

export interface ContribDiff {
  empty: boolean;
  itemKey: { remove: string | null; add: string | null };
  citekey: { remove: string | null; add: string | null };
}

export const EMPTY_CONTRIBUTIONS: FileContributions = {
  itemKey: null,
  citekey: null,
};

export function fileContributions(cache: CachedMetadata): FileContributions {
  return {
    itemKey: itemKeyFromFrontmatter(cache),
    citekey: citekeyFromFrontmatter(cache),
  };
}

export function itemKeyFromFrontmatter(
  cache: CachedMetadata | null | undefined,
): string | null {
  const value = cache?.frontmatter?.[FIELD_ZOTERO_KEY];
  if (typeof value !== "string") return null;
  return PATTERN_ZOTERO_KEY.test(value) ? value : null;
}

export function diffContributions(
  prev: FileContributions,
  next: FileContributions,
): ContribDiff {
  const itemKeyChanged = prev.itemKey !== next.itemKey;
  const citekeyChanged = prev.citekey !== next.citekey;

  return {
    empty: !itemKeyChanged && !citekeyChanged,
    itemKey: {
      remove: itemKeyChanged ? prev.itemKey : null,
      add: itemKeyChanged ? next.itemKey : null,
    },
    citekey: {
      remove: citekeyChanged ? prev.citekey : null,
      add: citekeyChanged ? next.citekey : null,
    },
  };
}

function citekeyFromFrontmatter(cache: CachedMetadata): string | null {
  const value = cache.frontmatter?.[FIELD_CITEKEY];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
