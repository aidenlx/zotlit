// Whether a note, or the target of a wikilink, is a Literature Note, read from
// its frontmatter alone: the plain reads beside the Note Index, for code
// outside Effect.
import type { CachedMetadata, MetadataCache, TFile } from "obsidian";

import { itemKeyFromFrontmatter } from "./parse";

/** What the reads take from Obsidian: the app, or any host with its metadata cache. */
export interface LiteratureNoteHost {
  readonly metadataCache: Pick<
    MetadataCache,
    "getCache" | "getFileCache" | "getFirstLinkpathDest"
  >;
}

/** Frontmatter-only check; does not consult the index. */
export function isLiteratureNote(
  file: string | TFile,
  app: LiteratureNoteHost,
): boolean {
  const cache =
    typeof file === "string"
      ? app.metadataCache.getCache(file)
      : app.metadataCache.getFileCache(file);
  return itemKeyFromFrontmatter(cache) !== null;
}

/** The Literature Note a wikilink target points at. */
export interface ResolvedLiteratureNote {
  /** The note's vault path. */
  path: string;
  /** Its Indexed Key — the frontmatter marker that makes it a Literature Note. */
  indexedKey: string;
}

/**
 * The Literature Note a wikilink target points at, seen from `sourcePath`, or
 * `null` when the target is missing or is an ordinary note. Frontmatter-only
 * like {@link isLiteratureNote}, so it answers before the first scan; every
 * consumer that turns a linkpath into a Citation shares it.
 */
export function resolveLiteratureNote(
  linkpath: string,
  sourcePath: string,
  options: { app: LiteratureNoteHost },
): ResolvedLiteratureNote | null {
  const { app } = options;
  const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!dest) return null;
  return literatureNoteOf(dest, app.metadataCache.getFileCache(dest));
}

/** The Literature Note `dest` is by its frontmatter, or `null` for an ordinary note. */
export function literatureNoteOf(
  dest: TFile,
  cache: CachedMetadata | null,
): ResolvedLiteratureNote | null {
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (indexedKey === null) return null;
  return {
    path: dest.path,
    indexedKey,
  };
}

/** {@link resolveLiteratureNote}, for a consumer that needs the key alone. */
export function resolveIndexedKey(
  linkpath: string,
  sourcePath: string,
  app: LiteratureNoteHost,
): string | null {
  const note = resolveLiteratureNote(linkpath, sourcePath, { app });
  return note?.indexedKey ?? null;
}
