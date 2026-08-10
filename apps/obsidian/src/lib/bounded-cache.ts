// A keyed cache that holds a fixed number of values, dropping the least recently asked-for one.

/**
 * Values by key, up to `limit` of them.
 *
 * An ask moves its value to the end, so the eviction takes the value whose ask
 * is furthest in the past. The bound exists so a session that visits many keys
 * cannot grow the cache without end.
 */
export class BoundedCache<T> {
  readonly #held = new Map<string, T>();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  get size(): number {
    return this.#held.size;
  }

  /** Answer `key`, running `create` when nothing holds it yet. */
  hold(key: string, create: () => T): T {
    const held = this.#held.get(key);
    if (held !== undefined) {
      this.#held.delete(key);
      this.#held.set(key, held);
      return held;
    }

    const created = create();
    this.#held.set(key, created);
    while (this.#held.size > this.#limit) {
      const oldest = this.#held.keys().next().value;
      if (oldest === undefined) break;
      this.#held.delete(oldest);
    }
    return created;
  }

  /** What `key` holds, leaving its place in the eviction order as it is. */
  peek(key: string): T | undefined {
    return this.#held.get(key);
  }

  delete(key: string): void {
    this.#held.delete(key);
  }

  clear(): void {
    this.#held.clear();
  }
}
