import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Schema,
  SubscriptionRef,
} from "effect";
import type { Stream } from "effect";
import type { App, TFile } from "obsidian";

import { isIndexedKey } from "@zotlit/db";

import { withLogCategory } from "@/lib/effect-log";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { ObsidianApp } from "@/lib/obsidian-app";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

const UseKind = Schema.Literals(["opened", "read", "cited"]);
export type UseKind = typeof UseKind.Type;

export interface Use {
  readonly instant: Temporal.Instant;
  readonly kind: UseKind;
}

/** The newest Use of each Item, keyed by Item key. */
export type Ledger = Readonly<Record<string, Use>>;

const STORAGE_KEY = "zotlit-use-ledger";
const CAPACITY = 300;

/** The last Use of each Item on this device, persisted per vault. */
export class UseLedger extends Context.Service<
  UseLedger,
  {
    readonly current: Effect.Effect<Ledger>;
    /** The ledger now, then each ledger a recorded Use replaces it with. */
    readonly changes: Stream.Stream<Ledger>;
    get(itemKey: string): Effect.Effect<Use | undefined>;
    /** A snapshot for the query worker and the empty Item search. */
    readonly uses: Effect.Effect<Readonly<Record<string, number>>>;
    /**
     * Keeps the newest Use and returns this action for live read write-back.
     * Without `instant`, the Use happens now, by the Effect Clock.
     */
    record(
      itemKey: string,
      kind: UseKind,
      instant?: Temporal.Instant,
    ): Effect.Effect<Use>;
    /** Keep a Companion update's own navigation outside the Use timeline. */
    withoutNoteUse<A, E, R>(
      file: TFile,
      open: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R>;
  }
>()("zotlit/use-ledger/UseLedger") {}

/**
 * The ledger loaded from local storage, recording Item notes as they open.
 * Closing the scope stops recording.
 */
const makeUseLedger = Effect.gen(function* () {
  const app = yield* ObsidianApp;
  const metadata = yield* MetadataCache;
  const workspace = yield* Workspace;
  const ledger = yield* SubscriptionRef.make(newest(yield* readSaved(app)));
  const excludedOpens = new Map<TFile, number>();
  let closed = false;

  const now = Effect.map(Clock.currentTimeMillis, (millis) =>
    Temporal.Instant.fromEpochMilliseconds(millis),
  );
  const current = SubscriptionRef.get(ledger);

  const record = Effect.fn("UseLedger.record")(function* (
    itemKey: string,
    kind: UseKind,
    instant?: Temporal.Instant,
  ) {
    const use: Use = Object.freeze({ instant: instant ?? (yield* now), kind });
    if (closed || !isIndexedKey(itemKey)) return use;
    const before = yield* current;
    const previous = before[itemKey];
    if (previous && Temporal.Instant.compare(previous.instant, use.instant) > 0)
      return use;
    const next = newest({ ...before, [itemKey]: use });
    app.saveLocalStorage(
      STORAGE_KEY,
      Object.fromEntries(
        Object.entries(next).map(([key, entry]) => [
          key,
          { instant: entry.instant.toString(), kind: entry.kind },
        ]),
      ),
    );
    yield* SubscriptionRef.set(ledger, next);
    return use;
  });

  let enabled = false;
  let pending: { file: TFile; instant: Temporal.Instant } | null = null;
  yield* workspace.layoutReady.pipe(
    Effect.andThen(
      Effect.sync(() => {
        if (!closed) enabled = true;
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  // Each `file-open` counts, from `changes`, which does not replay: the file
  // active when the ledger builds is not an open. forkEach hands each over
  // inside Obsidian's callback, so an open the flush below delivers lands
  // inside or outside an operation's scope as it happened.
  yield* forkEach(
    filterTag(workspace.changes, "file-open"),
    Effect.fnUntraced(function* ({ file }) {
      if (!enabled || closed) return;
      pending = null;
      if (!file || file.extension !== "md" || excludedOpens.has(file)) return;
      const instant = yield* now;
      const cache = yield* metadata.fileCache(file);
      const key = itemKeyFromFrontmatter(cache);
      if (key) yield* record(key, "opened", instant);
      else if (!cache) pending = { file, instant };
    }),
  );
  yield* forkEach(
    filterTag(metadata.changes, "changed"),
    Effect.fnUntraced(function* ({ file, cache }) {
      if (!pending || pending.file !== file) return;
      if ((yield* workspace.getActiveFile) !== file) return;
      const { instant } = pending;
      pending = null;
      const key = itemKeyFromFrontmatter(cache);
      if (key) yield* record(key, "opened", instant);
    }),
  );
  // Runs first on close: a Use recorded during teardown is not kept.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }).pipe(Effect.andThen(PubSub.shutdown(ledger.pubsub))),
  );

  // Obsidian defers file-open: deliver a pending open, so it lands inside or
  // outside an operation's scope as it happened.
  const flush = () => app.workspace.requestActiveLeafEvents.run();

  return UseLedger.of({
    current,
    changes: SubscriptionRef.changes(ledger),
    get: Effect.fn("UseLedger.get")((itemKey) =>
      Effect.map(current, (entries) => entries[itemKey]),
    ),
    uses: Effect.map(current, (entries) =>
      Object.fromEntries(
        Object.entries(entries).map(([key, use]) => [
          key,
          use.instant.epochMilliseconds,
        ]),
      ),
    ),
    record,
    withoutNoteUse: Effect.fn("UseLedger.withoutNoteUse")((file, open) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          flush();
          excludedOpens.set(file, (excludedOpens.get(file) ?? 0) + 1);
        }),
        () => open,
        () =>
          Effect.sync(() => {
            try {
              flush();
            } finally {
              const remaining = excludedOpens.get(file)! - 1;
              if (remaining) excludedOpens.set(file, remaining);
              else excludedOpens.delete(file);
            }
          }),
      ),
    ),
  });
}).pipe(withLogCategory("use-ledger"));

export const layerUseLedger: Layer.Layer<
  UseLedger,
  never,
  ObsidianApp | MetadataCache | Workspace
> = Layer.effect(UseLedger, makeUseLedger);

/**
 * The Uses saved for this vault, or none when they cannot be read: the ledger
 * builds during plugin load, so a failed read must not stop the plugin.
 */
function readSaved(app: App): Effect.Effect<Record<string, Use>> {
  return Effect.try(() => loadUses(app.loadLocalStorage(STORAGE_KEY))).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not read the saved Uses; starting empty").pipe(
        Effect.annotateLogs({ error: error.cause }),
        Effect.as({}),
      ),
    ),
  );
}

const decodeSaved = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decodeEntry = Schema.decodeUnknownOption(
  Schema.Struct({ instant: Schema.String, kind: UseKind }),
);

/** The Uses saved in local storage; an unreadable entry carries no Use. */
function loadUses(raw: unknown): Record<string, Use> {
  const loaded: Record<string, Use> = {};
  const saved = Option.getOrElse(decodeSaved(raw), () => ({}));
  for (const [key, value] of Object.entries(saved)) {
    if (!isIndexedKey(key)) continue;
    const entry = Option.getOrUndefined(decodeEntry(value));
    const instant = entry && parseInstant(entry.instant);
    if (entry && instant)
      loaded[key] = Object.freeze({ instant, kind: entry.kind });
  }
  return loaded;
}

function parseInstant(text: string): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(text);
  } catch {
    return undefined;
  }
}

function newest(entries: Ledger): Ledger {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries)
        .sort(([, a], [, b]) => Temporal.Instant.compare(b.instant, a.instant))
        .slice(0, CAPACITY),
    ),
  );
}
