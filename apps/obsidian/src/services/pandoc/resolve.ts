// Resolves one document's Literature Note links to the citation keys Pandoc cites.

import { parseLinktext, type LinkCache } from "obsidian";

/** Fragment prefix that declares citation intent on a link. */
const CITE_FRAGMENT_PREFIX = "#cite:";

/** Runs of well-formed `%XX` triples; a lone `%` stays literal. */
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

export type ResolveErrorCode =
  | "file-not-found"
  | "database-unavailable"
  | "item-not-found"
  | "citation-key-missing"
  | "duplicate-citation-key"
  | "unresolved-citation-intent";

export interface ResolveError {
  code: ResolveErrorCode;
  /** Bare decoded linkpath the error belongs to, absent for whole-run failures. */
  linkpath?: string;
  indexedKey?: string;
  message: string;
}

/**
 * Either every Literature Note link of the document as `linkpath → citation
 * key`, or every discoverable failure. The two never appear together: any
 * error stops all citations.
 */
export type ResolveResponse =
  | { citations: Record<string, string> }
  | { errors: ResolveError[] };

/** The document being resolved, as Obsidian's caches see it. */
export interface ResolveDocument {
  /** Vault-relative path, the source Obsidian resolves links against. */
  sourcePath: string;
  links: readonly LinkCache[];
}

/** What the database knows about one linked Zotero Item. */
export interface ResolvedItem {
  citationKey: string | null;
  /** Identifies the Item in the `citation-key-missing` message. */
  title: string;
}

/** Names the Zotero database the `database-unavailable` message reports on. */
export interface DatabaseDescription {
  dataDir: string;
  /** Effective read mode, `null` when the database never opened. */
  readMode: string | null;
}

export interface ResolvePorts {
  /** The vault file at an absolute path; `null` when the path names none. */
  readDocument: (absolutePath: string) => ResolveDocument | null;
  /**
   * Indexed Key of the Literature Note `linkpath` names, resolved from
   * `sourcePath`; `null` for a missing target or an ordinary note.
   */
  resolveIndexedKey: (linkpath: string, sourcePath: string) => string | null;
  database: {
    describe: () => DatabaseDescription;
    /**
     * Every lookup under one read lease, keyed by Indexed Key. A key the
     * database has no live Item for is absent; `null` means no read lease.
     */
    read: (
      indexedKeys: readonly string[],
    ) => Promise<ReadonlyMap<string, ResolvedItem> | null>;
  };
}

interface QueuedLink {
  linkpath: string;
  indexedKey: string;
}

/**
 * Resolve the Literature Note links of the file at `absolutePath`, the whole
 * `zotlit:resolve` contract. All-or-nothing: one error suppresses every
 * citation, and every discoverable error is reported together.
 */
export async function resolveCitations(
  absolutePath: string,
  ports: ResolvePorts,
): Promise<ResolveResponse> {
  const document = ports.readDocument(absolutePath);
  if (!document) {
    return {
      errors: [
        {
          code: "file-not-found",
          message: `No vault file at "${absolutePath}".`,
        },
      ],
    };
  }

  const { queued, errors } = collectLinks(document, ports.resolveIndexedKey);
  if (queued.length === 0) {
    return errors.length > 0 ? { errors } : { citations: {} };
  }

  const items = await ports.database.read(
    queued.map((link) => link.indexedKey),
  );
  if (!items) {
    const { dataDir, readMode } = ports.database.describe();
    errors.push({
      code: "database-unavailable",
      message: `Cannot read the Zotero database in data directory "${dataDir}" (read mode: ${readMode ?? "unavailable"}).`,
    });
    return { errors };
  }

  const citations: Record<string, string> = {};
  const owners = new Map<string, QueuedLink>();
  for (const link of queued) {
    const { linkpath, indexedKey } = link;
    const item = items.get(indexedKey);
    if (!item) {
      errors.push({
        code: "item-not-found",
        linkpath,
        indexedKey,
        message: `No live Item matches Indexed Key "${indexedKey}" — the Item may have been deleted from Zotero.`,
      });
      continue;
    }
    if (item.citationKey === null) {
      errors.push({
        code: "citation-key-missing",
        linkpath,
        indexedKey,
        message: `The Item "${item.title}" (Indexed Key "${indexedKey}") has no citation key.`,
      });
      continue;
    }
    const owner = owners.get(item.citationKey);
    if (owner && owner.indexedKey !== indexedKey) {
      errors.push({
        code: "duplicate-citation-key",
        linkpath,
        indexedKey,
        message: `Citation key "${item.citationKey}" belongs to two Items: "${owner.linkpath}" (Indexed Key "${owner.indexedKey}") and "${linkpath}" (Indexed Key "${indexedKey}").`,
      });
      continue;
    }
    owners.set(item.citationKey, link);
    citations[linkpath] = item.citationKey;
  }

  return errors.length > 0 ? { errors } : { citations };
}

/**
 * One entry per unique decoded bare linkpath, so a note linked ten times costs
 * one database lookup. Links to ordinary notes drop out silently; only a
 * `#cite:` fragment turns an unresolved target into an error.
 */
function collectLinks(
  document: ResolveDocument,
  resolveIndexedKey: ResolvePorts["resolveIndexedKey"],
): { queued: QueuedLink[]; errors: ResolveError[] } {
  const queued: QueuedLink[] = [];
  const errors: ResolveError[] = [];
  const resolved = new Map<string, string | null>();
  const reported = new Set<string>();

  for (const link of document.links) {
    const { path, subpath } = parseLinktext(link.link);
    if (path === "") continue;
    const linkpath = decodeLinkpath(path);

    let indexedKey = resolved.get(linkpath);
    if (indexedKey === undefined) {
      indexedKey = resolveIndexedKey(linkpath, document.sourcePath);
      resolved.set(linkpath, indexedKey);
      if (indexedKey !== null) queued.push({ linkpath, indexedKey });
    }
    if (indexedKey !== null) continue;

    if (!subpath.startsWith(CITE_FRAGMENT_PREFIX)) continue;
    if (reported.has(linkpath)) continue;
    reported.add(linkpath);
    errors.push({
      code: "unresolved-citation-intent",
      linkpath,
      message: `The "${subpath}" fragment declares a Citation, but "${linkpath}" does not resolve to a Literature Note.`,
    });
  }

  return { queued, errors };
}

/** Lenient, matching the filter: malformed percent escapes survive as written. */
function decodeLinkpath(path: string): string {
  return path.replaceAll(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}
