// A Locked Annotation: one Zotero's own reader refuses to edit, which ZotLit
// refuses to edit for the same reason. The lock is a fact of one Annotation,
// read from the Zotero database under either Annotation Source, and it stands
// apart from the Editing Capability of its Attachment.
//
// @see apps/obsidian/docs/adr/0067-annotation-locks-come-from-the-zotero-database.md

import type { Annotation } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import { lockReasonText } from "./lock-copy";

const logger = getLogger("annotation-repository");

/**
 * Why an Annotation is locked. `external`: Zotero imported it from the PDF
 * file and imports it again when the file changes, so an edit made here is
 * lost. `another-user`: another member of a group library created it, and
 * only its creator can change it.
 */
export type LockReason = "external" | "another-user";

export interface AnnotationLock {
  reason: LockReason;
}

/** A verb the lock can refuse: every write to an Annotation that exists. */
export type LockedVerb =
  | "color"
  | "comment"
  | "text"
  | "tags"
  | "geometry"
  | "delete";

/**
 * Whether `lock` refuses `verb`, as Zotero's reader refuses it. An External
 * Annotation refuses every edit and the delete; another user's Annotation
 * refuses every edit and allows the delete.
 */
export function lockRefuses(
  lock: AnnotationLock | null,
  verb: LockedVerb,
): boolean {
  if (lock === null) return false;
  switch (lock.reason) {
    case "external":
      return true;
    case "another-user":
      return verb !== "delete";
  }
}

/**
 * What a lock puts in the way of one verb: the Lock Reason, and no action,
 * since no gesture in ZotLit ends a lock.
 */
export interface LockBlock {
  reason: string;
  action: null;
  source: "lock";
}

/**
 * The block `lock` puts on `verb`, or `null` where the lock allows it: the one
 * lock question every surface asks, the card's verbs, the reader's keys, and
 * the Mark Handles of a Geometry Edit alike.
 */
export function lockBlock(
  lock: AnnotationLock | null,
  verb: LockedVerb,
): LockBlock | null {
  if (lock === null || !lockRefuses(lock, verb)) return null;
  return { reason: lockReasonText(lock.reason), action: null, source: "lock" };
}

/**
 * The first of these Annotations whose lock refuses `verb`. A group verb is
 * all or nothing, as in Zotero's reader, so this one Annotation stops the
 * whole group.
 *
 * @param annotationKeys Indexed Keys, in the order the first is picked from.
 * @param lockOn the lock of one Annotation by its Indexed Key, or `null`
 *   where none stands in the way.
 */
export function firstLockRefusal(
  annotationKeys: Iterable<string>,
  verb: LockedVerb,
  lockOn: (annotationKey: string) => AnnotationLock | null,
): { annotationKey: string; lock: AnnotationLock } | null {
  for (const annotationKey of annotationKeys) {
    const lock = lockOn(annotationKey);
    if (lock && lockRefuses(lock, verb)) return { annotationKey, lock };
  }
  return null;
}

/**
 * The lock the Zotero database facts give one Annotation. A fact the database
 * does not hold gives no lock, as Zotero itself reads it: Zotero counts a
 * missing creator (`!createdByUserID`, so `0` too) or a missing account user
 * ID as the author. `external` comes first, since it also refuses the delete.
 *
 * @param currentUserID the account user ID of the database identity, or
 *   `null` where the account never synced.
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L134-L160
 */
export function lockOf(
  facts: Pick<
    Annotation,
    "indexedKey" | "isExternal" | "groupID" | "createdByUserID"
  >,
  currentUserID: number | null,
): AnnotationLock | null {
  const { indexedKey, isExternal, groupID, createdByUserID } = facts;
  if (isExternal) return { reason: "external" };
  if (groupID === null) return null;
  const byAnotherUser =
    !!createdByUserID &&
    currentUserID !== null &&
    createdByUserID !== currentUserID;
  logger.trace("Read the creator lock of a group Annotation", {
    annotationKey: indexedKey,
    createdByUserID,
    currentUserID,
    byAnotherUser,
  });
  return byAnotherUser ? { reason: "another-user" } : null;
}
