// The render seam: a crop drawn from the reader's own document once that
// document proves it holds the file's bytes, and from the file otherwise.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPdfJs } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { sizedWebp } from "./__fixtures__/webp";
import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "./reader-borrow";
import { ExcerptImageService, excerptKey } from "./service";
import type { ExcerptEntry, ExcerptRequest } from "./service";

vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  loadPdfJs: vi.fn(),
}));

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(loadPdfJs).mockReset();
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** The file the reader shows, and the bytes a matching document answers. */
const PDF_BYTES = new Uint8Array([1, 2, 3, 4]);
const OTHER_BYTES = new Uint8Array([9, 9, 9, 9]);

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
    type: "image",
    color: null,
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    position: { kind: "pdf-rects", pageIndex: 1, rects: [[10, 20, 80, 90]] },
  },
  source: { kind: "zotero-local-api", serverID: "SERVER" },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: "ATTACH01",
  pdfPath: "",
  zoteroPngPath: null,
};

/** A PDF.js page proxy whose render task the test holds open or fails. */
function cropPage(
  options: {
    /** What a render task started on this page answers with. */
    task?: () => { promise: Promise<void>; cancel: () => void };
  } = {},
) {
  const tasks: { promise: Promise<void>; cancel: Mock }[] = [];
  // The reader's own render task for this page: excerpt work never touches it.
  const readerTask = { cancel: vi.fn(), promise: Promise.resolve() };
  const renderTasks = new Set<unknown>([
    { task: readerTask, _useRequestAnimationFrame: true },
  ]);
  const cleanup = vi.fn(() => true);
  const page = {
    view: [0, 0, 612, 792],
    cleanup,
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
      const started = options.task?.() ?? {
        promise: Promise.resolve(),
        cancel: () => undefined,
      };
      const task = { ...started, cancel: vi.fn(started.cancel) };
      tasks.push(task);
      // The crop's own task is the one scheduling is adjusted on; the reader's
      // task keeps its own flag.
      renderTasks.add({ task, _useRequestAnimationFrame: true });
      return task;
    },
  };
  return {
    page: Object.assign(page, {
      _intentStates: new Map([[1, { renderTasks }]]),
    }) as unknown as ExcerptCropPage & { cleanup: Mock },
    tasks,
    readerTask,
    cleanup,
  };
}

/** A canvas that encodes whatever size it is given, as the WebP fixture. */
function canvasFixture() {
  const canvases: {
    width: number;
    height: number;
    getContext: () => object;
    toBlob: (callback: (blob: Blob) => void) => void;
  }[] = [];
  const canvas = () => {
    const created = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob(callback: (blob: Blob) => void) {
        callback(
          new Blob([sizedWebp(this.width, this.height) as unknown as BlobPart]),
        );
      },
    };
    canvases.push(created);
    return created as unknown as HTMLCanvasElement;
  };
  return { canvas, canvases };
}

/** A page the detached path renders: the loader's own, cleanup and all. */
type LoadedCropPage = ExcerptCropPage & { cleanup: Mock };

/** The renderer's own path: a PDF.js library that counts its document loads. */
function detachedLibrary(options: { page?: () => LoadedCropPage } = {}) {
  const pages = vi.fn(async (_pageNumber: number) =>
    options.page ? options.page() : cropPage().page,
  );
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ getPage: pages }),
    destroy,
  }));
  const load = vi.fn(async () => ({ getDocument }));
  return { load, getDocument, pages, destroy };
}

/** The reader's document for the file, with the bytes it answers for itself. */
function readerDocument(options: {
  bytes: Uint8Array | null;
  page?: (pageIndex: number) => Promise<ExcerptCropPage | null>;
}) {
  const bytes = vi.fn(async () => options.bytes);
  const answered = cropPage();
  const page = vi.fn(options.page ?? (async () => answered.page));
  // Whether the reader still holds the document, until a test withdraws it.
  const current = vi.fn(() => true);
  const borrowed: Omit<BorrowedExcerptDocument, "path"> & { path: string } = {
    path: "",
    document: { name: "reader-document" },
    bytes,
    page,
    current,
  };
  const borrow = vi.fn(() => borrowed);
  const readers: ExcerptReaderDocuments = { borrow };
  return { readers, borrow, borrowed, bytes, page, answered, current };
}

/** A file two harnesses can share, so both resolutions read one revision. */
async function sharedPdf(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "zotlit-borrow-shared-"));
  folders.push(folder);
  const path = join(folder, "paper.pdf");
  await writeFile(path, PDF_BYTES);
  return path;
}

