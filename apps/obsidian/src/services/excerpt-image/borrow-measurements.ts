// Reader-borrow measurements for the shared excerpt cache (ticket #1188, ADR
// 0054).
//
// The harness drives the production `ExcerptImageService` and the production
// `ExcerptRenderer` over a corpus of real files, with a stand-in for the reader
// Obsidian would hold open. The revision proof is the real one: a borrowed
// document's own bytes are compared against a stable read of the file, and the
// document reads it pays are counted. What is modelled is the PDF work itself —
// a document load and a crop render each cost a stand-in a modelled delay —
// plus the canvas encode, which cannot exist in Node.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPdfJs } from "obsidian";
import { vi } from "vitest";

import { delay } from "./__fixtures__/delay";
import { sizedWebp } from "./__fixtures__/webp";
import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "./reader-borrow";
import { ExcerptImageService } from "./service";
import type { ExcerptCache, ExcerptEntry, ExcerptRequest } from "./service";

/** What one pass over a corpus did, as counts and as wall time. */
export interface ReaderPassMeasurement {
  excerpts: number;
  /** PDF.js document loads: one per parse of a file the excerpt code read itself. */
  loads: number;
  /** Crop renders started, borrowed or detached. */
  renders: number;
  /** Requests answered from the cache without PDF work. */
  hits: number;
  /** `getData()` reads taken from reader documents, one per revision proof. */
  documentBytes: number;
  /** Wall time for the whole pass, in milliseconds. */
  totalMs: number;
}

export interface ReaderMeasurements {
  corpus: {
    pdfs: number;
    excerptsPerPdf: number;
    excerpts: number;
    fileBytes: number;
    loadMs: number;
    cropMs: number;
  };
  /** The reader holds every PDF open, and its documents are current. */
  readerOpen: ReaderPassMeasurement;
  /** The same corpus with no reader open: every excerpt loads the file. */
  noReader: ReaderPassMeasurement;
  /** The same corpus requested again with the reader closed and the cache warm. */
  importAfterReader: ReaderPassMeasurement;
  /** The reader still holds the bytes one PDF had before it changed on disk. */
  changedOnDisk: ReaderPassMeasurement;
  /** One PDF's excerpts again, with its document already proven this process. */
  repeatedSinglePdf: ReaderPassMeasurement;
}

const PDFS = 3;
const EXCERPTS_PER_PDF = 4;
/** Small enough to read in microseconds, large enough to be a real file read. */
const FILE_BYTES = 64 * 1024;
const LOAD_MS = 40;
const CROP_MS = 12;

/** Deterministic file content per PDF, so a rewrite can differ in every byte. */
function content(pdf: number, marker = 0): Uint8Array {
  const bytes = new Uint8Array(FILE_BYTES);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = (pdf * 31 + index + marker) % 256;
  return bytes;
}

/** An empty cache: a pass that measures PDF work, not retention. */
function emptyCache(): ExcerptCache {
  return { get: async () => undefined, put: async () => undefined };
}

/** Counts every pass reads: what the corpus made the excerpt path do. */
interface Counters {
  loads: number;
  renders: number;
  documentBytes: number;
}

/** A canvas that encodes the size it is given, as the WebP fixture does. */
function canvasStub(): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({}),
    toBlob(callback: (blob: Blob) => void) {
      callback(
        new Blob([sizedWebp(this.width, this.height) as unknown as BlobPart]),
      );
    },
  };
  return canvas as unknown as HTMLCanvasElement;
}

/** The page a stand-in document answers, charged as one modelled crop. */
function pageStub(count: Counters): ExcerptCropPage & { cleanup(): boolean } {
  const renderTasks = new Set<unknown>();
  const page = {
    view: [0, 0, 612, 792],
    cleanup: () => true,
    getViewport: ({
      scale,
      offsetX = 0,
      offsetY = 0,
    }: {
      scale: number;
      offsetX?: number;
      offsetY?: number;
    }) => ({
      convertToViewportPoint: (x: number, y: number): [number, number] => [
        x * scale + offsetX,
        y * scale + offsetY,
      ],
    }),
    render: () => {
      count.renders += 1;
      const task = { promise: delay(CROP_MS), cancel: () => undefined };
      // PDF.js tracks every task it started on the page; the crop's own task is
      // the one the renderer may touch.
      renderTasks.add({ task, _useRequestAnimationFrame: true });
      return task;
    },
  };
  return Object.assign(page, {
    _intentStates: new Map([[1, { renderTasks }]]),
  }) as unknown as ExcerptCropPage & { cleanup(): boolean };
}

/**
 * The reader Obsidian would hold: one document per open PDF, holding the bytes
 * the reader loaded, and answering `getData()` with exactly those bytes.
 */
function readerStub(options: {
  paths: string[];
  bytes: Uint8Array[];
  count: Counters;
}): ExcerptReaderDocuments {
  const documents = new Map<string, BorrowedExcerptDocument>();
  for (const [index, path] of options.paths.entries()) {
    const loaded = options.bytes[index]!;
    const pages = pageStub(options.count);
    documents.set(path, {
      path,
      document: { name: `reader-document-${index}` },
      bytes: async () => {
        options.count.documentBytes += 1;
        return loaded;
      },
      page: async () => pages,
      current: () => true,
    });
  }
  return { borrow: (path) => documents.get(path) ?? null };
}

