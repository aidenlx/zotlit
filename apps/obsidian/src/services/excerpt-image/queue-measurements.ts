// Scheduling measurements for the shared PDF queue (ticket #1184, ADR 0052).
//
// The harness drives the production `ExcerptImageService` over a synthetic
// corpus and records what the queue decided: how many PDF documents were
// loaded, how many crops were rendered, how many requests were served from the
// cache, how long the batch took, when its first note finished, and how much
// memory it held. PDF work is modelled by a counting stand-in for the renderer
// (a document load per resident-document change, then a crop render per
// request); the cache is the same `ExcerptCache` interface the plugin's
// IndexedDB store implements. Wall times therefore measure the queue, not
// Chromium's rasterizer.

import { delay } from "./__fixtures__/delay";
import type { ExcerptImage } from "./format";
import { PNG_FORMAT } from "./format";
import type { ExcerptEntry, ExcerptRequest } from "./service";
import { ExcerptImageService } from "./service";

export interface BatchMeasurement {
  excerpts: number;
  /** Resident-document changes: one PDF parse each. */
  loads: number;
  /** Crop renders started. */
  renders: number;
  /** Requests served from the cache without PDF work. */
  hits: number;
  /** Wall time for the whole batch, in milliseconds. */
  totalMs: number;
  /** Wall time until the first note's own excerpts settled, in milliseconds. */
  firstNoteMs: number;
  peakRenders: number;
  peakAdmitted: number;
  peakHeapMiB: number;
  peakRssMiB: number;
}

export interface QueueMeasurements {
  corpus: {
    notes: number;
    annotationsPerNote: number;
    pdfs: number;
    excerpts: number;
    noteConcurrency: number;
    loadMs: number;
    cropMs: number;
  };
  cold: BatchMeasurement;
  /** The same corpus with each PDF's notes grouped, so affinity can reuse a load. */
  coldGrouped: BatchMeasurement;
  warm: BatchMeasurement;
  repeatedSinglePdf: BatchMeasurement;
  cacheHitWhileBlocked: { hitMs: number; renderStarted: boolean };
}

const bytes = new Uint8Array([1, 2, 3]);

/**
 * A counting stand-in for the PDF renderer's resident document session. PDF
 * work costs the queue wall time it actually spends: one modelled delay per
 * document load and one per crop render.
 */
class RendererStub {
  loads = 0;
  renders = 0;
  active = 0;
  peak = 0;
  #resident: string | undefined;

  constructor(
    readonly loadMs: number,
    readonly cropMs: number,
  ) {}

  readonly render = async (
    request: ExcerptRequest,
    signal: AbortSignal,
  ): Promise<ExcerptImage> => {
    const pdf = request.pdfPath ?? "";
    if (pdf !== this.#resident) {
      this.#resident = pdf;
      this.loads += 1;
      await delay(this.loadMs);
    }
    this.renders += 1;
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      await delay(this.cropMs);
      signal.throwIfAborted();
      return { bytes, format: PNG_FORMAT };
    } finally {
      this.active -= 1;
    }
  };
}

interface Memory {
  peakHeapMiB: number;
  peakRssMiB: number;
}

function sample(memory: Memory): void {
  const usage = process.memoryUsage();
  memory.peakHeapMiB = Math.max(memory.peakHeapMiB, usage.heapUsed / 2 ** 20);
  memory.peakRssMiB = Math.max(memory.peakRssMiB, usage.rss / 2 ** 20);
}

function memory(): Memory {
  const usage = process.memoryUsage();
  return {
    peakHeapMiB: usage.heapUsed / 2 ** 20,
    peakRssMiB: usage.rss / 2 ** 20,
  };
}

const request = (
  pdf: string,
  note: number,
  annotation: number,
): ExcerptRequest => ({
  annotation: {
    key: `PDF${pdf}-NOTE${note}-ANN${annotation}`,
    parentKey: `PDF${pdf}`,
    type: "image",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    lock: null,
    position: {
      kind: "pdf-rects",
      pageIndex: annotation,
      rects: [[10, 20, 80, 90]],
    },
  },
  source: { kind: "zotero-local-api", serverID: "measurements" },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: `PDF${pdf}`,
  pdfPath: `/corpus/pdf-${pdf}.pdf`,
  zoteroPngPath: null,
});

