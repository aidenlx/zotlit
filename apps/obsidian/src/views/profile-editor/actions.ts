import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";

const logger = getLogger(["views", "profile-editor"]);

/** UI callbacks consume failures after recording the operation that failed. */
export async function runProfileEditorAction(
  operation: string,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    logger.error("Profile Editor action {operation} failed", {
      operation,
      error,
    });
    new BaseNotice(m.notice_profile_action_failed());
    return false;
  }
}
