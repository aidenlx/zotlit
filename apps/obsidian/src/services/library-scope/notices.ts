// UI seam for Library Scope: the warn-once notice for a broken saved value.
import { Effect, Layer } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { revealSetting } from "@/lib/open-settings";
import { PluginHost } from "@/lib/plugin-host";

import { LibraryScope, scopeChanges } from "./service";

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
 * the pair; this is the one-off half. The notice's action reveals the Library
 * scope row so the user can repair it.
 */
export const layerLibraryScopeNotices = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const scope = yield* LibraryScope;
    yield* watchLibraryScopeInvalid(scope, () =>
      showLibraryScopeInvalid(
        libraryScopeInvalidNotice(() => {
          revealSetting(host.app, host.manifest.id, "settings_library_scope");
        }),
      ),
    );
  }),
);

/**
 * Watch the notice lifecycle without coupling its trigger to rendering. One
 * notice per broken spell: a repair hides it and re-arms the next one, so a
 * user who breaks the value again is told again. The open notice hides when
 * the Scope closes.
 */
export function watchLibraryScopeInvalid(
  scope: Pick<LibraryScope["Service"], "invalid" | "changes">,
  showNotice: () => LibraryScopeNoticeHandle,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    let notice: LibraryScopeNoticeHandle | null = null;
    const apply = Effect.gen(function* () {
      if (!(yield* scope.invalid)) {
        notice?.hide();
        notice = null;
        return;
      }
      notice ??= showNotice();
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        notice?.hide();
      }),
    );
    yield* apply;
    yield* forkEach(scopeChanges(scope.changes), () => apply);
  });
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
