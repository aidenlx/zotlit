import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Stream,
} from "@/lib/effect";
import { acquireDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import type { ProfileId } from "@/lib/profile-stamp";
import { createTemplateHost } from "@/services/template/__fixtures__";

import { profileOver, profileRuntimeOf } from "./__fixtures__";
import { Profile } from "./service";

it.effect("#1705: a built Profile exposes and replays its first registry", () =>
  Effect.gen(function* () {
    const host = createTemplateHost({
      "templates/zotlit-profile.books.md": `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
Books
--- zotlit:annotation ---
Annotation`,
    });
    const profile = Context.get(yield* Layer.build(profileOver(host)), Profile);
    expect(
      yield* profile.resolveProfile("Bk3Qn7XvT2Lp" as ProfileId),
    ).toMatchObject({ label: "Books" });
    const states = yield* Stream.runCollect(Stream.take(profile.changes, 1));
    expect(states[0]).toMatchObject({
      loaded: true,
      profiles: [{ label: "Books" }],
    });
  }),
);

it.effect(
  "#1705: a plain subscription attaches before two immediate settings changes",
  () =>
    Effect.gen(function* () {
      const { profile, settings } =
        yield* profileRuntimeOf(createTemplateHost());
      const received = yield* Queue.unbounded<string>();
      profile.subscribe((state) =>
        Queue.offerUnsafe(received, state.defaultDocumentPath),
      );
      settings.update({ "template.folder": "First" });
      settings.update({ "template.folder": "Second" });
      expect(yield* Queue.take(received)).toBe(
        "templates/zotlit-profile.default.md",
      );
      expect(yield* Queue.take(received)).toBe(
        "First/zotlit-profile.default.md",
      );
      expect(yield* Queue.take(received)).toBe(
        "Second/zotlit-profile.default.md",
      );
    }),
);

it.effect(
  "#1705: a late Profile subscriber sees Template startup failure",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      yield* acquireDisposable(() =>
        vi.spyOn(host.vault, "getFolderByPath").mockImplementationOnce(() => {
          throw new Error("Vault unavailable");
        }),
      );
      const profile = Context.get(
        yield* Layer.build(profileOver(host)),
        Profile,
      );
      const states = yield* Stream.runCollect(Stream.take(profile.changes, 1));
      expect(states[0]).toMatchObject({
        loaded: false,
        profiles: [],
        templateStatus: { state: "init-failed" },
      });
      expect(states[0]?.failure).toBeDefined();
      expect(
        yield* Effect.flip(profile.resolveProfile("default")),
      ).toMatchObject({ _tag: "ProfileOperationError" });
    }),
);

it.effect(
  "#1705: failed Template startup rejects Default restoration before touching the document",
  () =>
    Effect.gen(function* () {
      const path = "templates/zotlit-profile.default.md";
      const source = "The researcher's existing Default document";
      const host = createTemplateHost({ [path]: source });
      yield* acquireDisposable(() =>
        vi.spyOn(host.vault, "getFolderByPath").mockImplementationOnce(() => {
          throw new Error("Vault unavailable");
        }),
      );
      const { profile } = yield* profileRuntimeOf(host);
      expect(profile.loaded).toBe(false);
      yield* Effect.promise(() =>
        expect(profile.restoreDefault()).rejects.toThrow(),
      );
      expect(host.vault.contents.get(path)).toBe(source);
    }),
);

it.effect(
  "#1705: failed Template startup blocks Default creation through either write entry point",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      yield* acquireDisposable(() =>
        vi.spyOn(host.vault, "getFolderByPath").mockImplementationOnce(() => {
          throw new Error("Vault unavailable");
        }),
      );
      const { profile } = yield* profileRuntimeOf(host);
      yield* Effect.promise(() =>
        expect(profile.materializeDefault()).rejects.toThrow(),
      );
      yield* Effect.promise(() =>
        expect(profile.ejectDefault()).rejects.toThrow(),
      );
      expect([...host.vault.contents.keys()]).toEqual([]);
    }),
);

