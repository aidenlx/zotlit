import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  Plugin,
  TAbstractFile,
} from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { NON_VAULT_PROPERTY_KEYS } from "@/lib/constants";
import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { DEFAULT_PROFILE, readProfileStamp } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { Service } from "@/services/service-base";

import {
  diffContributions,
  EMPTY_CONTRIBUTIONS,
  fileContributions,
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "./parse";
import type { ContribDiff, FileContributions } from "./parse";

export { itemKeyFromFrontmatter, noteKeyFromFrontmatter };

const logger = getLogger("note-index");

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

interface NoteIndexEvents {
  /** A note's Indexed Key contribution changed: it was added, moved or removed. */
  changed: (file: TFile) => void;
  /**
   * The frontmatter of a note the index tracks changed, in any key; also
   * when the note joins or leaves the index by a frontmatter edit.
   */
  "frontmatter-changed": (file: TFile) => void;
  /**
   * The Full Scan has indexed the notes: what the index answered before it
   * may have changed in any way, with no `changed` for each note.
   */
  indexed: () => void;
}

export interface NoteIndexOptions {
  plugin: Plugin;
  app: App;
}

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

export class NoteIndex extends Service<void> {
  readonly #app;
  readonly #emitter = createNanoEvents<NoteIndexEvents>();

  readonly #notesByItemKey = new Map<string, Set<TFile>>();
  readonly #notesByNoteKey = new Map<string, Set<TFile>>();
  readonly #contribByFile = new Map<TFile, FileContributions>();
  /** The frontmatter of each tracked file as last seen, serialized, to tell a frontmatter edit from a body edit. */
  readonly #frontmatterByFile = new Map<TFile, string>();
  /** Settles once the Full Scan has populated the index. */
  readonly #indexed = Promise.withResolvers<void>();
  #disposed = false;
  /** The fallback `resolved` listener, held so disposal can drop it. */
  #fallbackRef: EventRef | null = null;
  readonly #warnedDuplicatePaths = new Map<string, string>();

  ready: Promise<void>;

  constructor(options: NoteIndexOptions) {
    super();
    this.#app = options.app;
    this.ready = this.#load();
  }

  getNotesByItemKey(indexedKey: string): TFile[] {
    const notes = sortNotes(this.#notesByItemKey.get(indexedKey));
    if (notes.length > 1) {
      const paths = notes.map((file) => file.path);
      const signature = paths.join("\0");
      if (this.#warnedDuplicatePaths.get(indexedKey) !== signature) {
        this.#warnedDuplicatePaths.set(indexedKey, signature);
        logger.warn("Indexed Key resolves to multiple Literature Notes", {
          indexedKey,
          paths,
        });
      }
    } else {
      this.#warnedDuplicatePaths.delete(indexedKey);
    }
    return notes;
  }

  /** Imported-note files carrying `zotero-note-key`; disjoint from lit notes. */
  getImportedNoteByNoteKey(noteKey: string): TFile[] {
    return sortNotes(this.#notesByNoteKey.get(noteKey));
  }

  /** Await {@link whenIndexed} before querying; stamp labels are hints, IDs select membership. */
  getNotesByProfile(selector: ProfileSelector): {
    literatureNotes: TFile[];
    importedNotes: TFile[];
  } {
    const literatureNotes: TFile[] = [];
    const importedNotes: TFile[] = [];
    for (const [file, contribution] of this.#contribByFile) {
      const stamp = readProfileStamp(this.#app.metadataCache, file);
      const profile = stamp === undefined ? DEFAULT_PROFILE : stamp.id;
      if (profile !== selector) continue;
      if (contribution.noteKey !== null) importedNotes.push(file);
      else if (contribution.itemKey !== null) literatureNotes.push(file);
    }
    return { literatureNotes, importedNotes };
  }

  /**
   * The frontmatter keys found across the Literature Notes, in locale order,
   * but Obsidian's reserved keys and ZotLit's system keys: the names a vault
   * property can take.
   */
  getPropertyNames(): string[] {
    const names = new Set<string>();
    for (const [file, contribution] of this.#contribByFile) {
      if (contribution.itemKey === null || contribution.noteKey !== null)
        continue;
      const frontmatter =
        this.#app.metadataCache.getFileCache(file)?.frontmatter;
      for (const name of Object.keys(frontmatter ?? {}))
        if (!NON_VAULT_PROPERTY_KEYS.has(name)) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** Indexed keys that currently have at least one Literature Note. */
  getIndexedItemKeys(): string[] {
    return [...this.#notesByItemKey.keys()];
  }

  on<K extends keyof NoteIndexEvents>(
    event: K,
    cb: NoteIndexEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * Resolves once the Full Scan has populated the index. Stronger than
   * {@link ready}, which only marks listener registration: at plugin load
   * during startup the metadata cache is still filling, so the scan runs
   * later and `ready` settles with an empty index. Read create-vs-existing
   * decisions off this — a pre-scan read returns empty and mints a duplicate
   * instead of opening/overwriting the existing note.
   */
  async whenIndexed(): Promise<void> {
    await this.ready;
    await this.#indexed.promise;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { metadataCache, vault } = this.#app;

    stack.use(
      registerEvent(
        metadataCache.on("changed", (file, _data, cache) => {
          if (isMarkdownFile(file)) this.#apply(file, this.#readCache(cache));
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("deleted", (file) => {
          this.#apply(file, NONE);
        }),
      ),
    );
    stack.use(
      registerEvent(
        vault.on("delete", (file) => {
          if (isMarkdownFile(file)) this.#apply(file, NONE);
        }),
      ),
    );
    // A rename changes the file's identity, not its content. Obsidian moves the
    // same `TFile` to the new path in place, so the maps here already hold the
    // renamed file; consumers still hear the moved mapping, since the link
    // target path changed under them. The metadata cache follows a rename as
    // one more vault `rename` listener, in registration order, and only
    // rekeys its entry: it fires no `changed`. It subscribes when its initial
    // load is done, so a plugin loaded during startup hears the rename before
    // the cache rekeys, and `getFileCache` has nothing for the new path yet
    // (Obsidian 1.14.4). The vault calls its listeners synchronously, so the
    // file is read once that dispatch is over.
    stack.use(
      registerEvent(
        vault.on("rename", (file) => {
          if (!(file instanceof TFile)) return;
          if (!isMarkdownFile(file)) {
            this.#apply(file, NONE);
            return;
          }
          if (this.#contribByFile.has(file))
            this.#emitter.emit("changed", file);
          queueMicrotask(() => {
            if (!this.#disposed) this.#apply(file, this.#read(file));
          });
        }),
      ),
    );

    // `onLayoutReady` and `onCleanCache` are one-shots with no unregister, so
    // the scan gates on disposal instead. Callers parked on `whenIndexed()`
    // are torn down alongside the service and would otherwise wait on
    // nothing, so disposal settles them.
    stack.defer(() => {
      this.#disposed = true;
      if (this.#fallbackRef) metadataCache.offref(this.#fallbackRef);
      this.#indexed.resolve();
    });
    this.#app.workspace.onLayoutReady(() => this.#scanWhenCacheClean());

    this.commit(stack.move());
  }

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
  #scanWhenCacheClean(): void {
    if (this.#disposed) return;
    const { metadataCache } = this.#app;
    if (typeof metadataCache.onCleanCache === "function") {
      let scanned = false;
      metadataCache.onCleanCache(() => {
        scanned = true;
        this.#fullScan();
      });
      if (!scanned) logger.debug("Note index waits for a clean metadata cache");
      return;
    }
    // A build without the hook: the documented signal, once. This misses an
    // empty vault, where `resolved` never fires.
    logger.warn(
      "Metadata cache has no onCleanCache hook; scanning on resolved",
    );
    this.#fallbackRef = metadataCache.on("resolved", () => {
      if (this.#fallbackRef) metadataCache.offref(this.#fallbackRef);
      this.#fallbackRef = null;
      this.#fullScan();
    });
  }

  /**
   * What the metadata cache holds for the file now: its contributions, or
   * {@link UNREAD} while the cache has no entry for its path. A non-Markdown
   * file contributes nothing.
   */
  #read(file: TFile): Reading {
    if (!isMarkdownFile(file)) return NONE;
    const cache = this.#app.metadataCache.getFileCache(file);
    return cache ? this.#readCache(cache) : UNREAD;
  }

  /** What a Markdown file's cache entry, as the cache hands it over, holds. */
  #readCache(cache: CachedMetadata): Read {
    return {
      contributions: fileContributions(cache),
      frontmatter: serializeFrontmatter(cache),
    };
  }

  /**
   * Settles the file to `reading`, and reports a move of its keys as
   * `changed`, then an edit of its frontmatter as `frontmatter-changed`.
   */
  #apply(file: TFile, reading: Reading): void {
    const settled = this.#settle(file, reading);
    if (settled.moved) this.#emitter.emit("changed", file);
    if (settled.frontmatter) this.#emitter.emit("frontmatter-changed", file);
  }

  /**
   * The one step that changes the index: the file's keys, and the
   * frontmatter of a tracked file as last seen. An {@link UNREAD} file keeps
   * what the index holds for it, and the cache's next `changed` or `deleted`
   * settles it.
   * @returns whether the keys moved, and whether the frontmatter of a note
   * the index tracks, or tracked until now, changed; a file that is gone
   * reports no frontmatter edit.
   */
  #settle(
    file: TFile,
    reading: Reading,
  ): { moved: boolean; frontmatter: boolean } {
    if (reading === UNREAD) return { moved: false, frontmatter: false };
    const prev = this.#contribByFile.get(file) ?? EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, reading.contributions);
    if (!diff.empty) {
      this.#applyDiff(file, diff);
      if (hasContributions(reading.contributions)) {
        this.#contribByFile.set(file, reading.contributions);
      } else {
        this.#contribByFile.delete(file);
      }
    }

    const before = this.#frontmatterByFile.get(file);
    const after = reading.frontmatter;
    const tracked = this.#contribByFile.has(file);
    if (tracked && after !== null) this.#frontmatterByFile.set(file, after);
    else this.#frontmatterByFile.delete(file);
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
  #fullScan(): void {
    if (this.#disposed) return;
    this.#clear();

    for (const file of this.#app.vault.getMarkdownFiles()) {
      this.#settle(file, this.#read(file));
    }

    logger.debug("Note index scanned", { count: this.#contribByFile.size });
    this.#indexed.resolve();
    this.#emitter.emit("indexed");
  }

  #applyDiff(file: TFile, diff: ContribDiff): void {
    if (diff.itemKey.remove) {
      removeIndexedFile(this.#notesByItemKey, diff.itemKey.remove, file);
    }
    if (diff.itemKey.add) {
      addIndexedFile(this.#notesByItemKey, diff.itemKey.add, file);
    }

    if (diff.noteKey.remove) {
      removeIndexedFile(this.#notesByNoteKey, diff.noteKey.remove, file);
    }
    if (diff.noteKey.add) {
      addIndexedFile(this.#notesByNoteKey, diff.noteKey.add, file);
    }
  }

  #clear(): void {
    this.#notesByItemKey.clear();
    this.#notesByNoteKey.clear();
    this.#contribByFile.clear();
    this.#frontmatterByFile.clear();
    this.#warnedDuplicatePaths.clear();
  }
}

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