/** The PDF.js stand-in the detached path reaches: one modelled load per parse. */
function pdfLibraryStub(count: Counters) {
  const getDocument = vi.fn(() => {
    count.loads += 1;
    return {
      promise: delay(LOAD_MS).then(() => ({
        getPage: async (_pageNumber: number) => pageStub(count),
      })),
      destroy: async () => undefined,
    };
  });
  return async () => ({ getDocument });
}

/**
 * One pass: every excerpt of the corpus resolved once, counted and timed. The
 * service is created for the pass and disposed after it.
 */
async function pass(options: {
  service: () => ExcerptImageService;
  requests: ExcerptRequest[];
  count: Counters;
}): Promise<ReaderPassMeasurement> {
  const { requests, count } = options;
  const before = { ...count };
  await using service = options.service();
  const start = performance.now();
  const outcomes = await Promise.all(
    requests.map((request) => service.resolve(request)),
  );
  const totalMs = performance.now() - start;
  return {
    excerpts: requests.length,
    loads: count.loads - before.loads,
    renders: count.renders - before.renders,
    hits: outcomes.filter(
      (outcome) =>
        outcome.kind === "available" && outcome.provenance === "cache",
    ).length,
    documentBytes: count.documentBytes - before.documentBytes,
    totalMs: Math.round(totalMs * 10) / 10,
  };
}

/** Every reader-to-import pass, over a corpus built for this call. */
export async function runReaderMeasurements(): Promise<ReaderMeasurements> {
  const folder = await mkdtemp(join(tmpdir(), "zotlit-reader-measurements-"));
  const count: Counters = { loads: 0, renders: 0, documentBytes: 0 };
  const global = globalThis as { document?: unknown };
  const previousDocument = global.document;
  global.document = { createElement: canvasStub };
  vi.mocked(loadPdfJs).mockImplementation(pdfLibraryStub(count));
  try {
    const paths: string[] = [];
    const bytes: Uint8Array[] = [];
    for (let pdf = 0; pdf < PDFS; pdf++) {
      const path = join(folder, `paper-${pdf}.pdf`);
      const loaded = content(pdf);
      await writeFile(path, loaded);
      paths.push(path);
      bytes.push(loaded);
    }
    const stamps = new Map(
      await Promise.all(
        paths.map(async (path) => [path, await stat(path)] as const),
      ),
    );
    const stamp = async (path: string) => {
      const info = stamps.get(path);
      return { size: info?.size ?? 0, mtimeMs: info?.mtimeMs ?? 0 };
    };
    const requests: ExcerptRequest[] = paths.flatMap((path, pdf) =>
      Array.from({ length: EXCERPTS_PER_PDF }, (_, index) => ({
        annotation: {
          key: `ANNOT${pdf}${index}`,
          parentKey: `ATTACH0${pdf}`,
          type: "image" as const,
          color: null,
          comment: null,
          text: null,
          pageLabel: "1",
          sortIndex: "00000|000000|00000",
          tags: [],
          version: null,
          lock: null,
          position: {
            kind: "pdf-rects" as const,
            pageIndex: index,
            rects: [[10, 20, 80 + index, 90]],
          },
        },
        source: { kind: "zotero-local-api" as const, serverID: "SERVER" },
        sourceScope: "/zotero",
        libraryID: 1,
        attachmentKey: `ATTACH0${pdf}`,
        pdfPath: path,
        zoteroPngPath: null,
      })),
    );
    const readers = readerStub({ paths, bytes, count });
    const entries = new Map<string, ExcerptEntry>();
    const shared = {
      get: async (key: string) => entries.get(key),
      put: async (key: string, entry: ExcerptEntry) => {
        entries.set(key, entry);
      },
    };

    const readerOpen = await pass({
      service: () => new ExcerptImageService({ cache: shared, stamp, readers }),
      requests,
      count,
    });
    const noReader = await pass({
      service: () => new ExcerptImageService({ cache: emptyCache(), stamp }),
      requests,
      count,
    });
    const importAfterReader = await pass({
      service: () => new ExcerptImageService({ cache: shared, stamp }),
      requests,
      count,
    });
    // One PDF changed on disk while the reader still holds the bytes it had.
    await writeFile(paths[0]!, content(0, 1));
    const changedOnDisk = await pass({
      service: () =>
        new ExcerptImageService({ cache: emptyCache(), stamp, readers }),
      requests,
      count,
    });
    const repeatedSinglePdf = await pass({
      service: () =>
        new ExcerptImageService({ cache: emptyCache(), stamp, readers }),
      requests: requests.filter((request) => request.pdfPath === paths[1]),
      count,
    });

    return {
      corpus: {
        pdfs: PDFS,
        excerptsPerPdf: EXCERPTS_PER_PDF,
        excerpts: requests.length,
        fileBytes: FILE_BYTES,
        loadMs: LOAD_MS,
        cropMs: CROP_MS,
      },
      readerOpen,
      noReader,
      importAfterReader,
      changedOnDisk,
      repeatedSinglePdf,
    };
  } finally {
    global.document = previousDocument;
    vi.mocked(loadPdfJs).mockReset();
    await rm(folder, { recursive: true, force: true });
  }
}
