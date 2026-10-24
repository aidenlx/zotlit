import { describe, expect, it as plainIt, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { Effect, Exit, Scope, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

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
      const { showNotice } = yield* watch(scope);

      scope.set(true);
      scope.set(true);

      expect(showNotice).toHaveBeenCalledOnce();
    }),
  );

  it.effect("stays quiet while the saved value is valid", () =>
    Effect.gen(function* () {
      const scope = fakeScope(false);
      const { showNotice } = yield* watch(scope);

      scope.set(false);

      expect(showNotice).not.toHaveBeenCalled();
    }),
  );

  it.effect("clears the notice on repair and arms the next break", () =>
    Effect.gen(function* () {
      const scope = fakeScope(false);
      const { showNotice, hide } = yield* watch(scope);

      scope.set(true);
      expect(showNotice).toHaveBeenCalledOnce();

      scope.set(false);
      expect(hide).toHaveBeenCalledOnce();

      scope.set(true);
      expect(showNotice).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect(
    "drops its subscription and its open notice when the Scope closes",
    () =>
      Effect.gen(function* () {
        const scope = fakeScope(true);
        const watched = yield* Scope.make();
        const hide = vi.fn();
        yield* watchLibraryScopeInvalid(scope.service, () => ({ hide })).pipe(
          Scope.provide(watched),
        );

        yield* Scope.close(watched, Exit.void);

        expect(hide).toHaveBeenCalledOnce();
        expect(scope.hasListener()).toBe(false);
      }),
  );
});

function watch(scope: ReturnType<typeof fakeScope>) {
  return Effect.gen(function* () {
    const hide = vi.fn();
    const showNotice = vi.fn(() => ({ hide }));
    yield* watchLibraryScopeInvalid(scope.service, showNotice);
    return { showNotice, hide };
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
