// The Note Index for callers outside Effect.
import { Effect, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import type { TFile } from "obsidian";

import { effectBridge, valueOr } from "@/lib/effect-bridge";
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
  // The legacy service retained its maps after release. The bridge keeps the
  // runtime's context for those reads: ManagedRuntime rejects new work after
  // disposal.
  const bridge = effectBridge(runtime);
  const index = runtime.runSync(NoteIndex.use(Effect.succeed));
  const read = bridge.runSync;
  const wait = async (effect: Effect.Effect<void>) => {
    if (bridge.closed()) return;
    // Runtime disposal interrupts callers before closing the layer. Both
    // scan and rename waiters settle when the legacy service is released.
    valueOr(await bridge.runPromiseExit(effect), undefined);
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
