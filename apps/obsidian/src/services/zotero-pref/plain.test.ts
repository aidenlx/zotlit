import { it } from "@effect/vitest";
import { Effect, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";

import { zoteroPrefFixture } from "./__fixtures__";
import { plainZoteroPref } from "./plain";
import { resolvedChanged } from "./service";

// #1705: unload can leave consumers holding the adapter after runtime disposal.
it.effect(
  "keeps released reads and no-op writes after the whole runtime closes",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture(() =>
        Effect.succeed(
          'user_pref("extensions.zotero.baseAttachmentPath", "/attachments");',
        ),
      );
      const plain = plainZoteroPref(f.runtime);
      const received: string[] = [];
      const unsubscribe = subscribe(
        f.runtime,
        Stream.drop(plain.changes, 1),
        () => received.push("change"),
      );
      // No intervening adapter read: the retained snapshot must include this write.
      plain.setDataDir("/last-data");
      yield* f.runtime.disposeEffect;
      const count = received.length;
      const last = yield* f.pref.current;
      const {
        prefs: _prefs,
        profileDirOverride: _profileDirOverride,
        ...snapshot
      } = last;
      expect(plain).toMatchObject(snapshot);
      expect(plain.dataDir).toBe("/last-data");
      expect(plain.get("baseAttachmentPath")).toBe("/attachments");
      expect(plain.get("missing")).toBeUndefined();
      expect(plain.setDataDir("/after-close")).toBeUndefined();
      expect(plain.setProfileDir("/after-close")).toBeUndefined();
      expect(plain.dataDir).toBe("/last-data");
      expect(f.saved()).toEqual({
        profileDir: "/profile",
        dataDir: "/last-data",
      });
      const stopLate = subscribe(f.runtime, Stream.drop(plain.changes, 1), () =>
        received.push("late"),
      );
      const stopChanged = subscribe(f.runtime, plain.changed, () =>
        received.push("changed"),
      );
      stopLate();
      stopChanged();
      unsubscribe();
      expect(received).toHaveLength(count);
    }),
);

// #1705: SubscriptionRef only replays the latest value to a late subscriber.
it.effect(
  "keeps a throwing listener subscribed for both immediate changes",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture();
      const plain = plainZoteroPref(f.runtime);
      const received: string[] = [];
      const delivered = yield* Queue.unbounded<void>();
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const unsubscribe = subscribe(
        f.runtime,
        Stream.drop(plain.changes, 1),
        (next) => {
          received.push(next.dataDir);
          if (received.length === 1) throw new Error("listener failed");
          if (next.dataDir === "/library-two")
            run(Queue.offer(delivered, undefined));
        },
      );
      plain.setDataDir("/library-one");
      plain.setDataDir("/library-two");
      yield* Queue.take(delivered);
      unsubscribe();
      expect(received).toEqual(["/library-one", "/library-two"]);
    }),
);

// Failure modes: the adapter misses a change immediately after subscribing,
// or calls an unsubscribed listener.
it.effect("provides plain reads and cancellable subscriptions", () =>
  Effect.gen(function* () {
    const f = yield* zoteroPrefFixture();
    yield* Stream.runHead(
      Stream.filter(f.pref.changes, (s) => s.state === "ready"),
    );
    const plain = plainZoteroPref(f.runtime);
    const received: string[] = [];
    const delivered = yield* Queue.unbounded<void>();
    const run = Effect.runSyncWith(yield* Effect.context<never>());
    const unsubscribe = subscribe(
      f.runtime,
      Stream.drop(plain.changes, 1),
      (next) => {
        received.push(next.dataDir);
        run(Queue.offer(delivered, undefined));
      },
    );
    plain.setDataDir("/library-one");
    yield* Queue.take(delivered);
    unsubscribe();
    plain.setDataDir("/library-two");
    expect(plain.dataDirOverride).toBe("/library-two");
    expect(received).toEqual(["/library-one"]);
  }),
);

// Failure modes: profile reload fails to notify old consumers, or `changed`
// confuses a profile read with a data-directory Device Override.
it.effect(
  "fires changed for a preference read and not for a Device Override",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture((path) =>
        path === "/profile/prefs.js"
          ? Effect.succeed("")
          : Effect.sleep("1 second").pipe(Effect.as("")),
      );
      const plain = plainZoteroPref(f.runtime);
      const events: string[] = [];
      const resolved = yield* Queue.unbounded<void>();
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const stops = [
        subscribe(f.runtime, plain.changed, () => events.push("prefs")),
        subscribe(f.runtime, resolvedChanged(f.pref), () => {
          run(Queue.offer(resolved, undefined));
        }),
      ];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const stop of stops) stop();
        }),
      );
      plain.setProfileDir("/reloaded-profile");
      yield* TestClock.adjust("1 second");
      yield* Queue.take(resolved);
      expect(events).toEqual(["prefs"]);
      plain.setDataDir("/override");
      yield* Queue.take(resolved);
      expect(events).toEqual(["prefs"]);
      plain.setDataDir("/override");
      plain.setProfileDir("/another-profile");
      yield* TestClock.adjust("1 second");
      yield* Queue.take(resolved);
      expect(events).toEqual(["prefs", "prefs"]);
      expect(plain.resolvedProfileDir).toBe("/another-profile");
    }),
);
