// What a print waits for: the moment a layout has drawn the value its store
// holds now. Preact subscribes a list to its store only after a paint, so a
// hidden print window can draw a store change later than the read that made
// it. The Query View keeps one latch for its Annotation Cards and one for the
// records of its Items layouts.

/** A wait for a layout to draw the value `current` gives, compared by identity. */
export class DrawLatch<T> {
  readonly #current: () => T;
  #drawn: T | undefined = undefined;
  #waits: (() => void)[] = [];

  constructor(current: () => T) {
    this.#current = current;
  }

  /** The layout drew `value`: the waits settle when it is the current one. */
  drew(value: T): void {
    this.#drawn = value;
    if (value === this.#current()) this.release();
  }

  /** Settles once the layout has drawn the current value. Never rejects. */
  drawn(): Promise<void> {
    if (this.#drawn === this.#current()) return Promise.resolve();
    return new Promise((resolve) => this.#waits.push(resolve));
  }

  /** Settle every wait, as the view unloads. */
  release(): void {
    const waits = this.#waits;
    this.#waits = [];
    for (const resolve of waits) resolve();
  }
}
