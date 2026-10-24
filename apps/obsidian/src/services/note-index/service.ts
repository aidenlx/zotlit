import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef, TAbstractFile } from "obsidian";

import { NON_VAULT_PROPERTY_KEYS } from "@/lib/constants";
import {
  Context,
  Deferred,
  Effect,
  Layer,
  SubscriptionRef,
} from "@/lib/effect";
import type { Stream } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { ObsidianApp } from "@/lib/obsidian-app";
import { DEFAULT_PROFILE, readProfileStamp } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";

import {
  diffContributions,
  EMPTY_CONTRIBUTIONS,
  fileContributions,
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "./parse";
import type { ContribDiff, FileContributions } from "./parse";

export { itemKeyFromFrontmatter, noteKeyFromFrontmatter };

/** The metadata cache holds no entry for the file's path yet. */
const UNREAD = Symbol("unread");
/**
 * What the metadata cache holds for a file: its Indexed Keys, and its
 * frontmatter serialized, `null` for a file that is gone or not Markdown.
 */
interface Read {
  contributions: FileContributions;
  frontmatter: string | null;
}
/** A file that is gone or not Markdown: no keys, no frontmatter. */
const NONE: Read = { contributions: EMPTY_CONTRIBUTIONS, frontmatter: null };
type Reading = Read | typeof UNREAD;

export type NoteIndexChange =
  | { readonly type: "initial" }
  | { readonly type: "indexed" }
  | { readonly type: "changed" | "frontmatter-changed"; readonly file: TFile };

/** Frontmatter-only check; does not consult the index. */
export function isLiteratureNote(file: string | TFile, app: App): boolean {
  const cache =
    typeof file === "string"
      ? app.metadataCache.getCache(file)
      : app.metadataCache.getFileCache(file);
  return itemKeyFromFrontmatter(cache) !== null;
}

/** The Literature Note a wikilink target points at. */
export interface ResolvedLiteratureNote {
  /** The note's vault path. */
  path: string;
  /** Its Indexed Key — the frontmatter marker that makes it a Literature Note. */
  indexedKey: string;
}

/**
 * The Literature Note a wikilink target points at, seen from `sourcePath`, or
 * `null` when the target is missing or is an ordinary note. Frontmatter-only
 * like {@link isLiteratureNote}, so it answers before the first scan; every
 * consumer that turns a linkpath into a Citation shares it.
 */
export function resolveLiteratureNote(
  linkpath: string,
  sourcePath: string,
  options: { app: App },
): ResolvedLiteratureNote | null {
  const { app } = options;
  const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!dest) return null;
  const cache = app.metadataCache.getFileCache(dest);
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (indexedKey === null) return null;
  return {
    path: dest.path,
    indexedKey,
  };
}

/** {@link resolveLiteratureNote}, for a consumer that needs the key alone. */
export function resolveIndexedKey(
  linkpath: string,
  sourcePath: string,
  app: App,
): string | null {
  const note = resolveLiteratureNote(linkpath, sourcePath, { app });
  return note?.indexedKey ?? null;
}

export class NoteIndex extends Context.Service<
  NoteIndex,
  {
    /** The latest index invalidation; `initial` precedes the first update. */
    readonly current: Effect.Effect<NoteIndexChange>;
    /** The latest invalidation, followed by every later one in order. */
    readonly changes: Stream.Stream<NoteIndexChange>;
    getNotesByItemKey(indexedKey: string): Effect.Effect<TFile[]>;
    getImportedNoteByNoteKey(noteKey: string): Effect.Effect<TFile[]>;
    getNotesByProfile(selector: ProfileSelector): Effect.Effect<{
      literatureNotes: TFile[];
      importedNotes: TFile[];
    }>;
    getPropertyNames(): Effect.Effect<string[]>;
    getIndexedItemKeys(): Effect.Effect<string[]>;
    /**
     * Settles after the Full Scan, or when the layer closes. Await this before
     * create-vs-existing decisions: a pre-scan read can mint a duplicate.
     */
    whenIndexed(): Effect.Effect<void>;
    /** Waits for queued rename reads, including those that change no keys. */
    whenSettled(): Effect.Effect<void>;
  }
