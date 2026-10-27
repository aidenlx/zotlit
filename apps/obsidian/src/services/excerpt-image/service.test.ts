import { it } from "@effect/vitest";
import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { Cause, Context, Effect, Exit, Fiber, FileSystem, Layer } from "effect";
import { TestClock } from "effect/testing";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { DatabaseAnnotationSource } from "@/services/annotation-repository/service";

import { excerptImageFixture } from "./__fixtures__/effect-service";
import { redPng, corruptPng } from "./__fixtures__/png";
import { PNG_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import {
  ExcerptImageService as ExcerptImages,
  layerExcerptImage,
} from "./service";
import {
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

const fixture = Effect.fnUntraced(function* () {
  const entries = new Map<string, ExcerptEntry>();
  const references = new Map<string, ExcerptIdentity>();
  let pdf = { size: 100, mtimeMs: 10 };
  const render = vi.fn(async () => rendered);
  const service = yield* excerptImageFixture({
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
});

/**
 * One stored excerpt, then `count` distinct requests held open on a blocked
 * render, which fills the queue's admission bound.
 */
const storedExcerptWithBlockedRenders = Effect.fnUntraced(function* (
  count: number,
) {
  const f = yield* fixture();
  expect(yield* f.service.resolve(request)).toMatchObject({
    provenance: "rendered",
  });
  const gate = Promise.withResolvers<ExcerptImage>();
  const started = Promise.withResolvers<void>();
  f.render.mockImplementation(async () => {
    started.resolve();
    return gate.promise;
  });
  const pending = yield* Effect.forEach(
    Array.from({ length: count }, (_, index) => index),
    (index) =>
      f.service
        .resolve({
          ...request,
          annotation: { ...request.annotation, key: `ANNOT${index}` },
        })
        .pipe(Effect.forkChild({ startImmediately: true })),
  );
  yield* Effect.promise(() => started.promise);
  return { ...f, pending, release: () => gate.resolve(rendered) };
});

describe("Excerpt Image resolution", () => {
  it.effect.each(["truncated", "idat", "scanline"] as const)(
    "rejects %s fallback PNG data",
    (kind) =>
      Effect.gen(function* () {
        const service = yield* excerptImageFixture({
          render: async () => {
            throw new Error("PDF unavailable");
          },
          read: async () => corruptPng(kind),
        });
        expect(yield* service.resolve(request)).toEqual({
          kind: "unavailable",
        });
      }),
  );
  it.effect(
    "waits at full capacity and renders the 129th request once a slot settles",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(() => {
          started.resolve();
          return gate.promise;
        });
        const service = yield* excerptImageFixture({ render });
        const pending = yield* Effect.forEach(
          Array.from({ length: 129 }, (_, index) => index),
          (index) =>
            service
              .resolve({
                ...request,
                annotation: { ...request.annotation, key: `ANNOT${index}` },
              })
              .pipe(Effect.forkChild({ startImmediately: true })),
        );
        yield* Effect.promise(() => started.promise);
        // One render holds the PDF slot, and the queue keeps every other admitted
        // job behind it rather than refusing them.
        expect(render).toHaveBeenCalledTimes(1);
        gate.resolve(rendered);
        const outcomes = yield* Effect.forEach(pending, (fiber) =>
          Fiber.join(fiber),
        );
        expect(outcomes.every((result) => result.kind === "available")).toBe(
          true,
        );
        expect(render).toHaveBeenCalledTimes(129);
      }),
  );

  it.effect(
    "leaves a full-capacity wait promptly when its caller cancels",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(() => {
          started.resolve();
          return gate.promise;
        });
        const service = yield* excerptImageFixture({ render });
        const blocked = yield* Effect.forEach(
          Array.from({ length: 128 }, (_, index) => index),
          (index) =>
            service
              .resolve({
                ...request,
                annotation: { ...request.annotation, key: `BLOCKED${index}` },
              })
              .pipe(Effect.forkChild({ startImmediately: true })),
        );
        yield* Effect.promise(() => started.promise);

        const waiting = yield* service
          .resolve({
            ...request,
            annotation: { ...request.annotation, key: "WAITING" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(service.queueDiagnostics).toMatchObject({ awaiting: 1 }),
          ),
        );
        yield* Fiber.interrupt(waiting);
        yield* assertRejected(waiting, { name: "AbortError" });
        // The cancelled producer left no slot and no wait behind it.
        expect(service.queueDiagnostics).toMatchObject({
          admitted: 128,
          awaiting: 0,
        });
        gate.resolve(rendered);
        expect(
          (yield* Effect.forEach(blocked, (fiber) => Fiber.join(fiber))).every(
            (outcome) => outcome.kind === "available",
          ),
        ).toBe(true);
        expect(render).toHaveBeenCalledTimes(128);
      }),
  );

  it.effect("resolves a cache hit while every admitted slot is held", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const service = f.service;
      yield* service.resolve(request);
      const gate = Promise.withResolvers<ExcerptImage>();
      const started = Promise.withResolvers<void>();
      f.render.mockImplementation(() => {
        started.resolve();
        return gate.promise;
      });
      const blocked = yield* Effect.forEach(
        Array.from({ length: 128 }, (_, index) => index),
        (index) =>
          service
            .resolve({
              ...request,
              annotation: { ...request.annotation, key: `BLOCKED${index}` },
            })
            .pipe(Effect.forkChild({ startImmediately: true })),
      );
      try {
        yield* Effect.promise(() => started.promise);
        // Freshness and cache checks run before admission: a cache hit resolves
        // even though the admitted bound is full and a render is in flight.
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "cache",
          bytes: generated,
        });
      } finally {
        gate.resolve(rendered);
      }
      expect(
        (yield* Effect.forEach(blocked, (fiber) => Fiber.join(fiber))).every(
          (result) => result.kind === "available",
        ),
      ).toBe(true);
    }),
  );

  it.effect(
    "returns every cancelled job's capacity and keeps the queue usable",
    () =>
      Effect.gen(function* () {
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
        const service = yield* excerptImageFixture({ render });

        for (let index = 0; index < 128; index++) {
          const pending = yield* service
            .resolve(request)
            .pipe(Effect.forkChild({ startImmediately: true }));
          const rejection = assertRejected(pending, {
            name: "AbortError",
          });
          if (index === 0) yield* Effect.promise(() => started.promise);
          yield* Fiber.interrupt(pending);
          yield* rejection;
        }

        // Cancelled demand released its slots: the same image can be requested
        // again once the cancelled job's bounded teardown frees the render slot.
        release.resolve();
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
        });
        expect(render).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    "waits for actual teardown before advancing a cancelled request's queue slot",
    () =>
      Effect.gen(function* () {
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
        const service = yield* excerptImageFixture({ render });

        const first = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const rejected = assertRejected(first, {
          name: "AbortError",
        });
        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(first);
        yield* rejected;
        const second = yield* service
          .resolve({
            ...request,
            annotation: { ...request.annotation, key: "SECOND" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        try {
          yield* Effect.promise(() => cleanupStarted.promise);
          expect(render).toHaveBeenCalledTimes(1);
        } finally {
          release.resolve();
        }
        expect(yield* Fiber.join(second)).toMatchObject({
          provenance: "rendered",
        });
        expect(render).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    "owns the published snapshot even when the caller edits it before startup settles",
    () =>
      Effect.gen(function* () {
        const input = structuredClone(inkRequest);
        let savedColor: string | null = null;
        const service = yield* excerptImageFixture({
          render: async (snapshot) => {
            savedColor = snapshot.annotation.color;
            return rendered;
          },
        });
        const result = yield* service
          .resolve(input)
          .pipe(Effect.forkChild({ startImmediately: true }));
        input.annotation.color = "#0000ff";
        yield* Fiber.join(result);
        expect(savedColor).toBe("#ff0000");
      }),
  );
  it.effect(
    "reuses canonical pixel inputs across non-rendering edits and source revisions",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        yield* service.resolve(inkRequest);
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
        expect(yield* service.resolve(edited)).toMatchObject({
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
          expect(
            yield* service.resolve({ ...edited, annotation }),
          ).toMatchObject({
            provenance: "rendered",
          });
        expect(f.render).toHaveBeenCalledTimes(5);
      }),
  );

  it.effect(
    "captures each rapid saved edit before waiting for an older render",
    () =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>();
        const old = Promise.withResolvers<ExcerptImage>();
        const colors: (string | null)[] = [];
        const service = yield* excerptImageFixture({
          render: async (snapshot) => {
            colors.push(snapshot.annotation.color);
            if (colors.length === 1) {
              started.resolve();
              return old.promise;
            }
            return rendered;
          },
        });
        const first = yield* service
          .resolve(inkRequest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        const second = yield* service
          .resolve({
            ...inkRequest,
            annotation: { ...inkRequest.annotation, color: "#00ff00" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        const third = yield* service
          .resolve({
            ...inkRequest,
            annotation: { ...inkRequest.annotation, color: "#0000ff" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        old.resolve(rendered);
        yield* Effect.forEach([first, second, third], (fiber) =>
          Fiber.join(fiber),
        );
        expect(colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
      }),
  );

  it.effect(
    "retries uncertain ink fallback and makes failed ink explicit",
    () =>
      Effect.gen(function* () {
        const render = vi.fn(async () => {
          throw new Error("broken PDF");
        });
        const service = yield* excerptImageFixture({
          render,
          read: async () => fallback,
        });
        expect(yield* service.resolve(inkRequest)).toMatchObject({
          provenance: "zotero",
          freshness: "uncertain",
        });
        expect(yield* service.resolve(inkRequest)).toMatchObject({
          provenance: "zotero",
          freshness: "uncertain",
        });
        expect(
          yield* service.resolve({ ...inkRequest, zoteroPngPath: null }),
        ).toEqual({ kind: "unavailable" });
        expect(render).toHaveBeenCalledTimes(3);
      }),
  );

  it.effect(
    "keeps pre-clear work out of storage and starts a new generation for later callers",
    () =>
      Effect.gen(function* () {
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
        const service = yield* excerptImageFixture({
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
        const old = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        yield* service.clear;
        const current = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        gate.resolve(rendered);
        expect(yield* Fiber.join(old)).toMatchObject({
          provenance: "rendered",
        });
        expect(yield* Fiber.join(current)).toMatchObject({
          provenance: "rendered",
        });
        expect(render).toHaveBeenCalledTimes(2);
        expect(put).toHaveBeenCalledTimes(1);
        expect(entries.size).toBe(1);
      }),
  );

  it.effect("revalidates an unchecked entry when the PDF returns", () =>
    Effect.gen(function* () {
      const stamp = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ size: 101, mtimeMs: 11 });
      const render = vi.fn(async () => rendered);
      const service = yield* excerptImageFixture({
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
      expect(yield* service.resolve(request)).toMatchObject({
        provenance: "cache",
        freshness: "unchecked",
      });
      expect(render).not.toHaveBeenCalled();
      expect(yield* service.resolve(request)).toMatchObject({
        provenance: "rendered",
        freshness: "checked",
      });
      expect(render).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect(
    "degrades after open and read failures and refuses persistence without a source scope",
    () =>
      Effect.gen(function* () {
        const render = vi.fn(async () => rendered);
        const failedOpen = yield* excerptImageFixture({
          render,
          openStore: async () => {
            throw new Error("blocked");
          },
        });
        expect(yield* failedOpen.resolve(request)).toMatchObject({
          provenance: "rendered",
        });
        yield* assertRejected(failedOpen.clear, {
          cause: expect.objectContaining({
            message: "Excerpt cache could not be opened",
          }),
        });
        const get = vi.fn(async (): Promise<ExcerptEntry | undefined> => {
          throw new Error("read failed");
        });
        const put = vi.fn(async () => {});
        const service = yield* excerptImageFixture({
          render,
          stamp: async () => ({ size: 1, mtimeMs: 1 }),
          cache: { get, put },
        });
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
        });
        get.mockClear();
        put.mockClear();
        expect(
          yield* service.resolve({ ...request, sourceScope: "" }),
        ).toMatchObject({ provenance: "rendered" });
        expect(get).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
      }),
  );
  it.effect("rejects oversized injected fallback bytes", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array(MAX_FALLBACK_BYTES + 1);
      bytes.set(fallback);
      const service = yield* excerptImageFixture({
        render: async () => {
          throw new Error("render failed");
        },
        read: async () => bytes,
      });
      expect(yield* service.resolve(request)).toEqual({ kind: "unavailable" });
    }),
  );
  it.effect(
    "rejects an oversized fallback file before reading its payload",
    () =>
      Effect.gen(function* () {
        const stack = yield* Effect.acquireDisposable(
          Effect.sync(() => new AsyncDisposableStack()),
        );
        const folder = stack.adopt(
          yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "zotlit-excerpt-")),
          ),
          (folder) => rm(folder, { recursive: true, force: true }),
        );
        const path = join(folder, "image.png");
        const file = yield* Effect.acquireDisposable(
          Effect.promise(() => open(path, "w")),
        );
        yield* Effect.promise(() => file.write(fallback));
        yield* Effect.promise(() => file.truncate(MAX_FALLBACK_BYTES + 1));
        const service = yield* excerptImageFixture({
          render: async () => {
            throw new Error("render failed");
          },
        });
        expect(
          yield* service.resolve({ ...request, zoteroPngPath: path }),
        ).toEqual({
          kind: "unavailable",
        });
      }),
  );
  it.effect(
    "drops cancelled queued work without an unhandled rejection or poisoning the queue",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(async () => {
          started.resolve();
          return gate.promise;
        });
        const service = yield* excerptImageFixture({ render });
        const first = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);

        const cancelled = yield* service
          .resolve({ ...request, attachmentKey: "SECOND" })
          .pipe(Effect.forkChild({ startImmediately: true }));
        const rejection = assertRejected(cancelled, {
          name: "AbortError",
        });
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(service.queueDiagnostics.queued).toBe(1)),
        );
        yield* Fiber.interrupt(cancelled);
        yield* rejection;
        const last = yield* service
          .resolve({ ...request, attachmentKey: "THIRD" })
          .pipe(Effect.forkChild({ startImmediately: true }));
        gate.resolve(rendered);
        expect(yield* Fiber.join(first)).toMatchObject({ kind: "available" });
        expect(yield* Fiber.join(last)).toMatchObject({ kind: "available" });
        expect(render).toHaveBeenCalledTimes(2);
      }),
  );
  it.effect(
    "generates, reuses a matching PDF, and refreshes changed PDF metadata",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
          freshness: "checked",
          bytes: generated,
        });
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "cache",
        });
        // Replacing content with the same metadata is deliberately indistinguishable.
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "cache",
        });
        f.changePdf();
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
        });
        expect(f.render).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    "publishes the revision the renderer loaded, not the one the probe saw",
    () =>
      Effect.gen(function* () {
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
        const service = yield* excerptImageFixture({
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
        const first = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        // The second job's own probe reads that revision, and then waits.
        const late = yield* service
          .resolve(lateRequest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => probed.promise);
        pdf = { size: 101, mtimeMs: 11 };
        gate.resolve();
        expect(yield* Fiber.join(first)).toMatchObject({
          provenance: "rendered",
          identity: { pdf: { size: 100, mtimeMs: 10 } },
        });
        // The bytes it renders are the replacement revision, and so is the stamp
        // published beside them and stored under the excerpt's key.
        expect(yield* Fiber.join(late)).toMatchObject({
          provenance: "rendered",
          bytes: replacement,
          identity: { pdf: { size: 101, mtimeMs: 11 } },
        });
        expect(entries.get(excerptKey(lateRequest))?.pdf).toEqual({
          size: 101,
          mtimeMs: 11,
        });
        // An unchanged request reuses those bytes instead of rendering again.
        expect(yield* service.resolve(lateRequest)).toMatchObject({
          provenance: "cache",
          bytes: replacement,
        });
        expect(render).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect("uses matching cached pixels when the PDF cannot be checked", () =>
    Effect.gen(function* () {
      const service = yield* excerptImageFixture({
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
      expect(yield* service.resolve(request)).toMatchObject({
        provenance: "cache",
        freshness: "unchecked",
      });
    }),
  );

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

  it.effect(
    "completes a cache hit while an unrelated render holds the queue",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        yield* service.resolve(request);
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        f.render.mockImplementationOnce(() => {
          started.resolve();
          return gate.promise;
        });
        const blocked = yield* service
          .resolve({
            ...request,
            annotation: { ...request.annotation, key: "ANNOT002" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        // A cache hit resolves without waiting for the blocked render.
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "cache",
          bytes: generated,
        });
        expect(f.render).toHaveBeenCalledTimes(2);
        gate.resolve(rendered);
        expect(yield* Fiber.join(blocked)).toMatchObject({
          provenance: "rendered",
        });
      }),
  );

  it.effect(
    "returns a stored cache hit while every admission slot is taken",
    () =>
      Effect.gen(function* () {
        const f = yield* storedExcerptWithBlockedRenders(128);
        const service = f.service;
        try {
          // Every slot is held by a blocked render, and the stored bytes still
          // resolve without one.
          expect(yield* service.resolve(request)).toMatchObject({
            provenance: "cache",
            bytes: generated,
          });
          expect(f.render).toHaveBeenCalledTimes(2);
        } finally {
          f.release();
        }
        expect(
          (yield* Effect.forEach(f.pending, (fiber) =>
            Fiber.join(fiber),
          )).every((result) => result.kind === "available"),
        ).toBe(true);
        expect(f.render).toHaveBeenCalledTimes(129);
      }),
  );

  it.effect(
    "records the excerpt key and the queue's counts at the admission decision",
    () =>
      Effect.gen(function* () {
        const f = yield* storedExcerptWithBlockedRenders(128);
        const service = f.service;
        const firstRequest = {
          ...request,
          annotation: { ...request.annotation, key: "WAITING-A" },
        };
        const first = yield* service
          .resolve(firstRequest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(
              captured.find(
                (record) => record.properties.key === excerptKey(firstRequest),
              ),
            ).toBeDefined(),
          ),
        );
        const secondRequest = {
          ...request,
          annotation: { ...request.annotation, key: "WAITING-B" },
        };
        const second = yield* service
          .resolve(secondRequest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(
              captured.find(
                (record) => record.properties.key === excerptKey(secondRequest),
              ),
            ).toBeDefined(),
          ),
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
        const outcomes = yield* Effect.forEach(
          [first, second, ...f.pending],
          (fiber) => Fiber.join(fiber),
        );
        expect(outcomes.every((outcome) => outcome.kind === "available")).toBe(
          true,
        );
      }),
  );

  it.effect(
    "keeps shared work alive while another caller still demands it",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(async (_request, signal: AbortSignal) => {
          started.resolve();
          await gate.promise;
          signal.throwIfAborted();
          return rendered;
        });
        const service = yield* excerptImageFixture({
          stamp: async () => ({ size: 1, mtimeMs: 1 }),
          render,
        });

        const database = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const api = yield* service
          .resolve({
            ...request,
            source: { kind: "zotero-local-api", serverID: "SERVER" },
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        const rejection = assertRejected(database, {
          name: "AbortError",
        });
        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(database);
        yield* rejection;
        // The remaining representation still receives the single shared render.
        gate.resolve(rendered);
        expect(yield* Fiber.join(api)).toMatchObject({
          provenance: "rendered",
          bytes: generated,
        });
        expect(render).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect("releases shared work once its last caller cancels", () =>
    Effect.gen(function* () {
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
      const service = yield* excerptImageFixture({
        stamp: async () => ({ size: 1, mtimeMs: 1 }),
        render,
      });

      const first = yield* service
        .resolve(request)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const second = yield* service
        .resolve({
          ...request,
          source: { kind: "zotero-local-api", serverID: "SERVER" },
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const rejections = [
        assertRejected(first, { name: "AbortError" }),
        assertRejected(second, { name: "AbortError" }),
      ];
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(first);
      yield* rejections[0]!;
      expect(aborted).toBe(false);
      // Only the last caller's cancellation releases the shared render.
      yield* Fiber.interrupt(second);
      yield* rejections[1]!;
      yield* Effect.promise(() => released.promise);
      expect(render).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("carries the validated identity on every available outcome", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const service = f.service;
      const identity = {
        key: excerptKey(request),
        fingerprint: excerptFingerprint(request.annotation),
      };
      expect(yield* service.resolve(request)).toMatchObject({
        provenance: "rendered",
        identity: { ...identity, pdf: { size: 100, mtimeMs: 10 } },
      });
      expect(yield* service.resolve(request)).toMatchObject({
        provenance: "cache",
        identity: { ...identity, pdf: { size: 100, mtimeMs: 10 } },
      });
      const unreadable = yield* excerptImageFixture({
        stamp: async () => {
          throw new Error("offline");
        },
        cache: {
          get: async () => ({ ...rendered, pdf: { size: 100, mtimeMs: 10 } }),
          put: async () => {},
        },
      });
      expect(yield* unreadable.resolve(request)).toMatchObject({
        provenance: "cache",
        identity: { ...identity, pdf: null },
      });
      const fallbackOnly = yield* excerptImageFixture({
        render: async () => {
          throw new Error("broken PDF");
        },
        read: async () => fallback,
      });
      expect(yield* fallbackOnly.resolve(request)).toMatchObject({
        provenance: "zotero",
        identity: { ...identity, pdf: null },
      });
    }),
  );

  it.effect(
    "retries rendering after an uncertain fallback and never validates that fallback",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        f.render.mockRejectedValueOnce(new Error("broken PDF"));
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "zotero",
          freshness: "uncertain",
          bytes: fallback,
        });
        expect(f.entries.size).toBe(0);
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
          bytes: generated,
        });
      }),
  );

  it.effect(
    "returns unavailable for total failure but preserves generated bytes when persistence fails",
    () =>
      Effect.gen(function* () {
        const failed = yield* excerptImageFixture({
          stamp: async () => ({ size: 1, mtimeMs: 1 }),
          render: async () => {
            throw new Error("bad PDF");
          },
          read: async () => {
            throw new Error("missing");
          },
        });
        expect(yield* failed.resolve(request)).toEqual({ kind: "unavailable" });
        const working = yield* excerptImageFixture({
          stamp: async () => ({ size: 1, mtimeMs: 1 }),
          render: async () => rendered,
          cache: {
            get: async () => undefined,
            put: async () => {
              throw new Error("quota");
            },
          },
        });
        expect(yield* working.resolve(request)).toMatchObject({
          provenance: "rendered",
          bytes: generated,
        });
      }),
  );

  it.effect(
    "shares identical work while cancellation releases only that caller",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(() => {
          started.resolve();
          return gate.promise;
        });
        const service = yield* excerptImageFixture({
          render,
          stamp: async () => ({ size: 1, mtimeMs: 1 }),
        });

        const first = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const rejected = assertRejected(first, {
          name: "AbortError",
        });
        const second = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(first);
        yield* rejected;
        gate.resolve(rendered);
        expect(yield* Fiber.join(second)).toMatchObject({
          provenance: "rendered",
        });
        expect(render).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect(
    "cancels abandoned work and allows the same image to be requested again",
    () =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<void>();
        let first = true;
        const service = yield* excerptImageFixture({
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

        const pending = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const rejection = assertRejected(pending, {
          name: "AbortError",
        });
        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(pending);
        yield* rejection;
        yield* Effect.promise(() => released.promise);
        expect(yield* service.resolve(request)).toMatchObject({
          provenance: "rendered",
        });
      }),
  );

  it.effect("shutdown aborts owned rendering and refuses later requests", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      let released = false;
      const service = yield* excerptImageFixture({
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
      const pending = yield* service
        .resolve(request)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const rejection = assertRejected(pending, {
        name: "AbortError",
      });
      yield* Effect.promise(() => started.promise);
      const disposal = service.close;
      expect(service.close).toBe(disposal);
      yield* disposal;
      yield* rejection;
      expect(released).toBe(true);
      yield* assertRejected(service.resolve(request), {
        name: "AbortError",
      });
    }),
  );
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

  it.effect(
    "publishes the image of the saved pixels, and survives a failed replacement",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        yield* service.resolve(inkRequest);
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
        yield* Effect.gen(function* () {
          expect(yield* service.resolve(saved)).toMatchObject({
            kind: "available",
            provenance: "zotero",
            freshness: "uncertain",
          });
        });
        expect(f.references.get(record)).toBe(previous);

        yield* Effect.gen(function* () {
          expect(yield* service.resolve(saved)).toMatchObject({
            provenance: "rendered",
          });
        });
        expect(f.references.get(record)?.fingerprint).toBe(
          excerptFingerprint(saved.annotation),
        );
      }),
  );

  it.effect(
    "takes the newer saved snapshot when it joins the older one's live job",
    () =>
      Effect.gen(function* () {
        const entries = new Map<string, ExcerptEntry>();
        const references = new Map<string, ExcerptIdentity>();
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        const render = vi.fn(async () => {
          started.resolve();
          return gate.promise;
        });
        const service = yield* excerptImageFixture({
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
        const a = yield* service
          .resolve(first)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const b = yield* service
          .resolve(second)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);
        const joined = yield* service
          .resolve(latest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        gate.resolve(rendered);
        yield* Effect.forEach([a, b, joined], (fiber) => Fiber.join(fiber));

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
      }),
  );

  it.effect(
    "keeps the newest saved pixels when a stale result lands last",
    () =>
      Effect.gen(function* () {
        const entries = new Map<string, ExcerptEntry>();
        const references = new Map<string, ExcerptIdentity>();
        const gate = Promise.withResolvers<void>();
        let stale = false;
        const service = yield* excerptImageFixture({
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
        yield* service.resolve(inkRequest);
        expect(references.get(record)?.fingerprint).toBe(
          excerptFingerprint(inkRequest.annotation),
        );

        // A request for the pixels the device already holds — a captured note, a
        // read that started before the edit — is admitted first and answers late.
        stale = true;
        const late = yield* service
          .resolve(inkRequest)
          .pipe(Effect.forkChild({ startImmediately: true }));
        const saved = recolor("#00ff00");
        const current = yield* service
          .resolve(saved)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(references.get(record)?.fingerprint).toBe(
              excerptFingerprint(saved.annotation),
            ),
          ),
        );

        gate.resolve();
        yield* Effect.gen(function* () {
          expect(yield* Fiber.join(late)).toMatchObject({
            provenance: "cache",
            bytes: generated,
          });
        });
        yield* Fiber.join(current);
        expect(references.get(record)?.fingerprint).toBe(
          excerptFingerprint(saved.annotation),
        );
      }),
  );

  it.effect(
    "keeps the saved edit's pixels when an older snapshot is admitted after them",
    () =>
      Effect.gen(function* () {
        const entries = new Map<string, ExcerptEntry>();
        const references = new Map<string, ExcerptIdentity>();
        const service = yield* excerptImageFixture({
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
        yield* Effect.gen(function* () {
          expect(yield* service.resolve(saved)).toMatchObject({
            provenance: "rendered",
          });
        });
        expect(references.get(record)?.fingerprint).toBe(
          excerptFingerprint(saved.annotation),
        );

        // A note or batch resolution holds the record as it was before that edit,
        // and is admitted after the edit has settled. Its pixels are older, so its
        // answer cannot become the latest reference.
        const stale = recolor("#ff0000", 1);
        yield* Effect.gen(function* () {
          expect(yield* service.resolve(stale)).toMatchObject({
            provenance: "rendered",
          });
        });
        expect(references.get(record)?.fingerprint).toBe(
          excerptFingerprint(saved.annotation),
        );
      }),
  );

  it.effect(
    "stops work a clear overtook from restoring pixels or a reference",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        const gate = Promise.withResolvers<ExcerptImage>();
        const started = Promise.withResolvers<void>();
        f.render.mockImplementationOnce(async () => {
          started.resolve();
          return gate.promise;
        });
        const pending = yield* service
          .resolve(request)
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started.promise);

        yield* service.clear;
        gate.resolve(rendered);
        yield* Effect.gen(function* () {
          expect(yield* Fiber.join(pending)).toMatchObject({
            kind: "available",
            provenance: "rendered",
          });
        });
        expect(f.entries.size).toBe(0);
        expect(f.references.size).toBe(0);
      }),
  );

  it.effect(
    "leaves durable note assets and Zotero's own cache out of the clear",
    () =>
      Effect.gen(function* () {
        const stack = yield* Effect.acquireDisposable(
          Effect.sync(() => new AsyncDisposableStack()),
        );
        const folder = stack.adopt(
          yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "zotlit-excerpt-clear-")),
          ),
          (folder) => rm(folder, { recursive: true, force: true }),
        );
        const asset = join(folder, "excerpt.webp");
        const zoteroImage = join(folder, "ANNOT001.png");
        yield* Effect.promise(() => writeFile(asset, generated));
        yield* Effect.promise(() => writeFile(zoteroImage, fallback));
        const f = yield* fixture();
        const service = f.service;
        yield* service.resolve({ ...request, zoteroPngPath: zoteroImage });
        expect(f.entries.size).toBe(1);

        yield* service.clear;
        expect(f.entries.size).toBe(0);
        expect(f.references.size).toBe(0);
        expect(yield* Effect.promise(() => readFile(asset))).toEqual(
          Buffer.from(generated),
        );
        expect(yield* Effect.promise(() => readFile(zoteroImage))).toEqual(
          Buffer.from(fallback),
        );
      }),
  );

  it.effect(
    "reads back the image this device last stored for an Annotation",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const service = f.service;
        yield* service.resolve(inkRequest);
        expect(yield* service.stored(inkRequest)).toMatchObject({
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
          (yield* service.stored(recolor("#00ff00")))?.identity.fingerprint,
        ).toBe(excerptFingerprint(inkRequest.annotation));

        // Evicted bytes read as nothing, even though the reference stands, and a
        // cache that keeps no references reads as nothing either.
        f.entries.clear();
        expect(yield* service.stored(inkRequest)).toBeNull();
        const bare = yield* excerptImageFixture({
          cache: { get: async () => undefined, put: async () => {} },
        });
        const _bare = bare;
        expect(yield* bare.stored(inkRequest)).toBeNull();
      }),
  );
});

