// The whole of the excerpt PDF path's scheduling. Two p-queue instances share
// one admission bound: the single crop-render slot and a separately bounded
// freshness/cache preflight that never takes that slot.

import PQueue from "p-queue";
import type { Queue, QueueAddOptions } from "p-queue";

/** p-queue's element type; the package root does not re-export the alias. */
type PdfRun = () => Promise<unknown>;

/** Jobs admitted — reserved, queued, or rendering — at once (ADR 0052). */
export const EXCERPT_JOB_LIMIT = 128;
/** One resident PDF document: the renderer renders one crop at a time. */
export const EXCERPT_RENDER_CONCURRENCY = 1;
/** Freshness and cache checks that may run beside a crop render. */
export const EXCERPT_PREFLIGHT_CONCURRENCY = 4;
/** Consecutive jobs one PDF may keep before another waiting PDF gets a turn. */
export const EXCERPT_PDF_AFFINITY = 4;

/** Task options this queue class orders by; p-queue passes them through `add`. */
interface PdfJobOptions extends QueueAddOptions {
  /** PDF whose loaded document the job reuses; affinity groups consecutive jobs by it. */
  pdf?: string;
  /** Admission order; jobs dequeue in it, so callers keep their request order. */
  sequence?: number;
}

interface PdfJob {
  run: PdfRun;
  id: string | undefined;
  pdf: string;
  sequence: number;
  priority: number;
}

/**
 * p-queue's queue class for crop renders: dequeue in admission order, but hand
 * a waiting PDF its turn after {@link EXCERPT_PDF_AFFINITY} consecutive jobs
 * that reuse one loaded document. This is the only custom scheduling in the
 * excerpt path; everything else is `PQueue` itself.
 */
export class PdfAffinityQueue implements Queue<PdfRun, PdfJobOptions> {
  readonly #jobs: PdfJob[] = [];
  #last: string | undefined;
  #consecutive = 0;

  get size(): number {
    return this.#jobs.length;
  }

  enqueue(run: PdfRun, options?: Partial<PdfJobOptions>): void {
    this.#jobs.push({
      run,
      id: options?.id,
      pdf: options?.pdf ?? "",
      sequence: options?.sequence ?? Number.MAX_SAFE_INTEGER,
      priority: options?.priority ?? 0,
    });
  }

  dequeue(): PdfRun | undefined {
    const index = this.#pick();
    if (index === -1) return undefined;
    const job = this.#jobs.splice(index, 1)[0]!;
    if (job.pdf === this.#last) this.#consecutive += 1;
    else {
      this.#last = job.pdf;
      this.#consecutive = 1;
    }
    return job.run;
  }

  setPriority(id: string, priority: number): void {
    const job = this.#jobs.find((entry) => entry.id === id);
    if (!job)
      throw new ReferenceError(
        `No promise function with the id "${id}" exists in the queue.`,
      );
    job.priority = priority;
  }

  /** Queued-abort removal, which p-queue drives by the task's id. */
  remove(id: string): void {
    const index = this.#jobs.findIndex((entry) => entry.id === id);
    if (index !== -1) this.#jobs.splice(index, 1);
  }

  filter(options: Readonly<Partial<PdfJobOptions>>): PdfRun[] {
    return this.#jobs
      .filter(
        (job) =>
          (options.pdf === undefined || job.pdf === options.pdf) &&
          (options.priority === undefined || job.priority === options.priority),
      )
      .map((job) => job.run);
  }

  /** Index of the best-ordered job, optionally excluding one PDF. */
  #best(excluding?: string): number {
    let best = -1;
    for (let index = 0; index < this.#jobs.length; index++) {
      const job = this.#jobs[index]!;
      if (job.pdf === excluding) continue;
      if (best === -1) {
        best = index;
        continue;
      }
      const current = this.#jobs[best]!;
      if (
        job.priority > current.priority ||
        (job.priority === current.priority && job.sequence < current.sequence)
      )
        best = index;
    }
    return best;
  }

  #pick(): number {
    const best = this.#best();
    if (best === -1) return -1;
    if (this.#jobs[best]!.pdf !== this.#last) return best;
    if (this.#consecutive < EXCERPT_PDF_AFFINITY) return best;
    // One PDF has had its four consecutive jobs; another waiting PDF loads next.
    const other = this.#best(this.#last);
    return other === -1 ? best : other;
  }
}

