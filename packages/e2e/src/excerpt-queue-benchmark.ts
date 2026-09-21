/**
 * Controlled cold/warm measurement for the shared excerpt queue.
 *
 * The desktop acceptance suite supplies the real Obsidian resolver, cache
 * clear operation, queue counters, and process-memory sampler. Keeping the
 * timing loop here makes the measurement reproducible without adding sleeps or
 * assuming a number of microtask turns.
 */

export interface ExcerptBenchmarkCounters {
  pdfDocumentLoads: number;
  cropRenders: number;
  cacheHits: number;
}

export interface ExcerptBenchmarkOutcome {
  kind: string;
  provenance?: string;
}

export interface ExcerptBenchmarkPhase {
  pdfs: number;
  totalMs: number;
  firstNoteMs: number | null;
  peakMemory: number | null;
  loads: number;
  renders: number;
  hits: number;
}

export interface ExcerptQueueBenchmark {
  cold: ExcerptBenchmarkPhase;
  warm: ExcerptBenchmarkPhase;
  limits: readonly string[];
  outcomes: readonly (readonly ExcerptBenchmarkOutcome[])[];
  warmOutcomes: readonly (readonly ExcerptBenchmarkOutcome[])[];
  /** The request corpus is reported so a run can be reproduced exactly. */
  requestCount: number;
  pdfCount: number;
}

export async function measureExcerptQueue<Request>(options: {
  notes: readonly (readonly Request[])[];
  pdfKey: (request: Request) => string;
  clear(): Promise<void>;
  resolve(request: Request): Promise<ExcerptBenchmarkOutcome>;
  counters(): ExcerptBenchmarkCounters;
  sampleMemory?(): Promise<number | null>;
}): Promise<ExcerptQueueBenchmark> {
  const { notes } = options;
  const pdfCount = new Set(notes.flatMap((note) => note.map(options.pdfKey)))
    .size;
  const requestCount = notes.reduce((count, note) => count + note.length, 0);

  await options.clear();
  const cold = await measurePhase(options, pdfCount);
  const outcomes = cold.outcomes;
  const warm = await measurePhase(options, pdfCount);
  return {
    cold: cold.phase,
    warm: warm.phase,
    limits: [
      "Peak memory is the supplied desktop process sample, not a renderer allocation trace.",
      "Timing includes the supplied resolver and persistence boundary on this host.",
      "The corpus, Obsidian, PDF.js, and Electron versions must accompany reported results.",
    ],
    outcomes,
    warmOutcomes: warm.outcomes,
    requestCount,
    pdfCount,
  };
}

async function measurePhase<Request>(
  options: {
    notes: readonly (readonly Request[])[];
    resolve(request: Request): Promise<ExcerptBenchmarkOutcome>;
    counters(): ExcerptBenchmarkCounters;
    sampleMemory?(): Promise<number | null>;
  },
  pdfs: number,
): Promise<{
  phase: ExcerptBenchmarkPhase;
  outcomes: readonly (readonly ExcerptBenchmarkOutcome[])[];
}> {
  const before = options.counters();
  const start = performance.now();
  let firstNoteMs: number | null = null;
  let peakMemory = (await options.sampleMemory?.()) ?? null;
  const outcomes = await Promise.all(
    options.notes.map(async (note) => {
      const result = await Promise.all(
        note.map((request) => options.resolve(request)),
      );
      if (firstNoteMs === null) firstNoteMs = performance.now() - start;
      const memory = (await options.sampleMemory?.()) ?? null;
      if (memory !== null)
        peakMemory =
          peakMemory === null ? memory : Math.max(peakMemory, memory);
      return result;
    }),
  );
  const after = options.counters();
  return {
    phase: {
      pdfs,
      totalMs: performance.now() - start,
      firstNoteMs,
      peakMemory,
      loads: after.pdfDocumentLoads - before.pdfDocumentLoads,
      renders: after.cropRenders - before.cropRenders,
      hits: after.cacheHits - before.cacheHits,
    },
    outcomes,
  };
}
