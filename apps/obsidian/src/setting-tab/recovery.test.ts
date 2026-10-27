import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit } from "effect";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Notifier } from "@/lib/notifier";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { ExcerptImages } from "@/services/excerpt-image/layer";
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

describe("clearExcerptCache", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "releases the displays, then empties the store: %s",
    (mode) =>
      Effect.gen(function* () {
        const calls: string[] = [];
        yield* clearExcerptCache(answer(mode)).pipe(
          Effect.provideContext(
            Context.make(Notifier, testNotifier().service).pipe(
              Context.add(
                ExcerptDisplays,
                stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
                  clear: () => void calls.push("displays"),
                }),
              ),
              Context.add(
                ExcerptImages,
                stubService<ExcerptImages["Service"]>("ExcerptImages", {
                  clear: async () => {
                    calls.push("images");
                    if (mode === "failure") throw new Error("storage blocked");
                  },
                }),
              ),
            ),
          ),
        );

        expect(calls).toEqual(mode === "cancel" ? [] : ["displays", "images"]);
      }),
  );
});

describe("resetCitationIndex", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "resets the index behind the confirmation: %s",
    (mode) =>
      Effect.gen(function* () {
        let resets = 0;
        yield* resetCitationIndex(answer(mode)).pipe(
          Effect.provideContext(
            Context.make(Notifier, testNotifier().service).pipe(
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
      }),
  );
});

describe("resetLanguagePacks", () => {
  const run = (reset: Effect.Effect<void, LanguagePackStorageFailed>) => {
    let resets = 0;
    return resetLanguagePacks(answer("clear")).pipe(
      Effect.provideContext(
        Context.make(Notifier, testNotifier().service).pipe(
          Context.add(
            LanguagePack,
            stubService<LanguagePack["Service"]>("LanguagePack", {
              reset: Effect.suspend(() => {
                resets++;
                return reset;
              }),
            }),
          ),
        ),
      ),
      Effect.exit,
      Effect.map((exit) => ({ exit, resets })),
    );
  };

  it.effect("clears the packs once confirmed", () =>
    Effect.gen(function* () {
      const { exit, resets } = yield* run(Effect.void);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(resets).toBe(1);
    }),
  );

  it.effect("fails with the storage failure, for the tab to report", () =>
    Effect.gen(function* () {
      const failure = new LanguagePackStorageFailed({
        message: "Storage is full",
        cause: null,
      });
      const { exit } = yield* run(Effect.fail(failure));
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
    }),
  );
});
