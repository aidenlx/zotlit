// Lifecycle notices for citation formatting prerequisites.
import { Effect, Layer } from "@/lib/effect";
import type { Scope, Stream } from "@/lib/effect";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { revealSetting } from "@/lib/open-settings";
import { PluginHost } from "@/lib/plugin-host";

import { BibliographyRender, missingStyleChanges } from "./render-cache";
import type { BibliographyRenderState } from "./render-cache";

interface CitationStyleNoticeCopy {
  title: string;
  action: string;
  openSettings: () => void;
}

interface CitationStyleNoticeHandle {
  hide(): void;
}

/** Show one recovery notice when the render cache first finds its selected style unavailable. */
export const layerCitationStyleNotice = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const renders = yield* BibliographyRender;
    yield* watchCitationStyleMissing(renders, () =>
      showCitationStyleMissing(
        citationStyleMissingNotice(() => {
          revealSetting(
            host.app,
            host.manifest.id,
            "settings_citation_references_style",
          );
        }),
      ),
    );
  }),
);

/**
 * Watch the notice lifecycle without coupling its trigger to rendering. The
 * open notice hides when the Scope closes.
 */
export function watchCitationStyleMissing(
  renders: { readonly changes: Stream.Stream<BibliographyRenderState> },
  showNotice: () => CitationStyleNoticeHandle,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    let notice: CitationStyleNoticeHandle | null = null;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        notice?.hide();
      }),
    );
    yield* forkEach(missingStyleChanges(renders.changes), () => {
      notice = showNotice();
    });
  });
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
