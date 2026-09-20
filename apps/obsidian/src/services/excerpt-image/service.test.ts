import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
  attachmentKey: "ATTACH01",
  pdfPath: "/paper.pdf",
  zoteroPngPath: "/fallback.png",
};
const generated = new Uint8Array([1, 2, 3]);
const fallback = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9]);

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
    await service[Symbol.asyncDispose]();
    await rejection;
    expect(released).toBe(true);
    await expect(service.resolve(request)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
