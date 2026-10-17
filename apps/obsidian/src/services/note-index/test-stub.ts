/**
 * Test double for the Note Index, shared by the consumer suites. Holds a
 * fixed key-to-notes table and property names, and lets a test fire
 * `changed` or `frontmatter-changed` by hand.
 */
type NoteIndexStubEvent = "changed" | "frontmatter-changed";

export class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #propertyNames: readonly string[];
  readonly #listeners: Record<NoteIndexStubEvent, Set<() => void>> = {
    changed: new Set(),
    "frontmatter-changed": new Set(),
  };

  constructor(
    notes: Record<string, { path: string }[]> = {},
    propertyNames: readonly string[] = [],
  ) {
    this.#notes = notes;
    this.#propertyNames = propertyNames;
  }

  getNotesByItemKey(indexedKey: string): { path: string }[] {
    return this.#notes[indexedKey] ?? [];
  }

  getIndexedItemKeys(): string[] {
    return Object.keys(this.#notes);
  }

  getPropertyNames(): string[] {
    return [...this.#propertyNames];
  }

  whenIndexed(): Promise<void> {
    return Promise.resolve();
  }

  on(event: NoteIndexStubEvent, cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: NoteIndexStubEvent): void {
    for (const cb of this.#listeners[event]) cb();
  }
}
