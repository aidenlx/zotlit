import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
// Lifecycle notices for citation formatting prerequisites.
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import type { PlainBibliographyRender } from "./render-cache/plain";

interface CitationStyleNoticeCopy {
  title: string;
  action: string;
  openSettings: () => void;
}

interface CitationStyleNoticeHandle {
  hide(): void;
}

/** Show one recovery notice when the render cache first finds its selected style unavailable. */
export function registerCitationStyleNotice(
  runtime: SubscriptionRuntime,
  renderCache: Pick<PlainBibliographyRender, "missingStyle">,
  openSettings: () => void,
): () => void {
  return subscribeCitationStyleMissing(runtime, renderCache, () =>
    showCitationStyleMissing(citationStyleMissingNotice(openSettings)),
  );
}

/** Subscribe the notice lifecycle without coupling its trigger to rendering. */
export function subscribeCitationStyleMissing(
  runtime: SubscriptionRuntime,
  renderCache: Pick<PlainBibliographyRender, "missingStyle">,
  showNotice: () => CitationStyleNoticeHandle,
): () => void {
  let notice: CitationStyleNoticeHandle | null = null;
  const unsubscribe = subscribe(runtime, renderCache.missingStyle, () => {
    notice = showNotice();
  });
  return () => {
    unsubscribe();
    notice?.hide();
  };
}

export function citationStyleMissingNotice(
  openSettings: () => void,
): CitationStyleNoticeCopy {
  return {
    title: m.notice_citation_style_missing(),
    action: m.notice_citation_style_missing_action(),
    openSettings,
  };
}

export function showCitationStyleMissing(
  copy: CitationStyleNoticeCopy,
): BaseNotice {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addAction((button) => {
        button
          .setButtonText(copy.action)
          .setCta()
          .onClick(() => {
            notice.hide();
            copy.openSettings();
          });
      });
    }),
    0,
  );
  return notice;
}
