// Lifecycle notices for citation formatting prerequisites.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import type { BibliographyRenderCache } from "./render-cache";

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
  renderCache: Pick<BibliographyRenderCache, "onStyleMissing">,
  openSettings: () => void,
): () => void {
  return subscribeCitationStyleMissing(renderCache, () =>
    showCitationStyleMissing(citationStyleMissingNotice(openSettings)),
  );
}

/** Subscribe the notice lifecycle without coupling its trigger to rendering. */
export function subscribeCitationStyleMissing(
  renderCache: Pick<BibliographyRenderCache, "onStyleMissing">,
  showNotice: () => CitationStyleNoticeHandle,
): () => void {
  let notice: CitationStyleNoticeHandle | null = null;
  const unsubscribe = renderCache.onStyleMissing(() => {
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
