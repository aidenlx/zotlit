import { open, stat } from "node:fs/promises";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import { abortable } from "./abort";
import {
  excerptAnnotationRecord,
  excerptFingerprint,
  excerptKey,
} from "./contract";
import type { ExcerptRequest } from "./contract";
import { PNG_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import type { ExcerptOutcomeScope } from "./outcome-scope";
import { ExcerptPdfQueue } from "./pdf-queue";
import { usableExcerptPng } from "./png";
import type { ExcerptReaderDocuments } from "./reader-borrow";
import { ExcerptRenderer } from "./renderer";
import type { ExcerptRendererDiagnostics } from "./renderer";
import type { ExcerptStore } from "./store";
export {
  EXCERPT_RENDERER_VERSION,
  excerptAnnotationIdentity,
  excerptAnnotationRecord,
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
  /**
   * The image one verified Annotation last displayed on this device, as the
   * reference that locates it. Absent from a cache that keeps no references.
   *
   * @param identity {@link excerptAnnotationIdentity} of the Annotation.
   */
  latest?(identity: string): Promise<ExcerptIdentity | undefined>;
  /** Replaces one Annotation's latest reference ({@link latest}). */
  putLatest?(identity: string, reference: ExcerptIdentity): Promise<void>;
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

/**
 * The image an available Excerpt resolved to: what a display paints, what a
 * note embeds, and what the store keeps as one Annotation's latest image.
 */
export type AvailableExcerpt = Extract<ExcerptOutcome, { kind: "available" }>;

export interface ExcerptDeps {
  cache?: ExcerptCache;
  openStore?: () => Promise<ExcerptStore>;
  stamp?: (path: string) => Promise<PdfStamp>;
  read?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  render?: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<ExcerptImage>;
  /**
   * Where a crop borrows an open reader's document instead of loading the
   * file, when that document is proven to hold the file's current bytes.
   *
   * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
   */
  readers?: ExcerptReaderDocuments;
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
  /**
   * What the job's preflight proved about the PDF's freshness, which is what a
   * caller records beside the answer it retains for its own batch.
   */
  evidence: { pdf?: PdfStamp };
}

/** The pixels one Annotation's consumers were last asked for, in saved order. */
interface ExcerptDemand {
  fingerprint: string;
  /** Saved order of those pixels; `null` where the source keeps none. */
  version: number | null;
  /** Resolutions in flight for them, each counting itself once. */
  jobs: number;
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
  /** The batch's own retained outcome for the key, fresh against `pdf`. */
  retained: ExcerptOutcome | undefined;
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

/**
 * Whether a snapshot taken at `version` may stand as an Annotation's newest
 * demand over one already recorded at `previous`.
 *
 * A record version is the saved order of the pixels it describes, so only a
 * snapshot at least as new as the recorded one may replace it: a note or batch
 * request carries the record as it was when the batch started, and admitting it
 * after a later saved edit must not make its older pixels the demand the edit's
 * own answer is measured against. A source that keeps no version — the database
 * partition — leaves no order to keep, so admission order stands there.
 *
 * Shared with the live display, which asks the same question of the demand one
 * of its slots already holds.
 */
export function supersedes(
  version: number | null,
  previous: number | null,
): boolean {
  if (version === null || previous === null) return true;
  return version >= previous;
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
  /**
   * The pixels each Annotation was last asked for, in saved order, with the
   * resolutions still in flight under them.
   *
   * A resolution publishes the Annotation's latest reference only while it is
   * that newest demand, so a late answer from an edit the user has already
   * replaced cannot move the reference back. The newest demand is the newest
   * *saved* snapshot rather than the newest admitted one, because a note or
   * batch resolution carries the record as it was before a later saved edit;
   * ordering by admission would let that stale snapshot become the demand a
   * late answer publishes against, writing its older pixels as the Annotation's
   * latest image.
   *
   * A versioned entry is therefore kept for the session instead of only for as
   * long as it has work in flight: the newer edit's own work has usually settled
   * by the time the stale snapshot arrives, and an entry dropped then would let
   * the snapshot stand as the newest demand again. One that carries no version —
   * the database partition — is held only while it has work in flight, which is
   * what this map held before.
   */
  readonly #demands = new Map<string, ExcerptDemand>();
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
    if (!this.#deps.render)
      this.#renderer = stack.use(
        new ExcerptRenderer({ readers: this.#deps.readers }),
      );
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
   * `options.outcomes` is the batch's retained outcomes: a record this
   * operation's own resolution matches by key and freshness answers from it
   * without PDF work, and every outcome the operation receives is retained
   * under it for the rest of that batch, including work shared with another
   * batch's live job.
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
        // Torn down as queue work: the resident document is destroyed while the
        // job holds the render slot, so a render the next operation admits
        // waits for it instead of reusing a session that is closing.
        const release = this.#queue.teardown(async () => {
          if (this.#operations === 0) await this.#renderer?.release();
        });
        // Caller cancellation stays immediate while the queue owns late
        // cleanup; the caller that cannot wait still observes the teardown's
        // result, so a queue that stops before it runs leaves no unhandled
        // rejection behind.
        if (settled) await release;
        else
          void release.catch((error) => {
            logger.debug("Excerpt queued teardown did not run", { error });
          });
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
   * What this device last displayed for one Annotation: the image its latest
   * reference locates, or `null` where it holds none.
   *
   * A display that has just mounted paints this while the Annotation's current
   * pixels resolve, which is what carries the last useful image across a remount
   * and across an application restart. The reference records the stamp that was
   * proven when the image was stored, and nothing proves that stamp now, so the
   * image reads as unchecked until a read revalidates it.
   */
  async stored(request: ExcerptRequest): Promise<AvailableExcerpt | null> {
    const cache = await this.ready;
    await this.#clearing;
    const store = request.sourceScope ? cache : undefined;
    if (!store?.latest) return null;
    const annotation = excerptAnnotationRecord(request);
    const reference = await store.latest(annotation).catch((error) => {
      logger.debug("Excerpt latest reference read failed", {
        annotation,
        error,
      });
      return undefined;
    });
    if (!reference) return null;
    const entry = await store
      .get(reference.key, reference.pdf ?? undefined)
      .catch((error) => {
        logger.debug("Excerpt latest image read failed", {
          key: reference.key,
          error,
        });
        return undefined;
      });
    if (!entry) return null;
    return {
      kind: "available",
      bytes: entry.bytes,
      format: entry.format,
      provenance: "cache",
      freshness: "unchecked",
      identity: reference,
    };
  }

  /**
   * Record one Annotation's latest image, which is what a display reads to paint
   * the Annotation while its saved pixels resolve.
   *
   * Only an outcome the store holds bytes for publishes one, and only while the
   * resolution still carries the newest saved pixels this Annotation was asked
   * for — the demand admission keeps in saved order, not in admission order — in
   * a clear generation that still stands: a superseded answer, a note or batch
   * snapshot taken before a later saved edit, and one a manual clear has already
   * overtaken each leave the reference where it was, so a failed or a late
   * replacement never moves the latest image backward.
   */
  async #publishLatest(
    request: ExcerptRequest,
    context: { cache: ExcerptCache | undefined; generation: number },
    reference: ExcerptIdentity,
  ): Promise<void> {
    const store = request.sourceScope ? context.cache : undefined;
    if (!store?.putLatest) return;
    if (context.generation !== this.#generation) return;
    const annotation = excerptAnnotationRecord(request);
    const demand = this.#demands.get(annotation);
    if (demand && demand.fingerprint !== reference.fingerprint) return;
    await store.putLatest(annotation, reference).catch((error) => {
      logger.debug("Excerpt latest reference write failed", {
        key: reference.key,
        error,
      });
    });
  }

  /**
   * The PDF's current size and modification time, or `undefined` where it
   * cannot be read: a stamp that cannot be taken proves nothing about pixels.
   */
  async #stamp(path: string, key: string): Promise<PdfStamp | undefined> {
    const stamp =
      this.#deps.stamp ??
      (async (path: string) => {
        const info = await stat(path);
        return { size: info.size, mtimeMs: info.mtimeMs };
      });
    return await stamp(path).catch((error) => {
      logger.debug("Excerpt PDF freshness unavailable", { key, error });
      return undefined;
    });
  }

  /**
   * Freshness and cache preflight. It runs on the bounded preflight queue,
   * outside the PDF render slot and ahead of admission, so a valid cached image
   * completes while an unrelated PDF render holds the queue, and a full queue
   * takes no slot to answer it.
   *
   * The freshness stamp comes first, then the batch's own retention — bytes
   * this batch already holds — and only a memory miss reads the persistent
   * store, so a repeat the retention can answer pays no store transaction.
   */
  async #probe(
    request: ExcerptRequest,
    options: {
      key: string;
      cache: ExcerptCache | undefined;
      outcomes: ExcerptOutcomeScope | undefined;
      signal: AbortSignal | undefined;
    },
  ): Promise<ExcerptProbe> {
    const { key, cache, outcomes, signal } = options;
    const pdf = request.pdfPath
      ? await this.#stamp(request.pdfPath, key)
      : undefined;
    // The batch's own retention holds what a store whose write failed never
    // kept, and it answers without touching the store.
    const retained = outcomes?.get(key, pdf);
    if (retained) return { pdf, retained, cached: undefined };
    const persistent = request.sourceScope ? cache : undefined;
    signal?.throwIfAborted();
    if (!persistent) return { pdf, retained: undefined, cached: undefined };
    const cached = await persistent.get(key, pdf).catch((error) => {
      logger.debug("Excerpt cache read failed", { key, error });
      return undefined;
    });
    return { pdf, retained: undefined, cached };
  }

  /**
   * The demand entry for one Annotation, advanced to the pixels a request asks
   * for, which the caller then counts its own resolution under.
   *
   * A caller that joins live work advances the entry exactly as a new admission
   * does: the demand is the newest *saved* request, and the joiner can carry a
   * later saved snapshot than the admission it joined. Only a snapshot at least
   * as new as the recorded one displaces it ({@link supersedes}).
   */
  #advanceDemand(
    annotation: string,
    fingerprint: string,
    version: number | null,
  ): ExcerptDemand {
    const demand = this.#demands.get(annotation);
    if (!demand) {
      const created: ExcerptDemand = { fingerprint, version, jobs: 0 };
      this.#demands.set(annotation, created);
      return created;
    }
    if (supersedes(version, demand.version)) {
      demand.fingerprint = fingerprint;
      demand.version = version;
    }
    return demand;
  }

  /**
   * Admit one job per excerpt, or adopt the live job another caller admitted.
   *
   * The key is the excerpt identity alone, so identical active work is one
   * admission and one render however many batches and scope-less consumers ask
   * for it at once. What each batch keeps of the answer stays its own: every
   * caller retains the outcome it received under its own scope, so simultaneous
   * batches share the work without sharing their retention.
   *
   * The entry takes the freshness and cache preflight before it renders, and
   * the cache hit is answered by that preflight alone: it returns here before
   * admission, so it never takes a slot and never waits for one. A request that
   * would render takes its slot in call order, so a cancelled job keeps its
   * place until its teardown settles; one that arrives at the bound waits there
   * as long as its caller and this service still want it, so a full bound alone
   * never refuses an image.
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
    const annotation = excerptAnnotationRecord(request);
    const fingerprint = excerptFingerprint(request.annotation);
    const version = request.annotation.version;
    const live = this.#pending.get(pendingKey);
    if (live && !live.controller.signal.aborted) {
      // Joining still advances the Annotation's demand: the caller can carry a
      // later saved snapshot than the admission it joined, and the reference
      // the answer publishes is measured against the newest saved pixels.
      this.#advanceDemand(annotation, fingerprint, version);
      return live;
    }
    const controller = new AbortController();
    // Queued cancellation drops demand only: an aborted signal removes the job
    // from the queue, while a running job keeps its slot until its bounded
    // teardown finishes. Nothing here carries the job deadline: waiting for
    // capacity is not the work, and a full bound must not refuse the image.
    const cancelling = AbortSignal.any([
      controller.signal,
      this.#shutdown.signal,
    ]);
    // The place in line is taken now, in call order, so rapid requests for one
    // PDF render in the order their callers made them even though their
    // preflights finish out of order.
    const sequence = this.#queue.nextSequence();
    // The preflight shares the job deadline, so a wedged freshness or cache
    // check cannot hold the key's later work. The render's own deadline starts
    // when its turn among the PDF jobs comes, inside the queued task below.
    const preflight = AbortSignal.any([
      cancelling,
      AbortSignal.timeout(EXCERPT_JOB_DEADLINE_MS),
    ]);
    // What this job's preflight proves, which the callers that retain its
    // answer record beside it in their own batch's retention.
    const evidence: { pdf?: PdfStamp } = {};
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
            outcomes: context.outcomes,
            signal: preflight,
          }),
        preflight,
      );
      preflight.throwIfAborted();
      evidence.pdf = probe.pdf;
      // One snapshot of the request builds the identity both answers report.
      const identity: ExcerptIdentity = {
        key: context.key,
        fingerprint: excerptFingerprint(request.annotation),
        pdf: probe.pdf ?? null,
      };
      // The batch's own retention answered the preflight, ahead of any store
      // read: what it holds is what a store whose write failed never kept.
      if (probe.retained) {
        logger.debug("Excerpt batch outcome reused", {
          key: context.key,
          outcome: probe.retained.kind,
        });
        return probe.retained;
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
        await this.#publishLatest(request, context, identity);
        return outcome;
      }
      // A queue stopped by an unsettled teardown is a scheduler artifact: it
      // answers unavailable without queueing more work, and a batch never
      // retains that answer for its other excerpts.
      if (this.#stalled) return STALLED;
      // One record per job that needs a slot, carrying the bound's own counts:
      // a saturated queue (admitted at the bound, producers awaiting) reads in
      // a diagnosis log instead of only as a stalled progress bar.
      const { admitted, awaiting } = this.#queue.diagnostics;
      logger.debug("Excerpt job entering the PDF queue", {
        key: context.key,
        admitted,
        awaiting,
      });
      const admission = await this.#queue.reserve(cancelling);
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
              { ...context, probe, identity, evidence },
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
        return outcome;
      } finally {
        admission.release();
      }
    })();
    const pending = { controller, promise, users: 0, evidence };
    this.#pending.set(pendingKey, pending);
    // The demand is the newest saved pixels this Annotation has been asked for,
    // which a snapshot taken before a later edit cannot displace; the entry then
    // stands for as long as it holds a version, so a stale answer is measured
    // against the edit rather than against itself.
    this.#advanceDemand(annotation, fingerprint, version).jobs++;
    void promise
      .finally(() => {
        if (this.#pending.get(pendingKey) === pending)
          this.#pending.delete(pendingKey);
        const held = this.#demands.get(annotation);
        if (held) {
          held.jobs--;
          if (held.jobs === 0 && held.version === null)
            this.#demands.delete(annotation);
        }
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
    // Active work is keyed by the excerpt identity alone: a batch and a
    // scope-less consumer, or two batches, asking at once share one admission
    // and one render. Only completed outcomes stay batch-local, which each
    // caller's own retention below keeps.
    const pendingKey = JSON.stringify([
      generation,
      key,
      snapshot.pdfPath,
      snapshot.zoteroPngPath,
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
      const outcome = await (signal
        ? abortable(pending.promise, signal)
        : pending.promise);
      // Each caller keeps the answer it received for its own batch, which is
      // how one shared job settles several scopes without merging them. A
      // stalled queue's answer is a scheduler artifact no batch keeps, and a
      // caller that never received the outcome retains nothing.
      if (outcome !== STALLED)
        outcomes?.retain(key, pending.evidence.pdf, outcome);
      return outcome;
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
      /** Where this job's callers read the freshness it settled against. */
      evidence: { pdf?: PdfStamp };
    },
    signal: AbortSignal,
  ): Promise<ExcerptOutcome> {
    const { cache, generation, probe, identity, evidence } = context;
    const { key } = identity;
    const persistent = request.sourceScope ? cache : undefined;
    signal.throwIfAborted();
    logger.trace("Excerpt cache missed; rendering", {
      key,
      cached: !!probe.cached,
      freshnessChecked: !!probe.pdf,
    });
    try {
      // The probe ran before this job waited for capacity and for the render
      // slot, so the PDF may have been replaced while it waited, and the
      // document read below is the revision on disk now. The stamp taken here
      // is what these bytes are labelled with — never older than them, so a
      // replacement that lands after it still revalidates — where a stamp that
      // cannot be read now leaves the probe's own standing.
      const pdf = probe.pdf
        ? ((await this.#stamp(request.pdfPath!, key)) ?? probe.pdf)
        : undefined;
      const rendered: ExcerptIdentity = { ...identity, pdf: pdf ?? null };
      const image = await (this.#deps.render
        ? this.#deps.render(request, signal)
        : this.#renderer!.render(request, signal));
      signal.throwIfAborted();
      // The callers that keep this answer read the freshness it was rendered
      // under, so their own repeat validates against the bytes they hold.
      evidence.pdf = pdf;
      if (pdf && generation === this.#generation && persistent) {
        const stored = await persistent.put(key, { ...image, pdf }).then(
          () => true,
          (error: unknown) => {
            logger.debug("Excerpt cache write failed", { key, error });
            return false;
          },
        );
        // A reference locates stored bytes: only a write that landed publishes one.
        if (stored) await this.#publishLatest(request, context, rendered);
      }
      logger.debug("Excerpt rendered", {
        key,
        bytes: image.bytes.length,
        format: image.format.format,
        freshnessChecked: !!pdf,
      });
      return {
        kind: "available",
        ...image,
        provenance: "rendered",
        freshness: pdf ? "checked" : "unchecked",
        identity: rendered,
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
