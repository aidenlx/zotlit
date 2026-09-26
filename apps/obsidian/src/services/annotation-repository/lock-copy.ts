// What each Lock Reason says to the user, in one table every surface reads:
// the lock icon, the notice of a press, and the notice of a refused write.

import * as m from "@/lib/i18n/generated/messages";

import type { LockReason } from "./lock";

/** The Lock Reason in one sentence: the tooltip, and the notice of a press. */
export function lockReasonText(reason: LockReason): string {
  switch (reason) {
    case "external":
      return m.annot_view_lock_external();
    case "another-user":
      return m.annot_view_lock_another_user();
  }
}
