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
  return deps.localBridge.on("profile-saved", () => {
    const notice = new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_workbench_profile_saved());
        renderer.addAction((button) => {
          button
            .setButtonText(m.notice_workbench_profile_saved_action())
            .onClick(() => {
              notice.hide();
              void runUpdateAllWithNotice(deps.updateAll);
            });
        });
      }),
      SAVED_NOTICE_DURATION_MS,
    );
  });
}
