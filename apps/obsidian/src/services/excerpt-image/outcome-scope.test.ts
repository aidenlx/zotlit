import { it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, FileSystem, Layer } from "effect";
import { TestClock } from "effect/testing";
// What one initiating batch retains, and what it refuses to retain.
import { describe, expect, vi } from "vitest";

import { NodeExcerptImageFixture as ExcerptImageService } from "@/services/excerpt-image/__fixtures__/node-service";

import { availableOutcome } from "./__fixtures__/outcome";
import { redPng } from "./__fixtures__/png";
import { PNG_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import { ExcerptOutcomeScope } from "./outcome-scope";
import {
  ExcerptImageService as ExcerptImages,
  layerExcerptImage,
} from "./service";
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
/** The same Annotation with its pixel inputs moved, so it hashes differently. */
const movedRequest: ExcerptRequest = {
  ...request,
  annotation: {
    ...request.annotation,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[11, 21, 81, 91]] },
  },
};

function fixture(options: { bytes?: number; failWrites?: boolean } = {}) {
  const bytes = new Uint8Array(options.bytes ?? 3).fill(1);
  const entries = new Map<string, ExcerptEntry>();
  let pdf = { size: 100, mtimeMs: 10 };
  const render = vi.fn(async (): Promise<ExcerptImage> => ({
    bytes,
    format: PNG_FORMAT,
  }));
  const service = new ExcerptImageService({
    cache: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        if (options.failWrites) throw new Error("store write failed");
        entries.set(key, entry);
      },
    },
    stamp: async () => pdf,
    render,
    read: async () => redPng,
  });
  return {
    service,
    render,
    entries,
    changePdf: () => {
      pdf = { size: 101, mtimeMs: 11 };
    },
  };
}

