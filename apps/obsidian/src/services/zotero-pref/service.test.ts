import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import { systemCallError } from "@/lib/errno";

import { zoteroPrefFixture } from "./__fixtures__";

// #1705: stalled external I/O releases startup and still publishes a late read.
it.effect(
  "bounds the first preference read and publishes its late result",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const result = yield* Deferred.make<string>();
      yield* Effect.gen(function* () {
        let built = false;
        const first = yield* zoteroPrefFixture(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(result)),
          ),
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              built = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        yield* TestClock.adjust("5 seconds");
        expect(built).toBe(true);
        const f = yield* Fiber.join(first);
        const changes = yield* Stream.toPull(f.pref.changes);
        expect((yield* changes)[0]).toMatchObject({
          state: "degraded",
          dataDir: join(homedir(), "Zotero"),
          prefs: new Map(),
          resolvedProfileDir: null,
        });
        yield* Deferred.succeed(
          result,
          'user_pref("extensions.zotero.baseAttachmentPath", "/late-attachments");',
        );
        expect((yield* changes)[0]).toMatchObject({
          state: "ready",
          baseAttachmentPath: "/late-attachments",
          resolvedProfileDir: "/profile",
        });
      }).pipe(Effect.ensuring(Deferred.succeed(result, "")));
    }),
);

// #1705: cancellation at the storage boundary must leave the published override
// equal to the saved one, and a profile change must still start its reload.
for (const kind of ["data", "profile"] as const) {
  it.effect(
    `finishes the ${kind} directory commit when interrupted after persistence`,
    () =>
      Effect.gen(function* () {
        const started = yield* Queue.unbounded<string>();
        const stopped = yield* Queue.unbounded<string>();
        let interrupt = () => {};
        const f = yield* zoteroPrefFixture(
          (path) =>
            path === "/profile/prefs.js"
              ? Effect.succeed("")
              : Queue.offer(started, path).pipe(
                  Effect.andThen(Effect.never),
                  Effect.ensuring(Queue.offer(stopped, path)),
                ),
          { profileDir: "/profile" },
          () => interrupt(),
        );
        const commit = yield* Effect.withFiber((fiber) => {
          // The synchronous OS callback interrupts exactly after persistence.
          interrupt = () => fiber.interruptUnsafe();
          return kind === "data"
            ? f.pref.setDataDir("/new-data")
            : f.pref.setProfileDir("/new-profile");
        }).pipe(Effect.forkChild);
        expect(Exit.isFailure(yield* Fiber.await(commit))).toBe(true);
        const current = yield* f.pref.current;
        if (kind === "data") {
          expect(f.saved()).toEqual({
            profileDir: "/profile",
            dataDir: "/new-data",
          });
          expect(current.dataDirOverride).toBe("/new-data");
        } else {
          expect(f.saved()).toEqual({ profileDir: "/new-profile" });
          expect(current.profileDirOverride).toBe("/new-profile");
          expect(yield* Queue.take(started)).toBe("/new-profile/prefs.js");
          yield* f.runtime.disposeEffect;
          expect(yield* Queue.take(stopped)).toBe("/new-profile/prefs.js");
        }
      }),
  );
}

// #1705: every consumer's first read needs the settled profile, including
// the worker database, the CLI source identity, and Template Workbench styles.
it.effect("builds with settled preferences before the first read", () =>
  Effect.gen(function* () {
    const started = yield* Queue.unbounded<void>();
    const first = yield* zoteroPrefFixture(() =>
      Queue.offer(started, undefined).pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.as(
          'user_pref("extensions.zotero.useDataDir", true);\nuser_pref("extensions.zotero.dataDir", "/research-data");',
        ),
      ),
    ).pipe(
      Effect.flatMap((f) => f.pref.current),
      Effect.forkChild,
    );
    yield* Queue.take(started);
    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(first)).toMatchObject({
      state: "ready",
      resolvedProfileDir: "/profile",
      dataDir: "/research-data",
      databasePath: "/research-data/zotero.sqlite",
      sourceId: expect.any(String),
    });
  }),
);

// Failure modes: a Device Override is not persisted, or observers retain the
// old database path after the setting changes.
it.effect("publishes and persists the data directory Device Override", () =>
  Effect.gen(function* () {
    const f = yield* zoteroPrefFixture();
    const changes = yield* Stream.toPull(f.pref.changes);
    yield* changes;
    yield* f.pref.setDataDir("/chosen-library");
    const next = yield* changes;
    expect(next[0]).toMatchObject({
      dataDirOverride: "/chosen-library",
      dataDir: "/chosen-library",
      databasePath: "/chosen-library/zotero.sqlite",
    });
    expect(f.saved()).toEqual({
      profileDir: "/profile",
      dataDir: "/chosen-library",
    });
  }),
);

