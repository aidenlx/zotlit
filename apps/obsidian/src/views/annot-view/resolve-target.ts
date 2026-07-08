// Pure follow-mode → load-target resolution for the annotation view.
import {
  type ItemRef,
  type Library,
  parseIndexedKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";

/** A resolved item plus the attachment to prefer when first loading it. */
export interface LoadTarget {
  indexedKey: string;
  key: string;
  libraryID: number;
  groupID: number | null;
  /** Reader-driven attachment; authoritative when set, falls back to saved/first when null. */
  boundAttachmentID: number | null;
}

/** Map a group ID to its active library ID; `null` when the group is unknown. */
export function resolveLibraryID(
  groupID: number | null,
  libraries: readonly Library[] | null,
): number | null {
  if (groupID === null) return USER_LIBRARY_ID;
  if (!libraries) return null;
  return libraries.find((l) => l.groupID === groupID)?.libraryID ?? null;
}

/**
 * Per-mode inputs, all pre-fetched by the view (active-note frontmatter key,
 * reader item ref, pinned item ref). Keeping resolution pure lets the branch
 * logic be unit-tested without Obsidian/DB access.
 */
export type ResolveTargetInput =
  | {
      mode: "note";
      indexedKey: string | null;
      libraries: readonly Library[] | null;
    }
  | { mode: "reader"; ref: ItemRef | null; attachmentID: number | null }
  | { mode: "linked"; linkedTarget: ItemRef | null };

export function resolveLoadTarget(
  input: ResolveTargetInput,
): LoadTarget | null {
  switch (input.mode) {
    case "note":
      return resolveNoteTarget(input.indexedKey, input.libraries);
    case "reader":
      return input.ref
        ? { ...toBase(input.ref), boundAttachmentID: input.attachmentID }
        : null;
    case "linked":
      return input.linkedTarget
        ? { ...toBase(input.linkedTarget), boundAttachmentID: null }
        : null;
  }
}

function toBase(ref: ItemRef): Omit<LoadTarget, "boundAttachmentID"> {
  return {
    indexedKey: ref.indexedKey,
    key: ref.key,
    libraryID: ref.libraryID,
    groupID: ref.groupID,
  };
}

function resolveNoteTarget(
  indexedKey: string | null,
  libraries: readonly Library[] | null,
): LoadTarget | null {
  if (!indexedKey) return null;
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const libraryID = resolveLibraryID(parsed.groupID, libraries);
  if (libraryID === null) return null;
  return {
    indexedKey,
    key: parsed.key,
    libraryID,
    groupID: parsed.groupID,
    boundAttachmentID: null,
  };
}
