import { testEvent } from "@/lib/__fixtures__/event-stream";
/**
 * Test double for the Note Index, shared by the consumer suites. Holds a
 * fixed key-to-notes table and property names, and lets a test fire
 * `changed`, `frontmatter-changed` or `indexed` by hand.
 */
type NoteIndexStubEvent = "changed" | "frontmatter-changed" | "indexed";

export class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #propertyNames: readonly string[];
  readonly #changed = testEvent<{ path: string }>();
  readonly #frontmatter = testEvent<{ path: string }>();
  readonly #indexed = testEvent<void>();
  readonly changed = this.#changed.stream;
  readonly "frontmatter-changed" = this.#frontmatter.stream;
  readonly indexed = this.#indexed.stream;

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

  /** Fire `event`, for the note `file` where it names one. */
  emit(event: NoteIndexStubEvent, file?: { path: string }): void {
    if (event === "indexed") this.#indexed.emit();
    else if (event === "changed") this.#changed.emit(file!);
    else this.#frontmatter.emit(file!);
  }
}
