// Batch-retention measurements for the shared Excerpt Image pipeline (#1185).
//
// The harness drives the production `ExcerptImageService` and the production
// `ExcerptOutcomeScope` over a synthetic batch corpus and records what the
// batch retention decided: how many requests reached the renderer, how many the
// retention answered, and how many encoded bytes it held at its peak. PDF work
// is modelled by a counting renderer stand-in; the persistent store is the same
// `ExcerptCache` interface the plugin's IndexedDB store implements.

import type { ExcerptImage } from "./format";
import { PNG_FORMAT } from "./format";
import { ExcerptOutcomeScope } from "./outcome-scope";
import type { ExcerptEntry, ExcerptRequest } from "./service";
import { ExcerptImageService } from "./service";

export interface BatchMeasurement {
  /** Notes the batch wrote. */
  notes: number;
  /** Excerpt requests those notes made. */
  requests: number;
  /** Distinct excerpts in the corpus. */
  distinct: number;
  /** Notes the batch ran at once. */
  concurrency: number;
  /** Crop renders the batch asked the PDF pipeline for. */
  renders: number;
  /** Requests the batch's retention answered. */
  hits: number;
  /** Lookups that found nothing to reuse. */
  misses: number;
  /** Records the retention held when the batch ended. */
  retained: number;
  /** Encoded bytes those records cost. */
  retainedBytes: number;
  /**
   * The most records the retention held when a note ended: entries are read at
   * note boundaries, so a peak reached and decayed inside one note group is
   * missed.
   */
  peakRetained: number;
  /** The most encoded bytes the retention held at once, as the scope tracked it. */
  peakRetainedBytes: number;
  /** Wall time for the whole batch, in milliseconds. */
  totalMs: number;
}

export interface BatchOutcomeMeasurements {
  corpus: {
    notes: number;
    excerptsPerNote: number;
    distinct: number;
    requests: number;
    bytesPerImage: number;
  };
  /** One retention for the batch, against a store that keeps what it is given. */
  repeated: BatchMeasurement;
  /** The same corpus with one retention per note instead of one per batch. */
  perNote: BatchMeasurement;
  /** The same corpus with one retention per note and a store that keeps nothing. */
  noPersistence: BatchMeasurement;
  /** The same corpus with one batch retention and a store that keeps nothing. */
  storeFailure: BatchMeasurement;
  /** The same as {@link storeFailure}, with every note in flight at once. */
  concurrent: BatchMeasurement;
  /** More distinct excerpts than the entry bound allows. */
  entryOverflow: BatchMeasurement;
  /** More distinct bytes than the byte bound allows. */
  byteBound: BatchMeasurement;
}

const MEASURED_BYTES = 3;
const ENTRY_OVERFLOW = 300;
const BYTE_BOUND_EXCERPTS = 200;
const BYTE_BOUND_IMAGE_BYTES = 192 * 1024;

const request = (key: string): ExcerptRequest => ({
  annotation: {
    key: `ANNOT${key}`,
    parentKey: `ATTACH${key}`,
    type: "image",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[10, 20, 80, 90]] },
  },
  source: { kind: "zotero-local-api", serverID: "measurements" },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: `ATTACH${key}`,
  pdfPath: `/corpus/pdf-${key}.pdf`,
  zoteroPngPath: null,
});

