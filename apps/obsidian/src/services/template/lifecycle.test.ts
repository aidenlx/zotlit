import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import { Context, Effect, Fiber, Layer, Queue, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { ObsidianApp } from "@/lib/obsidian-app";
import { PluginSettings } from "@/services/settings/service";

import { createTemplateHost, templateOf, templateOver } from "./__fixtures__";
import { layerTemplateMigration } from "./migration";
import { plainTemplate, plainTemplateMigration } from "./plain";
import { Template } from "./service";

it.effect("#1705: a built Template exposes its first loaded template", () =>
  Effect.gen(function* () {
    const host = createTemplateHost({
      "templates/zotlit-note.liquid.md": "Loaded {{ zt.title }}",
    });
    const template = yield* templateOf(host);
    expect(yield* template.render("note", { title: "Paper" })).toBe(
      "Loaded Paper",
    );
  }),
);

it.effect(
  "#1705: subscribe receives consecutive reconciliations and stops on runtime disposal",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost({
        "templates/zotlit-note.liquid.md": "First",
      });
      const stack = yield* acquireAsyncDisposable(
        async () => new AsyncDisposableStack(),
      );
      const context = yield* Effect.context<never>();
      const runtime = buildRuntime(
        templateOver(host).pipe(
          Layer.provideMerge(Layer.succeedContext(context)),
        ),
        stack,
      );
      yield* Effect.promise(() => runtime.context());
      const template = plainTemplate(runtime);
      const received = yield* Queue.unbounded<void>();
      const unsubscribe = template.subscribe(() => {
        Queue.offerUnsafe(received, undefined);
      });
      const both = template.refresh().then(() => template.refresh());
      yield* Effect.promise(() => both);
      yield* Queue.take(received);
      yield* Queue.take(received);
      unsubscribe();
      yield* Effect.promise(() => runtime.dispose());
      expect(template.render("note", {})).toBe("First");
      expect(yield* Effect.promise(() => template.waitUntilSettled(500))).toBe(
        "settled",
      );
      const afterClose = template.subscribe(() => {
        throw new Error("closed subscriber");
      });
      host.vault.modifyFile("templates/zotlit-note.liquid.md", "After close");
      yield* TestClock.adjust(500);
      expect(template.render("note", {})).toBe("First");
      afterClose();
    }),
);

it.effect("#1705: published vault edits reconcile on the Effect Clock", () =>
  Effect.gen(function* () {
    const host = createTemplateHost({
      "templates/zotlit-note.liquid.md": "Before",
    });
    const template = yield* templateOf(host);
    host.vault.modifyFile("templates/zotlit-note.liquid.md", "After");
    const settled = yield* template
      .waitUntilSettled(1000)
      .pipe(Effect.forkChild);
    yield* TestClock.adjust(500);
    expect(yield* Fiber.join(settled)).toBe("settled");
    expect(yield* template.render("note", {})).toBe("After");
  }),
);

it.effect("#1705: startup failure settles into the init-failed state", () =>
  Effect.gen(function* () {
    const host = createTemplateHost();
    vi.spyOn(host.vault, "on").mockImplementationOnce(() => {
      throw new Error("vault unavailable");
    });
    const template = yield* templateOf(host);
    expect(yield* template.loaded).toBe(false);
    expect(yield* template.waitUntilSettled(500)).toBe("init-failed");
  }),
);

it.effect(
  "#1705: runtime disposal waits for a document write that has started",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      const context = yield* Effect.context<never>();
      const stack = yield* acquireAsyncDisposable(
        async () => new AsyncDisposableStack(),
      );
      const runtime = buildRuntime(
        templateOver(host).pipe(
          Layer.provideMerge(Layer.succeedContext(context)),
        ),
        stack,
      );
      yield* Effect.promise(() => runtime.context());
      const template = plainTemplate(runtime);
      const started = yield* Queue.unbounded<void>();
      const writing = Promise.withResolvers<void>();
      const create = host.vault.create.bind(host.vault);
      vi.spyOn(host.vault, "create").mockImplementation(
        async (path, source) => {
          Queue.offerUnsafe(started, undefined);
          await writing.promise;
          return create(path, source);
        },
      );
      const created = template.createPartial("authors", { source: "Authors" });
      yield* Queue.take(started);
      let disposed = false;
      const closing = runtime.dispose().then(() => {
        disposed = true;
      });
      yield* TestClock.adjust(0);
      expect(disposed).toBe(false);
      writing.resolve();
      expect((yield* Effect.promise(() => created)).path).toBe(
        "templates/zotlit-partial.authors.md",
      );
      yield* Effect.promise(() => closing);
      expect(disposed).toBe(true);
      expect(
        host.vault.contents.get("templates/zotlit-partial.authors.md"),
      ).toBe("Authors");
    }),
);

it.effect(
  "#1705: migration ignores late layout callbacks and retains its released adapter surface",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost();
      const callbacks: (() => void)[] = [];
      host.workspace.onLayoutReady = (callback) => {
        callbacks.push(callback);
      };
      const openPrompt = vi.fn();
      const context = yield* Effect.context<never>();
      const stack = yield* acquireAsyncDisposable(
        async () => new AsyncDisposableStack(),
      );
      const runtime = buildRuntime(
        layerTemplateMigration({
          loadVerificationData: async () => null,
          openPrompt,
        }).pipe(
          Layer.provideMerge(templateOver(host)),
          Layer.provide(Layer.succeed(ObsidianApp, host.app)),
          Layer.provideMerge(Layer.succeedContext(context)),
        ),
        stack,
      );
      yield* Effect.promise(() => runtime.context());
      const migration = plainTemplateMigration(runtime);
      expect(callbacks).toHaveLength(1);
      yield* Effect.promise(() => runtime.dispose());
      host.vault.addFile("templates/zotlit-note.liquid.md", "Late inventory");
      for (const callback of callbacks) callback();
      yield* Effect.promise(() => migration.whenSettled());
      expect(openPrompt).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => migration.convert())).toMatchObject({
        outcome: "refused",
        diagnostic: { code: "no-legacy-templates" },
      });
      yield* Effect.promise(() =>
        expect(migration.retryCleanup()).rejects.toThrow(
          "Cleanup retry needs a completed conversion",
        ),
      );
    }),
);

it.effect("#1705: a later folder change supersedes a pending folder read", () =>
  Effect.gen(function* () {
    const host = createTemplateHost({
      "templates/zotlit-note.liquid.md": "Initial",
      "slow/zotlit-note.liquid.md": "Slow",
      "latest/zotlit-note.liquid.md": "Latest",
    });
    const services = yield* Layer.build(templateOver(host));
    const template = Context.get(services, Template);
    const settings = Context.get(services, PluginSettings);
    const started = yield* Queue.unbounded<void>();
    const slow = Promise.withResolvers<string>();
    const read = host.vault.cachedRead.getMockImplementation()!;
    host.vault.cachedRead.mockImplementation((file) => {
      if (file.path !== "slow/zotlit-note.liquid.md") return read(file);
      Queue.offerUnsafe(started, undefined);
      return slow.promise;
    });
    const changes = yield* Queue.unbounded<void>();
    yield* Stream.runForEach(template.changes, () =>
      Queue.offer(changes, undefined),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* settings.update({ "template.folder": "slow" });
    yield* Queue.take(started);
    yield* settings.update({ "template.folder": "latest" });
    yield* Queue.take(changes);
    expect(yield* template.render("note", {})).toBe("Latest");
    slow.resolve("Slow");
    expect(yield* template.waitUntilSettled(500)).toBe("settled");
    expect(yield* template.render("note", {})).toBe("Latest");
  }),
);
