// Attachment source policy: the canonical-roots snapshot, the synchronous
// decision taken against it while rendering, and the copy-time confirmation
// that catches what a string cannot express (ADR 0019).

import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { AttachmentCopySource } from "@/lib/copy-attachments";
import { isErrno } from "@/lib/errno";

/**
 * Read-only open that refuses a symbolic link at the final component. The path
 * being opened is already canonical, so a link there appeared after the
 * canonicalization and is an escape attempt. `O_NOFOLLOW` is POSIX-only.
 */
const OPEN_CONFIRMED =
  process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;

/**
 * Where an approved source's bytes came from. It selects the copy strategy:
 * see {@link readsFromDescriptor}.
 */
export type SourceOrigin =
  | "storage"
  | "linked-base"
  | "linked-absolute"
  | "annotation-cache";

/**
 * Private brand on the approved branch of {@link AttachmentSource}. Not
 * exported, so no module outside this file can name the symbol's type —
 * only {@link decideSource} can produce a value that structurally satisfies
 * the approved branch, closing off the literal-object bypass a plain
 * `{ approved: true, ... }` shape would otherwise allow. Defined
 * non-enumerable so it never surfaces in equality checks (`toEqual`,
 * `toHaveBeenCalledWith`) against plain-object fixtures.
 */
const APPROVED_SOURCE_BRAND = Symbol("attachment-source-approved");

/**
 * A decision about a location, taken while link resolution runs: approved
 * (with the {@link SourceOrigin} that drives the copy strategy and the
 * canonical root the copy-time confirmation holds it to) or blocked (rendered
 * as a `file://` link, queuing no copy). {@link decideSource} is the only
 * constructor for the approved branch.
 */
export type AttachmentSource =
  | {
      readonly [APPROVED_SOURCE_BRAND]: true;
      approved: true;
      path: string;
      origin: SourceOrigin;
      /**
       * Canonical form of the root that approved `path`; {@link confirmSource}
       * requires the canonicalized source to still sit inside it.
       */
      root: string;
    }
  | BlockedSource;

/** Why {@link decideSource} turned a location away. */
export type SourceBlock = "no-trusted-root" | "outside-trusted-root";

/**
 * The blocked branch of {@link AttachmentSource}. Carries its location so the
 * `file://` fallback renders in one place, plus the origin and reason the
 * structured log event reports.
 */
export interface BlockedSource {
  approved: false;
  path: string;
  origin: SourceOrigin;
  reason: SourceBlock;
}

/**
 * One trusted root in the two forms the two checks need.
 *
 * `declared` is the root as the candidate paths are built from — the Zotero
 * data directory as configured, joined with `storage` / `cache`, or the
 * `baseAttachmentPath` pref verbatim. The decision compares against it, so a
 * Zotero data directory that is itself a symbolic link keeps resolving exactly
 * as before.
 *
 * `canonical` is the same root with symbolic links resolved. Copy-time
 * confirmation compares against it, so a link planted *inside* a trusted root
 * cannot smuggle a file out of it.
 */
export interface CanonicalRoot {
  declared: string;
  canonical: string;
}

/** The standing snapshot every source decision is taken against. */
export interface CanonicalRoots {
  /** `<dataDir>/storage`; `null` when it does not resolve. */
  storage: CanonicalRoot | null;
  /** `<dataDir>/cache`; `null` when it does not resolve. */
  annotationCache: CanonicalRoot | null;
  /** Zotero's `baseAttachmentPath` pref; `null` when unset or unresolvable. */
  base: CanonicalRoot | null;
  /** Approved Attachment Roots, re-canonicalized at each rebuild. */
  approved: readonly CanonicalRoot[];
  /** Whether path comparison ignores case, as it does on macOS and Windows. */
  caseInsensitive: boolean;
}

/** Trusts nothing: every decision against it blocks. */
export const NO_ROOTS: CanonicalRoots = Object.freeze({
  storage: null,
  annotationCache: null,
  base: null,
  approved: Object.freeze([]),
  caseInsensitive: false,
});

/** Runtime inputs a snapshot is built from. */
export interface RootSources {
  /** Zotero data directory, parent of the storage and annotation cache dirs. */
  dataDir: string;
  /** Zotero's `baseAttachmentPath` pref; `null` when unset. */
  baseAttachmentPath: string | null;
  /** Approved Attachment Roots as persisted — canonical paths. */
  approvedFolders: readonly string[];
}

/**
 * Resolve every trusted root against the filesystem. A root that does not
 * resolve — an unset base-attachment pref, a data directory that moved, an
 * approval whose folder is gone — drops out of the snapshot, so sources
 * claiming that origin are blocked rather than the rebuild failing.
 *
 * An approved folder is re-canonicalized and kept only while it still
 * canonicalizes to itself, so a folder later replaced by a link to another
 * location drops the grant instead of moving it to the link's target.
 */
export async function buildCanonicalRoots(
  sources: RootSources,
): Promise<CanonicalRoots> {
  const [storage, annotationCache, base, approved] = await Promise.all([
    trustedRoot(join(sources.dataDir, "storage")),
    trustedRoot(join(sources.dataDir, "cache")),
    sources.baseAttachmentPath === null
      ? null
      : trustedRoot(sources.baseAttachmentPath),
    Promise.all(sources.approvedFolders.map(approvedRoot)),
  ]);
  return {
    storage,
    annotationCache,
    base,
    approved: approved.filter((root) => root !== null),
    caseInsensitive:
      process.platform === "darwin" || process.platform === "win32",
  };
}