>()("zotlit/note-index/NoteIndex") {}

const makeNoteIndex = Effect.gen(function* () {
  const app = yield* ObsidianApp;
  const changes = yield* SubscriptionRef.make<NoteIndexChange>({
    type: "initial",
  });
  const indexed = yield* Deferred.make<void>();
  const pendingRenames = new Set<Deferred.Deferred<void>>();
  const pendingBarriers = new Set<Deferred.Deferred<void>>();
  const events = yield* obsidianEvents<{
    changed: [TFile, string, CachedMetadata];
    deleted: [TFile];
    delete: [TAbstractFile];
    rename: [TAbstractFile, string];
    "rename-settled": [TFile, Deferred.Deferred<void>];
    layout: [];
    clean: [];
    resolved: [];
    barrier: [Deferred.Deferred<void>];
  }>();
  const notesByItemKey = new Map<string, Set<TFile>>();
  const notesByNoteKey = new Map<string, Set<TFile>>();
  const contribByFile = new Map<TFile, FileContributions>();
  /** The frontmatter of each tracked file as last seen, serialized, to tell a frontmatter edit from a body edit. */
  const frontmatterByFile = new Map<TFile, string>();
  const warnedDuplicatePaths = new Map<string, string>();
  let disposed = false;
  /** The fallback `resolved` listener, held so disposal can drop it. */
  let fallbackRef: EventRef | null = null;

  const publish = (change: NoteIndexChange) =>
    SubscriptionRef.set(changes, change);

  const getNotesByItemKey = Effect.fn("NoteIndex.getNotesByItemKey")(function* (
    indexedKey: string,
  ) {
    const notes = sortNotes(notesByItemKey.get(indexedKey));
    if (notes.length > 1) {
      const paths = notes.map((file) => file.path);
      const signature = paths.join("\0");
      if (warnedDuplicatePaths.get(indexedKey) !== signature) {
        warnedDuplicatePaths.set(indexedKey, signature);
        yield* Effect.logWarning(
          "Indexed Key resolves to multiple Literature Notes",
        ).pipe(
          Effect.annotateLogs({ indexedKey, paths }),
          withLogCategory("note-index"),
        );
      }
    } else {
      warnedDuplicatePaths.delete(indexedKey);
    }
    return notes;
  });

  /** Imported-note files carrying `zotero-note-key`; disjoint from lit notes. */
  const getImportedNoteByNoteKey = Effect.fn(
    "NoteIndex.getImportedNoteByNoteKey",
  )((noteKey: string) =>
    Effect.sync(() => sortNotes(notesByNoteKey.get(noteKey))),
  );

  /** Await {@link whenIndexed} before querying; stamp labels are hints, IDs select membership. */
  const getNotesByProfile = Effect.fn("NoteIndex.getNotesByProfile")(
    (selector: ProfileSelector) =>
      Effect.sync(() => {
        const literatureNotes: TFile[] = [];
        const importedNotes: TFile[] = [];
        for (const [file, contribution] of contribByFile) {
          const stamp = readProfileStamp(app.metadataCache, file);
          const profile = stamp === undefined ? DEFAULT_PROFILE : stamp.id;
          if (profile !== selector) continue;
          if (contribution.noteKey !== null) importedNotes.push(file);
          else if (contribution.itemKey !== null) literatureNotes.push(file);
        }
        return { literatureNotes, importedNotes };
      }),
  );

  /**
   * The frontmatter keys found across the Literature Notes, in locale order,
   * but Obsidian's reserved keys and ZotLit's system keys: the names a vault
   * property can take.
   */
  const getPropertyNames = Effect.fn("NoteIndex.getPropertyNames")(() =>
    Effect.sync(() => {
      const names = new Set<string>();
      for (const [file, contribution] of contribByFile) {
        if (contribution.itemKey === null || contribution.noteKey !== null)
          continue;
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        for (const name of Object.keys(frontmatter ?? {}))
          if (!NON_VAULT_PROPERTY_KEYS.has(name)) names.add(name);
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    }),
  );

  /** Indexed keys that currently have at least one Literature Note. */
  const getIndexedItemKeys = Effect.fn("NoteIndex.getIndexedItemKeys")(() =>
    Effect.sync(() => [...notesByItemKey.keys()]),
  );

  const whenIndexed = Effect.fn("NoteIndex.whenIndexed")(function* () {
    yield* Deferred.await(indexed);
  });

  const whenSettled = Effect.fn("NoteIndex.whenSettled")(function* () {
    if (disposed) return;
    // The consumer must reach this marker before we snapshot pending renames.
    const barrier = yield* Deferred.make<void>();
    pendingBarriers.add(barrier);
    events.callback("barrier")(barrier);
    yield* Deferred.await(barrier);
    yield* Effect.forEach([...pendingRenames], Deferred.await, {
      discard: true,
    });
  });

  // Acquire listeners after the functions below have been initialized.
  const listen = Effect.fn("NoteIndex.listen")(function* () {
    const { metadataCache, vault } = app;

    yield* events.on("changed", metadataCache, "changed");
    yield* events.on("deleted", metadataCache, "deleted");
    yield* events.on("delete", vault, "delete");
    yield* events.on("rename", vault, "rename");
    app.workspace.onLayoutReady(events.callback("layout"));
    // Start immediately so a ready layout and clean cache finish the Full Scan
    // before acquisition returns, as they did through the synchronous callbacks.
    yield* events
      .consume(consume)
      .pipe(Effect.forkScoped({ startImmediately: true }));

    // `onLayoutReady` and `onCleanCache` are one-shots with no unregister, so
    // the scan gates on disposal instead. Callers parked on `whenIndexed()`
    // are torn down alongside the service and would otherwise wait on
    // nothing, so disposal settles them.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        disposed = true;
        yield* Deferred.succeed(indexed, undefined);
        for (const settled of pendingRenames)
          yield* Deferred.succeed(settled, undefined);
        pendingRenames.clear();
        for (const barrier of pendingBarriers)
          yield* Deferred.succeed(barrier, undefined);
        pendingBarriers.clear();
      }),
    );
  });

  /**
   * Runs the Full Scan exactly once, when the metadata cache covers every file.
   *
   * Obsidian's public API carries no "cache complete" signal. `resolved` is
   * documented as firing "each time files get modified after the initial
   * load", and it fires only when the link-resolver queue drains after
   * running, so a vault with no indexable files never emits it. The
   * undocumented `metadataCache.initialized` flips when the initial scan is
   * dispatched, while parse tasks are still pending. The undocumented
   * `onCleanCache(cb)` is Obsidian's own one-shot (it uses it before rewriting
   * links on rename): it calls back at once when no parse task is in progress
   * and the resolver queue is idle, else after the next `finished`/`resolved`
   * (Obsidian 1.13.7). Layout-ready is the guard, since at plugin load during
   * startup the vault is not loaded yet and the empty cache reads as clean;
   * layout-ready runs strictly after the cache initializes, and synchronously
   * when the plugin is enabled at runtime.
   */
  const scanWhenCacheClean = Effect.fn("NoteIndex.scanWhenCacheClean")(
    function* () {
      if (disposed) return;
      const { metadataCache } = app;
      if (typeof metadataCache.onCleanCache === "function") {
        metadataCache.onCleanCache(events.callback("clean"));
        yield* Effect.logDebug(
          "Note index requested a clean metadata cache",
        ).pipe(withLogCategory("note-index"));
        return;
      }
      // A build without the hook: the documented signal, once. This misses an
      // empty vault, where `resolved` never fires.
      yield* Effect.logWarning(
        "Metadata cache has no onCleanCache hook; scanning on resolved",
      ).pipe(withLogCategory("note-index"));
      fallbackRef = yield* events.on("resolved", metadataCache, "resolved");
    },
  );

  const consume = Effect.fnUntraced(function* (
    event: Stream.Success<typeof events.stream>,
  ) {
    if (disposed) return;
    switch (event.type) {
      case "changed": {
        const [file, , cache] = event.args;
        if (isMarkdownFile(file)) yield* apply(file, readCache(cache));
        break;
      }
      case "deleted":
        yield* apply(event.args[0], NONE);
        break;
      case "delete": {
        const [file] = event.args;
        if (isMarkdownFile(file)) yield* apply(file, NONE);
        break;
      }
      case "rename": {
        const [file] = event.args;
        if (!(file instanceof TFile)) break;
        if (!isMarkdownFile(file)) {
          yield* apply(file, NONE);
          break;
        }
        // Obsidian rekeys the same TFile in a later vault listener during
        // startup. Read after that dispatch, keeping the moved-key notice first.
        if (contribByFile.has(file)) yield* publish({ type: "changed", file });
        const settled = yield* Deferred.make<void>();
        pendingRenames.add(settled);
        const published = events.callback("rename-settled");
        queueMicrotask(() => published(file, settled));
        break;
      }
      case "rename-settled": {
        const [file, settled] = event.args;
        yield* Effect.suspend(() => apply(file, read(file))).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              pendingRenames.delete(settled);
              yield* Deferred.succeed(settled, undefined);
            }),
          ),
        );
        break;
      }
      case "layout":
        yield* scanWhenCacheClean();
        break;
      case "resolved":
        if (!fallbackRef) break;
        app.metadataCache.offref(fallbackRef);
        fallbackRef = null;
        yield* fullScan();
        break;
      case "clean":
        yield* fullScan();
        break;
      case "barrier": {
        const [barrier] = event.args;
        pendingBarriers.delete(barrier);
        yield* Deferred.succeed(barrier, undefined);
        break;
      }
    }
  });

  /**
   * What the metadata cache holds for the file now: its contributions, or
   * {@link UNREAD} while the cache has no entry for its path. A non-Markdown
   * file contributes nothing.
   */
  function read(file: TFile): Reading {
    if (!isMarkdownFile(file)) return NONE;
    const cache = app.metadataCache.getFileCache(file);
    return cache ? readCache(cache) : UNREAD;
  }

  /** What a Markdown file's cache entry, as the cache hands it over, holds. */
  function readCache(cache: CachedMetadata): Read {
    return {
      contributions: fileContributions(cache),
      frontmatter: serializeFrontmatter(cache),
    };
  }

  /**
   * Settles the file to `reading`, and reports a move of its keys as
   * `changed`, then an edit of its frontmatter as `frontmatter-changed`.
   */
  const apply = Effect.fn("NoteIndex.apply")(function* (
    file: TFile,
    reading: Reading,
  ) {
    const settled = settle(file, reading);
    if (settled.moved) yield* publish({ type: "changed", file });
    if (settled.frontmatter)
      yield* publish({ type: "frontmatter-changed", file });
  });

  /**
   * The one step that changes the index: the file's keys, and the
   * frontmatter of a tracked file as last seen. An {@link UNREAD} file keeps
   * what the index holds for it, and the cache's next `changed` or `deleted`
   * settles it.
   * @returns whether the keys moved, and whether the frontmatter of a note
   * the index tracks, or tracked until now, changed; a file that is gone
   * reports no frontmatter edit.
   */
  function settle(
    file: TFile,
    reading: Reading,
  ): { moved: boolean; frontmatter: boolean } {
    if (reading === UNREAD) return { moved: false, frontmatter: false };
    const prev = contribByFile.get(file) ?? EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, reading.contributions);
    if (!diff.empty) {
      applyDiff(file, diff);
      if (hasContributions(reading.contributions)) {
        contribByFile.set(file, reading.contributions);
      } else {
        contribByFile.delete(file);
      }
    }

    const before = frontmatterByFile.get(file);
    const after = reading.frontmatter;
    const tracked = contribByFile.has(file);
    if (tracked && after !== null) frontmatterByFile.set(file, after);
    else frontmatterByFile.delete(file);
    return {
      moved: !diff.empty,
      frontmatter:
        after !== null && (tracked || before !== undefined) && before !== after,
    };
  }

  /**
   * Reads every note at once, then says `indexed`: a consumer that read the
   * index before the scan reads it again. It says no `changed` for each note;
   * every later change arrives as `changed` or `frontmatter-changed` for its
   * file.
   */
  const fullScan = Effect.fn("NoteIndex.fullScan")(
    function* () {
      if (disposed) return;
      clear();

      for (const file of app.vault.getMarkdownFiles()) {
        settle(file, read(file));
      }

      yield* Effect.logDebug("Note index scanned").pipe(
        Effect.annotateLogs({ count: contribByFile.size }),
        withLogCategory("note-index"),
      );
      yield* publish({ type: "indexed" });
    },
    Effect.ensuring(Deferred.succeed(indexed, undefined)),
  );

  function applyDiff(file: TFile, diff: ContribDiff): void {
    if (diff.itemKey.remove) {
      removeIndexedFile(notesByItemKey, diff.itemKey.remove, file);
    }
    if (diff.itemKey.add) {
      addIndexedFile(notesByItemKey, diff.itemKey.add, file);
    }

    if (diff.noteKey.remove) {
      removeIndexedFile(notesByNoteKey, diff.noteKey.remove, file);
    }
    if (diff.noteKey.add) {
      addIndexedFile(notesByNoteKey, diff.noteKey.add, file);
    }
  }

  function clear(): void {
    notesByItemKey.clear();
    notesByNoteKey.clear();
    contribByFile.clear();
    frontmatterByFile.clear();
    warnedDuplicatePaths.clear();
  }
  yield* listen();
  return NoteIndex.of({
    current: SubscriptionRef.get(changes),
    changes: SubscriptionRef.changes(changes),
    getNotesByItemKey,
    getImportedNoteByNoteKey,
    getNotesByProfile,
    getPropertyNames,
    getIndexedItemKeys,
    whenIndexed,
    whenSettled,
  });
});

