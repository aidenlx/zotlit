import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  TFile,
  type App,
  type CachedMetadata,
  type Plugin,
  type Pos,
  type TAbstractFile,
} from "obsidian";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import {
  diffContributions,
  EMPTY_CONTRIBUTIONS,
  fileContributions,
  formatItemKey,
  itemKeyFromFrontmatter,
  type ContribDiff,
  type FileContributions,
} from "./parse";

export { formatItemKey };

const logger = getLogger("note-index");

export interface BlockInfo {
  file: string;
  /** Indexed item key, format `KEY[gGROUPID]`. */
  key: string;
  position: Pos;
}

interface NoteIndexEvents {
  changed: (file: string) => void;
  rebuilt: () => void;
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

export class NoteIndex extends Service<void> {
  readonly #app;
  readonly #emitter = createNanoEvents<NoteIndexEvents>();

  readonly #notesByItemKey = new Map<string, Set<string>>();
  readonly #notesByCitekey = new Map<string, Set<string>>();
  readonly #blocksByItemKey = new Map<string, Set<BlockInfo>>();
  readonly #blocksByFile = new Map<string, BlockInfo[]>();
  readonly #contribByFile = new Map<string, FileContributions>();

  ready: Promise<void>;

  constructor(options: NoteIndexOptions) {
    super();
    this.#app = options.app;
    this.ready = this.#load();
  }

  getNotesByItemKey(indexedKey: string): string[] {
    return [...(this.#notesByItemKey.get(indexedKey) ?? [])];
  }

  getNotesByCitekey(citekey: string): string[] {
    return [...(this.#notesByCitekey.get(citekey) ?? [])];
  }

  getBlocksFor(arg: { file?: string; itemKey?: string }): BlockInfo[] {
    const { file, itemKey } = arg;
    if (!file && !itemKey) {
      throw new TypeError("getBlocksFor: provide file or itemKey");
    }

    if (file && itemKey) {
      const inFile = this.#blocksByFile.get(file);
      const forItem = this.#blocksByItemKey.get(itemKey);
      if (!inFile || !forItem) return [];
      return inFile.filter((info) => forItem.has(info));
    }

    if (file) return [...(this.#blocksByFile.get(file) ?? [])];
    return [...(this.#blocksByItemKey.get(itemKey!) ?? [])];
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

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { metadataCache, vault } = this.#app;

    stack.use(
      registerEvent(
        metadataCache.on("changed", (file, _data, cache) => {
          if (isMarkdownFile(file)) this.#applyFile(file.path, cache);
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("deleted", (file) => {
          this.#applyFile(file.path, null);
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
        vault.on("rename", (file, oldPath) => {
          this.#applyFile(oldPath, null);
          if (isMarkdownFile(file)) {
            this.#applyFile(file.path, metadataCache.getFileCache(file));
          }
        }),
      ),
    );
    stack.use(
      registerEvent(
        vault.on("delete", (file) => {
          if (isMarkdownFile(file)) this.#applyFile(file.path, null);
        }),
      ),
    );

    if (metadataCache.initialized) this.#bulkRescan();

    this.commit(stack.move());
  }

  #applyFile(path: string, cache: CachedMetadata | null): void {
    const prev = this.#contribByFile.get(path) ?? EMPTY_CONTRIBUTIONS;
    const next = cache ? fileContributions(cache) : EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, next);
    if (diff.empty) return;

    this.#applyDiff(path, diff, next);
    if (hasContributions(next)) {
      this.#contribByFile.set(path, next);
    } else {
      this.#contribByFile.delete(path);
    }
    this.#emitter.emit("changed", path);
  }

  #bulkRescan(): void {
    this.#clear();

    for (const file of this.#app.vault.getMarkdownFiles()) {
      const cache = this.#app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const contributions = fileContributions(cache);
      this.#insertContributions(file.path, contributions);
    }

    logger.debug("Note index rebuilt", { count: this.#contribByFile.size });
    this.#emitter.emit("rebuilt");
  }

  #applyDiff(file: string, diff: ContribDiff, next: FileContributions): void {
    if (diff.itemKey.remove) {
      removeIndexedFile(this.#notesByItemKey, diff.itemKey.remove, file);
    }
    if (diff.itemKey.add) {
      addIndexedFile(this.#notesByItemKey, diff.itemKey.add, file);
    }

    if (diff.citekey.remove) {
      removeIndexedFile(this.#notesByCitekey, diff.citekey.remove, file);
    }
    if (diff.citekey.add) {
      addIndexedFile(this.#notesByCitekey, diff.citekey.add, file);
    }

    for (const key of diff.blocks.remove) this.#removeBlockKey(file, key);
    for (const key of diff.blocks.add) {
      this.#addBlockKey(file, key, next.blocks.get(key)!);
    }
  }

  #insertContributions(file: string, contributions: FileContributions): void {
    if (!hasContributions(contributions)) return;

    if (contributions.itemKey) {
      addIndexedFile(this.#notesByItemKey, contributions.itemKey, file);
    }
    if (contributions.citekey) {
      addIndexedFile(this.#notesByCitekey, contributions.citekey, file);
    }
    for (const [key, positions] of contributions.blocks) {
      this.#addBlockKey(file, key, positions);
    }
    this.#contribByFile.set(file, contributions);
  }

  #removeBlockKey(file: string, key: string): void {
    const inFile = this.#blocksByFile.get(file);
    if (!inFile) return;

    const removed: BlockInfo[] = [];
    for (let i = inFile.length - 1; i >= 0; i--) {
      const info = inFile[i]!;
      if (info.key !== key) continue;
      removed.push(info);
      inFile.splice(i, 1);
    }

    if (inFile.length === 0) this.#blocksByFile.delete(file);

    const forItem = this.#blocksByItemKey.get(key);
    if (!forItem) return;
    for (const info of removed) forItem.delete(info);
    if (forItem.size === 0) this.#blocksByItemKey.delete(key);
  }

  #addBlockKey(file: string, key: string, positions: Pos[]): void {
    const inFile = this.#blocksByFile.get(file) ?? [];
    if (inFile.length === 0) this.#blocksByFile.set(file, inFile);

    const forItem = ensureSet(this.#blocksByItemKey, key);
    for (const position of positions) {
      const info = { file, key, position };
      inFile.push(info);
      forItem.add(info);
    }
  }

  #clear(): void {
    this.#notesByItemKey.clear();
    this.#notesByCitekey.clear();
    this.#blocksByItemKey.clear();
    this.#blocksByFile.clear();
    this.#contribByFile.clear();
  }
}

function addIndexedFile(
  index: Map<string, Set<string>>,
  key: string,
  file: string,
): void {
  ensureSet(index, key).add(file);
}

function removeIndexedFile(
  index: Map<string, Set<string>>,
  key: string,
  file: string,
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
    contributions.citekey !== null ||
    contributions.blocks.size > 0
  );
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
