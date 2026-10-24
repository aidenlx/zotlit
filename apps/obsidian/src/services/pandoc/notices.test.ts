import { describe, expect, it as plainIt, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { Effect, Exit, Scope, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import {
  citationStyleMissingNotice,
  watchCitationStyleMissing,
} from "./notices";
import type { BibliographyRenderState } from "./render-cache";

function styleEvents(existing = false) {
  const event = testEvent<BibliographyRenderState>();
  const stateOf = (missingStyle: string | null): BibliographyRenderState => ({
    vaultPresentation: {} as BibliographyRenderState["vaultPresentation"],
    missingStyle,
  });
  const style = "http://www.zotero.org/styles/missing";
  return {
    cache: {
      // The state a subscriber starts from, then each one the test emits.
      changes: Stream.unwrap(
        Effect.sync(() =>
          event.stream.pipe(Stream.prepend([stateOf(existing ? style : null)])),
        ),
      ),
    },
    emit: () => event.emit(stateOf(style)),
    hasListener: () => event.subscribers > 0,
  };
}

describe("citationStyleMissingNotice", () => {
  plainIt(
    "carries the approved copy and opens settings through its action",
    () => {
      const openSettings = vi.fn();
      const notice = citationStyleMissingNotice(openSettings);

      expect(notice).toMatchObject({
        title:
          "The selected citation and references style isn’t installed in Zotero.",
        action: "Open settings",
      });

      notice.openSettings();
      expect(openSettings).toHaveBeenCalledOnce();
    },
  );
});

describe("watchCitationStyleMissing", () => {
  it.effect(
    "shows a notice when the missing style was found before the start",
    () =>
      Effect.gen(function* () {
        const events = styleEvents(true);
        const notifier = testNotifier();
        const showNotice = notifier.service.show("Style missing", {
          duration: 0,
        });
        const watched = yield* Scope.make();
        yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
          Scope.provide(watched),
        );

        expect(notifier.notices).toMatchObject([{ hidden: false }]);
        yield* Scope.close(watched, Exit.void);
        expect(notifier.notices).toMatchObject([{ hidden: true }]);
        expect(events.hasListener()).toBe(false);
      }),
  );

  it.effect(
    "watches for the plugin lifecycle and hides the active notice at its end",
    () =>
      Effect.gen(function* () {
        const events = styleEvents();
        const notifier = testNotifier();
        const showNotice = notifier.service.show("Style missing", {
          duration: 0,
        });
        const watched = yield* Scope.make();
        yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
          Scope.provide(watched),
        );

        events.emit();
        expect(notifier.notices).toMatchObject([{ hidden: false }]);

        yield* Scope.close(watched, Exit.void);
        expect(notifier.notices).toMatchObject([{ hidden: true }]);
        expect(events.hasListener()).toBe(false);
      }),
  );
});
