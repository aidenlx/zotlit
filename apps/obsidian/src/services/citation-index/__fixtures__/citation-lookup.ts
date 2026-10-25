import { testEvent } from "@/lib/__fixtures__/event-stream";

import { Stream } from "effect";
import type { PlainCitationLookup } from "@/services/citation-index/plain";

import type {
  CitationLookupAnswer,
  CitationLookupRequest,
} from "@/services/citation-index/lookup";
import type {
  CitationLookupObservation,
  CitationLookupStatus,
  CitationLookupState,
} from "@/services/citation-index/lookup-service";

/** The consumer seam: async delivery, strict requested answers, and a held placeholder. */
export class CitationLookupStub implements Pick<
  PlainCitationLookup,
  "read" | "observe" | "changed" | "status-changed" | "status" | "whenResolved" | "changes"
> {
  status: CitationLookupStatus = "fresh";
  #revision = 0;
  readonly #events = testEvent<CitationLookupState>();
  readonly changes = Stream.suspend(() => this.#events.stream.pipe(Stream.prepend([{status: this.status, revision: String(this.#revision), stopped: false}])));
  readonly changed = this.#events.stream.pipe(Stream.map(() => undefined));
  readonly "status-changed" = this.changed;
  readonly #answer;
  readonly #deliveries = new Set<Promise<void>>();

  get pending(): boolean {
    return this.#deliveries.size > 0;
  }
  async settle(): Promise<void> {
    await Promise.all(this.#deliveries);
  }
  readonly #refresh = new Set<() => void>();


  constructor(
    answer: (
      request: CitationLookupRequest,
    ) => CitationLookupAnswer | null | Promise<CitationLookupAnswer | null>,
  ) {
    this.#answer = answer;
  }

  get activeObservations(): number {
    return this.#refresh.size;
  }

  async whenResolved(): Promise<void> {}

  async read(
    request: CitationLookupRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CitationLookupAnswer> {
    signal?.throwIfAborted();
    const answer = await this.#answer(request);
    signal?.throwIfAborted();
    if (!answer) throw new Error("Citation Lookup is unavailable");
    return answer;
  }

  refresh(): void {
    this.#revision++;
    for (const refresh of this.#refresh) refresh();
    this.#events.emit({status: this.status, revision: String(this.#revision), stopped: false});
  }

  observe(changed: () => void): CitationLookupObservation {
    let current: CitationLookupObservation["current"] = null;
    let request: CitationLookupRequest | null = null;
    let identity: string | undefined;
    let generation = 0;
    let disposed = false;
    let settle: ((answer: CitationLookupAnswer | null) => void) | undefined;
    const refresh = (): void => {
      if (!request || disposed) return;
      const turn = ++generation;
      settle?.(null);
      const pending = Promise.withResolvers<CitationLookupAnswer | null>();
      settle = pending.resolve;
      const previous = current?.value;
      current = previous
        ? { value: previous, status: "revalidating", settled: pending.promise }
        : null;
      changed();
      // The gap is part of the seam, even when the fixture knows the answer now.
      const delivery = Promise.resolve()
        .then(() => this.#answer(request!))
        .then(
          (answer) => {
            if (disposed || generation !== turn) return;
            if (answer === null) return;
            current = {
              value: answer,
              status: "fresh",
              settled: Promise.resolve(answer),
            };
            pending.resolve(answer);
            changed();
          },
          () => {
            if (disposed || generation !== turn) return;
            current = previous
              ? {
                  value: previous,
                  status: "failed",
                  settled: Promise.resolve(previous),
                }
              : null;
            pending.resolve(previous ?? null);
            changed();
          },
        );
      this.#deliveries.add(delivery);
      void delivery.finally(() => this.#deliveries.delete(delivery));
    };
    this.#refresh.add(refresh);
    return {
      get current() {
        return current;
      },
      set(next) {
        const selected = {
          citekeys: [...new Set(next.citekeys ?? [])].sort(),
          indexedKeys: [...new Set(next.indexedKeys ?? [])].sort(),
          annotationKeys: [...new Set(next.annotationKeys ?? [])].sort(),
        };
        const key = JSON.stringify(selected);
        if (disposed || identity === key) return;
        identity = key;
        request = selected;
        refresh();
      },
      [Symbol.dispose]: () => {
        disposed = true;
        generation += 1;
        settle?.(null);
        current = null;
        this.#refresh.delete(refresh);
      },
    };
  }
}

/** One observation for extension fixtures that receive a factory instead of a service. */
export function lookupObservation(
  answer: ConstructorParameters<typeof CitationLookupStub>[0],
  changed: () => void,
  released: () => void = () => undefined,
): CitationLookupObservation {
  const observation = new CitationLookupStub(answer).observe(changed);
  return {
    get current() {
      return observation.current;
    },
    set: (request) => observation.set(request),
    [Symbol.dispose]() {
      observation[Symbol.dispose]();
      released();
    },
  };
}
