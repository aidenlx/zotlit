// One initiating batch's retained Excerpt Image outcomes.
//
// A batch retains what its consumers have already settled — generated or stored
// pixels, a stable failure, or an uncertain Zotero fallback — so the next
// consumer of the same excerpt inside that batch reuses the verdict instead of
// loading, rasterizing, and failing over a second time. A retained record also
// survives a persistent-store write failure, because the bytes the renderer
// produced are what the batch reuses, not what the store kept.
//
// Retention is memory-only and bounded by encoded bytes and entry count; an
// evicted, stale, or oversized record simply recomputes. Only settled outcomes
// are ever retained: cancellation and the job deadline reject, so they never
// reach this module, and a queue stopped by an unsettled teardown answers on a
// path the service never retains. Fallback pixels keep their uncertain
// provenance and stay classed apart from validated generated entries.
//
// @see apps/obsidian/docs/adr/0051-batches-reuse-excerpt-outcomes-with-bounded-memory.md
import type { ExcerptOutcome, PdfStamp } from "./service";

/** Encoded bytes one batch retains. */
export const EXCERPT_OUTCOME_BYTES = 32 * 1024 * 1024;
/** Outcome entries one batch retains, failures included. */
export const EXCERPT_OUTCOME_ENTRIES = 256;

/** What a retained record is: validated pixels, uncertain fallback pixels, or a failure. */
type OutcomeVerdict = "validated" | "fallback" | "failure";

interface RetainedOutcome {
  verdict: OutcomeVerdict;
  /** The PDF evidence the outcome was settled against; `null` when none was proven. */
  pdf: PdfStamp | null;
  /** Encoded bytes this record costs; failures cost none. */
  bytes: number;
  outcome: ExcerptOutcome;
}

export interface ExcerptOutcomeScopeDiagnostics {
  /** Records currently retained. */
  retained: number;
  /** Encoded bytes currently retained. */
  bytes: number;
  /** The most bytes this scope ever retained at once. */
  peakBytes: number;
  /** Retained stable failures. */
  failures: number;
  /** Retained uncertain Zotero fallbacks. */
  fallbacks: number;
  /** Lookups answered from retention. */
  hits: number;
  /** Lookups that found nothing reusable. */
  misses: number;
  /** Consumers admitted and not yet settled. */
  consumers: number;
  /** Whether the owning batch has ended. */
  released: boolean;
}

/**
 * Changed PDF evidence invalidates a record: a readable stamp has to match the
 * one the outcome was settled against, while an unreadable stamp proves nothing
 * about a change and keeps the record.
 */
function stillFresh(
  retained: PdfStamp | null,
  current: PdfStamp | undefined,
): boolean {
  if (!current) return true;
  return (
    retained !== null &&
    retained.size === current.size &&
    retained.mtimeMs === current.mtimeMs
  );
}

function verdictOf(outcome: ExcerptOutcome): OutcomeVerdict {
  if (outcome.kind === "unavailable") return "failure";
  return outcome.provenance === "zotero" ? "fallback" : "validated";
}

/**
 * The outcomes one initiating batch reuses. Every note that batch writes —
 * the Literature Note, its Imported Notes, and the Child Notes imported through
 * its template — resolves through the same scope, so they share one retention;
 * a simultaneous batch owns another and stays isolated. Only what a batch keeps
 * is its own: the resolution itself is shared across batches when it is the
 * same excerpt in flight, and each batch retains that one answer for itself.
 *
 * The batch that creates the scope disposes it when its consumers have settled.
 * Retention then ends for good: a consumer admitted after that point neither
 * reads nor refills it.
 */
export class ExcerptOutcomeScope implements AsyncDisposable {
  readonly #bytesLimit: number;
  readonly #entryLimit: number;
  /** Insertion order is recency: the first key is the least recently used. */
  readonly #entries = new Map<string, RetainedOutcome>();
  #bytes = 0;
  #peakBytes = 0;
  #hits = 0;
  #misses = 0;
  #consumers = 0;
  #released = false;
  #settled: PromiseWithResolvers<void> | undefined;

