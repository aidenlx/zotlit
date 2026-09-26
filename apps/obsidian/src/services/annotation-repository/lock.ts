// A Locked Annotation: one Zotero's own reader refuses to edit, which ZotLit
// refuses to edit for the same reason. The lock is a fact of one Annotation,
// read from the Zotero database under either Annotation Source, and it stands
// apart from the Editing Capability of its Attachment.
//
// @see apps/obsidian/docs/adr/0066-annotation-locks-come-from-the-zotero-database.md

import type { Annotation } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";

const logger = getLogger("annotation-repository");

/**
 * Why an Annotation is locked. `external`: Zotero imported it from the PDF
 * file and imports it again when the file changes, so an edit made here is
 * lost. `another-user`: another member of a group library created it, and
 * only its creator can change it.
 */
export type LockReason = "external" | "another-user";

/** The lock on one Annotation. */
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

/** The Lock Reason in one sentence: the tooltip, and the notice of a press. */
export function lockReasonText(reason: LockReason): string {
  switch (reason) {
    case "external":
      return m.annot_view_lock_external();
    case "another-user":
      return m.annot_view_lock_another_user();
  }
}