/** One measurement pass over `notes`, one excerpt key list apiece. */
async function pass(options: {
  notes: readonly (readonly string[])[];
  concurrency: number;
  bytesPerImage: number;
  /** One retention for the whole batch, or one per note when it is `false`. */
  shared: boolean;
  /** A store that refuses every write keeps no bytes of its own. */
  failWrites: boolean;
  limits?: { bytes?: number; entries?: number };
}): Promise<BatchMeasurement> {
  const bytes = new Uint8Array(options.bytesPerImage).fill(1);
  const image: ExcerptImage = { bytes, format: PNG_FORMAT };
  const entries = new Map<string, ExcerptEntry>();
  let renders = 0;
  await using service = new ExcerptImageService({
    cache: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        if (options.failWrites) throw new Error("store write failed");
        entries.set(key, entry);
      },
    },
    stamp: async () => ({ size: 100, mtimeMs: 10 }),
    render: async () => {
      renders += 1;
      return image;
    },
    read: async () => {
      throw new Error("no Zotero fallback");
    },
  });

  await using batch = options.shared
    ? new ExcerptOutcomeScope(options.limits)
    : undefined;
  const total: BatchMeasurement = {
    notes: options.notes.length,
    requests: 0,
    distinct: 0,
    concurrency: options.concurrency,
    renders: 0,
    hits: 0,
    misses: 0,
    retained: 0,
    retainedBytes: 0,
    peakRetained: 0,
    peakRetainedBytes: 0,
    totalMs: 0,
  };
  const seen = new Set<string>();
  let retained = 0;
  let retainedBytes = 0;
  const sample = (scope: ExcerptOutcomeScope) => {
    const counts = scope.diagnostics;
    total.peakRetained = Math.max(total.peakRetained, counts.retained);
    // The scope's own peak, not the size a note boundary happens to catch.
    total.peakRetainedBytes = Math.max(
      total.peakRetainedBytes,
      counts.peakBytes,
    );
  };

  const started = performance.now();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < options.notes.length) {
      const group = options.notes[next++]!;
      // A batch shares one retention; otherwise each note owns its own, as a
      // separate operation does in production.
      await using own = options.shared
        ? undefined
        : new ExcerptOutcomeScope(options.limits);
      const scope = batch ?? own!;
      await using operation = service.operation({ outcomes: scope });
      await Promise.all(group.map((key) => operation.resolve(request(key))));
      total.requests += group.length;
      for (const key of group) seen.add(key);
      const counts = scope.diagnostics;
      sample(scope);
      // One retention's counters are cumulative; a per-note retention starts
      // fresh for each note, so its totals are summed as each note ends.
      if (options.shared) {
        total.hits = counts.hits;
        total.misses = counts.misses;
      } else {
        total.hits += counts.hits;
        total.misses += counts.misses;
      }
      retained = counts.retained;
      retainedBytes = counts.bytes;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, options.notes.length) },
      worker,
    ),
  );
  total.totalMs = performance.now() - started;
  total.renders = renders;
  total.distinct = seen.size;
  // A per-note retention is released when its note ends, so only a batch's
  // retention is still holding records when the pass finishes.
  total.retained = options.shared ? retained : 0;
  total.retainedBytes = options.shared ? retainedBytes : 0;
  return total;
}

/** Notes that all ask for the first `distinct` excerpts of the corpus. */
function repeatedNotes(
  notes: number,
  perNote: number,
  distinct: number,
): string[][] {
  return Array.from({ length: notes }, (_, note) =>
    Array.from(
      { length: perNote },
      (_, index) => `e${(note + index) % distinct}`,
    ),
  );
}

/** `notes × perNote` requests over `distinct` excerpts, then the same again. */
function spreadNotes(notes: number, perNote: number): string[][] {
  const distinct = (notes * perNote) / 2;
  let next = 0;
  return Array.from({ length: notes }, () =>
    Array.from({ length: perNote }, () => `e${next++ % distinct}`),
  );
}

/**
 * Record one repeated-excerpt batch under four store/retention combinations,
 * then a corpus larger than the entry bound and one larger than the byte bound.
 */
export async function runBatchOutcomeMeasurements(): Promise<BatchOutcomeMeasurements> {
  const notes = 24;
  const excerptsPerNote = 3;
  const distinct = 12;
  // The counting passes write one note at a time, so every repeat is a request
  // the retention can answer rather than one the pending map already merged.
  const shared = {
    notes: repeatedNotes(notes, excerptsPerNote, distinct),
    concurrency: 1,
    bytesPerImage: MEASURED_BYTES,
  };

  return {
    corpus: {
      notes,
      excerptsPerNote,
      distinct,
      requests: notes * excerptsPerNote,
      bytesPerImage: MEASURED_BYTES,
    },
    repeated: await pass({ ...shared, shared: true, failWrites: false }),
    perNote: await pass({ ...shared, shared: false, failWrites: false }),
    noPersistence: await pass({ ...shared, shared: false, failWrites: true }),
    storeFailure: await pass({ ...shared, shared: true, failWrites: true }),
    // A concurrent batch merges its in-flight duplicates before they reach the
    // retention, so the same corpus renders the same count with fewer hits.
    concurrent: await pass({
      ...shared,
      concurrency: 16,
      shared: true,
      failWrites: true,
    }),
    // Twice as many requests as excerpts, so evicted records are asked for again.
    entryOverflow: await pass({
      notes: spreadNotes((ENTRY_OVERFLOW / 3) * 2, 3),
      concurrency: 4,
      bytesPerImage: MEASURED_BYTES,
      shared: true,
      failWrites: true,
    }),
    byteBound: await pass({
      notes: spreadNotes((BYTE_BOUND_EXCERPTS / 4) * 2, 4),
      concurrency: 4,
      bytesPerImage: BYTE_BOUND_IMAGE_BYTES,
      shared: true,
      failWrites: true,
    }),
  };
}
