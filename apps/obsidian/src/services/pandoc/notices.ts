// Lifecycle notices for citation formatting prerequisites.
import { Effect, Layer } from "effect";
import type { Scope, Stream } from "effect";

import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { Notifier } from "@/lib/notifier";
import type { NoticeHandle } from "@/lib/notifier";
import { revealSetting } from "@/lib/open-settings";
import { PluginHost } from "@/lib/plugin-host";

import { BibliographyRender, missingStyleChanges } from "./render-cache";
import type { BibliographyRenderState } from "./render-cache";

interface CitationStyleNoticeCopy {
  title: string;
  action: string;
  openSettings: () => void;
}

/** Show one recovery notice when the render cache first finds its selected style unavailable. */
export const layerCitationStyleNotice = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const renders = yield* BibliographyRender;
    yield* watchCitationStyleMissing(
      renders,
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
export function watchCitationStyleMissing<R>(
  renders: { readonly changes: Stream.Stream<BibliographyRenderState> },
  showNotice: Effect.Effect<NoticeHandle, never, R>,
): Effect.Effect<void, never, Scope.Scope | R> {
  return Effect.gen(function* () {
    let notice: NoticeHandle | null = null;
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => notice?.hide ?? Effect.void),
    );
    yield* forkEach(missingStyleChanges(renders.changes), () =>
      Effect.map(showNotice, (shown) => {
        notice = shown;
      }),
    );
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

export const showCitationStyleMissing = Effect.fn(
  "CitationStyleNotice.showCitationStyleMissing",
)(function* (copy: CitationStyleNoticeCopy) {
  const notifier = yield* Notifier;
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  let notice: NoticeHandle | null = null;
  notice = yield* notifier.show(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addAction((button) => {
        button
          .setButtonText(copy.action)
          .setCta()
          .onClick(() => {
            if (notice) run(notice.hide);
            copy.openSettings();
          });
      });
    }),
    { duration: 0 },
  );
  return notice;
});
