import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { Effect, Queue, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { zoteroPrefFixture } from "./__fixtures__";
import { plainZoteroPref } from "./plain";

// #1705: unload can leave consumers holding the adapter after runtime disposal.
it.effect(
  "keeps released reads and no-op writes after the whole runtime closes",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture((path) =>
        Effect.succeed(
          path.endsWith("extensions.json")
            ? '{"addons":[{"id":"zotlit@aidenlx.site","active":true}]}'
            : path.endsWith("profiles.ini")
              ? "[Profile0]\nName=Research\nPath=/profile\nIsRelative=0\nDefault=1"
              : 'user_pref("extensions.zotero.baseAttachmentPath", "/attachments");',
        ),
      );
      const plain = plainZoteroPref(f.runtime);
      const received: string[] = [];
      const unsubscribe = plain.subscribe(() => received.push("change"));
      const stopEvent = plain.on("resolved-changed", () =>
        received.push("event"),
      );
      // No intervening adapter read: the retained snapshot must include this write.
      plain.setDataDir("/last-data");
      yield* f.runtime.disposeEffect;
      const count = received.length;
      const last = yield* f.pref.current;
      const { prefs: _prefs, ...snapshot } = last;
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
      expect(yield* Effect.promise(() => plain.companionInstalled())).toBe(
        true,
      );
      expect(yield* Effect.promise(() => plain.listProfiles())).toEqual([
        { name: "Research", dir: "/profile", isDefault: true },
      ]);
      const stopLate = plain.subscribe(() => received.push("late"));
      const lateEvents = (
        ["changed", "data-dir-changed", "resolved-changed"] as const
      ).map((event) => plain.on(event, () => received.push(event)));
      stopLate();
      for (const stop of lateEvents) stop();
      unsubscribe();
      stopEvent();
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
      const unsubscribe = plain.subscribe((next) => {
        received.push(next.dataDir);
        if (received.length === 1) throw new Error("listener failed");
        if (next.dataDir === "/library-two")
          run(Queue.offer(delivered, undefined));
      });
      plain.setDataDir("/library-one");
      plain.setDataDir("/library-two");
      yield* Queue.take(delivered);
      unsubscribe();
      expect(received).toEqual(["/library-one", "/library-two"]);
    }),
);

// Failure modes: the adapter returns an Effect instead of a Promise, misses a
// change immediately after subscribing, or calls an unsubscribed listener.
it.effect("provides plain reads, Promises, and cancellable subscriptions", () =>
  Effect.gen(function* () {
    const f = yield* zoteroPrefFixture((path) =>
      Effect.succeed(
        path.endsWith("extensions.json")
          ? '{"addons":[{"id":"zotlit@aidenlx.site","active":true}]}'
          : "",
      ),
    );
    yield* Stream.runHead(
      Stream.filter(f.pref.changes, (s) => s.state === "ready"),
    );
    const plain = plainZoteroPref(f.runtime);
    const received: string[] = [];
    const delivered = yield* Queue.unbounded<void>();
    const run = Effect.runSyncWith(yield* Effect.context<never>());
    const unsubscribe = plain.subscribe((next) => {
      received.push(next.dataDir);
      run(Queue.offer(delivered, undefined));
    });
    plain.setDataDir("/library-one");
    yield* Queue.take(delivered);
    unsubscribe();
    plain.setDataDir("/library-two");
    expect(plain.dataDirOverride).toBe("/library-two");
    const installed = plain.companionInstalled();
    expect(installed).toBeInstanceOf(Promise);
    expect(yield* Effect.promise(() => installed)).toBe(true);
    expect(yield* Effect.promise(() => plain.listProfiles())).toEqual([]);
    expect(received).toEqual(["/library-one"]);
  }),
);

// Failure modes: profile reload fails to notify old consumers, or the compatibility
// events confuse a profile read with a data-directory Device Override.
it.effect(
  "maps preference reads and Device Overrides to compatibility events",
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
        plain.on("changed", () => events.push("prefs")),
        plain.on("data-dir-changed", () => events.push("data")),
        plain.on("resolved-changed", () => {
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
      expect(events).toEqual(["prefs", "data"]);
      plain.setDataDir("/override");
      plain.setProfileDir("/another-profile");
      yield* TestClock.adjust("1 second");
      yield* Queue.take(resolved);
      expect(events).toEqual(["prefs", "data", "prefs"]);
      expect(plain.resolvedProfileDir).toBe("/another-profile");
    }),
);
