// A Locked Annotation: one Zotero's own reader refuses to edit, which ZotLit
// refuses to edit for the same reason. The lock is a fact of one Annotation,
// read from the Zotero database under either Annotation Source, and it stands
// apart from the Editing Capability of its Attachment.
//
// @see apps/obsidian/docs/adr/0066-annotation-locks-come-from-the-zotero-database.md

import * as m from "@/lib/i18n/generated/messages";

/**
 * Why an Annotation is locked. `external`: Zotero imported it from the PDF
 * file and imports it again when the file changes, so an edit made here is
 * lost.
 */
export type LockReason = "external";

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
 * Annotation refuses every edit and the delete.
 */
export function lockRefuses(
  lock: AnnotationLock | null,
  _verb: LockedVerb,
): boolean {
  if (lock === null) return false;
  switch (lock.reason) {
    case "external":
      return true;
  }
}

/**
 * The lock the Zotero database facts give one Annotation. A fact the database
 * does not hold gives no lock, as Zotero itself reads it.
 */
export function lockOf(facts: { isExternal: boolean }): AnnotationLock | null {
  return facts.isExternal ? { reason: "external" } : null;
}

/** The Lock Reason in one sentence: the tooltip, and the notice of a press. */
export function lockReasonText(reason: LockReason): string {
  switch (reason) {
    case "external":
      return m.annot_view_lock_external();
  }
}