// Failure modes: a late read replaces a newer profile, or closing the service
// leaves its profile reads running and able to change state.
it.effect("keeps the latest profile and interrupts reads on scope close", () =>
  Effect.gen(function* () {
    const started = yield* Queue.unbounded<string>();
    const stopped = yield* Queue.unbounded<string>();
    const read = (path: string) =>
      Effect.gen(function* () {
        if (path === "/profile/prefs.js") return "";
        yield* Queue.offer(started, path);
        yield* Effect.sleep(
          path === "/slow-profile/prefs.js" ? "2 seconds" : "1 second",
        );
        return `user_pref("extensions.zotero.baseAttachmentPath", "${path}");`;
      }).pipe(Effect.ensuring(Queue.offer(stopped, path)));
    const f = yield* zoteroPrefFixture(read);
    yield* Queue.take(stopped);
    yield* f.pref.setProfileDir("/slow-profile");
    expect(yield* Queue.take(started)).toBe("/slow-profile/prefs.js");
    yield* f.pref.setProfileDir("/new-profile");
    expect(yield* Queue.take(started)).toBe("/new-profile/prefs.js");
    yield* TestClock.adjust("1 second");
    yield* Queue.take(stopped);
    expect(yield* f.pref.get("baseAttachmentPath")).toBe(
      "/new-profile/prefs.js",
    );
    yield* TestClock.adjust("1 second");
    yield* Queue.take(stopped);
    expect((yield* f.pref.current).resolvedProfileDir).toBe("/new-profile");
    yield* f.pref.setProfileDir("/pending-profile");
    yield* Queue.take(started);
    yield* f.runtime.disposeEffect;
    expect(yield* Queue.take(stopped)).toBe("/pending-profile/prefs.js");
    const before = yield* f.pref.current;
    yield* f.pref.setDataDir("/after-close");
    yield* f.pref.setProfileDir("/after-close");
    expect(yield* f.pref.current).toBe(before);
    expect(f.saved()).toEqual({ profileDir: "/pending-profile" });
  }),
);

// Failure modes: automatic detection ignores profiles.ini, clearing a Device
// Override retains it, or an unreadable profile leaves old preferences active.
it.effect(
  "detects the default profile and degrades on an unreadable replacement",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture((path) => {
        if (path.endsWith("profiles.ini"))
          return Effect.succeed(
            "[Profile0]\nName=Research\nIsRelative=0\nPath=/research-profile\nDefault=1",
          );
        if (path === "/research-profile/prefs.js")
          return Effect.succeed(
            'user_pref("extensions.zotero.useDataDir", true);\nuser_pref("extensions.zotero.dataDir", "/research-data");\nuser_pref("extensions.zotero.httpServer.port", 45678);',
          );
        return Effect.fail(systemCallError(new Error("unreadable")));
      }, null);
      yield* Stream.runHead(
        Stream.filter(f.pref.changes, (s) => s.state === "ready"),
      );
      expect(yield* f.pref.current).toMatchObject({
        resolvedProfileDir: "/research-profile",
        dataDir: "/research-data",
        httpPort: 45678,
      });
      expect(yield* f.pref.listProfiles()).toEqual([
        { name: "Research", dir: "/research-profile", isDefault: true },
      ]);
      yield* f.pref.setDataDir("/override");
      yield* f.pref.setDataDir(null);
      expect((yield* f.pref.current).dataDir).toBe("/research-data");
      expect(f.saved()).toBeNull();
      yield* f.pref.setProfileDir("/unreadable");
      yield* Stream.runHead(
        Stream.filter(f.pref.changes, (s) => s.state === "degraded"),
      );
      expect(yield* f.pref.current).toMatchObject({
        state: "degraded",
        resolvedProfileDir: "/unreadable",
        dataDir: join(homedir(), "Zotero"),
      });
      expect(yield* f.pref.get("useDataDir")).toBeUndefined();
      expect(yield* f.pref.companionInstalled()).toBe(false);
    }),
);

// Failure mode: an observer remains blocked on the state Stream after unload.
it.effect("ends its changes Stream when the layer scope closes", () =>
  Effect.gen(function* () {
    const f = yield* zoteroPrefFixture();
    const observed = yield* Queue.unbounded<void>();
    const listener = yield* Stream.runForEach(f.pref.changes, () =>
      Queue.offer(observed, undefined),
    ).pipe(Effect.forkChild);
    yield* Queue.take(observed);
    yield* f.runtime.disposeEffect;
    yield* Fiber.join(listener);
  }),
);
