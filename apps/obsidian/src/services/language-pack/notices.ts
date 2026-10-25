// UI seam for the Language Pack: the startup consent notice and the download
// toast shared by every Install button.
import { Effect, Layer, Stream } from "effect";

import { logAndContinue } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { Notifier, reportProgress } from "@/lib/notifier";
import type { NoticeHandle } from "@/lib/notifier";

import { LanguagePack, LanguagePackDownloadFailed } from "./service";

/** The restart notice matters more than a transient toast, so it lingers. */
const RESTART_NOTICE_DURATION = "10 seconds";

/**
 * Install the Language Pack behind a toast: loading while the download runs,
 * then the restart notice or the failure. A call while a download is in flight
 * reports that download.
 */
export const toastLanguagePackInstall = Effect.gen(function* () {
  const pack = yield* LanguagePack;
  yield* reportProgress(Effect.exit(pack.install), {
    loading: m.notice_language_pack_downloading(),
    success: m.notice_language_pack_restart(),
    // A pack from a newer lineage than this build reads is a plugin-version
    // problem, not a transport one, so it names the fix instead of the error.
    error: (error) =>
      error instanceof LanguagePackDownloadFailed && error.updateNeeded
        ? m.notice_language_pack_update_needed()
        : m.notice_language_pack_download_failed({
            message: Error.isError(error) ? error.message : String(error),
          }),
    successDuration: RESTART_NOTICE_DURATION,
  });
}).pipe(Effect.withSpan("LanguagePackNotices.toastInstall"));

/**
 * What startup shows: the consent notice while the pack is offered, or the
 * toast of a consented refresh already downloading. The toast and the notice
 * end with the layer.
 */
export const layerLanguagePackNotices: Layer.Layer<
  never,
  never,
  LanguagePack | Notifier
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const pack = yield* LanguagePack;
    const situation = yield* pack.situation;
    switch (situation.kind) {
      case "offered":
        yield* showInstallOffer;
        break;
      case "downloading":
        yield* Effect.forkScoped(toastLanguagePackInstall);
        break;
    }
  }),
);

/**
 * The startup consent notice. It hides once the pack leaves `offered`, so
 * installing from the settings tab hides it too and the two entry points onto
 * the same download never disagree about whether it is still offered.
 */
const showInstallOffer = Effect.gen(function* () {
  const pack = yield* LanguagePack;
  const notifier = yield* Notifier;
  const scope = yield* Effect.scope;
  const run = Effect.runForkWith(
    yield* Effect.context<LanguagePack | Notifier>(),
  );
  const notice: NoticeHandle = yield* notifier.show(
    BaseNotice.render((renderer) => {
      renderer.setTitle(
        m.notice_language_pack_install({ language: pack.endonym }),
      );
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_language_pack_decline_action())
          .onClick(() => {
            run(
              pack.decline.pipe(
                logAndContinue("Language Pack decline failed", "i18n"),
              ),
            );
          });
      });
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_language_pack_install_action())
          .setCta()
          .onClick(() => {
            run(Effect.forkIn(toastLanguagePackInstall, scope));
          });
      });
    }),
    { duration: 0 },
  );
  yield* Effect.addFinalizer(() => notice.hide);
  yield* pack.changes.pipe(
    Stream.filter((next) => next.kind !== "offered"),
    Stream.take(1),
    Stream.runDrain,
    Effect.andThen(notice.hide),
    Effect.forkScoped({ startImmediately: true }),
  );
});
