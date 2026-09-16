// Pure follow-mode → load-target resolution for the annotation view.
import { parseIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import type { ReaderSessionTarget } from "@/services/reader-session/session";

import type { AttachmentLock } from "./store";

/** What the view reads, in the one identity every surface shares. */
export interface LoadTarget {
  /**
   * The Item whose Attachments the view lists, by Indexed Key; `null` for a
   * standalone Attachment, which {@link lockedAttachmentKey} then names alone.
   */
  itemKey: string | null;
  /**
   * The Attachment an Obsidian PDF view or the Zotero Reader chose. It is the
   * one on screen and the picker stands down while it stands.
   */
  lockedAttachmentKey: string | null;
  /** Why the Attachment is locked; `null` when the user may choose. */
  lock: AttachmentLock;
  /** Bare key of whichever of the two keys the read starts from. */
  key: string;
  libraryID: number;
  groupID: number | null;
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

/** What the active Obsidian tab offers the view, already read by the caller. */
export type ActiveLeafTarget =
  /** A Literature Note, by the Indexed Key in its frontmatter. */
  | { kind: "note"; itemKey: string }
  /** An Obsidian PDF view ZotLit resolved to a Zotero Attachment. */
  | { kind: "pdf"; target: ReaderSessionTarget };

/**
 * Per-mode inputs, all pre-fetched by the view (the active leaf, the Zotero
 * Reader's session target, the pinned Item). Keeping resolution pure lets the
 * branch logic be unit-tested without Obsidian/DB access.
 */
export type ResolveTargetInput = { libraries: readonly Library[] | null } & (
  | { mode: "active-tab"; leaf: ActiveLeafTarget | null }
  | { mode: "zotero-reader"; target: ReaderSessionTarget | null }
  | { mode: "pinned"; pinnedItemKey: string | null }
);

export function resolveLoadTarget(
  input: ResolveTargetInput,
): LoadTarget | null {
  const { libraries } = input;
  switch (input.mode) {
    case "active-tab":
      if (input.leaf === null) return null;
      return input.leaf.kind === "note"
        ? itemTarget(input.leaf.itemKey, libraries)
        : readerTarget(input.leaf.target, "obsidian-pdf", libraries);
    case "zotero-reader":
      return readerTarget(input.target, "zotero-reader", libraries);
    case "pinned":
      return itemTarget(input.pinnedItemKey, libraries);
  }
}

function readerTarget(
  target: ReaderSessionTarget | null,
  lock: AttachmentLock,
  libraries: readonly Library[] | null,
): LoadTarget | null {
  if (!target) return null;
  // The Attachment is what the reader holds; its parent only names the list
  // the picker would offer, so a standalone Attachment resolves all the same.
  const base = locate(target.itemKey ?? target.attachmentKey, libraries);
  if (!base) return null;
  return {
    itemKey: target.itemKey,
    lockedAttachmentKey: target.attachmentKey,
    lock,
    ...base,
  };
}

function itemTarget(
  itemKey: string | null,
  libraries: readonly Library[] | null,
): LoadTarget | null {
  if (!itemKey) return null;
  const base = locate(itemKey, libraries);
  if (!base) return null;
  return { itemKey, lockedAttachmentKey: null, lock: null, ...base };
}

function locate(
  indexedKey: string,
  libraries: readonly Library[] | null,
): Pick<LoadTarget, "key" | "libraryID" | "groupID"> | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const libraryID = resolveLibraryID(parsed.groupID, libraries);
  if (libraryID === null) return null;
  return { key: parsed.key, libraryID, groupID: parsed.groupID };
}
