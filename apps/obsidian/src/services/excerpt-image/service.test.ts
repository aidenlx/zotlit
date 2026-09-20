import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { redPng, corruptPng } from "./__fixtures__/png";
import { abortable, usePromiseScheduling } from "./renderer";
import { ExcerptImageService, excerptKey, MAX_FALLBACK_BYTES } from "./service";
import type { ExcerptEntry, ExcerptRequest } from "./service";

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
    type: "image",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    tags: [],
    version: null,
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
  let pdf = { size: 100, mtimeMs: 10 };
  const render = vi.fn(async () => generated);
  const service = new ExcerptImageService({
    cache: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        entries.set(key, entry);
      },
    },
    stamp: async () => pdf,
    render,
    read: async () => fallback,
  });
  return {
    service,
    entries,
    render,
    changePdf: () => {
      pdf = { size: 101, mtimeMs: 11 };
    },
  };
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
  it("admits 128 distinct requests and rejects the 129th without starting it", async () => {
    const gate = Promise.withResolvers<Uint8Array>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    const pending = Array.from({ length: 128 }, (_, index) =>
      service.resolve({
        ...request,
        annotation: { ...request.annotation, key: `ANNOT${index}` },
      }),
    );
    try {
      await started.promise;
      expect(
        await service.resolve({
          ...request,
          annotation: { ...request.annotation, key: "OVERFLOW" },
        }),
      ).toEqual({ kind: "unavailable" });
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve(generated);
    }
    expect(
      (await Promise.all(pending)).every(
        (result) => result.kind === "available",
      ),
    ).toBe(true);
    expect(render).toHaveBeenCalledTimes(128);
  });

  it("bounds cancelled same-key jobs that replace the dedup entry", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const render = vi.fn(async (_request, signal: AbortSignal) => {
      started.resolve();
      await release.promise;
      signal.throwIfAborted();
      return generated;
    });
    await using service = new ExcerptImageService({ render });

    for (let index = 0; index < 128; index++) {
      const controller = new AbortController();
      const listening = Promise.withResolvers<void>();
      const addEventListener = controller.signal.addEventListener.bind(
        controller.signal,
      );
      vi.spyOn(controller.signal, "addEventListener").mockImplementation(
        (...args) => {
          addEventListener(...args);
          if (args[0] === "abort") listening.resolve();
        },
      );
      const pending = service.resolve(request, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await listening.promise;
      if (index === 0) await started.promise;
      controller.abort();
      await rejection;
    }

    expect(await service.resolve(request)).toEqual({ kind: "unavailable" });
    expect(render).toHaveBeenCalledTimes(1);
    release.resolve();
  });

  it("waits for actual teardown before advancing a cancelled request's queue slot", async () => {
    const started = Promise.withResolvers<void>();
    const cleanupStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const render = vi.fn(
      async (_request: ExcerptRequest, signal: AbortSignal) => {
        if (render.mock.calls.length > 1) return generated;
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
      return new Promise<Uint8Array>(() => {});
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
        return generated;
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
    const old = Promise.withResolvers<Uint8Array>();
    const colors: (string | null)[] = [];
    await using service = new ExcerptImageService({
      render: async (snapshot) => {
        colors.push(snapshot.annotation.color);
        if (colors.length === 1) {
          started.resolve();
          return old.promise;
        }
        return generated;
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
    old.resolve(generated);
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
    const gate = Promise.withResolvers<Uint8Array>();
    const started = Promise.withResolvers<void>();
    const entries = new Map<string, ExcerptEntry>();
    const put = vi.fn(async (key: string, entry: ExcerptEntry) => {
      entries.set(key, entry);
    });
    const render = vi
      .fn(async () => generated)
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
    gate.resolve(generated);
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
    const render = vi.fn(async () => generated);
    await using service = new ExcerptImageService({
      stamp,
      render,
      cache: {
        get: async () => ({
          bytes: generated,
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
    const render = vi.fn(async () => generated);
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
    const gate = Promise.withResolvers<Uint8Array>();
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
    gate.resolve(generated);
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

  it("uses matching cached pixels when the PDF cannot be checked", async () => {
    await using service = new ExcerptImageService({
      stamp: async () => {
        throw new Error("offline");
      },
      cache: {
        get: async () => ({
          bytes: generated,
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

  it("isolates geometry, renderer input, Library, and source identities", () => {
    const api = {
      ...request,
      source: { kind: "zotero-local-api" as const, serverID: "SAME" },
    };
    expect(excerptKey({ ...api, libraryID: 2 })).not.toBe(excerptKey(api));
    if (request.source.kind !== "zotero-db")
      throw new Error("Expected database fixture");
    for (const serverID of [null, "SAME"]) {
      const first = {
        ...request,
        source: {
          ...request.source,
          database: { userID: 1, localUserKey: "LOCAL-A", serverID },
        },
      };
      const second = {
        ...first,
        source: {
          ...first.source,
          database: { userID: 2, localUserKey: "LOCAL-B", serverID },
        },
      };
      expect(excerptKey(first)).not.toBe(excerptKey(second));
      expect(
        excerptKey({ ...first, sourceScope: "/copied-database" }),
      ).not.toBe(excerptKey(first));
    }
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
      render: async () => generated,
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
    const gate = Promise.withResolvers<Uint8Array>();
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
    gate.resolve(generated);
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
        if (!first) return generated;
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
