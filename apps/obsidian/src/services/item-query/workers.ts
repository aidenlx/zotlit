import { getLogger } from "@logtape/logtape";
import { abortable } from "@std/async/abortable";
import type { EventEmitter } from "node:events";

import { SLICE_BUDGET_MS } from "@zotlit/item-query";

import type { CancellationEvent, QueryObserver } from "./trace";
import type { QueryJob, WorkerReply } from "./worker-protocol";

export interface QueryWorker extends Pick<
  EventEmitter,
  "on" | "removeAllListeners"
> {
  postMessage(text: string): void;
  terminate(): Promise<unknown>;
}
export type QueryWorkerFactory = () => QueryWorker;

// Reserve time inside the 50 ms budget for process exit, file cleanup, and timer delivery.
// Cooperative cleanup gets two scheduler slices from the original request.
const CANCEL_CLEANUP_GRACE_MS = SLICE_BUDGET_MS * 2;

interface Pending {
  job: QueryJob;
  signal: AbortSignal;
  resolve: (answer: string) => void;
  reject: (error: unknown) => void;
  removeAbort: () => void;
  observer?: QueryObserver;
}

/** Two warm workers bound concurrency and isolate an export from a small query. */
export class QueryWorkers implements AsyncDisposable {
  readonly #slots: Slot[];
  readonly #pending: Pending[] = [];
  readonly #running = new Set<Promise<void>>();
  readonly #unload = new AbortController();
  readonly ready: Promise<void>;

