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
 * Stands in for the Worker: each start records its request and hands back the
 * delivery callback, so a test decides when — or whether — a result arrives.
 */
function fakeWorkers() {
  const started: {
    request: RenderRequest;
    deliver: (result: ProfileRenderResult) => void;
    terminated: boolean;
  }[] = [];
  return {
    started,
    startWorker: (
      request: RenderRequest,
      deliver: (result: ProfileRenderResult) => void,
    ) => {
      const entry = { request, deliver, terminated: false };
      started.push(entry);
      return {
        terminate: () => {
          entry.terminated = true;
        },
      };
    },
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
    (change) => {
      const first = SAMPLE_ANNOTATIONS[0]!;
      const next = {
        ...first,
        id: change === "selection" ? "example:new" : first.id,
        revision: change === "refresh" ? "refreshed" : first.revision,
        root: { ...first.root, text: "Newest example" },
      };
      const workers = fakeWorkers();
      const results: ProfileRenderResult[] = [];
      using scheduler = createRenderScheduler({
        startWorker: workers.startWorker,
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
      workers.started[0]!.deliver(
        renderProfile(DEFAULT_PROFILE_SOURCE, snapshot, { annotation: first }),
      );
      expect(results).toHaveLength(0);
      workers.started[1]!.deliver(
        renderProfile(DEFAULT_PROFILE_SOURCE, snapshot, { annotation: next }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.annotation).toContain("Newest example");
    },
  );

  it("renders once the reader stops typing", () => {
    const workers = fakeWorkers();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      startWorker: workers.startWorker,
      onResult: (result) => results.push(result),
    });

    scheduler.request({ source: DEFAULT_PROFILE_SOURCE, snapshot });
    vi.advanceTimersByTime(299);
    expect(workers.started).toHaveLength(0);

    vi.advanceTimersByTime(1);
    workers.started[0]!.deliver(
      renderProfile(DEFAULT_PROFILE_SOURCE, snapshot),
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("ioannidisWhyMost2005");
  });

  it("terminates a runaway render at the deadline and renders the next one", () => {
    const workers = fakeWorkers();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      startWorker: workers.startWorker,
      onResult: (result) => results.push(result),
      deadlineMs: 1000,
    });

    scheduler.request({ source: "{% forever %}", snapshot });
    vi.advanceTimersByTime(300 + 1000);

    expect(workers.started[0]!.terminated).toBe(true);
    expect(results[0]!.diagnostics[0]).toMatchObject({
      code: "render-timeout",
    });

    scheduler.request({ source: DEFAULT_PROFILE_SOURCE, snapshot });
    vi.advanceTimersByTime(300);
    workers.started[1]!.deliver(
      renderProfile(DEFAULT_PROFILE_SOURCE, snapshot),
    );

    expect(results).toHaveLength(2);
    expect(results[1]!.creationBody).toContain(
      "# Why Most Published Research Findings Are False",
    );
  });

  it("drops a result the reader has already typed past", () => {
    const workers = fakeWorkers();
    const results: ProfileRenderResult[] = [];
    using scheduler = createRenderScheduler({
      startWorker: workers.startWorker,
      onResult: (result) => results.push(result),
    });
    const stale = `${DEFAULT_PROFILE_SOURCE}stale`;
    const fresh = `${DEFAULT_PROFILE_SOURCE}fresh`;

    scheduler.request({ source: stale, snapshot });
    vi.advanceTimersByTime(300);
    const staleWorker = workers.started[0]!;

    scheduler.request({ source: fresh, snapshot });
    vi.advanceTimersByTime(300);

    staleWorker.deliver(renderProfile(stale, snapshot));
    expect(results).toHaveLength(0);

    workers.started[1]!.deliver(renderProfile(fresh, snapshot));
    expect(results).toHaveLength(1);
    expect(results[0]!.sourceRevision).toBe(profileSourceRevision(fresh));
  });
});
