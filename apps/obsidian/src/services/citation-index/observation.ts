import { getLogger } from "@/lib/log";
import type { Held } from "@/services/query-client/service";

import type { CitationLookupAnswer, CitationLookupRequest } from "./lookup";

/** A view-owned projection. Replacing its request releases the old selection. */
export interface CitationLookupObservation extends Disposable {
  readonly current: Held<CitationLookupAnswer> | null;
  set(request: CitationLookupRequest): void;
}

export class LookupObservation implements CitationLookupObservation {
  readonly #read;
  readonly #changed;
  readonly #release;
  #request: CitationLookupRequest | null = null;
  #identity: string | null = null;
  #current: Held<CitationLookupAnswer> | null = null;
  #controller?: AbortController;
  #disposed = false;

  constructor(
    read: (
      request: CitationLookupRequest,
      signal: AbortSignal,
    ) => Promise<CitationLookupAnswer>,
    changed: () => void,
    release: () => void,
  ) {
    this.#read = read;
    this.#changed = changed;
    this.#release = release;
  }

  get current(): Held<CitationLookupAnswer> | null {
    return this.#current;
  }

  set(request: CitationLookupRequest): void {
    if (this.#disposed) return;
    const citekeys = [...new Set(request.citekeys ?? [])].sort();
    const indexedKeys = [...new Set(request.indexedKeys ?? [])].sort();
    const identity = JSON.stringify([citekeys, indexedKeys]);
    if (identity === this.#identity) return;
    this.#identity = identity;
    this.#request = { citekeys, indexedKeys };
    this.#current = null;
    this.refresh();
  }

  refresh(): void {
    if (this.#disposed || !this.#request) return;
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const previous = this.#current;
    const pending = Promise.withResolvers<CitationLookupAnswer | null>();
    if (previous)
      this.#current = {
        value: previous.value,
        status: "revalidating",
        settled: pending.promise,
      };
    void this.#read(this.#request, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) {
          pending.resolve(null);
          return;
        }
        const value =
          previous?.value.revision === answer.revision
            ? previous.value
            : answer;
        this.#current = {
          value,
          status: "fresh",
          settled: Promise.resolve(value),
        };
        pending.resolve(value);
        if (value !== previous?.value || previous?.status === "failed")
          this.#notify();
      },
      () => {
        if (controller.signal.aborted) {
          pending.resolve(null);
          return;
        }
        this.#current = previous
          ? {
              value: previous.value,
              status: "failed",
              settled: Promise.resolve(previous.value),
            }
          : null;
        pending.resolve(previous?.value ?? null);
        this.#notify();
      },
    );
  }

  #notify(): void {
    try {
      this.#changed();
    } catch (error) {
      getLogger("citation-index").warn("Lookup observer failed", { error });
    }
  }

  [Symbol.dispose](): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller?.abort();
    this.#request = null;
    this.#current = null;
    this.#release();
  }
}
