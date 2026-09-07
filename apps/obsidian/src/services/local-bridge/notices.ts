// UI seam for the Local Bridge: the Notice a connected Save shows in Obsidian,
// with the one action that carries the new look into the notes already written.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { runUpdateAllWithNotice } from "@/services/note-feature/actions";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";

import type { LocalBridgeService } from "./service";

const SAVED_NOTICE_DURATION_MS = 15_000;

export interface WorkbenchSavedNoticeDeps {
  localBridge: Pick<LocalBridgeService, "on">;
  /** The existing Update all notes flow, batch confirm modal included. */
  updateAll: () => Promise<BatchUpdateResult>;
}

interface WorkbenchSavedNoticeCopy {
  title: string;
  action: string;
  /** Runs the Update all notes flow the action offers. */
  updateAll: () => void;
}

/**
 * Show one Notice for each Save the page lands, offering the Update all notes
 * flow. The Save itself leaves every Literature Note as it was, so this action
 * is how the new look reaches them.
 *
 * @returns an unsubscribe function.
 */
export function registerWorkbenchSavedNotice(
  deps: WorkbenchSavedNoticeDeps,
): () => void {
  const copy = workbenchSavedNotice(() => {
    void runUpdateAllWithNotice(deps.updateAll);
  });
  return subscribeWorkbenchSaved(deps.localBridge, () =>
    showWorkbenchSaved(copy),
  );
}

/** The copy of the saved Notice, with the action bound to the flow it runs. */
export function workbenchSavedNotice(
  updateAll: () => void,
): WorkbenchSavedNoticeCopy {
  return {
    title: m.notice_workbench_profile_saved(),
    action: m.notice_workbench_profile_saved_action(),
    updateAll,
  };
}

/**
 * Subscribe the Notice to the bridge's Save events without coupling its
 * trigger to rendering: one Notice per Save that landed, none for a refusal.
 */
export function subscribeWorkbenchSaved(
  localBridge: Pick<LocalBridgeService, "on">,
  showNotice: () => void,
): () => void {
  return localBridge.on("profile-saved", () => showNotice());
}

function showWorkbenchSaved(copy: WorkbenchSavedNoticeCopy): BaseNotice {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addAction((button) => {
        button.setButtonText(copy.action).onClick(() => {
          notice.hide();
          copy.updateAll();
        });
      });
    }),
    SAVED_NOTICE_DURATION_MS,
  );
  return notice;
}
