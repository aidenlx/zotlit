// Bounded keyed reads that keep the old answer available while a fresh read replaces it.

import { createNanoEvents } from "@zotlit/shared/nanoevents";

export interface Held<T> {
  readonly value: T;
  readonly status: "fresh" | "revalidating" | "failed";
  readonly settled: Promise<T | null>;
}

interface MutableHeld<T> {
  value: T;
  status: Held<T>["status"];
  settled: Promise<T | null>;
}

interface Entry<T> {
  held: MutableHeld<T> | null;
  reading: Promise<T | null> | null;
  stale: boolean;
}

interface HeldReadEvents<T> {
  changed: (key: string) => void;
  settled: (key: string, held: Held<T> | null) => void;
  invalidated: () => void;
}

export interface HeldReadsOptions<T> {
  limit: number;
  same?: (prev: T, next: T) => boolean;
}

/**
 * Holds the last successful answer for each key while an invalidated answer is
 * read again. A failed first read keeps the key pending. A failed replacement
 * keeps its held answer with a failed status.
 */
export class HeldReads<T> implements Disposable {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #limit;
  readonly #same;
  readonly #emitter = createNanoEvents<HeldReadEvents<T>>();

  constructor(options: HeldReadsOptions<T>) {
    this.#limit = options.limit;
    this.#same = options.same ?? Object.is;
  }

  /** Returns the held answer and makes it the most recently asked-for key. */
  peek(key: string): Held<T> | null {
    const entry = this.#touch(key);
    return entry?.held ?? null;
  }

  /**
   * Reads a missing or stale key and joins an existing read for the same key.
   * A stale answer resolves immediately; its `settled` promise follows the
   * replacement read.
   */
  read(key: string, read: () => Promise<T | null>): Promise<Held<T> | null> {
    let entry = this.#touch(key);
    if (entry === undefined) {
      entry = { held: null, reading: null, stale: false };
      this.#entries.set(key, entry);
      this.#evict();
    }

    if (entry.reading !== null) {
      return entry.held
        ? Promise.resolve(entry.held)
        : entry.reading.then(() => this.#currentHeld(key, entry));
    }
    if (entry.held !== null && !entry.stale) {
      return Promise.resolve(entry.held);
    }
    const held = entry.held;
    entry.stale = false;
    const reading: Promise<T | null> = Promise.resolve()
      .then(read)
      .then((value) => this.#commit({ key, entry, reading, value }));
    entry.reading = reading;
    if (held !== null) {
      held.status = "revalidating";
      held.settled = reading;
      return Promise.resolve(held);
    }
    return reading.then(() => this.#currentHeld(key, entry));
  }

  /** Marks one or all answers stale and announces the affected scope. */
  invalidate(key?: string): void {
    if (key !== undefined) {
      if (!this.#invalidateEntry(key)) return;
      this.#emitter.emit("changed", key);
      return;
    }

    for (const [heldKey] of this.#entries) {
      this.#invalidateEntry(heldKey);
    }
    this.#emitter.emit("invalidated");
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  on<K extends keyof HeldReadEvents<T>>(
    event: K,
    cb: HeldReadEvents<T>[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  [Symbol.dispose](): void {
    this.#entries.clear();
  }

  #touch(key: string): Entry<T> | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  #currentHeld(key: string, entry: Entry<T>): Held<T> | null {
    return this.#entries.get(key) === entry ? entry.held : null;
  }

  #invalidateEntry(key: string): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    if (entry.held === null) {
      this.#entries.delete(key);
      return true;
    }
    entry.stale = true;
    return true;
  }

  #commit({
    key,
    entry,
    reading,
    value,
  }: {
    key: string;
    entry: Entry<T>;
    reading: Promise<T | null>;
    value: T | null;
  }): T | null {
    if (this.#entries.get(key) !== entry) return null;
    entry.reading = null;

    if (value === null) {
      if (entry.held !== null) {
        entry.held.status = "failed";
        entry.held.settled = reading;
      }
      this.#emitter.emit("settled", key, entry.held);
      return null;
    }

    if (entry.held !== null && this.#same(entry.held.value, value)) {
      entry.held.status = "fresh";
      entry.held.settled = reading;
    } else {
      entry.held = { value, status: "fresh", settled: reading };
      this.#emitter.emit("changed", key);
    }
    this.#emitter.emit("settled", key, entry.held);
    return value;
  }

  #evict(): void {
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }
}
