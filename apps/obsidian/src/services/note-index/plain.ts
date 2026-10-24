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
  /** Waits for queued rename reads, including those that change no keys. */
  whenSettled(): Promise<void>;
  /** Future index changes until the returned function stops the subscription. */
  subscribe(callback: (change: NoteIndexChange) => void): () => void;
  /** Compatibility surface for existing event consumers. */
  on<K extends keyof NoteIndexEvents>(
    event: K,
    callback: NoteIndexEvents[K],
  ): () => void;
}

export function plainNoteIndex(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<NoteIndex, never>,
    "runSync" | "runPromiseExit" | "runFork" | "scope"
  >,
): PlainNoteIndex {
  const index = runtime.runSync(NoteIndex.use(Effect.succeed));
  // The legacy service retained its maps after release. Keep the runtime's
  // context for those reads: ManagedRuntime rejects new work after disposal.
  const readReleased = Effect.runSyncWith(
    runtime.runSync(Effect.context<never>()),
  );
  const closed = () => runtime.scope.state._tag === "Closed";
  const read = <A>(effect: Effect.Effect<A>): A =>
    closed() ? readReleased(effect) : runtime.runSync(effect);
  const wait = async (effect: Effect.Effect<void>) => {
    if (closed()) return;
    // Runtime disposal interrupts callers before closing the layer. Both
    // scan and rename waiters settle when the legacy service is released.
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
      throw Cause.squash(exit.cause);
  };
  const subscribeChanges = (callback: (change: NoteIndexChange) => void) => {
    if (closed()) return () => {};
    const seen = runtime.runSync(index.current);
    return subscribe(
      runtime,
      Stream.dropWhile(index.changes, (next) => next === seen),
      callback,
    );
  };
  return {
    getNotesByItemKey: (key) => read(index.getNotesByItemKey(key)),
    getImportedNoteByNoteKey: (key) =>
      read(index.getImportedNoteByNoteKey(key)),
    getNotesByProfile: (selector) => read(index.getNotesByProfile(selector)),
    getPropertyNames: () => read(index.getPropertyNames()),
    getIndexedItemKeys: () => read(index.getIndexedItemKeys()),
    whenSettled: () => wait(index.whenSettled()),
    whenIndexed: () => wait(index.whenIndexed()),
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
