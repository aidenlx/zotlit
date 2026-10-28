// The Library's document atom and its coalesced settings commands.
import { Cause, Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { PluginSettings } from "@/services/settings/service";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
  withText,
} from "./document";
import type { LibraryViewDocument } from "./document";
import { waitForRead } from "./model";

const savedDocumentAtom = viewRuntime.atom(
  Effect.gen(function* () {
    return parseLibraryViewDocument(
      (yield* (yield* PluginSettings).current)["library.document"],
    );
  }),
);

const updateDocumentCommand = viewRuntime.fn(
  (doc: LibraryViewDocument) =>
    PluginSettings.use((settings) =>
      settings.update({
        "library.document": serializeLibraryViewDocument(doc),
      }),
    ),
  { concurrent: true },
);

/**
 * Writes plugin data to disk. It waits one turn first, so the changes of one
 * task reach disk in one write; a close in that turn skips the write. Once
 * the write starts it finishes, even when the view closes:
 * `PluginSettings.flush` runs uninterruptible.
 */
const flushDocumentCommand = viewRuntime.fn(
  () =>
    Effect.andThen(
      Effect.yieldNow,
      PluginSettings.use((settings) => settings.flush),
    ),
  { concurrent: true },
);

export class LibraryViewStorage {
  readonly model = {
    document: Atom.make(DEFAULT_LIBRARY_VIEW_DOCUMENT),
    save: Atom.make<{ readonly document: LibraryViewDocument } | null>(null),
  };
  readonly #registry;
  readonly #toolbar;
  #release: (() => void) | null;
  #taken: string | null = null;
  /** What waits for a write; a close ends each wait. */
  readonly #waiting = new Set<() => void>();

  constructor(registry: ViewRegistryHandle, toolbar: () => string | null) {
    this.#registry = registry;
    this.#toolbar = toolbar;
    this.#release = this.#hold();
  }

  #hold(): () => void {
    const releases = [
      this.#registry.mount(this.model.document),
      this.#registry.mount(this.model.save),
      this.#registry.mount(savedDocumentAtom),
      this.#registry.mount(updateDocumentCommand),
      this.#registry.mount(flushDocumentCommand),
      this.#registry.subscribe(this.model.save, (doc) => {
        if (doc) this.#registry.set(updateDocumentCommand, doc.document);
      }),
    ];
    return () => {
      for (const release of releases) release();
    };
  }

  async load(): Promise<void> {
    this.#release ??= this.#hold();
    this.#registry.refresh(savedDocumentAtom);
    await waitForRead(this.#registry, savedDocumentAtom, new Set());
    const saved = Option.getOrElse(
      AsyncResult.value(this.#registry.get(savedDocumentAtom)),
      () => DEFAULT_LIBRARY_VIEW_DOCUMENT,
    );
    this.#registry.set(this.model.document, saved);
    this.#taken = this.#toolbar();
  }

  document(): LibraryViewDocument {
    const text = this.#toolbar();
    if (text !== null && text !== this.#taken) {
      this.#registry.update(this.model.document, (doc) => withText(doc, text));
      this.#taken = text;
    }
    return this.#registry.get(this.model.document);
  }

  set(change: (doc: LibraryViewDocument) => LibraryViewDocument): void {
    this.#registry.set(this.model.document, change(this.document()));
  }

  /**
   * Write the document to disk. Settles once the writes asked for so far
   * end, or the storage closes; rejects where a write failed.
   */
  async save(): Promise<void> {
    this.#registry.set(this.model.save, { document: this.document() });
    this.#registry.set(flushDocumentCommand, undefined);
    await waitForRead(this.#registry, flushDocumentCommand, this.#waiting);
    if (!this.#release) return;
    const result = this.#registry.get(flushDocumentCommand);
    if (AsyncResult.isFailure(result) && !Cause.hasInterruptsOnly(result.cause))
      throw Cause.squash(result.cause);
  }

  change(
    change: (doc: LibraryViewDocument) => LibraryViewDocument,
  ): Promise<void> {
    this.set(change);
    return this.save();
  }

  close(): void {
    this.#release?.();
    this.#release = null;
    for (const finish of this.#waiting) finish();
  }
}