/** A waiting producer, woke by the slot a settling job hands over. */
interface CapacityWaiter {
  take(): void;
}

/** An admitted job: the capacity slot it holds and its place among renders. */
export interface ExcerptJobAdmission {
  /**
   * One crop render in the shared PDF slot. `options.signal` stops queued
   * demand only: it removes the job from the queue, while work that already
   * started keeps the slot through its own teardown.
   */
  render<T>(
    task: () => Promise<T>,
    options: { pdf: string; sequence: number; signal: AbortSignal },
  ): Promise<T>;
  /** Hand the capacity slot back; the oldest waiting job takes it. */
  release(): void;
}

/**
 * The bounded preflight, the single render slot, and the admission that joins
 * them. Freshness and cache checks run on their own bounded queue and never
 * charge admission, so a valid cache hit completes while an unrelated crop
 * render holds the slot and while the admitted bound is full. Only work that
 * needs PDF rendering reserves one of the {@link EXCERPT_JOB_LIMIT} slots —
 * document teardown, which takes the render slot, charges one too — and a full
 * bound makes the producer wait, cancellably, rather than reporting an
 * unavailable image.
 */
export class ExcerptPdfQueue {
  readonly #render: PQueue<PdfAffinityQueue, PdfJobOptions>;
  readonly #preflight: PQueue;
  readonly #limit: number;
  readonly #waiters = new Set<CapacityWaiter>();
  #reserved = 0;
  #sequence = 0;