/**
 * One service over a real file, a cache in memory, and a fake canvas. The
 * renderer the service builds is the real one; only PDF.js and the canvas are
 * doubles, so a detached resolution is a genuine document load and a borrowed
 * one genuinely draws from the page the reader answers. The fixture disposes
 * the service it owns.
 */
async function harness(options: {
  reader?: (path: string) => ExcerptReaderDocuments;
  cache?: Map<string, ExcerptEntry>;
  /** The file to render, so two harnesses can share one revision. */
  path?: string;
  /** The page the detached path renders, when a test holds its crops open. */
  detachedPage?: () => LoadedCropPage;
}) {
  const cleanup = new AsyncDisposableStack();
  const folder = await mkdtemp(join(tmpdir(), "zotlit-borrow-crop-"));
  folders.push(folder);
  const pdfPath = options.path ?? join(folder, "paper.pdf");
  if (!options.path) await writeFile(pdfPath, PDF_BYTES);
  const entries = options.cache ?? new Map<string, ExcerptEntry>();
  const { canvas, canvases } = canvasFixture();
  const detached = detachedLibrary({ page: options.detachedPage });
  vi.stubGlobal("document", { createElement: canvas });
  vi.mocked(loadPdfJs).mockImplementation(detached.load);
  const service = cleanup.use(
    new ExcerptImageService({
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
      },
      // Every request's own file, so a harness can carry more than one PDF.
      stamp: async (path) => {
        const info = await stat(path);
        return { size: info.size, mtimeMs: info.mtimeMs };
      },
      readers: options.reader?.(pdfPath),
    }),
  );
  return {
    service,
    entries,
    canvases,
    detached,
    pdfPath,
    request: { ...request, pdfPath } satisfies ExcerptRequest,
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

/** A reader that holds the file, with the bytes its document answers with. */
function holdingReader(
  reader: ReturnType<typeof readerDocument>,
): (path: string) => ExcerptReaderDocuments {
  return (path) => {
    reader.borrowed.path = path;
    return reader.readers;
  };
}

it("crops from the reader's own document without loading another PDF", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  const outcome = await f.service.resolve(f.request);

  expect(outcome).toMatchObject({
    kind: "available",
    provenance: "rendered",
    freshness: "checked",
    format: { format: "webp" },
  });
  // No second document: the reader's own page supplied the crop.
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(reader.page.mock.calls).toEqual([[1]]);
  expect(reader.answered.cleanup).not.toHaveBeenCalled();
  expect(reader.borrow).toHaveBeenCalledExactlyOnceWith(f.pdfPath);
  expect(f.canvases).toHaveLength(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("owns its crop canvas and task alone", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  await f.service.resolve(f.request);

  expect(reader.answered.tasks).toHaveLength(1);
  expect(reader.answered.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(reader.answered.readerTask.cancel).not.toHaveBeenCalled();
});

it("selects the reader's document and publishes under the detached identity", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using borrowed = await harness({ reader: holdingReader(reader) });
  await using detached = await harness({});

  const fromReader = await borrowed.service.resolve(borrowed.request);
  const fromFile = await detached.service.resolve(detached.request);

  if (fromReader.kind !== "available" || fromFile.kind !== "available")
    throw new Error("both sources answer an available image");
  // Route selection, which is what this file's seams can answer: the reader's
  // own document renders the crop and no PDF is loaded for it, while the same
  // request without a reader loads the file once. Both publish under one
  // identity, so a later resolution finds either route's entry.
  //
  // The canvases here encode a fixed fixture and ignore every drawing call, so
  // the two routes' bytes compare equal whatever either route drew. Pixel
  // parity between the routes is established where a crop is really drawn and
  // decoded: `verifyReaderBackedExcerpts` in packages/e2e compares the decoded
  // borrowed and detached crops of one Fixture Annotation in the running app.
  expect(borrowed.detached.load).not.toHaveBeenCalled();
  expect(detached.detached.load).toHaveBeenCalledTimes(1);
  expect(fromReader.format).toEqual(fromFile.format);
  expect(fromReader.identity).toMatchObject({
    key: excerptKey(borrowed.request),
    fingerprint: fromFile.identity.fingerprint,
  });
  expect([...borrowed.entries.keys()]).toEqual([excerptKey(borrowed.request)]);
  expect([...detached.entries.keys()]).toEqual([excerptKey(detached.request)]);
});

it("serves a later resolution from the entry reader-backed work published", async () => {
  const shared = new Map<string, ExcerptEntry>();
  const path = await sharedPdf();
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using borrowed = await harness({
    cache: shared,
    path,
    reader: holdingReader(reader),
  });

  const fromReader = await borrowed.service.resolve(borrowed.request);

  // The import that follows finds the reader's crop already published: no
  // document load, and the identical entry.
  await using later = await harness({ cache: shared, path });
  const fromCache = await later.service.resolve(later.request);

  expect(fromCache).toMatchObject({ kind: "available", provenance: "cache" });
  expect(later.detached.load).not.toHaveBeenCalled();
  expect([...shared.keys()]).toEqual([excerptKey(borrowed.request)]);
  expect(shared.get(excerptKey(later.request))).toMatchObject({
    bytes: fromReader.kind === "available" ? fromReader.bytes : undefined,
    format: fromReader.kind === "available" ? fromReader.format : undefined,
  });
});

it.each([
  ["the document holds other bytes", "other-bytes"],
  ["no reader holds the file", "no-reader"],
  ["the reader closed before its page was read", "closed"],
  ["the document answers no bytes", "no-bytes"],
] as const)("renders from the file when %s", async (_case, kind) => {
  const reader = readerDocument({
    bytes:
      kind === "no-bytes"
        ? null
        : kind === "other-bytes"
          ? OTHER_BYTES
          : PDF_BYTES,
    page: kind === "closed" ? async () => null : undefined,
  });
  await using f = await harness({
    reader:
      kind === "no-reader"
        ? () => ({ borrow: () => null })
        : holdingReader(reader),
  });

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("renders from the file when a reader open before startup holds bytes the file no longer has", async () => {
  const path = await sharedPdf();
  // The reader's document was loaded before the plugin started, from the
  // revision the file held then. The file has since been rewritten at the same
  // length, so only the content proof can tell the two apart.
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ path, reader: holdingReader(reader) });
  await writeFile(path, OTHER_BYTES);

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(reader.page).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("watches a full batch of excerpts borrow the one proven document", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  for (const key of ["ANNOT001", "ANNOT002", "ANNOT003"])
    await f.service.resolve({
      ...f.request,
      annotation: { ...f.request.annotation, key },
    });

  expect(reader.bytes).toHaveBeenCalledTimes(1);
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(3);
});

it("generates the requested crop alone, and only once", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  await using f = await harness({ reader: holdingReader(reader) });

  await f.service.resolve({
    ...f.request,
    annotation: {
      ...f.request.annotation,
      position: { kind: "pdf-rects", pageIndex: 3, rects: [[1, 2, 3, 4]] },
    },
  });

  expect(reader.page.mock.calls).toEqual([[3]]);
  expect(f.canvases).toHaveLength(1);
});

it("renders from the file when the reader's page fails under the crop", async () => {
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () =>
      cropPage({
        task: () => ({
          promise: Promise.reject(new Error("Worker was destroyed")),
          cancel: () => undefined,
        }),
      }).page,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  expect(await f.service.resolve(f.request)).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  // One publication, from the file the borrow fell back to.
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("stops waiting on a borrowed byte read that never settles", async () => {
  const reader = readerDocument({ bytes: PDF_BYTES });
  const reading = Promise.withResolvers<Uint8Array | null>();
  reader.bytes.mockImplementation(() => reading.promise);
  await using f = await harness({ reader: holdingReader(reader) });
  const caller = new AbortController();

  const pending = f.service.resolve(f.request, caller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(reader.bytes).toHaveBeenCalledTimes(1));
  caller.abort();

  await rejected;
  // The reader's own read is not cancelled or cleaned up to end the wait, and
  // the render slot comes back at once instead of after a teardown that has to
  // give up on the unresolved render.
  await vi.waitFor(() =>
    expect(f.service.queueDiagnostics).toMatchObject({
      rendering: 0,
      queued: 0,
    }),
  );
  expect(reader.page).not.toHaveBeenCalled();
  expect(f.detached.load).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(0);
});

it("reads the file when the reader replaces its document while the page is resolving", async () => {
  const reading = Promise.withResolvers<ExcerptCropPage | null>();
  const withdrawn = cropPage();
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: () => reading.promise,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const pending = f.service.resolve(f.request);
  await vi.waitFor(() => expect(reader.page).toHaveBeenCalledTimes(1));
  // The reader swaps its document while that page read is in flight.
  reader.current.mockReturnValue(false);
  reading.resolve(withdrawn.page);

  expect(await pending).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  // The withdrawn page was never drawn from, and the file supplied the one
  // publication.
  expect(withdrawn.tasks).toHaveLength(0);
  expect(withdrawn.cleanup).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("reads the file when the reader replaces its document while the crop draws", async () => {
  const gate = Promise.withResolvers<void>();
  const held = cropPage({
    task: () => ({ promise: gate.promise, cancel: () => undefined }),
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => held.page,
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const pending = f.service.resolve(f.request);
  await vi.waitFor(() => expect(held.tasks).toHaveLength(1));
  // The reader swaps its document under the crop, which goes on to finish.
  reader.current.mockReturnValue(false);
  gate.resolve();

  expect(await pending).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  // One publication, from the file: the withdrawn page's finished image was
  // not it, and nothing of the reader's own task was cancelled for it.
  expect(held.readerTask.cancel).not.toHaveBeenCalled();
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()]).toEqual([excerptKey(f.request)]);
});

it("cancels a borrowed crop when its caller aborts, and publishes nothing", async () => {
  const held = cropPage({
    task: () => ({
      promise: Promise.withResolvers<void>().promise,
      cancel: () => undefined,
    }),
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => held.page,
  });
  await using f = await harness({ reader: holdingReader(reader) });
  const caller = new AbortController();
  const pending = f.service.resolve(f.request, caller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(held.tasks).toHaveLength(1));

  caller.abort();

  await rejected;
  expect(held.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(held.readerTask.cancel).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(0);
  expect(f.detached.load).not.toHaveBeenCalled();
});

it("admits borrowed crops through the shared queue, one at a time", async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const renders: string[] = [];
  const first = cropPage({
    task: () => {
      renders.push("first");
      started.resolve();
      return { promise: gate.promise, cancel: () => undefined };
    },
  });
  const second = cropPage({
    task: () => {
      renders.push("second");
      return { promise: Promise.resolve(), cancel: () => undefined };
    },
  });
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async (pageIndex) => (pageIndex === 1 ? first.page : second.page),
  });
  await using f = await harness({ reader: holdingReader(reader) });

  const held = f.service.resolve(f.request);
  await started.promise;
  const queued = f.service.resolve({
    ...f.request,
    annotation: {
      ...f.request.annotation,
      key: "ANNOT002",
      position: { kind: "pdf-rects", pageIndex: 2, rects: [[10, 20, 80, 90]] },
    },
  });

  expect(renders).toEqual(["first"]);
  gate.resolve();
  expect(await held).toMatchObject({ kind: "available" });
  expect(await queued).toMatchObject({ kind: "available" });
  expect(renders).toEqual(["first", "second"]);
  expect(f.detached.load).not.toHaveBeenCalled();
});

it("gives a waiting PDF its turn after four borrowed crops of another", async () => {
  const pathA = await sharedPdf();
  const pathB = await sharedPdf();
  const started: string[] = [];
  const gates: (() => void)[] = [];
  // Every crop holds the one render slot until the test hands it back, so the
  // queue's own order — not the speed of a crop — decides what starts next.
  const heldCrop = (label: string) =>
    cropPage({
      task: () => {
        started.push(label);
        const { promise, resolve } = Promise.withResolvers<void>();
        gates.push(resolve);
        return { promise, cancel: () => undefined };
      },
    }).page;
  const reader = readerDocument({
    bytes: PDF_BYTES,
    page: async () => heldCrop("borrowed"),
  });
  await using f = await harness({
    path: pathA,
    reader: (path) => {
      reader.borrowed.path = path;
      return { borrow: (asked) => (asked === path ? reader.borrowed : null) };
    },
    detachedPage: () => heldCrop("detached"),
  });
  const requests = [
    ...Array.from({ length: 5 }, (_, index) => ({
      ...f.request,
      annotation: { ...f.request.annotation, key: `ANNOT00${index}` },
    })),
    {
      ...f.request,
      attachmentKey: "ATTACH02",
      pdfPath: pathB,
      annotation: { ...f.request.annotation, key: "ANNOTB01" },
    },
  ];

  const jobs = requests.map((request) => f.service.resolve(request));
  // Every crop is waiting in the one shared render queue before any settles.
  await vi.waitFor(() =>
    expect(f.service.queueDiagnostics).toMatchObject({
      rendering: 1,
      queued: 5,
    }),
  );
  // The doc the reader holds supplies four crops, then the PDF waiting behind
  // it — the one with no reader, rendering detached — takes the slot, and the
  // borrowed PDF finishes last.
  const order = [
    "borrowed",
    "borrowed",
    "borrowed",
    "borrowed",
    "detached",
    "borrowed",
  ];
  for (const [index, label] of order.entries()) {
    await vi.waitFor(() => expect(started).toHaveLength(index + 1));
    expect(started[index]).toBe(label);
    gates[index]!();
  }

  expect(await Promise.all(jobs)).toHaveLength(requests.length);
  expect(f.detached.load).toHaveBeenCalledTimes(1);
  expect([...f.entries.keys()].sort()).toEqual(requests.map(excerptKey).sort());
});
