import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit } from "effect";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { ExcerptImageService } from "@/services/excerpt-image/service";
import {
  LanguagePack,
  LanguagePackStorageFailed,
} from "@/services/language-pack/service";

import {
  clearExcerptCache,
  resetCitationIndex,
  resetLanguagePacks,
} from "./recovery";

type Mode = "cancel" | "clear" | "failure";

/** The user's answer to the confirmation, as `awaitConfirm` gives it. */
const answer = (mode: Mode) => Effect.succeed(mode !== "cancel");

/** What each notice said, in order. */
const said = (notices: ReturnType<typeof testNotifier>["notices"]) =>
  notices.map((notice) => notice.messages[0]);

describe("clearExcerptCache", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "releases the displays, then empties the store: %s",
    (mode) =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const calls: string[] = [];
        yield* clearExcerptCache(answer(mode)).pipe(
          Effect.provideContext(
            Context.make(Notifier, notifier.service).pipe(
              Context.add(
                ExcerptDisplays,
                stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
                  clear: () => void calls.push("displays"),
                }),
              ),
              Context.add(
                ExcerptImageService,
                stubService<ExcerptImageService["Service"]>("ExcerptImages", {
                  clear: Effect.tryPromise(async () => {
                    calls.push("images");
                    if (mode === "failure") throw new Error("storage blocked");
                  }),
                }),
              ),
            ),
          ),
        );

        expect(calls).toEqual(mode === "cancel" ? [] : ["displays", "images"]);
        expect(said(notifier.notices)).toEqual(
          mode === "cancel"
            ? []
            : mode === "clear"
              ? [m.notice_excerpt_cache_cleared()]
              : [m.notice_excerpt_cache_clear_failed()],
        );
      }),
  );
});

describe("resetCitationIndex", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "resets the index behind the confirmation: %s",
    (mode) =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        let resets = 0;
        yield* resetCitationIndex(answer(mode)).pipe(
          Effect.provideContext(
            Context.make(Notifier, notifier.service).pipe(
              Context.add(
                CitationIndex,
                stubService<CitationIndex["Service"]>("CitationIndex", {
                  reset: () =>
                    Effect.suspend(() => {
                      resets++;
                      return mode === "failure"
                        ? Effect.die(new Error("store locked"))
                        : Effect.void;
                    }),
                }),
              ),
            ),
          ),
        );

        expect(resets).toBe(mode === "cancel" ? 0 : 1);
        expect(said(notifier.notices)).toEqual(
          mode === "cancel"
            ? []
            : mode === "clear"
              ? [m.notice_citation_index_reset()]
              : [m.notice_citation_index_reset_failed()],
        );
      }),
  );
});

describe("resetLanguagePacks", () => {
  const run = (reset: Effect.Effect<void, LanguagePackStorageFailed>) => {
    const notifier = testNotifier();
    return resetLanguagePacks(answer("clear")).pipe(
      Effect.provideContext(
        Context.make(Notifier, notifier.service).pipe(
          Context.add(
            LanguagePack,
            stubService<LanguagePack["Service"]>("LanguagePack", { reset }),
          ),
        ),
      ),
      Effect.exit,
      Effect.map((exit) => ({ exit, notices: said(notifier.notices) })),
    );
  };

  it.effect("names the restart once the packs are gone", () =>
    Effect.gen(function* () {
      const { exit, notices } = yield* run(Effect.void);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(notices).toEqual([m.notice_language_pack_reset()]);
    }),
  );

  it.effect("fails with the storage failure, for the tab to report", () =>
    Effect.gen(function* () {
      const failure = new LanguagePackStorageFailed({
        message: "Storage is full",
        cause: null,
      });
      const { exit, notices } = yield* run(Effect.fail(failure));
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
      expect(notices).toEqual([]);
    }),
  );
});