  constructor(
    options: { limit?: number; render?: number; preflight?: number } = {},
  ) {
    this.#limit = options.limit ?? EXCERPT_JOB_LIMIT;
    this.#render = new PQueue({
      concurrency: options.render ?? EXCERPT_RENDER_CONCURRENCY,
      queueClass: PdfAffinityQueue,
    });
    this.#preflight = new PQueue({
      concurrency: options.preflight ?? EXCERPT_PREFLIGHT_CONCURRENCY,
    });
  }

  /**
   * Jobs holding an admitted slot: queued, rendering, or waiting for capacity —
   * the document teardown among them.
   */
  get admitted(): number {
    return this.#reserved;
  }

  /** Whether any preflight, queued job, or render is still in flight. */
  get busy(): boolean {
    return (
      this.#reserved > 0 ||
      this.#waiters.size > 0 ||
      this.#render.size > 0 ||
      this.#render.pending > 0 ||
      this.#preflight.size > 0 ||
      this.#preflight.pending > 0
    );
  }

  /** Admission and slot counts, for tests and the measurement harness. */
  get diagnostics(): {
    admitted: number;
    rendering: number;
    queued: number;
    checking: number;
    awaiting: number;
  } {
    return {
      admitted: this.#reserved,
      rendering: this.#render.pending,
      queued: this.#render.size,
      checking: this.#preflight.pending,
      awaiting: this.#waiters.size,
    };
  }

  /**
   * Freshness and cache check, on its own bounded queue: a valid cache hit
   * completes while a crop render holds the PDF slot, and it never takes one.
   *
   * Cancellation stops a check that is still waiting for the lane, and stops
   * following the caller the moment a check starts: one that already began
   * keeps its slot until the filesystem and store work inside it settles, which
   * is what makes the lane's bound count the checks that are really running
   * rather than the callers that still want them.
   */
  preflight<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const queued = new AbortController();
    const stop = () => queued.abort(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    return this.#preflight.add(
      () => {
        signal.removeEventListener("abort", stop);
        return task();
      },
      { signal: queued.signal },
    );
  }

  /**
   * The next place in line. A request takes it as it arrives, so rapid requests
   * for one PDF render in call order even when their preflights finish out of
   * order.
   */
  nextSequence(): number {
    return ++this.#sequence;
  }

  /**
   * Renderer teardown as queue work: it takes the single render slot, so a
   * render admitted after it waits for the resident document to be destroyed
   * instead of reusing a session that is closing. Its place in line is taken
   * when teardown is asked for, so the renders already admitted keep their
   * order and later ones come after the document is gone.
   *
   * It is one of the admitted jobs as well, not work laid over a full queue: it
   * charges a slot the moment it is asked for, so producers arriving while it
   * waits for the render slot wait for capacity themselves rather than filling
   * the bound beside it. Teardown is never cancelled and never refused, so at
   * capacity it waits for a slot to be handed over like any other job — and
   * enters the render queue then, with the place in line it took above.
   */
  teardown<T>(task: () => Promise<T>): Promise<T> {
    const sequence = this.nextSequence();
    // Capacity free: the teardown is queue work in this turn, which is what
    // keeps `idle()` a signal for it. At capacity it follows the slot it waits
    // for instead.
    return this.#charge()
      ? this.#enqueueTeardown(task, sequence)
      : this.#awaitSlot().then(() => this.#enqueueTeardown(task, sequence));
  }

  /** One teardown in the render slot, handing its admitted slot back after. */
  #enqueueTeardown<T>(task: () => Promise<T>, sequence: number): Promise<T> {
    return this.#render.add(
      async () => {
        try {
          return await task();
        } finally {
          this.#settle();
        }
      },
      { pdf: "", sequence },
    );
  }

  /**
   * Take one of the admitted slots, waiting at capacity. The check and the
   * reservation are one synchronous step, so producers that call together
   * cannot both take the last slot.
   */
  async reserve(signal: AbortSignal): Promise<ExcerptJobAdmission> {
    signal.throwIfAborted();
    if (!this.#charge()) await this.#awaitSlot(signal);
    let held = true;
    return {
      render: (task, options) => {
        // p-queue drops a queued task when its signal aborts, which is exactly
        // the demand this job no longer has. A running job must keep its slot
        // through teardown, so the signal stops following the caller the moment
        // its task starts.
        const queued = new AbortController();
        const stop = () => queued.abort(options.signal.reason);
        options.signal.addEventListener("abort", stop, { once: true });
        if (options.signal.aborted) stop();
        return this.#render.add(
          () => {
            options.signal.removeEventListener("abort", stop);
            return task();
          },
          {
            pdf: options.pdf,
            sequence: options.sequence,
            signal: queued.signal,
          },
        );
      },
      release: () => {
        if (!held) return;
        held = false;
        this.#settle();
      },
    };
  }

  /** Resolves when no admitted job is queued or rendering; a signal, not a status. */
  async idle(): Promise<void> {
    await Promise.all([this.#render.onIdle(), this.#preflight.onIdle()]);
  }

  /**
   * Charge one admitted slot in this turn, or report the bound is full. The
   * check and the charge are one synchronous step, so the jobs that call
   * together cannot both take the last slot.
   */
  #charge(): boolean {
    if (this.#reserved >= this.#limit) return false;
    this.#reserved += 1;
    return true;
  }

  /**
   * Wait for a settling job's slot; the slot is handed over, never retaken. A
   * waiting job that carries no signal — a teardown — waits for as long as the
   * queue holds it.
   */
  #awaitSlot(signal?: AbortSignal): Promise<void> {
    const slot = Promise.withResolvers<void>();
    let waiting = true;
    const abort = () => {
      if (!waiting) return;
      waiting = false;
      this.#waiters.delete(waiter);
      slot.reject(signal!.reason);
    };
    const waiter: CapacityWaiter = {
      take: () => {
        if (!waiting) return;
        waiting = false;
        this.#waiters.delete(waiter);
        signal?.removeEventListener("abort", abort);
        slot.resolve();
      },
    };
    this.#waiters.add(waiter);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    return slot.promise;
  }

  /** One slot came back: move it to the oldest waiting job, or free it. */
  #settle(): void {
    for (const waiter of this.#waiters) {
      waiter.take();
      return;
    }
    this.#reserved -= 1;
  }
}
