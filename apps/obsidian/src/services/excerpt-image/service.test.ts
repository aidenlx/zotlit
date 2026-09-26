import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { abortable } from "@std/async/abortable";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DatabaseAnnotationSource } from "@/services/annotation-repository/service";

import { redPng, corruptPng } from "./__fixtures__/png";
import { PNG_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import { usePromiseScheduling } from "./renderer";
import {
  ExcerptImageService,
  excerptAnnotationRecord,
  excerptFingerprint,
  excerptKey,
  MAX_FALLBACK_BYTES,
} from "./service";
import type { ExcerptEntry, ExcerptIdentity, ExcerptRequest } from "./service";

/** Debug records the excerpt-image logger emits; read by the admission tests. */
let captured: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: {
      capture: (record: LogRecord) => {
        captured.push(record);
      },
    },
    loggers: [
      { category: ["zotlit"], sinks: ["capture"], lowestLevel: "debug" },
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
    ],
  });
});

beforeEach(() => {
  captured = [];
});

afterAll(() => resetSync());

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
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
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
    libraryID: 1,
    libraryRevision: 1,
  },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: "ATTACH01",
  pdfPath: "/paper.pdf",
  zoteroPngPath: "/fallback.png",
};
const generated: Uint8Array = new Uint8Array([1, 2, 3]);
const rendered: ExcerptImage = { bytes: generated, format: PNG_FORMAT };
const fallback = redPng;
const inkRequest: ExcerptRequest = {
  ...request,
  annotation: {
    ...request.annotation,
    type: "ink",
    position: {
      kind: "pdf-ink",
      pageIndex: 0,
      width: 2,
      paths: [[10, 20, 30, 40]],
    },
  },
};

function fixture() {
  const entries = new Map<string, ExcerptEntry>();
  const references = new Map<string, ExcerptIdentity>();
  let pdf = { size: 100, mtimeMs: 10 };
  const render = vi.fn(async () => rendered);
  const service = new ExcerptImageService({
    cache: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        entries.set(key, entry);
      },
      latest: async (identity) => references.get(identity),
      putLatest: async (identity, reference) => {
        references.set(identity, reference);
      },
      clear: async () => {
        entries.clear();
        references.clear();
      },
    },
    stamp: async () => pdf,
    render,
    read: async () => fallback,
  });
  return {
    service,
    entries,
    references,
    render,
    changePdf: () => {
      pdf = { size: 101, mtimeMs: 11 };
    },
  };
}

/**
 * One stored excerpt, then `count` distinct requests held open on a blocked
 * render, which fills the queue's admission bound.
 */
async function storedExcerptWithBlockedRenders(count: number) {
  const f = fixture();
  expect(await f.service.resolve(request)).toMatchObject({
    provenance: "rendered",
  });
  const gate = Promise.withResolvers<ExcerptImage>();
  const started = Promise.withResolvers<void>();
  f.render.mockImplementation(async () => {
    started.resolve();
    return gate.promise;
  });
  const pending = Array.from({ length: count }, (_, index) =>
    f.service.resolve({
      ...request,
      annotation: { ...request.annotation, key: `ANNOT${index}` },
    }),
  );
  await started.promise;
  return { ...f, pending, release: () => gate.resolve(rendered) };
}

