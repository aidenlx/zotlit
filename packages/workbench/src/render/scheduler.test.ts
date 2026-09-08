import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  SAMPLE_ANNOTATIONS,
  renderProfile,
} from "./index";
import { profileSourceRevision } from "./result";
import type { ProfileRenderResult } from "./result";
import { createRenderScheduler } from "./scheduler";
import type { RenderRequest } from "./scheduler";

const snapshot = SAMPLE_ITEMS[0]!;

/**
 * Stands in for the host renderer: each start records its request and hands
 * back the promise's own settlers, so a test decides when — or whether — a
 * result arrives.
 */
function fakeRenders() {
  const started: {
    request: RenderRequest;
    deliver: (result: ProfileRenderResult) => void;
    fail: (error: unknown) => void;
  }[] = [];
  return {
    started,
    render: (request: RenderRequest) =>
      new Promise<ProfileRenderResult>((deliver, fail) => {
        started.push({ request, deliver, fail });
      }),
  };
}

describe("createRenderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["selection", "refresh"])(
    "drops an old annotation result after %s without changing source or paper",
    async (change) => {
      const first = SAMPLE_ANNOTATIONS[0]!;
      const next = {
        ...first,
        id: change === "selection" ? "example:new" : first.id,
        revision: change === "refresh" ? "refreshed" : first.revision,
        root: { ...first.root, text: "Newest example" },
      };
      const renders = fakeRenders();
      const results: ProfileRenderResult[] = [];
      using scheduler = createRenderScheduler({
        render: renders.render,
        onResult: (result) => results.push(result),
      });
      scheduler.request({
        source: DEFAULT_PROFILE_SOURCE,
        snapshot,
        annotation: first,
      });
      vi.advanceTimersByTime(300);
      scheduler.request({
        source: DEFAULT_PROFILE_SOURCE,
        snapshot,
        annotation: next,
      });
      vi.advanceTimersByTime(300);
      renders.started[0]!.deliver(
        renderProfile(DEFAULT_PROFILE_SOURCE, snapshot, { annotation: first }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(0);
      renders.started[1]!.deliver(
        renderProfile(DEFAULT_PROFILE_SOURCE, snapshot, { annotation: next }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(results).toHaveLength(1);
      expect(results[0]!.annotation).toContain("Newest example");
    },
  );

  it("renders once the reader stops typing", async () => {
    const renders = fakeRenders();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      render: renders.render,
      onResult: (result) => results.push(result),
    });

    scheduler.request({ source: DEFAULT_PROFILE_SOURCE, snapshot });
    vi.advanceTimersByTime(299);
    expect(renders.started).toHaveLength(0);

    vi.advanceTimersByTime(1);
    renders.started[0]!.deliver(
      renderProfile(DEFAULT_PROFILE_SOURCE, snapshot),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("ioannidisWhyMost2005");
  });

  it("reads a render that threw as a render error against the same draft", async () => {
    const renders = fakeRenders();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      render: renders.render,
      onResult: (result) => results.push(result),
    });

    scheduler.run({ source: DEFAULT_PROFILE_SOURCE, snapshot });
    renders.started[0]!.fail(new Error("Liquid ran out of stack"));
    await vi.advanceTimersByTimeAsync(0);

    expect(results).toHaveLength(1);
    expect(results[0]!.diagnostics).toEqual([
      {
        code: "render-error",
        message: "Liquid ran out of stack",
        part: "render",
      },
    ]);
    expect(results[0]!.sourceRevision).toBe(
      profileSourceRevision(DEFAULT_PROFILE_SOURCE),
    );
  });

  it("drops a result the reader has already typed past", async () => {
    const renders = fakeRenders();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      render: renders.render,
      onResult: (result) => results.push(result),
    });
    const stale = `${DEFAULT_PROFILE_SOURCE}stale`;
    const fresh = `${DEFAULT_PROFILE_SOURCE}fresh`;

    scheduler.request({ source: stale, snapshot });
    vi.advanceTimersByTime(300);
    const staleRender = renders.started[0]!;

    scheduler.request({ source: fresh, snapshot });
    vi.advanceTimersByTime(300);

    staleRender.deliver(renderProfile(stale, snapshot));
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(0);

    renders.started[1]!.deliver(renderProfile(fresh, snapshot));
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
    expect(results[0]!.sourceRevision).toBe(profileSourceRevision(fresh));
  });
});

it("runs immediately and drops a stopped render even when the next request has the same identity", async () => {
  const renders = fakeRenders();
  const results: ProfileRenderResult[] = [];
  using scheduler = createRenderScheduler({
    render: renders.render,
    onResult: (result) => results.push(result),
  });
  const request = { source: DEFAULT_PROFILE_SOURCE, snapshot };
  scheduler.run(request);
  scheduler.run(request);
  renders.started[0]!.deliver(renderProfile(request.source, snapshot));
  await Promise.resolve();
  expect(results).toHaveLength(0);
  renders.started[1]!.deliver(renderProfile(request.source, snapshot));
  await Promise.resolve();
  expect(results).toHaveLength(1);
});
