/**
 * Test double for the Note Index, shared by the consumer suites. Holds a
 * fixed key-to-notes table and property names, and lets a test fire
 * `changed`, `frontmatter-changed` or `indexed` by hand.
 */
type NoteIndexStubEvent = "changed" | "frontmatter-changed" | "indexed";

export class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #propertyNames: readonly string[];
  readonly #listeners: Record<
    NoteIndexStubEvent,
    Set<(file?: { path: string }) => void>
  > = {
    changed: new Set(),
    "frontmatter-changed": new Set(),
    indexed: new Set(),
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

  on(
    event: NoteIndexStubEvent,
    cb: (file?: { path: string }) => void,
  ): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  /** Fire `event`, for the note `file` where it names one. */
  emit(event: NoteIndexStubEvent, file?: { path: string }): void {
    for (const cb of this.#listeners[event]) cb(file);
  }
}