describe("Excerpt Image resolution", () => {
  it.each(["truncated", "idat", "scanline"] as const)(
    "rejects %s fallback PNG data",
    async (kind) => {
      await using service = new ExcerptImageService({
        render: async () => {
          throw new Error("PDF unavailable");
        },
        read: async () => corruptPng(kind),
      });
      expect(await service.resolve(request)).toEqual({ kind: "unavailable" });
    },
  );
  it("waits at full capacity and renders the 129th request once a slot settles", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    const pending = Array.from({ length: 129 }, (_, index) =>
      service.resolve({
        ...request,
        annotation: { ...request.annotation, key: `ANNOT${index}` },
      }),
    );
    await started.promise;
    // One render holds the PDF slot, and the queue keeps every other admitted
    // job behind it rather than refusing them.
    expect(render).toHaveBeenCalledTimes(1);
    gate.resolve(rendered);
    const outcomes = await Promise.all(pending);
    expect(outcomes.every((result) => result.kind === "available")).toBe(true);
    expect(render).toHaveBeenCalledTimes(129);
  });

  it("waits at full capacity past the job deadline and still renders the image", async () => {
    const limits = new Map<number, AbortController>();
    using _deadlines = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        const controller = new AbortController();
        limits.set(milliseconds, controller);
        return controller.signal;
      });
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    const blocked = Array.from({ length: 128 }, (_, index) =>
      service.resolve({
        ...request,
        annotation: { ...request.annotation, key: `BLOCKED${index}` },
      }),
    );
    await started.promise;
    const waiting = service.resolve({
      ...request,
      annotation: { ...request.annotation, key: "WAITING" },
    });
    await vi.waitFor(() =>
      expect(service.queueDiagnostics).toMatchObject({ awaiting: 1 }),
    );
    // Every slot is held, so the last deadline this producer created is its own
    // preflight's. Letting it expire must not end the wait: a full bound is not
    // a resolution, and the render's own deadline starts with its turn.
    limits.get(35_000)!.abort(new Error("job deadline"));
    const stillWaiting = service.queueDiagnostics;
    gate.resolve(rendered);
    const outcomes = await Promise.allSettled([...blocked, waiting]);
    expect(stillWaiting).toMatchObject({ awaiting: 1, admitted: 128 });
    expect(
      outcomes.map(
        (settled) =>
          settled.status === "fulfilled" && settled.value.kind === "available",
      ),
    ).toStrictEqual(Array.from({ length: 129 }, () => true));
    expect(render).toHaveBeenCalledTimes(129);
  });

  it("leaves a full-capacity wait promptly when its caller cancels", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    const blocked = Array.from({ length: 128 }, (_, index) =>
      service.resolve({
        ...request,
        annotation: { ...request.annotation, key: `BLOCKED${index}` },
      }),
    );
    await started.promise;
    const controller = new AbortController();
    const waiting = service.resolve(
      { ...request, annotation: { ...request.annotation, key: "WAITING" } },
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(service.queueDiagnostics).toMatchObject({ awaiting: 1 }),
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    // The cancelled producer left no slot and no wait behind it.
    expect(service.queueDiagnostics).toMatchObject({
      admitted: 128,
      awaiting: 0,
    });
    gate.resolve(rendered);
    expect(
      (await Promise.all(blocked)).every(
        (outcome) => outcome.kind === "available",
      ),
    ).toBe(true);
    expect(render).toHaveBeenCalledTimes(128);
  });

  it("resolves a cache hit while every admitted slot is held", async () => {
    const f = fixture();
    await using service = f.service;
    await service.resolve(request);
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    f.render.mockImplementation(() => {
      started.resolve();
      return gate.promise;
    });
    const blocked = Array.from({ length: 128 }, (_, index) =>
      service.resolve({
        ...request,
        annotation: { ...request.annotation, key: `BLOCKED${index}` },
      }),
    );
    try {
      await started.promise;
      // Freshness and cache checks run before admission: a cache hit resolves
      // even though the admitted bound is full and a render is in flight.
      expect(await service.resolve(request)).toMatchObject({
        provenance: "cache",
        bytes: generated,
      });
    } finally {
      gate.resolve(rendered);
    }
    expect(
      (await Promise.all(blocked)).every(
        (result) => result.kind === "available",
      ),
    ).toBe(true);
  });

  it("returns every cancelled job's capacity and keeps the queue usable", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const render = vi.fn(
      async (_request: ExcerptRequest, signal: AbortSignal) => {
        if (render.mock.calls.length > 1) return rendered;
        started.resolve();
        await release.promise;
        signal.throwIfAborted();
        return rendered;
      },
    );
    await using service = new ExcerptImageService({ render });

    for (let index = 0; index < 128; index++) {
      const controller = new AbortController();
      const pending = service.resolve(request, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      if (index === 0) await started.promise;
      controller.abort();
      await rejection;
    }

    // Cancelled demand released its slots: the same image can be requested
    // again once the cancelled job's bounded teardown frees the render slot.
    release.resolve();
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("waits for actual teardown before advancing a cancelled request's queue slot", async () => {
    const started = Promise.withResolvers<void>();
    const cleanupStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const render = vi.fn(
      async (_request: ExcerptRequest, signal: AbortSignal) => {
        if (render.mock.calls.length > 1) return rendered;
        started.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        cleanupStarted.resolve();
        await release.promise;
        throw signal.reason;
      },
    );
    await using service = new ExcerptImageService({ render });
    const controller = new AbortController();
    const first = service.resolve(request, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    controller.abort();
    await rejected;
    const second = service.resolve({
      ...request,
      annotation: { ...request.annotation, key: "SECOND" },
    });
    try {
      await cleanupStarted.promise;
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    expect(await second).toMatchObject({ provenance: "rendered" });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("stops new work when the 35-second job and 5-second teardown deadlines expire", async () => {
    const limits = new Map<number, AbortController>();
    const grace = Promise.withResolvers<void>();
    using _deadlines = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        const controller = new AbortController();
        limits.set(milliseconds, controller);
        if (milliseconds === 5_000) grace.resolve();
        return controller.signal;
      });
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return new Promise<ExcerptImage>(() => {});
    });
    await using service = new ExcerptImageService({ render });
    const pending = service.resolve(request);
    const rejected = expect(pending).rejects.toThrow("job deadline");
    await started.promise;
    limits.get(35_000)!.abort(new Error("job deadline"));
    await grace.promise;
    limits.get(5_000)!.abort(new Error("cleanup deadline"));
    await rejected;
    expect(
      await service.resolve({
        ...request,
        annotation: { ...request.annotation, key: "SECOND" },
      }),
    ).toEqual({ kind: "unavailable" });
    expect(render).toHaveBeenCalledTimes(1);
    await service[Symbol.asyncDispose]();
  });

  it("owns the published snapshot even when the caller edits it before startup settles", async () => {
    const input = structuredClone(inkRequest);
    let savedColor: string | null = null;
    await using service = new ExcerptImageService({
      render: async (snapshot) => {
        savedColor = snapshot.annotation.color;
        return rendered;
      },
    });
    const result = service.resolve(input);
    input.annotation.color = "#0000ff";
    await result;
    expect(savedColor).toBe("#ff0000");
  });
  it("reuses canonical pixel inputs across non-rendering edits and source revisions", async () => {
    const f = fixture();
    await using service = f.service;
    await service.resolve(inkRequest);
    const edited: ExcerptRequest = {
      ...inkRequest,
      annotation: {
        ...inkRequest.annotation,
        color: "#FF0000",
        comment: "saved comment",
        text: "text",
        pageLabel: "iv",
        tags: ["tag"],
        version: 5,
        position: {
          paths: [[10, 20, 30, 40]],
          width: 2,
          pageIndex: 0,
          kind: "pdf-ink",
        },
      },
      source: {
        ...request.source,
        libraryRevision: 8,
      } as ExcerptRequest["source"],
    };
    expect(excerptKey(edited)).toBe(excerptKey(inkRequest));
    expect(await service.resolve(edited)).toMatchObject({
      provenance: "cache",
    });
    expect(f.render).toHaveBeenCalledTimes(1);
    for (const annotation of [
      { ...edited.annotation, color: "#00ff00" },
      {
        ...edited.annotation,
        position: {
          kind: "pdf-ink" as const,
          pageIndex: 1,
          width: 2,
          paths: [[10, 20, 30, 40]],
        },
      },
      {
        ...edited.annotation,
        position: {
          kind: "pdf-ink" as const,
          pageIndex: 0,
          width: 4,
          paths: [[10, 20, 30, 40]],
        },
      },
      {
        ...edited.annotation,
        position: {
          kind: "pdf-ink" as const,
          pageIndex: 0,
          width: 2,
          paths: [[10, 20, 30, 41]],
        },
      },
    ])
      expect(await service.resolve({ ...edited, annotation })).toMatchObject({
        provenance: "rendered",
      });
    expect(f.render).toHaveBeenCalledTimes(5);
  });

  it("captures each rapid saved edit before waiting for an older render", async () => {
    const started = Promise.withResolvers<void>();
    const old = Promise.withResolvers<ExcerptImage>();
    const colors: (string | null)[] = [];
    await using service = new ExcerptImageService({
      render: async (snapshot) => {
        colors.push(snapshot.annotation.color);
        if (colors.length === 1) {
          started.resolve();
          return old.promise;
        }
        return rendered;
      },
    });
    const first = service.resolve(inkRequest);
    await started.promise;
    const second = service.resolve({
      ...inkRequest,
      annotation: { ...inkRequest.annotation, color: "#00ff00" },
    });
    const third = service.resolve({
      ...inkRequest,
      annotation: { ...inkRequest.annotation, color: "#0000ff" },
    });
    old.resolve(rendered);
    await Promise.all([first, second, third]);
    expect(colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("retries uncertain ink fallback and makes failed ink explicit", async () => {
    const render = vi.fn(async () => {
      throw new Error("broken PDF");
    });
    await using service = new ExcerptImageService({
      render,
      read: async () => fallback,
    });
    expect(await service.resolve(inkRequest)).toMatchObject({
      provenance: "zotero",
      freshness: "uncertain",
    });
    expect(await service.resolve(inkRequest)).toMatchObject({
      provenance: "zotero",
      freshness: "uncertain",
    });
    expect(
      await service.resolve({ ...inkRequest, zoteroPngPath: null }),
    ).toEqual({ kind: "unavailable" });
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("keeps pre-clear work out of storage and starts a new generation for later callers", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const entries = new Map<string, ExcerptEntry>();
    const put = vi.fn(async (key: string, entry: ExcerptEntry) => {
      entries.set(key, entry);
    });
    const render = vi
      .fn(async () => rendered)
      .mockImplementationOnce(() => {
        started.resolve();
        return gate.promise;
      });
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render,
      cache: {
        get: async (key) => entries.get(key),
        put,
        clear: async () => {
          entries.clear();
        },
      },
    });
    const old = service.resolve(request);
    await started.promise;
    await service.clear();
    const current = service.resolve(request);
    gate.resolve(rendered);
    expect(await old).toMatchObject({ provenance: "rendered" });
    expect(await current).toMatchObject({ provenance: "rendered" });
    expect(render).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(1);
  });

  it("revalidates an unchecked entry when the PDF returns", async () => {
    const stamp = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ size: 101, mtimeMs: 11 });
    const render = vi.fn(async () => rendered);
    await using service = new ExcerptImageService({
      stamp,
      render,
      cache: {
        get: async () => ({
          bytes: generated,
          format: PNG_FORMAT,
          pdf: { size: 100, mtimeMs: 10 },
        }),
        put: async () => {},
      },
    });
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
      freshness: "unchecked",
    });
    expect(render).not.toHaveBeenCalled();
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
      freshness: "checked",
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("degrades after open and read failures and refuses persistence without a source scope", async () => {
    const render = vi.fn(async () => rendered);
    await using failedOpen = new ExcerptImageService({
      render,
      openStore: async () => {
        throw new Error("blocked");
      },
    });
    expect(await failedOpen.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    await expect(failedOpen.clear()).rejects.toThrow("could not be opened");
    const get = vi.fn(async (): Promise<ExcerptEntry | undefined> => {
      throw new Error("read failed");
    });
    const put = vi.fn(async () => {});
    await using service = new ExcerptImageService({
      render,
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      cache: { get, put },
    });
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    get.mockClear();
    put.mockClear();
    expect(
      await service.resolve({ ...request, sourceScope: "" }),
    ).toMatchObject({ provenance: "rendered" });
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it("observes an existing rejection even when cancellation already happened", async () => {
    const signal = AbortSignal.abort(new Error("cancelled"));
    await expect(
      abortable(Promise.reject(new Error("operation rejected")), signal),
    ).rejects.toThrow("cancelled");
    await expect(
      abortable(Promise.resolve("old result"), signal),
    ).rejects.toThrow("cancelled");
  });
  it("rejects oversized injected fallback bytes", async () => {
    const bytes = new Uint8Array(MAX_FALLBACK_BYTES + 1);
    bytes.set(fallback);
    await using service = new ExcerptImageService({
      render: async () => {
        throw new Error("render failed");
      },
      read: async () => bytes,
    });
    expect(await service.resolve(request)).toEqual({ kind: "unavailable" });
  });
  it("rejects an oversized fallback file before reading its payload", async () => {
    await using stack = new AsyncDisposableStack();
    const folder = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-excerpt-")),
      (folder) => rm(folder, { recursive: true, force: true }),
    );
    const path = join(folder, "image.png");
    await using file = await open(path, "w");
    await file.write(fallback);
    await file.truncate(MAX_FALLBACK_BYTES + 1);
    await using service = new ExcerptImageService({
      render: async () => {
        throw new Error("render failed");
      },
    });
    expect(await service.resolve({ ...request, zoteroPngPath: path })).toEqual({
      kind: "unavailable",
    });
  });
  it("drops cancelled queued work without an unhandled rejection or poisoning the queue", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(async () => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    const first = service.resolve(request);
    await started.promise;
    const controller = new AbortController();
    const subscribed = Promise.withResolvers<void>();
    const addListener = controller.signal.addEventListener.bind(
      controller.signal,
    );
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (...args) => {
        addListener(...args);
        subscribed.resolve();
      },
    );
    const cancelled = service.resolve(
      { ...request, attachmentKey: "SECOND" },
      controller.signal,
    );
    const rejection = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    await subscribed.promise;
    controller.abort();
    await rejection;
    const last = service.resolve({ ...request, attachmentKey: "THIRD" });
    gate.resolve(rendered);
    expect(await first).toMatchObject({ kind: "available" });
    expect(await last).toMatchObject({ kind: "available" });
    expect(render).toHaveBeenCalledTimes(2);
  });
  it("generates, reuses a matching PDF, and refreshes changed PDF metadata", async () => {
    const f = fixture();
    await using service = f.service;
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
      freshness: "checked",
      bytes: generated,
    });
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
    });
    // Replacing content with the same metadata is deliberately indistinguishable.
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
    });
    f.changePdf();
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it("publishes the revision the renderer loaded, not the one the probe saw", async () => {
    const entries = new Map<string, ExcerptEntry>();
    let pdf = { size: 100, mtimeMs: 10 };
    const replacement = new Uint8Array([4, 5, 6]);
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const probed = Promise.withResolvers<void>();
    let renders = 0;
    const render = vi.fn(async () => {
      // The revision this call reads, which for the queued job below is the one
      // that replaced the PDF while it waited for the render slot.
      const revision = pdf;
      renders += 1;
      if (renders === 1) {
        started.resolve();
        await gate.promise;
      }
      return revision.mtimeMs === 10
        ? rendered
        : { bytes: replacement, format: PNG_FORMAT };
    });
    await using service = new ExcerptImageService({
      stamp: async (path) => {
        if (path === "/late.pdf") probed.resolve();
        return pdf;
      },
      render,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
      },
    });
    const lateRequest: ExcerptRequest = {
      ...request,
      pdfPath: "/late.pdf",
      annotation: { ...request.annotation, key: "ANNOT002" },
    };
    // The first job holds the render slot, rendering the stored revision.
    const first = service.resolve(request);
    await started.promise;
    // The second job's own probe reads that revision, and then waits.
    const late = service.resolve(lateRequest);
    await probed.promise;
    pdf = { size: 101, mtimeMs: 11 };
    gate.resolve();
    expect(await first).toMatchObject({
      provenance: "rendered",
      identity: { pdf: { size: 100, mtimeMs: 10 } },
    });
    // The bytes it renders are the replacement revision, and so is the stamp
    // published beside them and stored under the excerpt's key.
    expect(await late).toMatchObject({
      provenance: "rendered",
      bytes: replacement,
      identity: { pdf: { size: 101, mtimeMs: 11 } },
    });
    expect(entries.get(excerptKey(lateRequest))?.pdf).toEqual({
      size: 101,
      mtimeMs: 11,
    });
    // An unchanged request reuses those bytes instead of rendering again.
    expect(await service.resolve(lateRequest)).toMatchObject({
      provenance: "cache",
      bytes: replacement,
    });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("uses matching cached pixels when the PDF cannot be checked", async () => {
    await using service = new ExcerptImageService({
      stamp: async () => {
        throw new Error("offline");
      },
      cache: {
        get: async () => ({
          bytes: generated,
          format: PNG_FORMAT,
          pdf: { size: 100, mtimeMs: 10 },
        }),
        put: async () => {},
      },
    });
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
      freshness: "unchecked",
    });
  });

  it("isolates geometry, renderer input, Library, and unverified source identities", () => {
    const api: ExcerptRequest = {
      ...request,
      source: { kind: "zotero-local-api", serverID: "SAME" },
    };
    expect(excerptKey({ ...api, libraryID: 2 })).not.toBe(excerptKey(api));
    if (request.source.kind !== "zotero-db")
      throw new Error("Expected database fixture");
    const standalone = (
      database: DatabaseAnnotationSource["database"],
    ): ExcerptRequest => ({
      ...request,
      source: { kind: "zotero-db", database, libraryID: 1, libraryRevision: 0 },
    });
    // A database that names no Server ID keeps a local identity, which never
    // stands in for another user's database.
    expect(
      excerptKey(
        standalone({ userID: 1, localUserKey: "LOCAL-A", serverID: null }),
      ),
    ).not.toBe(
      excerptKey(
        standalone({ userID: 2, localUserKey: "LOCAL-B", serverID: null }),
      ),
    );
    expect(
      excerptKey(
        standalone({ userID: 1, localUserKey: "LOCAL-A", serverID: null }),
      ),
    ).not.toBe(excerptKey(api));
    expect(
      excerptKey(
        standalone({ userID: 1, localUserKey: "LOCAL-A", serverID: "OTHER" }),
      ),
    ).not.toBe(excerptKey(api));
    // One database reached through either representation shares one identity.
    expect(
      excerptKey(
        standalone({ userID: 1, localUserKey: "LOCAL-A", serverID: "SAME" }),
      ),
    ).toBe(excerptKey(api));
    expect(excerptKey({ ...api, sourceScope: "/copied-database" })).not.toBe(
      excerptKey(api),
    );
    const changed = structuredClone(request);
    changed.annotation.position = {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[11, 20, 80, 90]],
    };
    expect(excerptKey(changed)).not.toBe(excerptKey(request));
    expect(excerptKey({ ...request, sourceScope: "/other" })).not.toBe(
      excerptKey(request),
    );
    expect(excerptKey({ ...request, attachmentKey: "ATTACH01g2" })).not.toBe(
      excerptKey(request),
    );
    expect(
      excerptKey({
        ...request,
        annotation: { ...request.annotation, comment: "New comment" },
      }),
    ).toBe(excerptKey(request));
  });

  it("shares verified API and database sources of one Annotation", async () => {
    const f = fixture();
    await using service = f.service;
    const api: ExcerptRequest = {
      ...request,
      source: { kind: "zotero-local-api", serverID: "SERVER" },
    };
    expect(excerptKey(api)).toBe(excerptKey(request));
    expect(await service.resolve(api)).toMatchObject({
      provenance: "rendered",
      bytes: generated,
    });
    // The database representation of the same Annotation reuses those pixels.
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
      bytes: generated,
    });
    expect(f.render).toHaveBeenCalledTimes(1);
  });

  it("completes a cache hit while an unrelated render holds the queue", async () => {
    const f = fixture();
    await using service = f.service;
    await service.resolve(request);
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    f.render.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const blocked = service.resolve({
      ...request,
      annotation: { ...request.annotation, key: "ANNOT002" },
    });
    await started.promise;
    // A cache hit resolves without waiting for the blocked render.
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
      bytes: generated,
    });
    expect(f.render).toHaveBeenCalledTimes(2);
    gate.resolve(rendered);
    expect(await blocked).toMatchObject({ provenance: "rendered" });
  });

  it("returns a stored cache hit while every admission slot is taken", async () => {
    const f = await storedExcerptWithBlockedRenders(128);
    await using service = f.service;
    try {
      // Every slot is held by a blocked render, and the stored bytes still
      // resolve without one.
      expect(await service.resolve(request)).toMatchObject({
        provenance: "cache",
        bytes: generated,
      });
      expect(f.render).toHaveBeenCalledTimes(2);
    } finally {
      f.release();
    }
    expect(
      (await Promise.all(f.pending)).every(
        (result) => result.kind === "available",
      ),
    ).toBe(true);
    expect(f.render).toHaveBeenCalledTimes(129);
  });

  it("records the excerpt key and the queue's counts at the admission decision", async () => {
    const f = await storedExcerptWithBlockedRenders(128);
    await using service = f.service;
    const firstRequest = {
      ...request,
      annotation: { ...request.annotation, key: "WAITING-A" },
    };
    const first = service.resolve(firstRequest);
    await vi.waitFor(() =>
      expect(
        captured.find(
          (record) => record.properties.key === excerptKey(firstRequest),
        ),
      ).toBeDefined(),
    );
    const secondRequest = {
      ...request,
      annotation: { ...request.annotation, key: "WAITING-B" },
    };
    const second = service.resolve(secondRequest);
    await vi.waitFor(() =>
      expect(
        captured.find(
          (record) => record.properties.key === excerptKey(secondRequest),
        ),
      ).toBeDefined(),
    );
    const firstRecord = captured.find(
      (record) => record.properties.key === excerptKey(firstRequest),
    )!;
    const secondRecord = captured.find(
      (record) => record.properties.key === excerptKey(secondRequest),
    )!;
    // Both records name the excerpt and the full bound; the second also counts
    // the producer already waiting for a slot, which is the saturation a
    // diagnosis log would otherwise have to infer from a stalled progress bar.
    expect(firstRecord.properties).toMatchObject({
      admitted: 128,
      awaiting: 0,
    });
    expect(secondRecord.properties).toMatchObject({
      admitted: 128,
      awaiting: 1,
    });
    f.release();
    const outcomes = await Promise.all([first, second, ...f.pending]);
    expect(outcomes.every((outcome) => outcome.kind === "available")).toBe(
      true,
    );
  });

  it("keeps shared work alive while another caller still demands it", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(async (_request, signal: AbortSignal) => {
      started.resolve();
      await gate.promise;
      signal.throwIfAborted();
      return rendered;
    });
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render,
    });
    const controller = new AbortController();
    const database = service.resolve(request, controller.signal);
    const api = service.resolve({
      ...request,
      source: { kind: "zotero-local-api", serverID: "SERVER" },
    });
    const rejection = expect(database).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    controller.abort();
    await rejection;
    // The remaining representation still receives the single shared render.
    gate.resolve(rendered);
    expect(await api).toMatchObject({
      provenance: "rendered",
      bytes: generated,
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("releases shared work once its last caller cancels", async () => {
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    let aborted = false;
    const render = vi.fn((_request, signal: AbortSignal) => {
      started.resolve();
      return new Promise<ExcerptImage>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            released.resolve();
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    });
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render,
    });
    const database = new AbortController();
    const api = new AbortController();
    const first = service.resolve(request, database.signal);
    const second = service.resolve(
      { ...request, source: { kind: "zotero-local-api", serverID: "SERVER" } },
      api.signal,
    );
    const rejections = [
      expect(first).rejects.toMatchObject({ name: "AbortError" }),
      expect(second).rejects.toMatchObject({ name: "AbortError" }),
    ];
    await started.promise;
    database.abort();
    await rejections[0];
    expect(aborted).toBe(false);
    // Only the last caller's cancellation releases the shared render.
    api.abort();
    await rejections[1];
    await released.promise;
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("carries the validated identity on every available outcome", async () => {
    const f = fixture();
    await using service = f.service;
    const identity = {
      key: excerptKey(request),
      fingerprint: excerptFingerprint(request.annotation),
    };
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
      identity: { ...identity, pdf: { size: 100, mtimeMs: 10 } },
    });
    expect(await service.resolve(request)).toMatchObject({
      provenance: "cache",
      identity: { ...identity, pdf: { size: 100, mtimeMs: 10 } },
    });
    await using unreadable = new ExcerptImageService({
      stamp: async () => {
        throw new Error("offline");
      },
      cache: {
        get: async () => ({ ...rendered, pdf: { size: 100, mtimeMs: 10 } }),
        put: async () => {},
      },
    });
    expect(await unreadable.resolve(request)).toMatchObject({
      provenance: "cache",
      identity: { ...identity, pdf: null },
    });
    await using fallbackOnly = new ExcerptImageService({
      render: async () => {
        throw new Error("broken PDF");
      },
      read: async () => fallback,
    });
    expect(await fallbackOnly.resolve(request)).toMatchObject({
      provenance: "zotero",
      identity: { ...identity, pdf: null },
    });
  });

  it("retries rendering after an uncertain fallback and never validates that fallback", async () => {
    const f = fixture();
    await using service = f.service;
    f.render.mockRejectedValueOnce(new Error("broken PDF"));
    expect(await service.resolve(request)).toMatchObject({
      provenance: "zotero",
      freshness: "uncertain",
      bytes: fallback,
    });
    expect(f.entries.size).toBe(0);
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
      bytes: generated,
    });
  });

  it("returns unavailable for total failure but preserves generated bytes when persistence fails", async () => {
    await using failed = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render: async () => {
        throw new Error("bad PDF");
      },
      read: async () => {
        throw new Error("missing");
      },
    });
    expect(await failed.resolve(request)).toEqual({ kind: "unavailable" });
    await using working = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render: async () => rendered,
      cache: {
        get: async () => undefined,
        put: async () => {
          throw new Error("quota");
        },
      },
    });
    expect(await working.resolve(request)).toMatchObject({
      provenance: "rendered",
      bytes: generated,
    });
  });

  it("shares identical work while cancellation releases only that caller", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({
      render,
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
    });
    const controller = new AbortController();
    const first = service.resolve(request, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = service.resolve(request);
    await started.promise;
    controller.abort();
    await rejected;
    gate.resolve(rendered);
    expect(await second).toMatchObject({ provenance: "rendered" });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("changes scheduling only for the exact owned task and rejects incompatible shapes", () => {
    const task = { promise: Promise.resolve(), cancel() {} };
    const own = { task, _useRequestAnimationFrame: true };
    const other = { task: {}, _useRequestAnimationFrame: true };
    usePromiseScheduling(
      { _intentStates: new Map([[1, { renderTasks: new Set([own, other]) }]]) },
      task,
    );
    expect([
      own._useRequestAnimationFrame,
      other._useRequestAnimationFrame,
    ]).toEqual([false, true]);
    expect(() =>
      usePromiseScheduling({ _intentStates: new Map() }, task),
    ).toThrow("Unsupported");
    expect(() => usePromiseScheduling({}, task)).toThrow("Unsupported");
  });

  it("cancels abandoned work and allows the same image to be requested again", async () => {
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    let first = true;
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render: async (_, signal) => {
        if (!first) return rendered;
        first = false;
        started.resolve();
        return new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              released.resolve();
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    });
    const controller = new AbortController();
    const pending = service.resolve(request, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    controller.abort();
    await rejection;
    await released.promise;
    expect(await service.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
  });

  it("shutdown aborts owned rendering and refuses later requests", async () => {
    const started = Promise.withResolvers<void>();
    let released = false;
    const service = new ExcerptImageService({
      stamp: async () => ({ size: 1, mtimeMs: 1 }),
      render: async (_, signal) => {
        started.resolve();
        return new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              released = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    });
    const pending = service.resolve(request);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    const disposal = service[Symbol.asyncDispose]();
    expect(service[Symbol.asyncDispose]()).toBe(disposal);
    await disposal;
    await rejection;
    expect(released).toBe(true);
    await expect(service.resolve(request)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("Excerpt latest references", () => {
  /** The record one Annotation's latest image lives under, as the store keys it. */
  const record = excerptAnnotationRecord(inkRequest);
  /** The ink pixels one colour asks for: another colour is another saved edit. */
  const recolor = (
    color: string,
    version: number | null = null,
  ): ExcerptRequest => ({
    ...inkRequest,
    annotation: { ...inkRequest.annotation, color, version },
  });

  it("publishes the image of the saved pixels, and survives a failed replacement", async () => {
    const f = fixture();
    await using service = f.service;
    await service.resolve(inkRequest);
    const previous = f.references.get(record);
    expect(previous).toEqual({
      key: excerptKey(inkRequest),
      fingerprint: excerptFingerprint(inkRequest.annotation),
      pdf: { size: 100, mtimeMs: 10 },
    });

    // A replacement that renders nothing keeps the reference the device has:
    // the answer is Zotero's own image, which the store holds no bytes for.
    const saved = recolor("#00ff00");
    f.render.mockRejectedValueOnce(new Error("PDF unavailable"));
    await expect(service.resolve(saved)).resolves.toMatchObject({
      kind: "available",
      provenance: "zotero",
      freshness: "uncertain",
    });
    expect(f.references.get(record)).toBe(previous);

    await expect(service.resolve(saved)).resolves.toMatchObject({
      provenance: "rendered",
    });
    expect(f.references.get(record)?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );
  });

  it("takes the newer saved snapshot when it joins the older one's live job", async () => {
    const entries = new Map<string, ExcerptEntry>();
    const references = new Map<string, ExcerptIdentity>();
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(async () => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render,
      read: async () => fallback,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
        latest: async (identity) => references.get(identity),
        putLatest: async (identity, reference) => {
          references.set(identity, reference);
        },
      },
    });

    // A is in flight, a saved edit to B is admitted behind it, and the user
    // saves A again: that third request joins the first one's job instead of
    // admitting anything of its own.
    const first = recolor("#ff0000", 1);
    const second = recolor("#00ff00", 2);
    const latest = recolor("#ff0000", 3);
    const a = service.resolve(first);
    const b = service.resolve(second);
    await started.promise;
    const joined = service.resolve(latest);
    gate.resolve(rendered);
    await Promise.all([a, b, joined]);

    // The joining caller carries the newest saved pixels, so A's answer is the
    // one that becomes the reference and B's older one cannot move it back.
    expect(references.get(record)).toMatchObject({
      key: excerptKey(latest),
      fingerprint: excerptFingerprint(latest.annotation),
    });
    expect(references.get(record)?.fingerprint).not.toBe(
      excerptFingerprint(second.annotation),
    );
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest saved pixels when a stale result lands last", async () => {
    const entries = new Map<string, ExcerptEntry>();
    const references = new Map<string, ExcerptIdentity>();
    const gate = Promise.withResolvers<void>();
    let stale = false;
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render: async () => rendered,
      read: async () => fallback,
      cache: {
        get: async (key) => {
          // The stale request's preflight stalls; every other read answers.
          if (stale && key === excerptKey(inkRequest)) await gate.promise;
          return entries.get(key);
        },
        put: async (key, entry) => {
          entries.set(key, entry);
        },
        latest: async (identity) => references.get(identity),
        putLatest: async (identity, reference) => {
          references.set(identity, reference);
        },
      },
    });
    await service.resolve(inkRequest);
    expect(references.get(record)?.fingerprint).toBe(
      excerptFingerprint(inkRequest.annotation),
    );

    // A request for the pixels the device already holds — a captured note, a
    // read that started before the edit — is admitted first and answers late.
    stale = true;
    const late = service.resolve(inkRequest);
    const saved = recolor("#00ff00");
    const current = service.resolve(saved);
    await vi.waitFor(() =>
      expect(references.get(record)?.fingerprint).toBe(
        excerptFingerprint(saved.annotation),
      ),
    );

    gate.resolve();
    await expect(late).resolves.toMatchObject({
      provenance: "cache",
      bytes: generated,
    });
    await current;
    expect(references.get(record)?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );
  });

  it("keeps the saved edit's pixels when an older snapshot is admitted after them", async () => {
    const entries = new Map<string, ExcerptEntry>();
    const references = new Map<string, ExcerptIdentity>();
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render: async () => rendered,
      read: async () => fallback,
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          entries.set(key, entry);
        },
        latest: async (identity) => references.get(identity),
        putLatest: async (identity, reference) => {
          references.set(identity, reference);
        },
      },
    });

    // The saved edit is the display's own request, and it is admitted and
    // resolved first: it is the Annotation's newest saved pixels.
    const saved = recolor("#00ff00", 2);
    await expect(service.resolve(saved)).resolves.toMatchObject({
      provenance: "rendered",
    });
    expect(references.get(record)?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );

    // A note or batch resolution holds the record as it was before that edit,
    // and is admitted after the edit has settled. Its pixels are older, so its
    // answer cannot become the latest reference.
    const stale = recolor("#ff0000", 1);
    await expect(service.resolve(stale)).resolves.toMatchObject({
      provenance: "rendered",
    });
    expect(references.get(record)?.fingerprint).toBe(
      excerptFingerprint(saved.annotation),
    );
  });

  it("stops work a clear overtook from restoring pixels or a reference", async () => {
    const f = fixture();
    await using service = f.service;
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    f.render.mockImplementationOnce(async () => {
      started.resolve();
      return gate.promise;
    });
    const pending = service.resolve(request);
    await started.promise;

    await service.clear();
    gate.resolve(rendered);
    await expect(pending).resolves.toMatchObject({
      kind: "available",
      provenance: "rendered",
    });
    expect(f.entries.size).toBe(0);
    expect(f.references.size).toBe(0);
  });

  it("leaves durable note assets and Zotero's own cache out of the clear", async () => {
    await using stack = new AsyncDisposableStack();
    const folder = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-excerpt-clear-")),
      (folder) => rm(folder, { recursive: true, force: true }),
    );
    const asset = join(folder, "excerpt.webp");
    const zoteroImage = join(folder, "ANNOT001.png");
    await writeFile(asset, generated);
    await writeFile(zoteroImage, fallback);
    const f = fixture();
    await using service = f.service;
    await service.resolve({ ...request, zoteroPngPath: zoteroImage });
    expect(f.entries.size).toBe(1);

    await service.clear();
    expect(f.entries.size).toBe(0);
    expect(f.references.size).toBe(0);
    expect(await readFile(asset)).toEqual(Buffer.from(generated));
    expect(await readFile(zoteroImage)).toEqual(Buffer.from(fallback));
  });

  it("reads back the image this device last stored for an Annotation", async () => {
    const f = fixture();
    await using service = f.service;
    await service.resolve(inkRequest);
    expect(await service.stored(inkRequest)).toMatchObject({
      kind: "available",
      provenance: "cache",
      freshness: "unchecked",
      bytes: generated,
      identity: {
        key: excerptKey(inkRequest),
        fingerprint: excerptFingerprint(inkRequest.annotation),
        pdf: { size: 100, mtimeMs: 10 },
      },
    });

    // An Annotation whose pixels moved still reads back the image the device
    // holds: that is what a display paints while the new pixels resolve.
    expect(
      (await service.stored(recolor("#00ff00")))?.identity.fingerprint,
    ).toBe(excerptFingerprint(inkRequest.annotation));

    // Evicted bytes read as nothing, even though the reference stands, and a
    // cache that keeps no references reads as nothing either.
    f.entries.clear();
    expect(await service.stored(inkRequest)).toBeNull();
    const bare = new ExcerptImageService({
      cache: { get: async () => undefined, put: async () => {} },
    });
    await using _bare = bare;
    expect(await bare.stored(inkRequest)).toBeNull();
  });
});
