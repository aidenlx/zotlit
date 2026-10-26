// The Library's document atom and its coalesced settings commands.
import { Cause, Effect, Exit, Option } from "effect";
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

const flushDocumentCommand = viewRuntime.fn(
  (result: PromiseWithResolvers<void>) =>
    PluginSettings.use((settings) => settings.flush).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            result.reject(Cause.squash(exit.cause));
          else result.resolve();
        }),
      ),
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
  #writing: Promise<void> | null = null;
  #queued: Promise<void> | null = null;

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

  save(): Promise<void> {
    this.#registry.set(this.model.save, { document: this.document() });
    if (this.#queued) return this.#queued;
    const queued = (this.#writing ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        this.#queued = null;
        const result = Promise.withResolvers<void>();
        this.#registry.set(flushDocumentCommand, result);
        this.#writing = result.promise;
        void result.promise
          .finally(() => {
            if (this.#writing === result.promise) this.#writing = null;
          })
          .catch(() => {});
        return result.promise;
      });
    this.#queued = queued;
    return queued;
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
  }
}
