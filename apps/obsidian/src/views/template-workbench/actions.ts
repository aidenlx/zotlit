import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";

const logger = getLogger(["views", "template-workbench"]);

/** UI callbacks consume failures after recording the operation that failed. */
export async function runTemplateWorkbenchAction(
  operation: string,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    if (AbortError.test(error)) return false;
    logger.error("Template Workbench action {operation} failed", {
      operation,
      error,
    });
    new BaseNotice(m.notice_profile_action_failed());
    return false;
  }
}