// #1790: deadlines and finalizers run on the layer's Effect clock.
it.effect(
  "stops new renders after a timed-out host cannot finish cleanup",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const render = vi.fn(() => {
        started.resolve();
        return new Promise<ExcerptImage>(() => {});
      });
      const context = yield* Layer.build(
        layerExcerptImage({ render }).pipe(
          Layer.provide(
            Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
          ),
        ),
      );
      const service = Context.get(context, ExcerptImages);
      const fiber = yield* service
        .resolve(request)
        .pipe(Effect.exit, Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust(35_000);
      yield* TestClock.adjust(5_000);
      const exit = yield* Fiber.join(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(
        yield* service.resolve({
          ...request,
          annotation: { ...request.annotation, key: "SECOND" },
        }),
      ).toEqual({ kind: "unavailable" });
      expect(render).toHaveBeenCalledTimes(1);
    }),
);

it.effect("keeps capacity waits open beyond a preflight deadline", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<ExcerptImage>();
    const second = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const render = vi.fn(() => {
      if (render.mock.calls.length === 1) {
        started.resolve();
        return first.promise;
      }
      if (render.mock.calls.length === 2) {
        secondStarted.resolve();
        return second.promise;
      }
      return Promise.resolve(rendered);
    });
    const context = yield* Layer.build(
      layerExcerptImage({ render }).pipe(
        Layer.provide(
          Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
        ),
      ),
    );
    const service = Context.get(context, ExcerptImages);
    const fibers = yield* Effect.forEach(
      Array.from({ length: 129 }, (_, index) => index),
      (index) =>
        service
          .resolve({
            ...request,
            annotation: { ...request.annotation, key: `ANNOT${index}` },
          })
          .pipe(Effect.forkChild({ startImmediately: true })),
    );
    yield* Effect.promise(() => started.promise);
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(service.queueDiagnostics.awaiting).toBe(1)),
    );
    yield* TestClock.adjust(20_000);
    first.resolve(rendered);
    yield* Effect.promise(() => secondStarted.promise);
    yield* TestClock.adjust(20_000);
    second.resolve(rendered);
    const outcomes = yield* Effect.forEach(fibers, (fiber) =>
      Fiber.join(fiber),
    );
    expect(outcomes.every((outcome) => outcome.kind === "available")).toBe(
      true,
    );
    expect(render).toHaveBeenCalledTimes(129);
  }),
);

