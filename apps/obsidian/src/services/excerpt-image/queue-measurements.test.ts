import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { runQueueMeasurements } from "./queue-measurements";

// The harness models PDF work with wall-time costs and samples process memory,
// so it runs only when asked; the normal suite never pays for it.
describe.runIf(process.env.ZOTLIT_QUEUE_MEASUREMENTS === "1")(
  "Excerpt PDF queue measurements",
  () => {
    it("records cold, warm, repeated-PDF, and blocked cache-hit scheduling", async () => {
      const record = await runQueueMeasurements();
      const serialized = JSON.stringify(record, null, 2);
      process.stdout.write(`${serialized}\n`);
      const out = process.env.ZOTLIT_QUEUE_MEASUREMENTS_OUT;
      if (out) await writeFile(out, `${serialized}\n`, "utf8");
      expect(record.cold.renders).toBe(record.corpus.excerpts);
      expect(record.cold.loads).toBeGreaterThan(0);
      expect(record.coldGrouped.renders).toBe(record.corpus.excerpts);
      // One PDF document is resident at a time, so no two crops overlap.
      expect(record.cold.peakRenders).toBe(1);
      expect(record.coldGrouped.peakRenders).toBe(1);
      expect(record.warm.renders).toBe(0);
      expect(record.warm.hits).toBe(record.corpus.excerpts);
      expect(record.repeatedSinglePdf.loads).toBe(1);
      expect(record.cacheHitWhileBlocked.renderStarted).toBe(true);
    }, 120_000);
  },
);
