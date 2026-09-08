import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
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
    preview: { live, mode: "create" },
  });
  const scheduler = createRenderScheduler({
    render,
    failed: nativeResult,
    controller: new WorkbenchDocumentController(PROFILE_SOURCE),
    store,
  });
  return { render, store, scheduler };
}

describe("native preview data", () => {
  it("loads paper data and publishes annotation choices while execution is on demand", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const { render, store, scheduler } = scheduling(false);
    using session = new NativePreviewSession(fixture.deps, scheduler, store);
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
    store.getState().setItem(null);
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
    using session = new NativePreviewSession(fixture.deps, scheduler, store);
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
    using session = new NativePreviewSession(fixture.deps, scheduler, store);
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
