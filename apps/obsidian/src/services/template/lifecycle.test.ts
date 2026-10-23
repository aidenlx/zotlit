import { TestClock } from "effect/testing";
import { expect, expectTypeOf, vi } from "vitest";

import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Stream,
} from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { ObsidianApp } from "@/lib/obsidian-app";
import { PluginSettings } from "@/services/settings/service";

import { createTemplateHost, templateOf, templateOver } from "./__fixtures__";
import { layerTemplateMigration, TemplateMigration } from "./migration";
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
  "#1705: throwing listeners receive later reconciliations and stop on disposal",
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
      let changes = 0;
      const unsubscribe = template.subscribe(() => {
        Queue.offerUnsafe(received, undefined);
        if (++changes === 1) throw new Error("status listener failed");
      });
      const compiled = yield* Queue.unbounded<void>();
      let compilations = 0;
      const stopCompile = template.on("compile-status-changed", () => {
        Queue.offerUnsafe(compiled, undefined);
        if (++compilations === 1) throw new Error("compile listener failed");
      });
      yield* Queue.take(received);
      const both = template.refresh().then(() => template.refresh());
      yield* Effect.promise(() => both);
      yield* Queue.take(received);
      yield* Queue.take(received);
      yield* Queue.take(compiled);
      yield* Queue.take(compiled);
      stopCompile();
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
    yield* Stream.runForEach(template.compileEvents, () =>
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

it.effect("#1705: settlement includes an edit queued during a slow flush", () =>
  Effect.gen(function* () {
    const path = "templates/zotlit-note.liquid.md";
    const host = createTemplateHost({ [path]: "Initial" });
    const template = yield* templateOf(host);
    const started = yield* Queue.unbounded<void>();
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    host.vault.cachedRead
      .mockImplementationOnce(() => {
        Queue.offerUnsafe(started, undefined);
        return first.promise;
      })
      .mockImplementationOnce(() => {
        Queue.offerUnsafe(started, undefined);
        return second.promise;
      });
    host.vault.modifyFile(path, "First edit");
    yield* TestClock.adjust(500);
    yield* Queue.take(started);
    const settledRender = yield* template
      .waitUntilSettled(2000)
      .pipe(
        Effect.andThen(template.render("note", {})),
        Effect.forkChild({ startImmediately: true }),
      );
    host.vault.modifyFile(path, "Second edit");
    first.resolve("First edit");
    yield* TestClock.adjust(500);
    yield* Queue.take(started);
    second.resolve("Second edit");
    expect(yield* Fiber.join(settledRender)).toBe("Second edit");
  }),
);

it.effect.each(["loaded", "init-failed"] as const)(
  "#1705: late status subscribers receive the initial %s state",
  (state) =>
    Effect.gen(function* () {
      const host = createTemplateHost({
        "templates/zotlit-note.liquid.md": "{% unknown_tag %}",
      });
      if (state === "init-failed") {
        vi.spyOn(host.vault, "getFolderByPath").mockImplementationOnce(() => {
          throw new Error("initial scan failed");
        });
      }
      const template = yield* templateOf(host);
      const first = yield* template.changes.pipe(
        Stream.runHead,
        Effect.timeoutOption(10),
        Effect.forkChild,
      );
      yield* TestClock.adjust(10);
      const replay = Option.getOrThrow(
        Option.getOrThrow(yield* Fiber.join(first)),
      );
      expect(replay.state).toBe(state);
      if (state === "loaded")
        expect(replay.compileErrors.has("note")).toBe(true);
      else if (replay.state === "init-failed") {
        expect(replay.cause).toBeDefined();
      }
    }),
);

it.effect("#1705: a stalled source read does not block runtime disposal", () =>
  Effect.gen(function* () {
    const host = createTemplateHost({
      "templates/zotlit-note.liquid.md": "Loaded",
    });
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
    const stalled = Promise.withResolvers<string>();
    host.vault.cachedRead.mockImplementationOnce(() => {
      Queue.offerUnsafe(started, undefined);
      return stalled.promise;
    });
    const reading = template.getTemplateSource("note").catch(() => undefined);
    yield* Queue.take(started);
    const closing = runtime.dispose();
    const disposed = yield* Effect.promise(() => closing).pipe(
      Effect.timeoutOption(10),
      Effect.forkChild,
    );
    yield* TestClock.adjust(10);
    const result = yield* Fiber.join(disposed);
    stalled.resolve("Late source");
    yield* Effect.promise(() => Promise.all([closing, reading]));
    expect(result).toMatchObject({ _tag: "Some" });
  }),
);

it.effect(
  "#1705: Template keeps tagged render, conversion, and vault failures",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost({
        "templates/zotlit-note.eta.md": "Inert",
        "templates/zotlit-filename.liquid.md": "Title",
      });
      const template = yield* templateOf(host);
      expectTypeOf<
        Effect.Error<ReturnType<typeof template.render>>
      >().toExtend<{ readonly _tag: string }>();
      expect(yield* Effect.flip(template.render("missing", {}))).toMatchObject({
        _tag: "TemplateError",
        templateName: "missing",
      });
      expect(
        yield* Effect.flip(
          template.convertLegacyLiteratureNoteTemplates({
            note: {},
            filename: {},
          }),
        ),
      ).toMatchObject({
        _tag: "LegacyTemplateConversionError",
        code: "unsupported-legacy-template",
      });
      const cause = new Error("vault read failed");
      host.vault.cachedRead.mockRejectedValueOnce(cause);
      expect(
        yield* Effect.flip(template.getTemplateSource("filename")),
      ).toMatchObject({
        _tag: "TemplateOperationError",
        cause,
      });
    }),
);

it.effect(
  "#1705: TemplateMigration maps external failures with their cause",
  () =>
    Effect.gen(function* () {
      const host = createTemplateHost({
        "templates/zotlit-note.liquid.md": "Note",
      });
      const cause = new Error("verification data unavailable");
      const services = yield* Layer.build(
        layerTemplateMigration({
          loadVerificationData: async () => {
            throw cause;
          },
          openPrompt: () => {},
        }).pipe(
          Layer.provideMerge(templateOver(host)),
          Layer.provide(Layer.succeed(ObsidianApp, host.app)),
        ),
      );
      const migration = Context.get(services, TemplateMigration);
      expectTypeOf<
        Effect.Error<ReturnType<typeof migration.convert>>
      >().toExtend<{ readonly _tag: string }>();
      expect(yield* Effect.flip(migration.convert())).toMatchObject({
        _tag: "TemplateOperationError",
        cause,
      });
    }),
);
