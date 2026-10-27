// UI seam for the attachment-import service: one persistent summary notice per
// operation, naming the folders blocked from reads and explaining how approval
// changes the next import.
import { Effect, Layer } from "effect";

import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { Notifier } from "@/lib/notifier";
import type { NoticeHandle } from "@/lib/notifier";

import { AttachmentImport } from "./service";
import type { AttachmentSkipSummary } from "./service";

const ATTACHMENT_SKIP_NOTICE_DURATION_MS = 30_000;

export interface AttachmentSkipNoticePorts {
  /** Open the plugin's settings tab, which holds the approved folders list. */
  readonly openSettings: () => void;
}

/**
 * Show one summary notice whenever an import operation settles having skipped
 * sources — blocked by the decision or refused by the copy-time confirmation.
 * The subscription ends when the layer's Scope closes.
 */
export const layerAttachmentSkipNotice = (
  ports: AttachmentSkipNoticePorts,
): Layer.Layer<never, never, AttachmentImport | Notifier> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { skipped } = yield* AttachmentImport;
      const notifier = yield* Notifier;
      // The notice's button is a DOM callback: it hides the notice in place.
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      yield* forkEach(skipped, (summary) =>
        Effect.gen(function* () {
          let notice: NoticeHandle | null = null;
          notice = yield* notifier.show(
            skipNoticeMessage(summary, () => {
              if (notice) run(notice.hide);
              ports.openSettings();
            }),
            { duration: ATTACHMENT_SKIP_NOTICE_DURATION_MS },
          );
        }),
      );
    }),
  );

function skipNoticeMessage(
  { blocked, refused, blockedFolders }: AttachmentSkipSummary,
  openSettings: () => void,
): DocumentFragment {
  return BaseNotice.render((renderer) => {
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
        .onClick(openSettings);
    });
  });
}
