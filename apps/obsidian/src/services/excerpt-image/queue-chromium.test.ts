import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";
import type { ChromiumQueueReport } from "./queue-chromium.browser-test";

/**
 * The queue's in-app half, in the same Chromium the plugin ships on: a window
 * Chromium minimizes (so the page is hidden and its timers are clamped), real
 * canvas crops, and the admitted bound under pressure. The PDF document and
 * rasterizer Obsidian owns are not part of it — see
 * docs/excerpt-image-queue-measurements.md.
 */
const MAX_COLD_BATCH_MS = 30_000;

it.skipIf(!testElectron)(
  "schedules real Chromium crop work under the admitted bound in a minimized window",
  async () => {
    // The trial throws on any failed check, so a returned report is the shape of
    // a complete run.
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "queue-chromium.browser-test.ts"),
      name: "excerptQueueTrial",
      marker: "EXCERPT_QUEUE_RESULT",
      minimized: true,
      timeoutMs: 120_000,
    })) as ChromiumQueueReport;

    expect(report.passed).toEqual([
      "cold batch of canvas crops",
      "cache hit while a render is blocked",
      "teardown before idle",
      "timers under background throttling",
    ]);
    // A minimized window is what makes this the in-app half rather than a second
    // Node run: Chromium reports the page hidden and clamps a 200 ms timer.
    expect(report.visibility).toBe("hidden");
    expect(report.throttledTimers.timerMs).toBeGreaterThanOrEqual(200);
    expect(report.throttledTimers.deadlineMs).toBeGreaterThanOrEqual(200);
    expect(report.cold.excerpts).toBe(130);
    expect(report.cold.renders).toBe(130);
    expect(report.cold.bytes).toBeGreaterThan(0);
    expect(report.cold.peakRenders).toBe(1);
    expect(report.cold.peakAdmitted).toBe(128);
    // The two producers past the bound waited instead of being refused.
    expect(report.cold.awaitingAtBurst).toBe(2);
    // The crop work does not run on timers, so throttling does not stall it.
    expect(report.cold.totalMs).toBeLessThan(MAX_COLD_BATCH_MS);
    expect(report.cacheHitWhileBlocked.answeredWhileBlocked).toBe(true);
    expect(report.teardown.order).toEqual(["teardown", "idle"]);
  },
  150_000,
);
