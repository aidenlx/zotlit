// UI seam for Library Scope: the warn-once notice for a broken saved value.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import type { LibraryScopeService } from "./service";

interface LibraryScopeNoticeCopy {
  title: string;
  explanation: string;
  action: string;
  openSettings: () => void;
}

interface LibraryScopeNoticeHandle {
  hide(): void;
}

/**
 * Show one notice while the saved Library Scope is broken, and arm it again
 * once the value is repaired. The Settings warning is the persistent half of
 * the pair; this is the one-off half.
 *
 * @param openSettings reveals the Library scope row so the user can repair it.
 */
export function registerLibraryScopeNotices(
  service: LibraryScopeService,
  openSettings: () => void,
): () => void {
  return subscribeLibraryScopeInvalid(service, () =>
    showLibraryScopeInvalid(libraryScopeInvalidNotice(openSettings)),
  );
}

/**
 * Subscribe the notice lifecycle without coupling its trigger to rendering.
 * One notice per broken spell: a repair hides it and re-arms the next one, so
 * a user who breaks the value again is told again.
 */
export function subscribeLibraryScopeInvalid(
  service: Pick<LibraryScopeService, "invalid" | "on">,
  showNotice: () => LibraryScopeNoticeHandle,
): () => void {
  let notice: LibraryScopeNoticeHandle | null = null;
  const apply = (): void => {
    if (!service.invalid) {
      notice?.hide();
      notice = null;
      return;
    }
    notice ??= showNotice();
  };

  apply();
  const unsubscribe = service.on("changed", apply);
  return () => {
    unsubscribe();
    notice?.hide();
  };
}

export function libraryScopeInvalidNotice(
  openSettings: () => void,
): LibraryScopeNoticeCopy {
  return {
    title: m.notice_library_scope_invalid(),
    explanation: m.notice_library_scope_invalid_explanation(),
    action: m.notice_library_scope_invalid_action(),
    openSettings,
  };
}

export function showLibraryScopeInvalid(
  copy: LibraryScopeNoticeCopy,
): BaseNotice {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addText(copy.explanation);
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
