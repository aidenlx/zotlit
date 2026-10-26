// PROTOTYPE (proto/view-reactivity) — throwaway. The Effect side of the
// Reactivity Lab: the Streams and Effects a view wants from the real services,
// plus a probe that counts live subscriptions so teardown is visible.
import { Effect, Queue, Stream } from "effect";
import type { TFile } from "obsidian";

import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitedBySnapshot } from "@/services/citation-index/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { PluginSettings } from "@/services/settings/service";

export type LabServices =
  | Vault
  | Workspace
  | MetadataCache
  | CitationIndex
  | PluginSettings;

export interface ActiveNote {
  readonly path: string | null;
  readonly key: string | null;
}

export const EMPTY_SNAPSHOT: CitedBySnapshot = {
  groups: [],
  coverage: "complete",
  resolution: null,
};

// ---------------------------------------------------------------------------
// Probe: plain counters every tab renders in its debug strip.

export interface ProbeState {
  readonly live: number;
  readonly opened: number;
  readonly lateCallbacks: number;
  readonly log: readonly string[];
}

let probeState: ProbeState = { live: 0, opened: 0, lateCallbacks: 0, log: [] };
const probeListeners = new Set<() => void>();
let probeSeq = 0;

function probe(patch: (s: ProbeState) => Partial<ProbeState>, line?: string) {
  const next = { ...probeState, ...patch(probeState) };
  if (line) {
    probeSeq += 1;
    next.log = [`#${probeSeq} ${line}`, ...probeState.log].slice(0, 12);
  }
  probeState = next;
  for (const listener of probeListeners) listener();
}

export const labProbe = {
  get: () => probeState,
  subscribe: (listener: () => void) => {
    probeListeners.add(listener);
    return () => probeListeners.delete(listener);
  },
  note: (line: string) => probe(() => ({}), line),
};
// Readable after the plugin is disabled, for the teardown walk.
Object.assign(globalThis, { __zotlitLabProbe: labProbe });

// ---------------------------------------------------------------------------
// Streams and Effects.

const sameNote = (a: ActiveNote, b: ActiveNote) =>
  a.path === b.path && a.key === b.key;

/**
 * The active note and its indexed key, now and on each change. Emits when the
 * path or the key changes; a path change with the same key still emits, so a
 * consumer must dedupe on the key itself before it resubscribes.
 */
export const activeNote: Stream.Stream<
  ActiveNote,
  never,
  Vault | Workspace | MetadataCache
> = Stream.unwrap(
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const vault = yield* Vault;
    const read = Effect.gen(function* () {
      const file: TFile | null = yield* workspace.getActiveFile;
      const cache =
        file?.extension === "md" ? yield* metadata.fileCache(file) : null;
      return {
        path: file?.path ?? null,
        key: itemKeyFromFrontmatter(cache),
      } satisfies ActiveNote;
    });
    const triggers = Stream.mergeAll(
      [
        filterTag(workspace.changes, "file-open", "active-leaf-change"),
        filterTag(metadata.changes, "changed"),
        filterTag(vault.changes, "rename"),
      ].map((events: Stream.Stream<unknown>) => Stream.map(events, () => null)),
      { concurrency: "unbounded" },
    );
    return Stream.concat(Stream.make(null), triggers).pipe(
      Stream.mapEffect(() => read),
      Stream.changesWith(sameNote),
    );
  }),
);

/**
 * The Cited By snapshot of `key`, live. The service exposes a callback; this
 * is the Stream shape a view-friendly service member would have, with the
 * probe counting how many are open and any callback after close.
 */
export const citedBy = (
  key: string,
): Stream.Stream<CitedBySnapshot, never, CitationIndex> =>
  Stream.callback<CitedBySnapshot>((queue) =>
    Effect.gen(function* () {
      const index = yield* CitationIndex;
      let closed = false;
      probe(
        (s) => ({ live: s.live + 1, opened: s.opened + 1 }),
        `open citedBy(${key})`,
      );
      const stop = yield* index.observeCitedBy(key, (snapshot) => {
        if (closed) {
          probe(
            (s) => ({ lateCallbacks: s.lateCallbacks + 1 }),
            "LATE callback",
          );
          return;
        }
        Queue.offerUnsafe(queue, snapshot);
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
          stop();
          probe((s) => ({ live: s.live - 1 }), `close citedBy(${key})`);
        }),
      );
    }),
  );

/** Cited By of the followed key: switches on key change, not on path change. */
export const citedByOfActive = (
  notes: Stream.Stream<ActiveNote, never, Vault | Workspace | MetadataCache>,
) =>
  notes.pipe(
    Stream.map((note) => note.key),
    Stream.changes,
    Stream.switchMap((key) =>
      key ? citedBy(key) : Stream.make(EMPTY_SNAPSHOT),
    ),
  );

const AT_TRIGGER = "citation.at-trigger" as const;

/** One boolean setting, now and on each change. */
export const atTrigger: Stream.Stream<boolean, never, PluginSettings> =
  Stream.unwrap(
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      return settings.changes.pipe(
        Stream.map((s) => s[AT_TRIGGER]),
        Stream.changes,
      );
    }),
  );

/** The write a handler enters Effect for. Slowed so "pending" is visible. */
export const toggleAtTrigger = Effect.gen(function* () {
  const settings = yield* PluginSettings;
  yield* Effect.sleep("400 millis");
  yield* settings.update((current) => ({ [AT_TRIGGER]: !current[AT_TRIGGER] }));
});

/** Why a preview read gave no preview. */
export interface PreviewUnavailable {
  readonly _tag: "PreviewUnavailable";
  readonly key: string;
}

/**
 * A slow one-shot read per key, the shape of a group preview. The probe logs
 * its start, its end and an interrupt, so the walk sees whether a read stops
 * when its last reader leaves. The key "fail" fails with a typed error.
 */
export const readPreview = (key: string) =>
  Effect.gen(function* () {
    probe(() => ({}), `read start(${key})`);
    yield* Effect.sleep("1500 millis");
    if (key === "fail") {
      return yield* Effect.fail<PreviewUnavailable>({
        _tag: "PreviewUnavailable",
        key,
      });
    }
    probe(() => ({}), `read done(${key})`);
    return `preview of ${key}`;
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => probe(() => ({}), `read interrupted(${key})`)),
    ),
  );

/** A one-shot async read with a loading and an error state. */
export const readCitedByOnce = (key: string) =>
  Effect.gen(function* () {
    const index = yield* CitationIndex;
    yield* Effect.sleep("300 millis");
    const answer = yield* index.readCitedBy({ key }, 2000);
    return answer.kind === "timeout"
      ? "timed out (indexing)"
      : `${JSON.stringify(answer).length} bytes of answer`;
  });

export const openNote = (path: string) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    yield* workspace.openLinkText(path, "", { newLeaf: false });
  });
