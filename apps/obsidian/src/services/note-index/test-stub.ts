/**
 * Test double for the Note Index, shared by the consumer suites. Holds a
 * fixed key-to-notes table and lets a test fire `changed` by hand.
 */
export class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #listeners: Record<"changed", Set<() => void>> = {
    changed: new Set(),
  };

  constructor(notes: Record<string, { path: string }[]> = {}) {
    this.#notes = notes;
  }

  getNotesByItemKey(indexedKey: string): { path: string }[] {
    return this.#notes[indexedKey] ?? [];
  }

  whenIndexed(): Promise<void> {
    return Promise.resolve();
  }

  on(event: "changed", cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed"): void {
    for (const cb of this.#listeners[event]) cb();
  }
}
