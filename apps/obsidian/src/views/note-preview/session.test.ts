import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import {
  failedRender,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type { RenderRequest } from "@zotlit/workbench/render";
import { createWorkbenchStore } from "@zotlit/workbench/ui";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { renderNativeProfile } from "./render";
import type { NativeRenderResult } from "./render";
import { NativePreviewSession } from "./session";

vi.mock("./render", async (original) => ({
  ...(await original<typeof import("./render")>()),
  renderNativeProfile: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(renderNativeProfile).mockReset();
});
function output(request: RenderRequest): NativeRenderResult {
  return {
    ...failedRender(renderIdentity(request), { code: "render-error" }),
    creationBody: request.source,
    diagnostics: [],
    sourcePath: "",
    citations: [],
    annotationCitations: [],
  };
}
function store(live = true) {
  return createWorkbenchStore({
    item: { id: "MAIN2345", title: "Better figures" },
    preview: { live, mode: "create" },
  });
}

describe("native preview scheduling", () => {
  it("loads paper data and publishes annotation choices while execution is on demand", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const view = store(false);
    using session = new NativePreviewSession(
      fixture.deps,
      new WorkbenchDocumentController(PROFILE_SOURCE),
      view,
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
    expect(renderNativeProfile).not.toHaveBeenCalled();
    view.getState().setItem(null);
    expect(session.state.getState()).toMatchObject({
      snapshot: null,
      current: [],
      example: null,
    });
  });

  it("waits for 300 ms of quiet after the last edit", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    vi.mocked(renderNativeProfile).mockImplementation(async (_, request) =>
      output(request),
    );
    const controller = new WorkbenchDocumentController(PROFILE_SOURCE);
    using session = new NativePreviewSession(fixture.deps, controller, store());
    await vi.advanceTimersByTimeAsync(299);
    expect(renderNativeProfile).not.toHaveBeenCalled();
    controller.setManifestKey("name", "Revised");
    await vi.advanceTimersByTimeAsync(299);
    expect(renderNativeProfile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(renderNativeProfile).toHaveBeenCalledOnce();
    expect(session.state.getState().result?.creationBody).toContain(
      "name: Revised",
    );
  });

  it("lets the in-flight render finish after Stop, then runs only on request", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const pending = Promise.withResolvers<NativeRenderResult>();
    let request!: RenderRequest;
    vi.mocked(renderNativeProfile).mockImplementationOnce((_, value) => {
      request = value;
      return pending.promise;
    });
    const view = store();
    const controller = new WorkbenchDocumentController(PROFILE_SOURCE);
    using session = new NativePreviewSession(fixture.deps, controller, view);
    await vi.advanceTimersByTimeAsync(300);
    expect(session.state.getState().busy).toBe(true);
    view.getState().setPreview({ live: false });
    session.pause();
    pending.resolve(output(request));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.getState()).toMatchObject({
      busy: false,
      result: { creationBody: PROFILE_SOURCE },
    });
    controller.setManifestKey("name", "Paused edit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(renderNativeProfile).toHaveBeenCalledOnce();
    vi.mocked(renderNativeProfile).mockImplementation(async (_, value) =>
      output(value),
    );
    await session.run();
    expect(renderNativeProfile).toHaveBeenCalledTimes(2);
    expect(session.state.getState().result?.creationBody).toContain(
      "name: Paused edit",
    );
  });

  it("drops a stale result after a new source has already rendered", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    const pending = Promise.withResolvers<NativeRenderResult>();
    let old!: RenderRequest;
    vi.mocked(renderNativeProfile)
      .mockImplementationOnce((_, request) => {
        old = request;
        return pending.promise;
      })
      .mockImplementation(async (_, request) => output(request));
    const controller = new WorkbenchDocumentController(PROFILE_SOURCE);
    using session = new NativePreviewSession(
      fixture.deps,
      controller,
      store(false),
    );
    await vi.advanceTimersByTimeAsync(0);
    const first = session.run();
    await vi.advanceTimersByTimeAsync(0);
    controller.setManifestKey("name", "New source");
    await session.run();
    const current = session.state.getState().result;
    pending.resolve(output(old));
    await first;
    expect(session.state.getState().result).toBe(current);
    expect(current?.creationBody).toContain("name: New source");
  });

  it("refreshes data and clears the old paper immediately while paused", async () => {
    await using fixture = await createRenderFixture();
    vi.useFakeTimers();
    using session = new NativePreviewSession(
      fixture.deps,
      new WorkbenchDocumentController(PROFILE_SOURCE),
      store(false),
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
    expect(renderNativeProfile).not.toHaveBeenCalled();
  });
});