  constructor(factory: QueryWorkerFactory) {
    this.#slots = [
      new Slot(factory, () => this.#pump()),
      new Slot(factory, () => this.#pump()),
    ];
    this.ready = Promise.all(this.#slots.map((slot) => slot.ready())).then(
      () => {},
    );
  }

  async answer(
    job: QueryJob,
    parentSignal: AbortSignal,
    observer?: QueryObserver,
  ): Promise<string> {
    const signal = AbortSignal.any([parentSignal, this.#unload.signal]);
    signal.throwIfAborted();
    await abortable(this.ready, signal);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        job,
        signal,
        resolve,
        reject,
        observer,
        removeAbort: () => signal.removeEventListener("abort", abort),
      };
      const abort = () => {
        const index = this.#pending.indexOf(pending);
        if (index < 0) return;
        this.#pending.splice(index, 1);
        pending.removeAbort();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#pending.push(pending);
      this.#pump();
    });
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (!slot.available) continue;
      const pending = this.#pending.shift();
      if (!pending) break;
      pending.removeAbort();
      slot.busy = true;
      const running = slot
        .answer(pending.job, pending.signal, pending.observer)
        .then(pending.resolve, pending.reject)
        .finally(() => {
          slot.busy = false;
          this.#running.delete(running);
          this.#pump();
        });
      this.#running.add(running);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#unload.abort();
    await this.ready.catch(() => {});
    await Promise.allSettled(this.#running);
    await Promise.all(this.#slots.map((slot) => slot.close()));
  }
}

class Slot {
  readonly #factory;
  readonly #onAvailable;
  #worker: QueryWorker | undefined;
  #ready: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #fail: ((error: unknown) => void) | undefined;
  #answer: ((answer: string) => void) | undefined;
  #cancelled: (() => void) | undefined;
  #cancelAccepted: (() => void) | undefined;
  #observer: QueryObserver | undefined;
  busy = false;

  constructor(factory: QueryWorkerFactory, onAvailable: () => void) {
    this.#factory = factory;
    this.#onAvailable = onAvailable;
  }

  get available(): boolean {
    return !this.busy && this.#closing === undefined;
  }

  async ready(): Promise<void> {
    await this.#closing;
    if (this.#ready) return this.#ready;
    const worker = (this.#worker = this.#factory());
    this.#ready = new Promise<void>((resolve, reject) => {
      worker.on("message", (text: string) => {
        const reply = JSON.parse(text) as WorkerReply;
        if (reply.type === "ready") resolve();
        else if (reply.type === "cancel-accepted") {
          this.#observeCancel("accepted");
          this.#cancelAccepted?.();
        } else if (reply.type === "cancelled") {
          this.#observeCancel("receipt");
          this.#cancelled?.();
        } else if (reply.type === "cancel-progress") {
          this.#observer?.cancelled?.(reply.event);
        } else if (reply.type === "log") {
          const { category, ...record } = reply.record;
          getLogger(category).emit(record);
        } else if (reply.type === "answer") {
          if (reply.measurement) this.#observer?.completed(reply.measurement);
          this.#answer?.(reply.answer);
        } else if (reply.type === "error") {
          const error = new Error(reply.message);
          error.name = reply.name;
          error.stack = reply.stack;
          reject(error);
          this.#fail?.(error);
        }
      });
      worker.on("error", (error: Error) => {
        reject(error);
        this.#fail?.(error);
      });
      worker.on("exit", (code: number) => {
        this.#observeCancel("exit");
        const error = new Error(`Item Query worker exited (${code})`);
        reject(error);
        this.#fail?.(error);
        if (this.#worker === worker) {
          this.#worker = undefined;
          this.#ready = undefined;
        }
      });
    });
    return this.#ready;
  }

  async answer(
    job: QueryJob,
    signal: AbortSignal,
    observer?: QueryObserver,
  ): Promise<string> {
    let acknowledged = false;
    let dispatched = false;
    const closedResources = Promise.withResolvers<void>();
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    let requestedAt: number | undefined;
    let stopping = false;
    const stop = () => {
      stopping = true;
      this.#observeCancel("stop-requested");
      this.#fail?.(signal.reason);
    };
    const abort = () => {
      requestedAt = performance.now();
      this.#observeCancel("sent");
      // This watchdog detects an unresponsive event loop. Once the worker
      // accepts interruption, cleanup keeps the deadline measured from the original request.
      forceStop = setTimeout(stop, SLICE_BUDGET_MS);
      try {
        this.#worker?.postMessage(JSON.stringify({ type: "cancel" }));
      } catch (error) {
        this.#fail?.(error);
      }
    };
    try {
      signal.throwIfAborted();
      await abortable(this.ready(), signal);
      signal.throwIfAborted();
      return await new Promise<string>((resolve, reject) => {
        this.#answer = resolve;
        this.#observer = observer;
        this.#fail = reject;
        this.#cancelled = () => {
          acknowledged = true;
          closedResources.resolve();
          reject(signal.reason);
        };
        this.#cancelAccepted = () => {
          if (requestedAt === undefined || stopping) return;
          clearTimeout(forceStop);
          forceStop = setTimeout(
            stop,
            Math.max(
              0,
              requestedAt + CANCEL_CLEANUP_GRACE_MS - performance.now(),
            ),
          );
        };
        signal.addEventListener("abort", abort, { once: true });
        dispatched = true;
        this.#worker!.postMessage(JSON.stringify({ type: "query", job }));
      });
    } catch (error) {
      // Closure acknowledgement or exit proves that the query owns no resources.
      // A late acknowledgement can win even after process termination starts;
      // close() keeps that process unavailable until its exit is confirmed.
      if (dispatched && !acknowledged) {
        const exited = this.close();
        if (signal.aborted)
          await Promise.race([closedResources.promise, exited]);
        else await exited;
      } else if (!signal.aborted) await this.close();
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      clearTimeout(forceStop);
      this.#cancelled = undefined;
      this.#cancelAccepted = undefined;
      this.#answer = undefined;
      this.#observer = undefined;
      this.#fail = undefined;
    }
  }

  #observeCancel(phase: CancellationEvent["phase"]): void {
    this.#observer?.cancelled?.({
      phase,
      atEpochMs: Temporal.Now.instant().epochMilliseconds,
    });
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    const worker = this.#worker;
    if (!worker) return Promise.resolve();
    const closing = (async () => {
      await worker.terminate();
      worker.removeAllListeners();
      if (this.#worker === worker) {
        this.#worker = undefined;
        this.#ready = undefined;
      }
    })();
    this.#closing = closing;
    void closing.then(
      () => {
        this.#closing = undefined;
        this.#onAvailable();
      },
      () => {},
    );
    return closing;
  }
}
