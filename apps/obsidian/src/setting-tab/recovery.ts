// The Advanced page's recovery actions: each asks first, then empties a store
// the plugin can always fill again, and names the outcome in a notice.
import { Effect } from "effect";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log-category";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError, portCall } from "@/lib/legacy-port";
import { Notifier } from "@/lib/notifier";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import { LanguagePack } from "@/services/language-pack/service";

/**
 * Run `clear` and name its outcome: `cleared` on success, else `failed`, with
 * the cause logged under `label`.
 */
const withOutcome = <E, R>(
  clear: Effect.Effect<void, E, R>,
  label: string,
  notices: { readonly cleared: string; readonly failed: string },
) =>
  Effect.gen(function* () {
    const notifier = yield* Notifier;
    yield* clear.pipe(
      Effect.andThen(notifier.show(notices.cleared)),
      recover(
        (cause) => Effect.logError(label, cause),
        notifier.show(notices.failed),
      ),
    );
  });

/**
 * Clear every stored citekey scan and rebuild it from the vault. The rebuild
 * runs on past this action, so the notice names it rather than claiming it is
 * done.
 */
export const resetCitationIndex = Effect.fn("SettingTab.resetCitationIndex")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return;
    yield* withOutcome(
      CitationIndex.use((index) => index.reset()),
      "Failed to reset the citation index",
      {
        cleared: m.notice_citation_index_reset(),
        failed: m.notice_citation_index_reset_failed(),
      },
    );
  },
  withLogCategory("setting-tab", "advanced"),
);

/** Empty the Excerpt Image store and release every display that paints from it. */
export const clearExcerptCache = Effect.fn("SettingTab.clearExcerptCache")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return;
    const displays = yield* ExcerptDisplays;
    const images = yield* ExcerptImages;
    yield* withOutcome(
      // The Held Reads go first: a card that repainted from the store while
      // it emptied would hold an image the clear removed.
      Effect.try({
        try: () => displays.clear(),
        catch: (cause) =>
          new LegacyPortError({ step: "clear-excerpt-displays", cause }),
      }).pipe(
        Effect.andThen(portCall("clear-excerpt-images", () => images.clear())),
      ),
      "Failed to clear excerpt image cache",
      {
        cleared: m.notice_excerpt_cache_cleared(),
        failed: m.notice_excerpt_cache_clear_failed(),
      },
    );
  },
  withLogCategory("setting-tab", "advanced"),
);

/**
 * Clear every downloaded Language Pack and the consent behind it. The pack
 * applied at startup keeps running, so the notice names the restart.
 */
export const resetLanguagePacks = Effect.fn("SettingTab.resetLanguagePacks")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return;
    yield* LanguagePack.use((pack) => pack.reset);
    yield* Notifier.use((notifier) =>
      notifier.show(m.notice_language_pack_reset()),
    );
  },
  withLogCategory("setting-tab", "advanced"),
);
