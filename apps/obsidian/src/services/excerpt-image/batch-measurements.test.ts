import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { runBatchOutcomeMeasurements } from "./batch-measurements";

// ADR 0051 states the two limits as literals, so they are asserted as literals:
// taking them from the module under test would leave a changed default green.
const OUTCOME_ENTRIES = 256;
const OUTCOME_BYTES = 32 * 1024 * 1024;
/** The byte-bound corpus' image size, so "near the bound" has a scale. */
const BOUND_IMAGE_BYTES = 192 * 1024;

// The harness samples wall time and drives the production service over a
// synthetic corpus, so it runs only when asked.
describe.runIf(process.env.ZOTLIT_BATCH_MEASUREMENTS === "1")(
  "Excerpt batch retention measurements",
  () => {
    it("records repeated, per-note, store-failure, and bounded batches", async () => {
      const record = await runBatchOutcomeMeasurements();
      const serialized = JSON.stringify(record, null, 2);
      process.stdout.write(`${serialized}\n`);
      const out = process.env.ZOTLIT_BATCH_MEASUREMENTS_OUT;
      if (out) await writeFile(out, `${serialized}\n`, "utf8");
      const { requests, distinct } = record.corpus;
      // One request per distinct excerpt reaches the renderer: the retention
      // answers the rest.
      for (const measurement of [record.repeated, record.storeFailure]) {
        expect(measurement.renders).toBe(distinct);
        expect(measurement.hits).toBe(requests - distinct);
      }
      // Without a retention and without a store, every request renders.
      expect(record.noPersistence.renders).toBe(requests);
      expect(record.noPersistence.hits).toBe(0);
      // A store that keeps what it is given answers the repeats too.
      expect(record.perNote.renders).toBe(distinct);
      expect(record.perNote.retained).toBe(0);
      // The entry bound evicts, so an excerpt that left the retention renders
      // again: more renders than distinct excerpts.
      expect(record.entryOverflow.peakRetained).toBe(OUTCOME_ENTRIES);
      expect(record.entryOverflow.renders).toBeGreaterThan(
        record.entryOverflow.distinct,
      );
      // The byte-bound corpus fills the literal ceiling to within one image, so
      // this fails if the default, the corpus, or the accounting moves.
      expect(record.byteBound.peakRetainedBytes).toBeGreaterThan(
        OUTCOME_BYTES - BOUND_IMAGE_BYTES,
      );
      expect(record.byteBound.peakRetainedBytes).toBeLessThanOrEqual(
        OUTCOME_BYTES,
      );
      expect(record.byteBound.renders).toBeGreaterThan(
        record.byteBound.distinct,
      );
    }, 120_000);
  },
);
