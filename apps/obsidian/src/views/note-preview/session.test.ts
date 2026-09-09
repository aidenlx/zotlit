import { afterEach, describe, expect, it, vi } from "vitest";

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

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { nativeResult } from "./render";
import type { NativeRenderResult } from "./render";
import { NativePreviewSession } from "./session";

afterEach(() => vi.useRealTimers());

/** The scheduler the Profile Editor holds, with the renders it drove recorded. */
function scheduling(live: boolean) {
  const render = vi.fn((request: RenderRequest) =>
    Promise.resolve<NativeRenderResult>(
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
    using session = new NativePreviewSession(
      fixture.deps,
      scheduler,
      store.getState().item,
    );
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
      example: null,
    });
  });

  it("hands the loaded paper and annotation example to the scheduler", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const { render, store, scheduler } = scheduling(true);
    using session = new NativePreviewSession(
      fixture.deps,
      scheduler,
      store.getState().item,
    );
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
    using session = new NativePreviewSession(
      fixture.deps,
      scheduler,
      store.getState().item,
    );
    await vi.advanceTimersByTimeAsync(0);
    {
      using lease = await fixture.deps.db.acquireRead();
      lease.client.$client.exec(
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
  it("distinguishes a failed load from a valid Item with no annotations and retries explicitly", async () => {
    await using fixture = await createRenderFixture();
    const { scheduler } = scheduling(false);
    using _scheduler = scheduler;
    {
      using lease = await fixture.deps.db.acquireRead();
      lease.client.$client.exec(
        "delete from itemAnnotations; delete from items where itemID = 3",
      );
    }
    vi.spyOn(fixture.deps.db, "acquireRead").mockRejectedValueOnce(
      new Error("Database offline"),
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      id: "MAIN2345",
      title: null,
    });
    expect(session.state.getState().status).toBe("loading");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "error",
      error: "Database offline",
      snapshot: null,
    });
    session.refresh();
    await session.ready;
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
    const acquire = fixture.deps.db.acquireRead.bind(fixture.deps.db);
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
    vi.spyOn(fixture.deps.db, "acquireRead").mockImplementationOnce(
      () => pending.promise,
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      id: "MAIN2345",
      title: null,
    });
    const firstRead = session.ready;
    session.setItem({ id: "ABCD2345", title: null });
    await session.ready;
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
    const acquire = fixture.deps.db.acquireRead.bind(fixture.deps.db);
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof acquire>>>();
    vi.spyOn(fixture.deps.db, "acquireRead").mockImplementationOnce(
      () => pending.promise,
    );
    using session = new NativePreviewSession(fixture.deps, scheduler, {
      id: "MAIN2345",
      title: null,
    });
    const changed = vi.fn();
    session.state.subscribe(changed);
    session[Symbol.dispose]();
    pending.resolve(await acquire());
    await session.ready;
    expect(changed).not.toHaveBeenCalled();
    expect(session.state.getState().snapshot).toBeNull();
  });
});