/**
 * Decide whether `path` may be read as an attachment source. Synchronous and
 * memory-only by design: it runs inside link resolution, which renders a
 * template and populates a `dragstart` data transfer, neither of which can
 * await. The string check is complete for a hostile Zotero row, because the
 * pure layer in `@zotlit/db` already rejected every separator and parent
 * segment; a symbolic link on disk is left to {@link confirmSource}.
 */
export function decideSource(
  path: string,
  origin: SourceOrigin,
  roots: CanonicalRoots,
): AttachmentSource {
  const trusted = rootsForOrigin(origin, roots);
  for (const root of trusted) {
    if (isInside(root.declared, path, roots.caseInsensitive)) {
      return approve(path, origin, root.canonical);
    }
  }
  return {
    approved: false,
    path,
    origin,
    // The two cases a maintainer has to tell apart from a log alone: an origin
    // with no root at all (base pref unset, no folder approved yet) against a
    // location that simply sits outside the roots there are.
    reason: trusted.length === 0 ? "no-trusted-root" : "outside-trusted-root",
  };
}

/** Why {@link confirmSource} refused a source the decision had approved. */
export type SourceRefusal = "not-a-regular-file" | "escaped-root";

export type ConfirmedSource =
  | { status: "confirmed"; source: AttachmentCopySource }
  | { status: "missing" }
  | { status: "refused"; reason: SourceRefusal };

/**
 * Resolve an approved source to the exact file the copy may read: canonicalize
 * it, require a regular file, and require the canonical path to still sit
 * inside the origin's canonical root. This is the authoritative check — the
 * decision judged a string, and a string cannot express a symbolic link.
 *
 * A source that is simply gone reports `missing` rather than a refusal, so an
 * annotation Zotero has not rendered yet stays an ordinary missing file.
 *
 * @returns The confirmed source in the form its origin copies from — a
 *   canonical path for a Zotero-managed origin, an open descriptor for a
 *   linked file. The caller owns the descriptor and closes it.
 */
export async function confirmSource(
  source: { path: string; root: string; origin: SourceOrigin },
  caseInsensitive: boolean,
): Promise<ConfirmedSource> {
  try {
    const canonical = await realpath(source.path);
    if (!(await stat(canonical)).isFile()) {
      return { status: "refused", reason: "not-a-regular-file" };
    }
    if (!isInside(source.root, canonical, caseInsensitive)) {
      return { status: "refused", reason: "escaped-root" };
    }
    if (!readsFromDescriptor(source.origin)) {
      return { status: "confirmed", source: { kind: "path", path: canonical } };
    }
    const handle = await open(canonical, OPEN_CONFIRMED);
    return { status: "confirmed", source: { kind: "handle", handle } };
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
      return { status: "missing" };
    }
    // `OPEN_CONFIRMED` refused a symbolic link that took the canonical path's
    // place after it was checked.
    if (isErrno(error, "ELOOP")) {
      return { status: "refused", reason: "escaped-root" };
    }
    throw error;
  }
}

/**
 * Whether an origin's copy reads from the descriptor opened at confirmation
 * rather than from the confirmed path.
 *
 * A linked file lives where Zotero does not control it, so the check and the
 * copy have to name the same open file. A Zotero-managed source reads by path
 * instead, keeping reflink — copy-on-write cloning operates on paths, and it
 * is what makes importing a large PDF library on macOS cheap.
 */
function readsFromDescriptor(origin: SourceOrigin): boolean {
  switch (origin) {
    case "storage":
    case "annotation-cache":
      return false;
    case "linked-base":
    case "linked-absolute":
      return true;
  }
}

/**
 * Whether `candidate` resolves strictly inside `root`. The root itself is not
 * inside itself, so a directory handed in where a file belongs never passes.
 */
function isInside(
  root: string,
  candidate: string,
  caseInsensitive: boolean,
): boolean {
  const rel = relative(
    fold(root, caseInsensitive),
    fold(candidate, caseInsensitive),
  );
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function rootsForOrigin(
  origin: SourceOrigin,
  roots: CanonicalRoots,
): readonly CanonicalRoot[] {
  switch (origin) {
    case "storage":
      return roots.storage ? [roots.storage] : [];
    case "annotation-cache":
      return roots.annotationCache ? [roots.annotationCache] : [];
    case "linked-base":
      return roots.base ? [roots.base] : [];
    // A linked file outside Zotero's control is trusted only where the user
    // approved it on this device.
    case "linked-absolute":
      return roots.approved;
  }
}

function approve(
  path: string,
  origin: SourceOrigin,
  root: string,
): AttachmentSource {
  const source = { approved: true, path, origin, root } as AttachmentSource;
  Object.defineProperty(source, APPROVED_SOURCE_BRAND, {
    value: true,
    enumerable: false,
  });
  return source;
}

async function trustedRoot(declared: string): Promise<CanonicalRoot | null> {
  const canonical = await canonicalize(declared);
  return canonical === null ? null : { declared, canonical };
}

/**
 * Re-canonicalize a stored approval. A record holds the folder's canonical
 * path, so a folder that canonicalizes to somewhere else was replaced by a link
 * after the grant: the approval leaves the snapshot entirely, granting neither
 * the path the user approved nor the link's target.
 */
async function approvedRoot(folder: string): Promise<CanonicalRoot | null> {
  const canonical = await canonicalize(folder);
  return canonical === folder ? { declared: folder, canonical: folder } : null;
}

/**
 * Resolve `path` through every symbolic link, or `null` when it does not
 * resolve. Also how an approved folder is reduced to the canonical form the
 * record holds.
 */
export async function canonicalize(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function fold(path: string, caseInsensitive: boolean): string {
  return caseInsensitive ? path.toLowerCase() : path;
}
