import { it } from "@effect/vitest";
import { Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it as plainIt, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { testNotifier } from "@/lib/__fixtures__/notifier";

import { libraryScopeInvalidNotice, watchLibraryScopeInvalid } from "./notices";
import { DEFAULT_LIBRARY_SCOPE } from "./scope";
import type { LibraryScopeState } from "./service";

describe("libraryScopeInvalidNotice", () => {
  plainIt(
    "carries the approved copy and opens settings through its action",
    () => {
      const openSettings = vi.fn();
      const notice = libraryScopeInvalidNotice(openSettings);

      expect(notice).toMatchObject({
        title: "Library scope is invalid",
        explanation:
          "ZotLit is using My Library until you select a library scope.",
        action: "Open settings",
      });

      notice.openSettings();
      expect(openSettings).toHaveBeenCalledOnce();
    },
  );
});

describe("watchLibraryScopeInvalid", () => {
  it.effect("warns once for a value that was already broken at the start", () =>
    Effect.gen(function* () {
      const scope = fakeScope(true);
      const { notices } = yield* watch(scope);

      scope.set(true);
      scope.set(true);

      expect(notices).toHaveLength(1);
    }),
  );

  it.effect("stays quiet while the saved value is valid", () =>
    Effect.gen(function* () {
      const scope = fakeScope(false);
      const { notices } = yield* watch(scope);

      scope.set(false);

      expect(notices).toEqual([]);
    }),
  );

  it.effect("clears the notice on repair and arms the next break", () =>
    Effect.gen(function* () {
      const scope = fakeScope(false);
      const { notices } = yield* watch(scope);

      scope.set(true);
      expect(notices).toHaveLength(1);

      scope.set(false);
      expect(notices[0]?.hidden).toBe(true);

      scope.set(true);
      expect(notices).toHaveLength(2);
      expect(notices[1]?.hidden).toBe(false);
    }),
  );

  it.effect(
    "drops its subscription and its open notice when the Scope closes",
    () =>
      Effect.gen(function* () {
        const scope = fakeScope(true);
        const watched = yield* Scope.make();
        const notifier = testNotifier();
        yield* watchLibraryScopeInvalid(
          scope.service,
          invalidNotice(notifier),
        ).pipe(Scope.provide(watched));

        yield* Scope.close(watched, Exit.void);

        expect(notifier.notices).toMatchObject([{ hidden: true }]);
        expect(scope.hasListener()).toBe(false);
      }),
  );
});

function invalidNotice(notifier: ReturnType<typeof testNotifier>) {
  return notifier.service.show("Library scope is invalid", { duration: 0 });
}

function watch(scope: ReturnType<typeof fakeScope>) {
  return Effect.gen(function* () {
    const notifier = testNotifier();
    yield* watchLibraryScopeInvalid(scope.service, invalidNotice(notifier));
    return { notices: notifier.notices };
  });
}

/** A Library Scope whose saved value a test breaks and repairs. */
function fakeScope(invalid: boolean) {
  const event = testEvent<LibraryScopeState>();
  const stateOf = (broken: boolean): LibraryScopeState => ({
    current: null,
    all: null,
    invalid: broken,
    effective: DEFAULT_LIBRARY_SCOPE,
    libraryRows: null,
  });
  let latest = stateOf(invalid);
  return {
    service: {
      invalid: Effect.sync(() => latest.invalid),
      // The state a subscriber starts from, then each one the test sets.
      changes: Stream.unwrap(
        Effect.sync(() => event.stream.pipe(Stream.prepend([latest]))),
      ),
    },
    set(broken: boolean) {
      latest = stateOf(broken);
      event.emit(latest);
    },
    hasListener: () => event.subscribers > 0,
  };
}