  constructor(limits: { bytes?: number; entries?: number } = {}) {
    this.#bytesLimit = limits.bytes ?? EXCERPT_OUTCOME_BYTES;
    this.#entryLimit = limits.entries ?? EXCERPT_OUTCOME_ENTRIES;
  }

  get diagnostics(): ExcerptOutcomeScopeDiagnostics {
    let failures = 0;
    let fallbacks = 0;
    for (const record of this.#entries.values()) {
      if (record.verdict === "failure") failures += 1;
      else if (record.verdict === "fallback") fallbacks += 1;
    }
    return {
      retained: this.#entries.size,
      bytes: this.#bytes,
      peakBytes: this.#peakBytes,
      failures,
      fallbacks,
      hits: this.#hits,
      misses: this.#misses,
      consumers: this.#consumers,
      released: this.#released,
    };
  }

  /**
   * The outcome retained for `key` while its freshness still matches, else
   * `undefined`. A record whose PDF evidence changed is dropped, so the caller
   * resolves the excerpt again.
   */
  get(key: string, pdf?: PdfStamp): ExcerptOutcome | undefined {
    const record = this.#entries.get(key);
    if (!record) {
      this.#misses += 1;
      return undefined;
    }
    if (!stillFresh(record.pdf, pdf)) {
      this.#drop(key);
      this.#misses += 1;
      return undefined;
    }
    // A hit is the most recent use, so it moves behind every other record.
    this.#entries.delete(key);
    this.#entries.set(key, record);
    this.#hits += 1;
    return record.outcome;
  }

  /** Retain one settled outcome, evicting least-recently-used records the bounds displace. */
  retain(
    key: string,
    pdf: PdfStamp | null | undefined,
    outcome: ExcerptOutcome,
  ): void {
    if (this.#released) return;
    const bytes = outcome.kind === "available" ? outcome.bytes.length : 0;
    // One oversized image is never worth the whole batch's retention: leaving
    // it out costs this excerpt's reuse and keeps every other record.
    if (bytes > this.#bytesLimit) return;
    this.#drop(key);
    this.#entries.set(key, {
      verdict: verdictOf(outcome),
      pdf: pdf ?? null,
      bytes,
      outcome,
    });
    this.#bytes += bytes;
    for (const oldest of this.#entries.keys()) {
      if (
        this.#entries.size <= this.#entryLimit &&
        this.#bytes <= this.#bytesLimit
      )
        break;
      this.#drop(oldest);
    }
    // The peak is what the retention holds between operations: the entry a
    // record just added can push past a bound only until the eviction above
    // runs, and eviction is synchronous, so no consumer ever sees that state.
    this.#peakBytes = Math.max(this.#peakBytes, this.#bytes);
  }

  /** Admit one consumer; disposing the handle settles it. */
  admit(): Disposable {
    this.#consumers += 1;
    return {
      [Symbol.dispose]: () => {
        this.#consumers -= 1;
        if (this.#consumers === 0) this.#settled?.resolve();
      },
    };
  }

  /** Wait for every admitted consumer to settle, then release the retention. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    if (this.#consumers > 0) {
      this.#settled = Promise.withResolvers<void>();
      await this.#settled.promise;
    }
    this.#dropAll();
  }

  #drop(key: string): void {
    const record = this.#entries.get(key);
    if (!record) return;
    this.#entries.delete(key);
    this.#bytes -= record.bytes;
  }

  #dropAll(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

/**
 * The scope a batch above provides, or one opened on `stack` when the caller is
 * its own initiating batch. Whichever way it is obtained, the stack that owns
 * it releases the retention once the batch's consumers settle, and every write
 * below the seam shares that one scope.
 */
export function resolveOutcomeScope(
  provided: ExcerptOutcomeScope | undefined,
  stack: AsyncDisposableStack,
): ExcerptOutcomeScope {
  return provided ?? stack.use(new ExcerptOutcomeScope());
}
