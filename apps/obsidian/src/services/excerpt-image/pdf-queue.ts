/**
 * A bounded, single-worker queue for PDF loading and crop rendering.
 *
 * Admission is separate from execution. At most 128 distinct jobs can be
 * admitted at once; later producers wait for a slot. The worker prefers the
 * current PDF for document reuse, then gives another waiting PDF a turn after
 * four consecutive jobs.
 */

const MAX_ADMITTED = 128;

interface QueueEntry {
  readonly pdfKey: string;
  readonly signal: AbortSignal;
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  admitted: boolean;
  started: boolean;
  settled: boolean;
  aborted: boolean;
  removeAbortListener?: () => void;
}

/** Owns bounded PDF work independently of cache and durable asset writes. */
export class PdfExcerptQueue implements AsyncDisposable {
  readonly #ready: QueueEntry[] = [];
  readonly #waiting: QueueEntry[] = [];
  #active?: QueueEntry;
  #admitted = 0;
  #lastPdfKey?: string;
  #consecutive = 0;
  #disposed = false;
  #idle = Promise.resolve();
  #idleResolve?: (value: void | PromiseLike<void>) => void;

  enqueue<T>(
    pdfKey: string,
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> {
    if (this.#disposed)
      return Promise.reject(new Error("Excerpt PDF queue is closed"));
    if (signal.aborted) return Promise.reject(signal.reason);

    let entry: QueueEntry;
    const deferred = Promise.withResolvers<T>();
    entry = {
      pdfKey,
      signal,
      run: async () => run(),
      resolve: (value) => deferred.resolve(value as T),
      reject: deferred.reject,
      admitted: false,
      started: false,
      settled: false,
      aborted: false,
    };
    const abort = () => this.#cancel(entry);
    signal.addEventListener("abort", abort, { once: true });
    entry.removeAbortListener = () =>
      signal.removeEventListener("abort", abort);

    this.#markBusy();
    if (this.#admitted < MAX_ADMITTED) {
      entry.admitted = true;
      this.#admitted++;
      this.#ready.push(entry);
    } else {
      this.#waiting.push(entry);
    }
    this.#pump();
    return deferred.promise;
  }

  /** Resolves when all admitted jobs and capacity waiters have settled. */
  whenIdle(): Promise<void> {
    return this.#isIdle() ? Promise.resolve() : this.#idle;
  }

  /** Small diagnostics seam for acceptance tests and real-app probes. */
  snapshot(): {
    active: boolean;
    admitted: number;
    waiting: number;
    consecutivePdfJobs: number;
  } {
    return {
      active: !!this.#active,
      admitted: this.#admitted,
      waiting: this.#waiting.length,
      consecutivePdfJobs: this.#consecutive,
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#ready, ...this.#waiting]) {
      this.#cancel(entry, new Error("Excerpt PDF queue is closed"));
    }
    await this.whenIdle();
  }

  #markBusy(): void {
    if (this.#isIdle()) {
      const deferred = Promise.withResolvers<void>();
      this.#idle = deferred.promise;
      this.#idleResolve = deferred.resolve;
    }
  }

  #isIdle(): boolean {
    return !this.#active && this.#admitted === 0 && this.#waiting.length === 0;
  }

  #cancel(entry: QueueEntry, reason = entry.signal.reason): void {
    if (entry.settled || entry.aborted) return;
    entry.aborted = true;
    if (entry.started) return;

    this.#remove(entry);
    entry.removeAbortListener?.();
    entry.settled = true;
    entry.reject(reason);
    this.#pump();
  }

  #remove(entry: QueueEntry): void {
    const list = entry.admitted ? this.#ready : this.#waiting;
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
    if (entry.admitted) {
      entry.admitted = false;
      this.#admitted--;
    }
  }

  #pick(): QueueEntry | undefined {
    const same =
      this.#lastPdfKey === undefined
        ? undefined
        : this.#ready.find((entry) => entry.pdfKey === this.#lastPdfKey);
    const differentReady =
      this.#lastPdfKey === undefined
        ? undefined
        : this.#ready.find((entry) => entry.pdfKey !== this.#lastPdfKey);
    const differentWaiting =
      this.#lastPdfKey === undefined
        ? undefined
        : this.#waiting.find((entry) => entry.pdfKey !== this.#lastPdfKey);

    if (same && this.#consecutive < 4) return same;
    if (differentReady) return differentReady;
    if (differentWaiting && this.#admitted < MAX_ADMITTED)
      return differentWaiting;
    return this.#ready[0] ?? this.#waiting[0];
  }

  #pump(): void {
    if (this.#active || this.#disposed) {
      this.#settleIdle();
      return;
    }
    const next = this.#pick();
    if (!next) {
      this.#settleIdle();
      return;
    }
    if (!next.admitted) {
      if (this.#admitted >= MAX_ADMITTED) return;
      const index = this.#waiting.indexOf(next);
      if (index !== -1) this.#waiting.splice(index, 1);
      next.admitted = true;
      this.#admitted++;
    } else {
      const index = this.#ready.indexOf(next);
      if (index !== -1) this.#ready.splice(index, 1);
    }
    if (next.aborted || next.signal.aborted) {
      this.#removeAdmitted(next);
      next.removeAbortListener?.();
      next.settled = true;
      next.reject(next.signal.reason);
      this.#pump();
      return;
    }

    next.started = true;
    if (this.#lastPdfKey === next.pdfKey) this.#consecutive++;
    else {
      this.#lastPdfKey = next.pdfKey;
      this.#consecutive = 1;
    }
    this.#active = next;
    void (async () => {
      try {
        this.#finish(next, undefined, await next.run());
      } catch (error) {
        this.#finish(next, error);
      }
    })();
  }

  #removeAdmitted(entry: QueueEntry): void {
    if (!entry.admitted) return;
    entry.admitted = false;
    this.#admitted--;
  }

  #finish(entry: QueueEntry, error: unknown, value?: unknown): void {
    entry.removeAbortListener?.();
    this.#removeAdmitted(entry);
    if (this.#active === entry) this.#active = undefined;
    entry.settled = true;
    if (error !== undefined) entry.reject(error);
    else entry.resolve(value);
    this.#pump();
  }

  #settleIdle(): void {
    if (!this.#isIdle()) return;
    const resolve = this.#idleResolve;
    this.#idleResolve = undefined;
    resolve?.();
  }
}

export { MAX_ADMITTED as MAX_EXCERPT_PDF_JOBS };
