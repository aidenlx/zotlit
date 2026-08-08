import { TFile } from "obsidian";
import type { App, CachedMetadata, Plugin, TAbstractFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

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
  rebuilt: () => void;
}

export interface NoteIndexOptions {
  plugin: Plugin;
  app: App;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
}

/** Frontmatter-only check; does not consult the index. */
export function isLiteratureNote(file: string | TFile, app: App): boolean {
  const cache =
    typeof file === "string"
      ? app.metadataCache.getCache(file)
      : app.metadataCache.getFileCache(file);
  return itemKeyFromFrontmatter(cache) !== null;
}

export class NoteIndex extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #emitter = createNanoEvents<NoteIndexEvents>();

  readonly #notesByItemKey = new Map<string, Set<TFile>>();
  readonly #notesByCitationKey = new Map<string, Set<TFile>>();
  readonly #notesByNoteKey = new Map<string, Set<TFile>>();
  readonly #contribByFile = new Map<TFile, FileContributions>();
  #scanned = false;
  #citationKeyProperty: string | null = null;

  ready: Promise<void>;

  constructor(options: NoteIndexOptions) {
    super();
    this.#app = options.app;
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  getNotesByItemKey(indexedKey: string): TFile[] {
    return sortNotes(this.#notesByItemKey.get(indexedKey));
  }

  getNotesByCitationKey(citationKey: string): TFile[] {
    return sortNotes(this.#notesByCitationKey.get(citationKey));
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

  once<K extends keyof NoteIndexEvents>(
    event: K,
    cb: NoteIndexEvents[K],
  ): () => void {
    return this.#emitter.once(event, cb);
  }

  /**
   * Resolves once a full scan has populated the index. Stronger than
   * {@link ready}, which only marks listener registration: when `metadataCache`
   * wasn't initialized at construction, the first scan runs later on its
   * "resolved" event, so `ready` can settle with an empty index. Read
   * create-vs-existing decisions off this — a pre-scan read returns empty and
   * mints a duplicate instead of opening/overwriting the existing note.
   */
  async whenIndexed(): Promise<void> {
    await this.ready;
    if (this.#scanned) return;
    await new Promise<void>((resolve) => this.once("rebuilt", () => resolve()));
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;
    const initialSettings = this.#settings.current;
    if (initialSettings) {
      this.#citationKeyProperty = citationKeyProperty(initialSettings);
    }
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
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
        metadataCache.on("resolved", () => {
          this.#bulkRescan();
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

    if (metadataCache.initialized) this.#bulkRescan();

    this.commit(stack.move());
  }

  #applyFile(file: TFile, cache: CachedMetadata | null): void {
    const prev = this.#contribByFile.get(file) ?? EMPTY_CONTRIBUTIONS;
    const next = cache
      ? fileContributions(cache, this.#citationKeyProperty)
      : EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, next);
    if (diff.empty) return;

    this.#applyDiff(file, diff);
    if (hasContributions(next)) {
      this.#contribByFile.set(file, next);
    } else {
      this.#contribByFile.delete(file);
    }
    this.#emitter.emit("changed", file);
  }

  #bulkRescan(): void {
    this.#clear();

    for (const file of this.#app.vault.getMarkdownFiles()) {
      const cache = this.#app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const contributions = fileContributions(cache, this.#citationKeyProperty);
      this.#insertContributions(file, contributions);
    }

    this.#scanned = true;
    logger.debug("Note index rebuilt", { count: this.#contribByFile.size });
    this.#emitter.emit("rebuilt");
  }

  #applyDiff(file: TFile, diff: ContribDiff): void {
    if (diff.itemKey.remove) {
      removeIndexedFile(this.#notesByItemKey, diff.itemKey.remove, file);
    }
    if (diff.itemKey.add) {
      addIndexedFile(this.#notesByItemKey, diff.itemKey.add, file);
    }

    if (diff.citationKey.remove) {
      removeIndexedFile(
        this.#notesByCitationKey,
        diff.citationKey.remove,
        file,
      );
    }
    if (diff.citationKey.add) {
      addIndexedFile(this.#notesByCitationKey, diff.citationKey.add, file);
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
    if (contributions.citationKey) {
      addIndexedFile(this.#notesByCitationKey, contributions.citationKey, file);
    }
    if (contributions.noteKey) {
      addIndexedFile(this.#notesByNoteKey, contributions.noteKey, file);
    }
    this.#contribByFile.set(file, contributions);
  }

  #clear(): void {
    this.#notesByItemKey.clear();
    this.#notesByCitationKey.clear();
    this.#notesByNoteKey.clear();
    this.#contribByFile.clear();
  }

  #applySettings(settings: Readonly<Settings>): void {
    const next = citationKeyProperty(settings);
    if (next === this.#citationKeyProperty) return;
    this.#citationKeyProperty = next;
    if (this.#scanned) {
      this.#bulkRescan();
    } else {
      this.#clearCitationKeyContributions();
    }
  }

  #clearCitationKeyContributions(): void {
    this.#notesByCitationKey.clear();
    for (const [file, contributions] of this.#contribByFile) {
      if (contributions.citationKey === null) continue;
      const next = { ...contributions, citationKey: null };
      if (hasContributions(next)) {
        this.#contribByFile.set(file, next);
      } else {
        this.#contribByFile.delete(file);
      }
    }
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
  return (
    contributions.itemKey !== null ||
    contributions.citationKey !== null ||
    contributions.noteKey !== null
  );
}

function citationKeyProperty(settings: Readonly<Settings>): string | null {
  return settings["citation.key-links"]
    ? settings["citation.key-links-frontmatter-key"]
    : null;
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