it.effect(
  "#1705: runtime disposal stops Profile listeners and retains the plain read surface",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      const { runtime, profile, settings } = yield* profileRuntimeOf(host);
      const received: unknown[] = [];
      const unsubscribe = profile.subscribe((state) => received.push(state));
      expect(received).toHaveLength(1);
      const source = yield* Effect.promise(() => profile.getSource("default"));
      const retained = profile.profiles;
      yield* Effect.promise(() => runtime.dispose());
      settings.update({ "template.folder": "Released" });
      host.vault.addFile("templates/zotlit-profile.late.md", source);
      yield* TestClock.adjust(500);
      expect(received).toHaveLength(1);
      expect(profile.profiles).toBe(retained);
      expect(profile.loaded).toBe(true);
      expect(profile.resolveProfile("default")).toBeDefined();
      expect(yield* Effect.promise(() => profile.getSource("default"))).toBe(
        source,
      );
      expect(
        (yield* Effect.promise(() => profile.prepareShare("default"))).manifest
          .name,
      ).toBe("Default");
      profile.subscribe(() => {
        throw new Error("late listener");
      })();
      profile.on("changed", () => {
        throw new Error("late event");
      })();
      unsubscribe();
    }),
);

it.effect(
  "#1705: runtime disposal waits for a Profile document write already started",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      const { runtime, profile } = yield* profileRuntimeOf(host);
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const create = host.vault.create.bind(host.vault);
      host.vault.create = async (...args) => {
        started.resolve();
        await release.promise;
        return create(...args);
      };
      const writing = profile.materializeDefault();
      yield* Effect.promise(() => started.promise);
      let closed = false;
      const closing = runtime.dispose().then(() => {
        closed = true;
      });
      expect(closed).toBe(false);
      release.resolve();
      yield* TestClock.adjust(500);
      expect(yield* Effect.promise(() => writing)).toMatchObject({
        created: true,
      });
      yield* Effect.promise(() => closing);
      expect(
        host.vault.contents.has("templates/zotlit-profile.default.md"),
      ).toBe(true);
    }),
);

it.effect.each(["read", "create", "duplicate"] as const)(
  "#1705: a stalled Profile source %s does not hold runtime disposal",
  (operation) =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      const { runtime, profile } = yield* profileRuntimeOf(host);
      const creating = profile.materializeDefault();
      yield* TestClock.adjust(500);
      yield* Effect.promise(() => creating);
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<string>();
      host.vault.cachedRead.mockImplementationOnce(() => {
        started.resolve();
        return release.promise;
      });
      const pending =
        operation === "read"
          ? profile.getSource("default")
          : operation === "create"
            ? profile.create({ label: "Late creation" })
            : profile.duplicate("default");
      const reading = pending.catch((error: unknown) => error);
      yield* Effect.promise(() => started.promise);
      yield* Effect.promise(() => runtime.dispose());
      expect(String(yield* Effect.promise(() => reading))).not.toContain(
        "ManagedRuntime disposed",
      );
      release.resolve(profile.getBuiltInSource());
      yield* TestClock.adjust(500);
      expect([...host.vault.contents.keys()]).toEqual([
        "templates/zotlit-profile.default.md",
      ]);
    }),
);

it.effect(
  "#1705: disposal cancels deletion waiting for the first note index",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost({
        "templates/zotlit-profile.books.md": `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
Books
--- zotlit:annotation ---
Annotation`,
      });
      const layouts: (() => void)[] = [];
      host.workspace.onLayoutReady = (callback) => {
        layouts.push(callback);
      };
      const { runtime, profile } = yield* profileRuntimeOf(host);
      const deleting = profile
        .delete("Bk3Qn7XvT2Lp" as ProfileId, "default")
        .catch((error: unknown) => error);
      const closing = runtime.dispose();
      const outcome = yield* Effect.promise(() => closing).pipe(
        Effect.timeoutOption(1),
        Effect.forkChild,
      );
      yield* TestClock.adjust(1);
      const closedBeforeLayout = Option.isSome(yield* Fiber.join(outcome));
      // Release the old implementation too, so a failing case can close cleanly.
      for (const callback of layouts) callback();
      yield* TestClock.adjust(500);
      yield* Effect.promise(() => deleting);
      yield* Effect.promise(() => closing);
      expect(closedBeforeLayout).toBe(true);
      expect(host.vault.contents.has("templates/zotlit-profile.books.md")).toBe(
        true,
      );
    }),
);
