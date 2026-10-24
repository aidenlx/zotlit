// The Note Index for callers outside Effect.
import type { TFile } from "obsidian";

import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import type { ProfileSelector } from "@/lib/profile-stamp";

import { NoteIndex } from "./service";
import type { NoteIndexChange } from "./service";

export interface PlainNoteIndex {
  readonly changes: Stream.Stream<NoteIndexChange>;
  readonly changed: Stream.Stream<TFile>;
  readonly "frontmatter-changed": Stream.Stream<TFile>;
  readonly indexed: Stream.Stream<void>;
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
  return {
    getNotesByItemKey: (key) => read(index.getNotesByItemKey(key)),
    getImportedNoteByNoteKey: (key) =>
      read(index.getImportedNoteByNoteKey(key)),
    getNotesByProfile: (selector) => read(index.getNotesByProfile(selector)),
    getPropertyNames: () => read(index.getPropertyNames()),
    getIndexedItemKeys: () => read(index.getIndexedItemKeys()),
    whenSettled: () => wait(index.whenSettled()),
    whenIndexed: () => wait(index.whenIndexed()),
    changes: index.changes,
    changed: index.changes.pipe(
      Stream.filter(
        (change): change is Extract<NoteIndexChange, { file: TFile }> =>
          change.type === "changed",
      ),
      Stream.map((change) => change.file),
    ),
    "frontmatter-changed": index.changes.pipe(
      Stream.filter(
        (change): change is Extract<NoteIndexChange, { file: TFile }> =>
          change.type === "frontmatter-changed",
      ),
      Stream.map((change) => change.file),
    ),
    indexed: index.changes.pipe(
      Stream.filter((change) => change.type === "indexed"),
      Stream.map(() => undefined),
    ),
  };
}
