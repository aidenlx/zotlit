import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, vi } from "vitest";

import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type { RenderRequest } from "@zotlit/workbench/render";
import {
  createRenderScheduler,
  createWorkbenchStore,
} from "@zotlit/workbench/ui";

import { makeViewRunner } from "@/lib/view-runner";
import { SAMPLE_ITEM_CHOICES } from "@/views/template-workbench/selection-data";

import {
  createRenderFixture,
  paperLoaded,
  PROFILE_SOURCE,
} from "./__fixtures__/render";
import { nativeResult } from "./render";
import type { NativeRenderResult } from "./render";
import { NativePreviewSession } from "./session";

afterEach(() => vi.useRealTimers());

/** The scheduler the Template Workbench holds, with the renders it drove recorded. */
function scheduling(live: boolean) {
  const render = vi.fn((request: RenderRequest) =>
    Effect.succeed<NativeRenderResult>(
      nativeResult({
        ...failedRender(renderIdentity(request), { code: "render-error" }),
        creationBody: request.source,
        diagnostics: [],
      }),
    ),
  );
  const store = createWorkbenchStore({
    item: { id: "MAIN2345", title: "Better figures" },
  });
  const scheduler = createRenderScheduler({
    render,
    run: Effect.runFork,
    failed: nativeResult,
    input: {
      source: PROFILE_SOURCE,
      snapshot: null,
      live,
      mode: "create",
    },
  });
  return { render, store, scheduler };
}

describe("native preview data", () => {
  it("loads paper data and publishes annotation choices while execution is on demand", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const { render, store, scheduler } = scheduling(false);
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: store.getState().item,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.getState().snapshot?.item.indexedKey).toBe("MAIN2345");
    expect(session.state.getState().current).toHaveLength(1);
    expect(session.state.getState().example?.root.text).toBe(
      "Use readable figures.",
    );
    session.select(SAMPLE_ANNOTATIONS[1]!.id);
    expect(session.state.getState().example?.id).toBe(
      SAMPLE_ANNOTATIONS[1]!.id,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(render).not.toHaveBeenCalled();
    session.setItem(null);
    expect(session.state.getState()).toMatchObject({
      snapshot: null,
      current: [],
      example: { id: "example:underline" },
      status: "empty",
    });
  });

  it("hands the loaded paper and annotation example to the scheduler", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const { render, store, scheduler } = scheduling(true);
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: store.getState().item,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(render).toHaveBeenCalledOnce();
    const request = render.mock.calls[0]![0];
    expect(request.snapshot.item.indexedKey).toBe("MAIN2345");
    expect(request.annotation?.root["text"]).toBe("Use readable figures.");
    expect(session.state.getState().snapshot).not.toBeNull();
    expect(scheduler.getState().result?.creationBody).toBe(PROFILE_SOURCE);
  });

  it("refreshes data and clears the old paper immediately while paused", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const { render, store, scheduler } = scheduling(false);
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: store.getState().item,
    });
    await vi.advanceTimersByTimeAsync(0);
    {
      fixture.client.$client.exec(
        "update itemDataValues set value = 'Updated figures' where valueID = 1",
      );
    }
    session.refresh();
    expect(session.state.getState().snapshot).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.getState().snapshot?.item.title).toBe(
      "Updated figures",
    );
    expect(render).not.toHaveBeenCalled();
  });
});

