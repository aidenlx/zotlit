import { open, stat } from "node:fs/promises";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import { abortable } from "./abort";
import { excerptFingerprint, excerptKey } from "./contract";
import type { ExcerptRequest } from "./contract";
import { PNG_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import type { ExcerptOutcomeScope } from "./outcome-scope";
import { ExcerptPdfQueue } from "./pdf-queue";
import { usableExcerptPng } from "./png";
import { ExcerptRenderer } from "./renderer";
import type { ExcerptRendererDiagnostics } from "./renderer";
import type { ExcerptStore } from "./store";
export {
  EXCERPT_RENDERER_VERSION,
  excerptFingerprint,
  excerptKey,
  excerptSourceIdentity,
} from "./contract";
export type { ExcerptRequest } from "./contract";
export { excerptRequest } from "./request";

const logger = getLogger("excerpt-image");

/** Size/mtime validation intentionally cannot detect a replacement with identical metadata. */
export interface PdfStamp {
  size: number;
  mtimeMs: number;
}
export interface ExcerptEntry extends ExcerptImage {
  pdf: PdfStamp;
}
export interface ExcerptCache {
  get(key: string, pdf?: PdfStamp): Promise<ExcerptEntry | undefined>;
  put(key: string, entry: ExcerptEntry): Promise<void>;
  clear?(): Promise<void>;
}
/** What an available excerpt was resolved against, for a later latest reference. */
export interface ExcerptIdentity {
  /** Canonical cache key ({@link excerptKey}) of the request that was resolved. */
  key: string;
  /** Canonical pixel fingerprint ({@link excerptFingerprint}) of its snapshot. */
  fingerprint: string;
  /** PDF stamp that proved freshness; `null` when nothing was proven. */
  pdf: PdfStamp | null;
}
export type ExcerptOutcome =
  | ({
      kind: "available";
      provenance: "rendered" | "cache" | "zotero";
      freshness: "checked" | "unchecked" | "uncertain";
      identity: ExcerptIdentity;
    } & ExcerptImage)
  | { kind: "unavailable" };

export interface ExcerptDeps {
  cache?: ExcerptCache;
  openStore?: () => Promise<ExcerptStore>;
  stamp?: (path: string) => Promise<PdfStamp>;
  read?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  render?: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<ExcerptImage>;
}

export const MAX_FALLBACK_BYTES = 32 * 1024 * 1024;

/** One resolution's bound on PDF work and on the preflight that precedes it. */
const EXCERPT_JOB_DEADLINE_MS = 35_000;

/** Check the open file before allocating; one extra byte detects later growth. */
async function readFallback(
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  await using file = await open(path, "r");
  signal.throwIfAborted();
  const { size } = await file.stat();
  if (size > MAX_FALLBACK_BYTES)
    throw new Error("Zotero image exceeds byte limit");
  const bytes = new Uint8Array(size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset > size) throw new Error("Zotero image changed while reading");
  return bytes.subarray(0, offset);
}

interface Pending {
  controller: AbortController;
  promise: Promise<ExcerptOutcome>;
  users: number;
}

/**
 * What a stalled queue answers with. It is a scheduler artifact, not a
 * resolution, so the two places that hand it out share one value the batch
 * retention can recognise and refuse to keep.
 */
const STALLED: ExcerptOutcome = { kind: "unavailable" };

/** Freshness and cache evidence gathered before queue admission. */
interface ExcerptProbe {
  /** PDF stamp that validated freshness; `undefined` when it could not be read. */
  pdf: PdfStamp | undefined;
  /** The cache record for the key, whether or not its stamp matched. */
  cached: ExcerptEntry | undefined;
}

/** The record a probe validated: an unreadable PDF stamp accepts it unchanged. */
function validatedEntry(probe: ExcerptProbe): ExcerptEntry | undefined {
  const { pdf, cached } = probe;
  if (!cached) return undefined;
  if (!pdf) return cached;
  return pdf.size === cached.pdf.size && pdf.mtimeMs === cached.pdf.mtimeMs
    ? cached
    : undefined;
}

export interface ExcerptImageOperation extends AsyncDisposable {
  resolve(
    request: ExcerptRequest,
    signal?: AbortSignal,
  ): Promise<ExcerptOutcome>;
}

/** Owns resolution, shared requests, and the bounded rendering queue. */
export class ExcerptImageService extends Service<ExcerptCache | undefined> {
  ready: Promise<ExcerptCache | undefined>;
  readonly #deps;
  readonly #pending = new Map<string, Pending>();
  readonly #shutdown = new AbortController();
  readonly #queue = new ExcerptPdfQueue();
  #generation = 0;
  #clearing: Promise<void> = Promise.resolve();
  #renderer?: ExcerptRenderer;
  #stalled = false;
  #operations = 0;

  /** Internal lifecycle diagnostics used by the real-app acceptance suite. */
  get rendererDiagnostics(): ExcerptRendererDiagnostics | undefined {
    return this.#renderer?.diagnostics;
  }

  /** Admission and slot counts, for tests and the measurement harness. */
  get queueDiagnostics(): ExcerptPdfQueue["diagnostics"] {
    return this.#queue.diagnostics;
  }

  constructor(deps: ExcerptDeps = {}) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<ExcerptCache | undefined> {
    await using stack = new AsyncDisposableStack();
    if (!this.#deps.render) this.#renderer = stack.use(new ExcerptRenderer());
    let cache = this.#deps.cache;
    if (this.#deps.openStore) {
      try {
        cache = stack.use(await this.#deps.openStore());
      } catch (error) {
        logger.debug("Excerpt cache open failed", { error });
      }
    }
    stack.defer(async () => {
      this.#shutdown.abort();
      for (const pending of this.#pending.values()) pending.controller.abort();
      await Promise.allSettled(
        [...this.#pending.values()].map((p) => p.promise),
      );
      // A queued task's own bounded teardown holds its slot; this waits for it.
      await this.#queue.idle();
    });
    this.commit(stack.move());
    return cache;
  }

  /** Clear only derived entries; old requests can finish but cannot refill them. */
  clear(): Promise<void> {
    this.#generation++;
    const operation = this.#clearing.then(async () => {
      const cache = await this.ready;
      this.#shutdown.signal.throwIfAborted();
      if (this.#deps.openStore && !cache)
        throw new Error("Excerpt cache could not be opened");
      await cache?.clear?.();
    });
    this.#clearing = operation.catch(() => undefined);
    return operation;
  }

  /**
   * Keep one PDF session reusable only for this bounded consumer operation.
   *
   * `options.outcomes` is the initiating batch's retained outcomes: a settled
   * record whose identity and freshness match answers without PDF work, and
   * every outcome this operation settles is retained for the rest of that batch.
   */
  operation(
    options: { outcomes?: ExcerptOutcomeScope } = {},
  ): ExcerptImageOperation {
    this.#operations++;
    let active = true;
    return {
      resolve: (request, signal) => {
        if (!active)
          return Promise.reject(new Error("Excerpt operation ended"));
        return this.#resolveRequest(request, signal, options.outcomes);
      },
      [Symbol.asyncDispose]: async () => {
        if (!active) return;
        active = false;
        this.#operations--;
        if (this.#operations !== 0) return;
        const settled = !this.#queue.busy;
        const release = this.#queue.idle().then(async () => {
          if (this.#operations === 0) await this.#renderer?.release();
        });
        // Caller cancellation stays immediate while the queue owns late cleanup.
        if (settled) await release;
      },
    };
  }

  async resolve(
    request: ExcerptRequest,
    signal?: AbortSignal,
  ): Promise<ExcerptOutcome> {
    await using operation = this.operation();
    return await operation.resolve(request, signal);
  }

  /**
   * Freshness and cache preflight. It runs on the bounded preflight queue,
   * outside the PDF render slot and ahead of admission, so a valid cached image
   * completes while an unrelated PDF render holds the queue, and a full queue
   * takes no slot to answer it.
   */
  async #probe(
    request: ExcerptRequest,
    options: {
      key: string;
      cache: ExcerptCache | undefined;
      signal: AbortSignal | undefined;
    },
  ): Promise<ExcerptProbe> {
    const { key, cache, signal } = options;
    const stamp =
      this.#deps.stamp ??
      (async (path: string) => {
        const info = await stat(path);
        return { size: info.size, mtimeMs: info.mtimeMs };
      });
    const pdf = request.pdfPath
      ? await stamp(request.pdfPath).catch((error) => {
          logger.debug("Excerpt PDF freshness unavailable", { key, error });
          return undefined;
        })
      : undefined;
    const persistent = request.sourceScope ? cache : undefined;
    signal?.throwIfAborted();
    if (!persistent) return { pdf, cached: undefined };
    const cached = await persistent.get(key, pdf).catch((error) => {
      logger.debug("Excerpt cache read failed", { key, error });
      return undefined;
    });
    return { pdf, cached };
  }

  /**
   * Admit one job per key per batch scope, or adopt the live job another
   * caller admitted.
   *
   * The key carries the caller's batch scope, so a batch admits one job per
   * excerpt for its consumers, while a scope-less caller asking for the same
   * excerpt at the same time gets an admission of its own and the two render it
   * twice. Batch isolation is deliberate; that overlap is its accepted price.
   *
   * The entry takes the freshness and cache preflight before it renders, and
   * the cache hit is answered by that preflight alone: it returns here before
   * admission, so it never takes a slot and never waits for one. A request that
   * would render takes its slot in call order, so a cancelled job keeps its
   * place until its teardown settles; one that arrives at the bound waits,
   * cancellably, for a slot to come back, and is refused only by a real failure
   * or by the caller's own cancellation.
   */
  #admit(
    pendingKey: string,
    request: ExcerptRequest,
    context: {
      key: string;
      cache: ExcerptCache | undefined;
      generation: number;
      outcomes: ExcerptOutcomeScope | undefined;
    },
  ): Pending {
    const live = this.#pending.get(pendingKey);
    if (live && !live.controller.signal.aborted) return live;
    const controller = new AbortController();
    // The place in line is taken now, in call order, so rapid requests for one
    // PDF render in the order their callers made them even though their
    // preflights finish out of order.
    const sequence = this.#queue.nextSequence();
    // The preflight shares the job deadline, so a wedged freshness or cache
    // check cannot hold the key's later work, and a capacity wait is bounded
    // too. The render's own deadline starts when its turn among the PDF jobs
    // comes, inside the queued task below.
    const preflight = AbortSignal.any([
      controller.signal,
      this.#shutdown.signal,
      AbortSignal.timeout(EXCERPT_JOB_DEADLINE_MS),
    ]);
    const promise = (async (): Promise<ExcerptOutcome> => {
      // This resolution keeps the batch's retention alive: the scope drops it
      // only once every consumer admitted here has settled.
      using _consumer = context.outcomes?.admit();
      // Freshness and cache checks run before admission: a valid cache hit
      // resolves without taking one of the admitted slots or the PDF slot.
      const probe = await this.#queue.preflight(
        () =>
          this.#probe(request, {
            key: context.key,
            cache: context.cache,
            signal: preflight,
          }),
        preflight,
      );
      preflight.throwIfAborted();
      // One snapshot of the request builds the identity both answers report.
      const identity: ExcerptIdentity = {
        key: context.key,
        fingerprint: excerptFingerprint(request.annotation),
        pdf: probe.pdf ?? null,
      };
      // The batch's own retention comes first: it holds what a store whose
      // write failed never kept, and it answers without touching the store.
      const retained = context.outcomes?.get(context.key, probe.pdf);
      if (retained) {
        logger.debug("Excerpt batch outcome reused", {
          key: context.key,
          outcome: retained.kind,
        });
        return retained;
      }
      const cached = validatedEntry(probe);
      if (cached) {
        logger.debug("Excerpt cache matched", {
          key: context.key,
          freshnessChecked: !!probe.pdf,
        });
        const outcome: ExcerptOutcome = {
          kind: "available",
          bytes: cached.bytes,
          format: cached.format,
          provenance: "cache",
          freshness: probe.pdf ? "checked" : "unchecked",
          identity,
        };
        context.outcomes?.retain(context.key, probe.pdf, outcome);
        return outcome;
      }
      // A queue stopped by an unsettled teardown is a scheduler artifact: it
      // answers unavailable without queueing more work, and a batch never
      // retains that answer for its other excerpts.
      if (this.#stalled) return STALLED;
      // Queued cancellation drops demand only: an aborted signal removes the
      // job from the queue, while a running job keeps its slot until the
      // bounded teardown above finishes.
      const cancelling = AbortSignal.any([
        controller.signal,
        this.#shutdown.signal,
      ]);
      // One record per job that needs a slot, carrying the bound's own counts:
      // a saturated queue (admitted at the bound, producers awaiting) reads in
      // a diagnosis log instead of only as a stalled progress bar.
      const { admitted, awaiting } = this.#queue.diagnostics;
      logger.debug("Excerpt job entering the PDF queue", {
        key: context.key,
        admitted,
        awaiting,
      });
      const admission = await this.#queue.reserve(preflight);
      try {
        const outcome = await admission.render(
          async () => {
            // A host that cannot settle must not accumulate more active jobs:
            // the stall may have flipped while this job waited for its slot, so
            // the queued task checks it before it renders and answers without
            // touching the renderer.
            if (this.#stalled) return STALLED;
            const bounded = AbortSignal.any([
              cancelling,
              AbortSignal.timeout(EXCERPT_JOB_DEADLINE_MS),
            ]);
            bounded.throwIfAborted();
            const job = this.#resolve(
              request,
              { ...context, probe, identity },
              bounded,
            );
            try {
              return await abortable(job, bounded);
            } finally {
              // Caller cancellation is immediate; the queue still owns teardown.
              // A host that cannot settle must not accumulate more active jobs.
              await abortable(
                job.then(
                  () => undefined,
                  () => undefined,
                ),
                AbortSignal.timeout(5_000),
              ).catch(() => {
                this.#stalled = true;
                logger.debug("Excerpt queue stopped after unsettled teardown");
              });
            }
          },
          { pdf: request.pdfPath ?? "", sequence, signal: cancelling },
        );
        // Only a settled resolution reaches here, so a deadline-aborted one
        // never retains anything, and a stalled queue's answer is a scheduler
        // artifact the batch must not answer another excerpt from. A cancelled
        // one keeps nothing either: its callers no longer want this excerpt,
        // and the batch must not answer for it after they are gone.
        if (!cancelling.aborted && outcome !== STALLED)
          context.outcomes?.retain(context.key, probe.pdf, outcome);
        return outcome;
      } finally {
        admission.release();
      }
    })();
    const pending = { controller, promise, users: 0 };
    this.#pending.set(pendingKey, pending);
    void promise
      .finally(() => {
        if (this.#pending.get(pendingKey) === pending)
          this.#pending.delete(pendingKey);
      })
      .catch(() => undefined);
    return pending;
  }

  async #resolveRequest(
    request: ExcerptRequest,
    signal?: AbortSignal,
    outcomes?: ExcerptOutcomeScope,
  ): Promise<ExcerptOutcome> {
    // Capture the published input before startup or queued work can yield.
    const snapshot = structuredClone(request);
    const generation = this.#generation;
    const cache = await this.ready;
    await this.#clearing;
    signal?.throwIfAborted();
    this.#shutdown.signal.throwIfAborted();
    const key = excerptKey(snapshot);
    const pendingKey = JSON.stringify([
      generation,
      key,
      snapshot.pdfPath,
      snapshot.zoteroPngPath,
      // Batches never share an admission: only callers inside one batch carry
      // its scope, and its retention belongs to those callers alone.
      outcomes?.id ?? null,
    ]);
    const pending = this.#admit(pendingKey, snapshot, {
      key,
      cache,
      generation,
      outcomes,
    });
    // Callers share one admission; releasing one leaves the others' work owned.
    pending.users++;
    try {
      return await (signal
        ? abortable(pending.promise, signal)
        : pending.promise);
    } finally {
      if (--pending.users === 0) pending.controller.abort();
    }
  }

  async #resolve(
    request: ExcerptRequest,
    context: {
      cache: ExcerptCache | undefined;
      generation: number;
      probe: ExcerptProbe;
      identity: ExcerptIdentity;
    },
    signal: AbortSignal,
  ): Promise<ExcerptOutcome> {
    const { cache, generation, probe, identity } = context;
    const { key } = identity;
    const persistent = request.sourceScope ? cache : undefined;
    signal.throwIfAborted();
    logger.trace("Excerpt cache missed; rendering", {
      key,
      cached: !!probe.cached,
      freshnessChecked: !!probe.pdf,
    });
    try {
      const image = await (this.#deps.render
        ? this.#deps.render(request, signal)
        : this.#renderer!.render(request, signal));
      signal.throwIfAborted();
      if (probe.pdf && generation === this.#generation)
        await persistent
          ?.put(key, { ...image, pdf: probe.pdf })
          .catch((error) => {
            logger.debug("Excerpt cache write failed", { key, error });
          });
      logger.debug("Excerpt rendered", {
        key,
        bytes: image.bytes.length,
        format: image.format.format,
        freshnessChecked: !!probe.pdf,
      });
      return {
        kind: "available",
        ...image,
        provenance: "rendered",
        freshness: probe.pdf ? "checked" : "unchecked",
        identity,
      };
    } catch (error) {
      signal.throwIfAborted();
      logger.debug("Excerpt rendering failed; checking Zotero image", {
        key,
        error,
      });
    }
    try {
      if (request.zoteroPngPath) {
        const bytes = await (this.#deps.read ?? readFallback)(
          request.zoteroPngPath,
          signal,
        );
        signal.throwIfAborted();
        if (bytes.length > MAX_FALLBACK_BYTES)
          throw new Error("Zotero image exceeds byte limit");
        if (
          usableExcerptPng(
            Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          )
        ) {
          logger.debug("Excerpt uses uncertain Zotero image", {
            key,
            bytes: bytes.length,
          });
          return {
            kind: "available",
            bytes,
            format: PNG_FORMAT,
            provenance: "zotero",
            freshness: "uncertain",
            // Zotero's own bytes prove nothing about the PDF's freshness.
            identity: { ...identity, pdf: null },
          };
        }
        logger.debug("Zotero excerpt has unusable PNG data", { key });
      }
    } catch (error) {
      signal.throwIfAborted();
      logger.debug("Zotero excerpt read failed", { key, error });
    }
    logger.debug("Excerpt unavailable", { key });
    return { kind: "unavailable" };
  }
}
