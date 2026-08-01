// UI seam for the attachment-import service: one persistent summary notice per
// operation, naming the folders blocked from reads and explaining how approval
// changes the next import.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { type AttachmentImportService } from "./service";

const ATTACHMENT_SKIP_NOTICE_DURATION_MS = 30_000;

export interface AttachmentSkipNoticeDeps {
  attachmentImport: Pick<AttachmentImportService, "on">;
  /** Open the plugin's settings tab, which holds the approved folders list. */
  openSettings: () => void;
}

/**
 * Show one summary notice whenever an import operation settles having skipped
 * sources — blocked by the decision or refused by the copy-time confirmation.
 *
 * @returns an unsubscribe function.
 */
export function registerAttachmentSkipNotice(
  deps: AttachmentSkipNoticeDeps,
): () => void {
  return deps.attachmentImport.on(
    "sources-skipped",
    ({ blocked, refused, blockedFolders }) => {
      const notice = new BaseNotice(
        BaseNotice.render((renderer) => {
          renderer.setTitle(
            m.notice_attachment_sources_skipped({ count: blocked + refused }),
          );
          if (blockedFolders.length > 0) {
            renderer.addList(
              m.notice_attachment_sources_skipped_folders({
                count: blockedFolders.length,
              }),
              blockedFolders,
            );
            renderer.addText(
              m.notice_attachment_sources_skipped_next({
                count: blockedFolders.length,
              }),
            );
          }
          renderer.addAction((button) => {
            button
              .setButtonText(m.notice_attachment_sources_skipped_action())
              .onClick(() => {
                notice.hide();
                deps.openSettings();
              });
          });
        }),
        ATTACHMENT_SKIP_NOTICE_DURATION_MS,
      );
    },
  );
}