describe("Excerpt outcome scope", () => {
  it("answers a repeat of a settled excerpt without touching the PDF pipeline", async () => {
    const f = fixture();
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    const first = await operation.resolve(request);
    const second = await operation.resolve(request);
    expect(first).toMatchObject({ provenance: "rendered" });
    expect(second).toBe(first);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(outcomes.diagnostics).toMatchObject({
      retained: 1,
      bytes: 3,
      peakBytes: 3,
      hits: 1,
      misses: 1,
      released: false,
    });
  });

  it("answers a repeat from retention without reading the store", async () => {
    const entries = new Map<string, ExcerptEntry>();
    const stored = vi.fn(async (key: string) => entries.get(key));
    const render = vi.fn(async (): Promise<ExcerptImage> => ({
      bytes: new Uint8Array(3),
      format: PNG_FORMAT,
    }));
    await using service = new ExcerptImageService({
      cache: {
        get: stored,
        put: async (key, entry) => {
          entries.set(key, entry);
        },
      },
      stamp: async () => ({ size: 100, mtimeMs: 10 }),
      render,
    });
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    expect(await operation.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    stored.mockClear();
    // Retention holds these bytes, so the repeat answers from memory: a store
    // that stalls or fails cannot hold back what the batch already owns.
    expect(await operation.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    expect(stored).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reuses the bytes a store whose write failed never kept", async () => {
    const f = fixture({ failWrites: true });
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    const first = await operation.resolve(request);
    const second = await operation.resolve(request);
    expect(first).toMatchObject({ provenance: "rendered" });
    expect(second).toBe(first);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.entries.size).toBe(0);
    expect(outcomes.diagnostics).toMatchObject({ retained: 1, hits: 1 });
  });

  it("reuses a stable failure for the same excerpt", async () => {
    const f = fixture();
    f.render.mockRejectedValue(new Error("PDF unavailable"));
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    const bare = { ...request, zoteroPngPath: null };
    expect(await operation.resolve(bare)).toEqual({ kind: "unavailable" });
    expect(await operation.resolve(bare)).toEqual({ kind: "unavailable" });
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(outcomes.diagnostics).toMatchObject({
      retained: 1,
      bytes: 0,
      failures: 1,
      fallbacks: 0,
      hits: 1,
    });
  });

  it("reuses an uncertain Zotero fallback and keeps it classed apart from generated pixels", async () => {
    const f = fixture();
    f.render.mockRejectedValue(new Error("PDF unavailable"));
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    const first = await operation.resolve(request);
    const second = await operation.resolve(request);
    expect(first).toMatchObject({
      kind: "available",
      provenance: "zotero",
      freshness: "uncertain",
      bytes: redPng,
    });
    expect(second).toBe(first);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(outcomes.diagnostics).toMatchObject({
      retained: 1,
      bytes: redPng.length,
      fallbacks: 1,
      failures: 0,
      hits: 1,
    });
  });

  it("resolves again when the Annotation's rendering inputs change", async () => {
    const f = fixture();
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    await operation.resolve(request);
    await operation.resolve(movedRequest);
    expect(f.render).toHaveBeenCalledTimes(2);
    expect(outcomes.diagnostics).toMatchObject({ retained: 2, hits: 0 });
  });

  it("resolves again when the PDF's freshness evidence changes", async () => {
    const f = fixture();
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    await operation.resolve(request);
    f.changePdf();
    await operation.resolve(request);
    expect(f.render).toHaveBeenCalledTimes(2);
    // The record the changed PDF invalidated is gone, not shadowed by a new one.
    expect(outcomes.diagnostics).toMatchObject({ retained: 1, hits: 0 });
  });

  it("evicts the least recently used entry at the entry bound, allowing recomputation", async () => {
    const f = fixture({ failWrites: true });
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope({ entries: 2 });
    await using operation = service.operation({ outcomes });
    const keyed = (key: string) => ({
      ...request,
      annotation: { ...request.annotation, key },
    });
    await operation.resolve(keyed("FIRST"));
    await operation.resolve(keyed("SECOND"));
    // The hit makes FIRST the most recently used, so SECOND leaves next.
    await operation.resolve(keyed("FIRST"));
    await operation.resolve(keyed("THIRD"));
    expect(outcomes.diagnostics).toMatchObject({ retained: 2, hits: 1 });
    expect(f.render).toHaveBeenCalledTimes(3);
    await operation.resolve(keyed("FIRST"));
    // FIRST is still retained; SECOND recomputes.
    await operation.resolve(keyed("SECOND"));
    expect(f.render).toHaveBeenCalledTimes(4);
    expect(outcomes.diagnostics).toMatchObject({ retained: 2, hits: 2 });
  });

  it("evicts at the encoded-byte bound and refuses one image larger than it", async () => {
    const f = fixture({ bytes: 4, failWrites: true });
    await using service = f.service;
    await using outcomes = new ExcerptOutcomeScope({ bytes: 6 });
    const operation = service.operation({ outcomes });
    const keyed = (key: string) => ({
      ...request,
      annotation: { ...request.annotation, key },
    });
    const small = await operation.resolve(keyed("SMALL"));
    const evicting = await operation.resolve(keyed("EVICTING"));
    expect(small).toMatchObject({ kind: "available" });
    expect(evicting).toMatchObject({ kind: "available" });
    // Two 4-byte images cannot both stay under a 6-byte bound, and the peak is
    // what the retention holds afterwards: eviction runs in the same step.
    expect(outcomes.diagnostics).toMatchObject({
      retained: 1,
      bytes: 4,
      peakBytes: 4,
    });
    await operation.resolve(keyed("SMALL"));
    expect(f.render).toHaveBeenCalledTimes(3);

    f.render.mockImplementation(async () => ({
      bytes: new Uint8Array(7).fill(2),
      format: PNG_FORMAT,
    }));
    const oversized = await operation.resolve(keyed("OVERSIZED"));
    expect(oversized).toMatchObject({ kind: "available" });
    // The oversized image is left out rather than evicting everything else.
    expect(outcomes.diagnostics).toMatchObject({ retained: 1, bytes: 4 });
    await operation.resolve(keyed("SMALL"));
    expect(f.render).toHaveBeenCalledTimes(4);
    await operation[Symbol.asyncDispose]();
  });

  it("shares one resolution across simultaneous batches and keeps what each retains", async () => {
    const f = fixture({ failWrites: true });
    await using service = f.service;
    await using first = new ExcerptOutcomeScope();
    await using second = new ExcerptOutcomeScope();
    await using one = service.operation({ outcomes: first });
    await using two = service.operation({ outcomes: second });
    // The store keeps nothing here, so only each batch's own retention can
    // answer its repeats.
    const [a, b, unscoped] = await Promise.all([
      one.resolve(request),
      two.resolve(request),
      service.resolve(request),
    ]);
    // Identical active work is one admission: the two batches and the
    // scope-less consumer render it once.
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ kind: "available" });
    expect(b).toMatchObject({ kind: "available" });
    expect(unscoped).toMatchObject({ kind: "available" });
    // Each batch retains that one answer for itself, and reads only its own.
    expect(first.diagnostics).toMatchObject({ retained: 1, hits: 0 });
    expect(second.diagnostics).toMatchObject({ retained: 1, hits: 0 });
    await one.resolve(request);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(first.diagnostics).toMatchObject({ retained: 1, hits: 1 });
    expect(second.diagnostics).toMatchObject({ retained: 1, hits: 0 });
  });

  it.effect.each([false, true])(
    "does not retain a stopped queue's answer (already queued: %s)",
    (queued) =>
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
        const outcomes = yield* Effect.acquireDisposable(
          Effect.sync(() => new ExcerptOutcomeScope()),
        );
        const operation = yield* service.operation({ outcomes });
        const first = yield* operation
          .resolve(request)
          .pipe(Effect.exit, Effect.forkChild);
        yield* Effect.promise(() => started.promise);
        yield* TestClock.adjust(35_000);
        const nextRequest = {
          ...request,
          annotation: { ...request.annotation, key: "SECOND" },
        };
        const next = queued
          ? yield* operation.resolve(nextRequest).pipe(Effect.forkChild)
          : undefined;
        if (next)
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(service.queueDiagnostics.queued).toBe(1)),
          );
        yield* TestClock.adjust(5_000);
        expect(Exit.isFailure(yield* Fiber.join(first))).toBe(true);
        expect(
          next
            ? yield* Fiber.join(next)
            : yield* operation.resolve(nextRequest),
        ).toEqual({ kind: "unavailable" });
        expect(render).toHaveBeenCalledTimes(1);
        expect(outcomes.diagnostics).toMatchObject({ retained: 0, hits: 0 });
      }),
  );

  it("does not retain a cancelled resolution", async () => {
    const gate = Promise.withResolvers<ExcerptImage>();
    const started = Promise.withResolvers<void>();
    const render = vi.fn(async () => {
      started.resolve();
      return gate.promise;
    });
    await using service = new ExcerptImageService({ render });
    await using outcomes = new ExcerptOutcomeScope();
    const operation = service.operation({ outcomes });
    const controller = new AbortController();
    const cancelled = expect(
      operation.resolve(request, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    controller.abort();
    // The cancelled job's teardown owns the slot until its own render settles.
    gate.resolve({ bytes: new Uint8Array([1, 2, 3]), format: PNG_FORMAT });
    await cancelled;
    // The cancelled job keeps nothing for the batch, even if its render had
    // already produced bytes: a later consumer resolves for itself.
    expect(outcomes.diagnostics).toMatchObject({ retained: 0, hits: 0 });
    expect(await operation.resolve(request)).toMatchObject({
      provenance: "rendered",
    });
    expect(render).toHaveBeenCalledTimes(2);
    expect(outcomes.diagnostics).toMatchObject({
      retained: 1,
      failures: 0,
      hits: 0,
      misses: 2,
    });
    await operation[Symbol.asyncDispose]();
    await service[Symbol.asyncDispose]();
  });

  it("releases the retention when the batch releases it", async () => {
    const f = fixture({ failWrites: true });
    await using service = f.service;
    const outcomes = new ExcerptOutcomeScope();
    await using operation = service.operation({ outcomes });
    await operation.resolve(request);
    expect(outcomes.diagnostics).toMatchObject({ retained: 1, bytes: 3 });
    await outcomes[Symbol.asyncDispose]();
    expect(outcomes.diagnostics).toMatchObject({
      retained: 0,
      bytes: 0,
      peakBytes: 3,
      released: true,
    });
    // Nothing refills a released batch: a later consumer resolves again.
    await operation.resolve(request);
    expect(f.render).toHaveBeenCalledTimes(2);
    expect(outcomes.diagnostics).toMatchObject({
      retained: 0,
      hits: 0,
      misses: 2,
    });
  });

  it("keeps retention until the consumer it admitted settles", async () => {
    const outcomes = new ExcerptOutcomeScope();
    outcomes.retain(
      "key",
      { size: 1, mtimeMs: 1 },
      availableOutcome({
        bytes: redPng,
        format: PNG_FORMAT,
        provenance: "rendered",
        freshness: "checked",
      }),
    );
    const consumer = outcomes.admit();
    const disposing = outcomes[Symbol.asyncDispose]();
    expect(outcomes.diagnostics).toMatchObject({
      released: true,
      consumers: 1,
      retained: 1,
    });
    consumer[Symbol.dispose]();
    await disposing;
    expect(outcomes.diagnostics).toMatchObject({
      released: true,
      consumers: 0,
      retained: 0,
      bytes: 0,
    });
  });
});