const assertRejected = Effect.fnUntraced(function* <A, E>(
  input: Effect.Effect<A, E> | Fiber.Fiber<A, E>,
  expected: Record<string, unknown>,
) {
  const exit = yield* Effect.isEffect(input)
    ? Effect.exit(input)
    : Fiber.await(input);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    if (expected.name === "AbortError")
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    else expect(Cause.squash(exit.cause)).toMatchObject(expected);
  }
});

// #1790: a started cache mutation holds its barrier through interruption.
it.effect(
  "an interrupted clear holds later resolutions until the store finishes",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const get = vi.fn(async () => undefined);
      const render = vi.fn(async () => rendered);
      const service = yield* excerptImageFixture({
        cache: {
          get,
          put: async () => {},
          clear: () => {
            started.resolve();
            return release.promise;
          },
        },
        render,
      });
      const clearing = yield* service.clear.pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.promise(() => started.promise);
      const interrupted = yield* Fiber.interrupt(clearing).pipe(
        Effect.forkChild,
      );
      const resolving = yield* service
        .resolve(request)
        .pipe(Effect.forkChild({ startImmediately: true }));
      expect(get).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      release.resolve();
      yield* Fiber.join(interrupted);
      expect(yield* Fiber.join(resolving)).toMatchObject({
        provenance: "rendered",
      });
    }),
);

it.effect("an interrupted startup disposes a store that opens later", () =>
  Effect.gen(function* () {
    const opened = Promise.withResolvers<import("./store").ExcerptStore>();
    const started = Promise.withResolvers<void>();
    const dispose = vi.fn();
    const fiber = yield* excerptImageFixture({
      openStore: () => {
        started.resolve();
        return opened.promise;
      },
    }).pipe(Effect.scoped, Effect.forkChild);
    yield* Effect.promise(() => started.promise);
    const interrupted = yield* Fiber.interrupt(fiber).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    opened.resolve(
      stubService<import("./store").ExcerptStore>("Store", {
        [Symbol.dispose]: dispose,
      }),
    );
    yield* Fiber.join(interrupted);
    expect(dispose).toHaveBeenCalledTimes(1);
  }),
);
