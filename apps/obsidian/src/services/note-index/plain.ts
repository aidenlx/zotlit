// The Note Index for callers outside Effect.
import type { TFile } from "obsidian";

import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import type { ProfileSelector } from "@/lib/profile-stamp";

import { NoteIndex } from "./service";
import type { NoteIndexChange, NoteIndexEvents } from "./service";

export interface PlainNoteIndex {
  getNotesByItemKey(indexedKey: string): TFile[];
  getImportedNoteByNoteKey(noteKey: string): TFile[];
  getNotesByProfile(selector: ProfileSelector): {
    literatureNotes: TFile[];
    importedNotes: TFile[];
  };
  getPropertyNames(): string[];
  getIndexedItemKeys(): string[];
  whenIndexed(): Promise<void>;
  /** Future index changes until the returned function stops the subscription. */
  subscribe(callback: (change: NoteIndexChange) => void): () => void;
  /** Compatibility surface for existing event consumers. */
  on<K extends keyof NoteIndexEvents>(
    event: K,
    callback: NoteIndexEvents[K],
  ): () => void;
}

export function plainNoteIndex(
  runtime: ManagedRuntime.ManagedRuntime<NoteIndex, never>,
): PlainNoteIndex {
  const index = runtime.runSync(NoteIndex.use(Effect.succeed));
  const subscribeChanges = (callback: (change: NoteIndexChange) => void) => {
    const seen = runtime.runSync(index.current);
    return subscribe(
      runtime,
      Stream.dropWhile(index.changes, (next) => next === seen),
      callback,
    );
  };
  return {
    getNotesByItemKey: (key) => runtime.runSync(index.getNotesByItemKey(key)),
    getImportedNoteByNoteKey: (key) =>
      runtime.runSync(index.getImportedNoteByNoteKey(key)),
    getNotesByProfile: (selector) =>
      runtime.runSync(index.getNotesByProfile(selector)),
    getPropertyNames: () => runtime.runSync(index.getPropertyNames()),
    getIndexedItemKeys: () => runtime.runSync(index.getIndexedItemKeys()),
    whenIndexed: async () => {
      // The runtime interrupts its callers before it closes the layer. A
      // caller waiting for the Full Scan still settles during teardown.
      const exit = await runtime.runPromiseExit(index.whenIndexed());
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        throw Cause.squash(exit.cause);
    },
    subscribe: subscribeChanges,
    on: (event, callback) =>
      subscribeChanges((change) => {
        if (change.type !== event) return;
        if (change.type === "indexed")
          (callback as NoteIndexEvents["indexed"])();
        else (callback as NoteIndexEvents["changed"])(change.file);
      }),
  };
}
