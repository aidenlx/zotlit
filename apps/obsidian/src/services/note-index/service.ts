import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  Plugin,
  TAbstractFile,
} from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
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

interface NoteIndexEvents {
  changed: (file: TFile) => void;
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
  /** Settles once the Full Scan has populated the index. */
  readonly #indexed = Promise.withResolvers<void>();
  #disposed = false;
  /** The fallback `resolved` listener, held so disposal can drop it. */
  #fallbackRef: EventRef | null = null;

  ready: Promise<void>;

  constructor(options: NoteIndexOptions) {
    super();
    this.#app = options.app;
    this.ready = this.#load();
  }

  getNotesByItemKey(indexedKey: string): TFile[] {
    return sortNotes(this.#notesByItemKey.get(indexedKey));
  }

  /** Imported-note files carrying `zotero-note-key`; disjoint from lit notes. */
  getImportedNoteByNoteKey(noteKey: string): TFile[] {
    return sortNotes(this.#notesByNoteKey.get(noteKey));
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
          if (isMarkdownFile(file)) this.#applyFile(file, cache);
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("deleted", (file) => {
          this.#applyFile(file, null);
        }),
      ),
    );
    stack.use(
      registerEvent(
        vault.on("delete", (file) => {
          if (isMarkdownFile(file)) this.#applyFile(file, null);
        }),
      ),
    );
    // The metadata cache fires neither `changed` nor `deleted` on rename: it
    // rekeys its entries by path and mutates the `TFile` in place, so the maps
    // here already hold the renamed file. Consumers still see a moved mapping,
    // since the link target path changed under them.
    stack.use(
      registerEvent(
        vault.on("rename", (file) => {
          if (!(file instanceof TFile)) return;
          const cache = isMarkdownFile(file)
            ? metadataCache.getFileCache(file)
            : null;
          const applied = this.#applyFile(file, cache);
          if (!applied && this.#contribByFile.has(file)) {
            this.#emitter.emit("changed", file);
          }
        }),
      ),
    );

    // `onLayoutReady` and `onCleanCache` are one-shots with no unregister, so
    // the scan gates on disposal instead.
    stack.defer(() => {
      this.#disposed = true;
      if (this.#fallbackRef) metadataCache.offref(this.#fallbackRef);
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
   * Applies the file's contribution diff and reports it as `changed`.
   * @returns false when nothing moved, so no `changed` went out.
   */
  #applyFile(file: TFile, cache: CachedMetadata | null): boolean {
    const prev = this.#contribByFile.get(file) ?? EMPTY_CONTRIBUTIONS;
    const next = cache ? fileContributions(cache) : EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, next);
    if (diff.empty) return false;

    this.#applyDiff(file, diff);
    if (hasContributions(next)) {
      this.#contribByFile.set(file, next);
    } else {
      this.#contribByFile.delete(file);
    }
    this.#emitter.emit("changed", file);
    return true;
  }

  /** Silent to consumers: every later mapping change arrives as `changed`. */
  #fullScan(): void {
    if (this.#disposed) return;
    this.#clear();

    for (const file of this.#app.vault.getMarkdownFiles()) {
      const cache = this.#app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const contributions = fileContributions(cache);
      this.#insertContributions(file, contributions);
    }

    logger.debug("Note index scanned", { count: this.#contribByFile.size });
    this.#indexed.resolve();
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

  #insertContributions(file: TFile, contributions: FileContributions): void {
    if (!hasContributions(contributions)) return;

    if (contributions.itemKey) {
      addIndexedFile(this.#notesByItemKey, contributions.itemKey, file);
    }
    if (contributions.noteKey) {
      addIndexedFile(this.#notesByNoteKey, contributions.noteKey, file);
    }
    this.#contribByFile.set(file, contributions);
  }

  #clear(): void {
    this.#notesByItemKey.clear();
    this.#notesByNoteKey.clear();
    this.#contribByFile.clear();
  }
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