describe("native preview load boundaries", () => {
  it.each(SAMPLE_ITEM_CHOICES)(
    "loads $id without a database and retains its canonical selection",
    async (item) => {
      await using fixture = await createRenderFixture();
      const acquire = vi
        .spyOn(fixture.deps.zoteroReads, "acquireRead")
        .mockRejectedValue(new Error("Database offline"));
      const { scheduler } = scheduling(false);
      using _scheduler = scheduler;
      using session = new NativePreviewSession(fixture.deps, scheduler, {
        item,
      });
      await paperLoaded(session);
      expect(session.state.getState()).toMatchObject({
        item,
        status: "ready",
        snapshot: { provenance: { kind: "sample" } },
      });
      session.refresh();
      await paperLoaded(session);
      expect(session.state.getState().item?.id).toBe(item.id);
      expect(acquire).not.toHaveBeenCalled();
    },
  );

  it("renders an explicit built-in annotation without selecting a note Item", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const acquire = vi
      .spyOn(fixture.deps.zoteroReads, "acquireRead")
      .mockRejectedValue(new Error("Database offline"));
    const { render, scheduler } = scheduling(true);
    using _scheduler = scheduler;
    using session = new NativePreviewSession(fixture.deps, scheduler);
    await paperLoaded(session);
    await vi.advanceTimersByTimeAsync(300);
    expect(render).not.toHaveBeenCalled();
    expect(session.state.getState()).toMatchObject({
      item: null,
      snapshot: null,
      example: null,
      status: "empty",
    });
    session.select("example:underline");
    await vi.advanceTimersByTimeAsync(300);
    expect(render).toHaveBeenCalledOnce();
    const request = render.mock.calls[0]![0];
    expect(request.snapshot.item.indexedKey).toBe("CNPF226A");
    expect(request.annotation?.root.text).toBe(
      "Report the assumptions behind each result.",
    );
    expect(session.state.getState()).toMatchObject({
      item: null,
      snapshot: null,
      current: [],
      status: "empty",
      annotationId: "example:underline",
    });
    session.select(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(session.state.getState().example).toBeNull();
    expect(render).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("keeps an unavailable sample selection out of the database", async () => {
    await using fixture = await createRenderFixture();
    const acquire = vi.spyOn(fixture.deps.zoteroReads, "acquireRead");
    const { scheduler } = scheduling(false);
    using _scheduler = scheduler;
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: { id: "sample:removed", title: null },
    });
    await paperLoaded(session);
    expect(session.state.getState()).toMatchObject({
      status: "error",
      snapshot: null,
      item: { id: "sample:removed" },
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "keeps a sample current when an older database read later %ss",
    async (outcome) => {
      await using fixture = await createRenderFixture();
      const { scheduler } = scheduling(false);
      using _scheduler = scheduler;
      const acquire = fixture.deps.zoteroReads.acquireRead.bind(
        fixture.deps.zoteroReads,
      );
      const pending =
        Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
      vi.spyOn(fixture.deps.zoteroReads, "acquireRead").mockImplementationOnce(
        () => pending.promise,
      );
      using session = new NativePreviewSession(fixture.deps, scheduler, {
        item: { id: "MAIN2345", title: null },
      });
      const firstRead = paperLoaded(session);
      session.setItem({ id: "sample:book", title: null });
      await paperLoaded(session);
      if (outcome === "resolve") pending.resolve(await acquire());
      else pending.reject(new Error("Old database failed"));
      await firstRead;
      expect(session.state.getState()).toMatchObject({
        status: "ready",
        error: null,
        item: { id: "sample:book" },
        snapshot: { item: { title: "Thinking, fast and slow" } },
      });
      expect(scheduler.getState().result).toBeNull();
    },
  );

  it("distinguishes a failed load from a valid Item with no annotations and retries explicitly", async () => {
    await using fixture = await createRenderFixture();
    const { scheduler } = scheduling(false);
    using _scheduler = scheduler;
    {
      fixture.client.$client.exec(
        "delete from itemAnnotations; delete from items where itemID = 3",
      );
    }
    vi.spyOn(fixture.deps.zoteroReads, "acquireRead").mockRejectedValueOnce(
      new Error("Database offline"),
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: { id: "MAIN2345", title: null },
    });
    expect(session.state.getState().status).toBe("loading");
    await paperLoaded(session);
    expect(session.state.getState()).toMatchObject({
      status: "error",
      error: "Database offline",
      snapshot: null,
    });
    session.refresh();
    await paperLoaded(session);
    expect(session.state.getState().status).toBe("ready");
    expect(session.state.getState().current).toEqual([]);
    expect(session.state.getState().example?.id).toBe(
      SAMPLE_ANNOTATIONS[0]!.id,
    );
    expect(session.state.getState().snapshot?.item.indexedKey).toBe("MAIN2345");
  });

  it("discards an earlier Item read after a different Item becomes current", async () => {
    await using fixture = await createRenderFixture();
    const { scheduler } = scheduling(false);
    using _scheduler = scheduler;
    const acquire = fixture.deps.zoteroReads.acquireRead.bind(
      fixture.deps.zoteroReads,
    );
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
    vi.spyOn(fixture.deps.zoteroReads, "acquireRead").mockImplementationOnce(
      () => pending.promise,
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: { id: "MAIN2345", title: null },
    });
    const firstRead = paperLoaded(session);
    session.setItem({ id: "ABCD2345", title: null });
    await paperLoaded(session);
    expect(session.state.getState().status).toBe("error");
    pending.resolve(await acquire());
    await firstRead;
    expect(session.state.getState().snapshot).toBeNull();
    expect(session.state.getState().item?.id).toBe("ABCD2345");
    expect(session.state.getState().status).toBe("error");
    expect(scheduler.getState().result?.creationBody).toBeNull();
  });

  it("does not publish a pending Item read after closing", async () => {
    await using fixture = await createRenderFixture();
    const { scheduler } = scheduling(false);
    using _scheduler = scheduler;
    const acquire = fixture.deps.zoteroReads.acquireRead.bind(
      fixture.deps.zoteroReads,
    );
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
    vi.spyOn(fixture.deps.zoteroReads, "acquireRead").mockImplementationOnce(
      () => pending.promise,
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      item: { id: "MAIN2345", title: null },
    });
    const changed = vi.fn();
    session.state.subscribe(changed);
    expect(session.state.getState().snapshot).toBeNull();
    session[Symbol.dispose]();
    pending.resolve(await acquire());
    await paperLoaded(session);
    expect(changed).not.toHaveBeenCalled();
  });

  it.effect(
    "drops its wait for the paper when a partial preview is interrupted",
    () =>
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireDisposable(
          Effect.promise(() => createRenderFixture()),
        );
        const { scheduler } = scheduling(false);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => scheduler[Symbol.dispose]()),
        );
        const acquire = fixture.deps.zoteroReads.acquireRead.bind(
          fixture.deps.zoteroReads,
        );
        const pending =
          Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
        vi.spyOn(
          fixture.deps.zoteroReads,
          "acquireRead",
        ).mockImplementationOnce(() => pending.promise);
        const session = new NativePreviewSession(fixture.deps, scheduler, {
          item: { id: "MAIN2345", title: null },
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => session[Symbol.dispose]()),
        );
        const registry = fixture.deps.registry;
        const subscribe = registry.subscribe.bind(registry);
        const released = vi.fn();
        vi.spyOn(registry, "subscribe").mockImplementation((atom, listener) => {
          const unsubscribe = subscribe(atom, listener);
          return () => {
            released();
            unsubscribe();
          };
        });
        const runner = makeViewRunner(registry);
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => runner[Symbol.asyncDispose]()),
        );
        const render = yield* Effect.forkChild(
          Effect.ignore(
            runner.provide(session.renderPartial("summary", "note")),
          ),
        );
        yield* Effect.yieldNow;
        expect(registry.subscribe).toHaveBeenCalled();
        yield* Fiber.interrupt(render);
        expect(released).toHaveBeenCalled();
        pending.resolve(yield* Effect.promise(() => acquire()));
      }),
  );
});