export const layerNoteIndex: Layer.Layer<NoteIndex, never, ObsidianApp> =
  Layer.effect(NoteIndex, makeNoteIndex);

function serializeFrontmatter(cache: CachedMetadata | null): string {
  return JSON.stringify(cache?.frontmatter ?? null);
}

/** Most-recently-modified first; ties broken by path for stable ordering. */
function sortNotes(files: Set<TFile> | undefined): TFile[] {
  if (!files) return [];
  return [...files].sort(
    (a, b) => b.stat.mtime - a.stat.mtime || a.path.localeCompare(b.path),
  );
}

function addIndexedFile(
  index: Map<string, Set<TFile>>,
  key: string,
  file: TFile,
): void {
  ensureSet(index, key).add(file);
}

function removeIndexedFile(
  index: Map<string, Set<TFile>>,
  key: string,
  file: TFile,
): void {
  const files = index.get(key);
  if (!files) return;
  files.delete(file);
  if (files.size === 0) index.delete(key);
}

function ensureSet<T>(index: Map<string, Set<T>>, key: string): Set<T> {
  let values = index.get(key);
  if (!values) {
    values = new Set();
    index.set(key, values);
  }
  return values;
}

function hasContributions(contributions: FileContributions): boolean {
  return contributions.itemKey !== null || contributions.noteKey !== null;
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