/** One measurement pass: notes run at the batch concurrency, each awaiting its own excerpts. */
async function pass(options: {
  entries: Map<string, ExcerptEntry>;
  notes: { pdf: string; index: number }[];
  annotationsPerNote: number;
  noteConcurrency: number;
  loadMs: number;
  cropMs: number;
}): Promise<BatchMeasurement> {
  const { entries, notes, annotationsPerNote, noteConcurrency } = options;
  const counter = new RendererStub(options.loadMs, options.cropMs);
  await using service = new ExcerptImageService({
    cache: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        entries.set(key, entry);
      },
    },
    stamp: async () => ({ size: 100, mtimeMs: 10 }),
    render: counter.render,
  });
  const peak = memory();
  const started = performance.now();
  let firstNoteMs = 0;
  let excerpts = 0;
  let hits = 0;
  let peakAdmitted = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < notes.length) {
      const note = notes[next++]!;
      const outcomes = await Promise.all(
        Array.from({ length: annotationsPerNote }, (_, annotation) =>
          service.resolve(request(note.pdf, note.index, annotation)),
        ),
      );
      if (!firstNoteMs) firstNoteMs = performance.now() - started;
      for (const outcome of outcomes) {
        if (outcome.kind !== "available") continue;
        excerpts += 1;
        if (outcome.provenance === "cache") hits += 1;
        peakAdmitted = Math.max(
          peakAdmitted,
          service.queueDiagnostics.admitted,
        );
        sample(peak);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(noteConcurrency, notes.length) }, worker),
  );

  return {
    excerpts,
    loads: counter.loads,
    renders: counter.renders,
    hits,
    totalMs: performance.now() - started,
    firstNoteMs,
    // Peaks are sampled as each excerpt settles, so they are lower bounds.
    peakRenders: counter.peak,
    peakAdmitted,
    peakHeapMiB: peak.peakHeapMiB,
    peakRssMiB: peak.peakRssMiB,
  };
}

/**
 * Record one cold batch, the same batch warm, a repeated single-PDF batch, and
 * the latency of a cache hit taken while a crop render is blocked.
 */
export async function runQueueMeasurements(): Promise<QueueMeasurements> {
  const loadMs = 40;
  const cropMs = 12;
  const pdfs = 6;
  const notesPerPdf = 4;
  const annotationsPerNote = 3;
  const noteConcurrency = 16;
  const notes = Array.from({ length: pdfs * notesPerPdf }, (_, index) => ({
    pdf: String(index % pdfs),
    index,
  }));
  // The same corpus, but every PDF's notes arrive together.
  const grouped = Array.from({ length: pdfs * notesPerPdf }, (_, index) => ({
    pdf: String(Math.floor(index / notesPerPdf)),
    index: index + 1000,
  }));
  const entries = new Map<string, ExcerptEntry>();
  const shared = {
    notes,
    annotationsPerNote,
    noteConcurrency,
    loadMs,
    cropMs,
  };

  const cold = await pass({ ...shared, entries });
  const coldGrouped = await pass({
    ...shared,
    notes: grouped,
    entries: new Map(),
  });
  // The same batch against the cache the cold pass left behind.
  const warm = await pass({ ...shared, entries });
  const repeatedSinglePdf = await pass({
    entries: new Map(),
    notes: Array.from({ length: 20 }, (_, index) => ({
      pdf: "shared",
      index: index + 100,
    })),
    annotationsPerNote: 1,
    noteConcurrency: 1,
    loadMs,
    cropMs,
  });

  // A cache hit taken while an unrelated crop render holds the PDF slot.
  const blocked = Promise.withResolvers<void>();
  const blockedStarted = Promise.withResolvers<void>();
  let renderStarted = false;
  await using blockedService = new ExcerptImageService({
    stamp: async () => ({ size: 100, mtimeMs: 10 }),
    render: async () => {
      renderStarted = true;
      blockedStarted.resolve();
      await blocked.promise;
      return { bytes, format: PNG_FORMAT };
    },
    cache: {
      get: async (key) => entries.get(key),
      put: async () => {},
    },
  });
  await blockedService.resolve(request("0", 0, 0));
  const rendering = blockedService.resolve(request("0", 1, 1));
  await blockedStarted.promise;
  const hitStarted = performance.now();
  await blockedService.resolve(request("0", 0, 0));
  const hitMs = performance.now() - hitStarted;
  blocked.resolve();
  await rendering;

  return {
    corpus: {
      notes: notes.length,
      annotationsPerNote,
      pdfs,
      excerpts: notes.length * annotationsPerNote,
      noteConcurrency,
      loadMs,
      cropMs,
    },
    cold,
    coldGrouped,
    warm,
    repeatedSinglePdf,
    cacheHitWhileBlocked: { hitMs, renderStarted },
  };
}
