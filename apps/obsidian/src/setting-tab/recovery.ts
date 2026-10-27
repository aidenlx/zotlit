// The Advanced page's recovery actions: each asks first, then empties a store
// the plugin can always fill again, and names the outcome in a notice.
import { Effect } from "effect";

import { withLogCategory } from "@/lib/effect-log-category";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError, portCall } from "@/lib/legacy-port";
import { Notifier, reportOutcome } from "@/lib/notifier";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import { LanguagePack } from "@/services/language-pack/service";

/**
 * Clear every stored citekey scan and rebuild it from the vault. The rebuild
 * runs on past this action, so the notice names it rather than claiming it is
 * done.
 */
export const resetCitationIndex = Effect.fn("SettingTab.resetCitationIndex")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return "cancelled" as const;
    yield* CitationIndex.use((index) => index.reset);
    return "completed" as const;
  },
  withLogCategory("setting-tab", "advanced"),
);

/** Empty the Excerpt Image store and release every display that paints from it. */
export const clearExcerptCache = Effect.fn("SettingTab.clearExcerptCache")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return "cancelled" as const;
    const displays = yield* ExcerptDisplays;
    const images = yield* ExcerptImages;
    // The Held Reads go first: a card that repainted from the store while
    // it emptied would hold an image the clear removed.
    yield* Effect.try({
      try: () => displays.clear(),
      catch: (cause) =>
        new LegacyPortError({ step: "clear-excerpt-displays", cause }),
    });
    yield* portCall("clear-excerpt-images", () => images.clear());
    return "completed" as const;
  },
  withLogCategory("setting-tab", "advanced"),
);

/** Report a confirmed index reset, preserving silence on cancellation. */
export const reportResetCitationIndex = (confirm: Effect.Effect<boolean>) =>
  reportOutcome(resetCitationIndex(confirm), {
    success: (outcome) =>
      outcome === "completed" ? m.notice_citation_index_reset() : undefined,
    error: () => m.notice_citation_index_reset_failed(),
  });

/** Report a confirmed cache clear, preserving silence on cancellation. */
export const reportClearExcerptCache = (confirm: Effect.Effect<boolean>) =>
  reportOutcome(clearExcerptCache(confirm), {
    success: (outcome) =>
      outcome === "completed" ? m.notice_excerpt_cache_cleared() : undefined,
    error: () => m.notice_excerpt_cache_clear_failed(),
  });

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
