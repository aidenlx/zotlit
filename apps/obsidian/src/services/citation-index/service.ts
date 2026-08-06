// The vault-wide Citation Index: literal-citekey occurrences per file, wikilinks derived at query time.

import { TFile, type App, type TAbstractFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import {
  itemKeyFromFrontmatter,
  resolveIndexedKey,
  type NoteIndex,
} from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import { groupCitations, type Citation, type ResolvedNote } from "./query";
import {
  documentOccurrences,
  occurrencesEqual,
  scanCitekeyOccurrences,
  type CitationOccurrence,
} from "./scan";

export {
  citationsEqual,
  type Citation,
  type ResolvedNote,
  type ResolveOccurrence,
} from "./query";
export { type CitationOccurrence, type CitationSyntax } from "./scan";

const logger = getLogger("citation-index");

/** Files the backfill scans between two yields to the host. */
const BACKFILL_CHUNK = 20;

interface CitationIndexEvents {
  /** One document's literal-citekey occurrences changed. */
  changed: (path: string) => void;
  /** The vault-wide backfill finished; the index covers every Markdown file. */
  backfilled: () => void;
}

export interface CitationIndexOptions {
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByCitationKey">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
}

/**
 * Answers which Citations a document contains, for both syntaxes.
 *
 * Literal-citekey occurrences are scanned from file bodies and held per path;
 * wikilink occurrences derive from Obsidian's metadata cache at query time, and
 * resolution to Zotero Items is lazy — a cross-file change therefore never
 * dirties a file's record. The incremental path scans the body the metadata
 * cache hands to its `changed` event, so it reads no file of its own; only the
 * backfill and an on-demand query do.
 */
export class CitationIndex extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #settings;
  readonly #emitter = createNanoEvents<CitationIndexEvents>();
  /** Literal-citekey occurrences by path; a path it holds is one the index covers. */
  readonly #citekeys = new Map<string, CitationOccurrence[]>();
  #indexing = true;
  #backfilled = false;
  #stopped = false;

  ready: Promise<void>;

  constructor(options: CitationIndexOptions) {
    super();
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  /**
   * The Citations of one document, in first-occurrence order with their
   * Reference Numbers. A document the backfill has not reached is scanned on
   * demand, so the active document is answered without waiting for the vault.
   *
   * @param wikilinks whether Literature Note wikilinks count as Citations — the
   *   Wikilink Citations setting, which each consumer applies for itself.
   *   Leaving it out answers with everything the index knows.
   */
  async getCitations(
    file: TFile,
    { wikilinks = true }: { wikilinks?: boolean } = {},
  ): Promise<Citation[]> {
    const citekeys = await this.#coverFile(file);
    const links = wikilinks
      ? (this.#app.metadataCache.getFileCache(file)?.links ?? [])
      : [];
    return groupCitations(documentOccurrences(citekeys, links), (occurrence) =>
      this.#resolve(occurrence, file.path),
    );
  }

  on<K extends keyof CitationIndexEvents>(
    event: K,
    cb: CitationIndexEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  once<K extends keyof CitationIndexEvents>(
    event: K,
    cb: CitationIndexEvents[K],
  ): () => void {
    return this.#emitter.once(event, cb);
  }

  /**
   * Resolves once the index covers every Markdown file. Stronger than
   * {@link ready}, which only marks listener registration: the backfill starts
   * at layout-ready and runs in chunks well past it. A vault-wide consumer
   * awaits this; an active-document consumer queries straight away.
   */
  async whenIndexed(): Promise<void> {
    await this.ready;
    if (this.#backfilled) return;
    await new Promise<void>((resolve) =>
      this.once("backfilled", () => resolve()),
    );
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;
    const initial = this.#settings.current;
    if (initial) this.#indexing = initial["citation.citekey-indexing"];
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );

    const { metadataCache, vault, workspace } = this.#app;
    stack.use(
      registerEvent(
        metadataCache.on("changed", (file, data) => {
          if (isMarkdownFile(file)) this.#scan(file.path, data);
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("deleted", (file) => {
          this.#drop(file.path);
        }),
      ),
    );
    // A rename fires no re-parse of its own, so the record moves with the file.
    stack.use(
      registerEvent(
        vault.on("rename", (file, oldPath) => {
          this.#move(oldPath, file.path);
        }),
      ),
    );
    stack.defer(() => {
      this.#stopped = true;
    });

    // The vault holds no files before layout-ready, and `onLayoutReady` is a
    // one-shot with no unregister, so the run gates on disposal instead.
    workspace.onLayoutReady(() => void this.#runBackfill());

    this.commit(stack.move());
  }

  /** Readiness settles even on a failed pass, so no consumer waits forever. */
  async #runBackfill(): Promise<void> {
    try {
      await this.#backfill();
    } catch (error) {
      logger.error("Citation index backfill failed", { error });
    }
    if (this.#stopped) return;
    logger.debug("Citation index backfilled", { count: this.#citekeys.size });
    this.#backfilled = true;
    this.#emitter.emit("backfilled");
  }

  /**
   * The vault pass that covers the files no event reached. It streams one body
   * at a time rather than holding the vault in memory, and yields to the host
   * between chunks so a large vault never freezes the app.
   */
  async #backfill(): Promise<void> {
    let scanned = 0;
    for (const file of this.#app.vault.getMarkdownFiles()) {
      if (this.#stopped || !this.#indexing) return;
      if (this.#citekeys.has(file.path)) continue;
      this.#scan(file.path, await this.#app.vault.cachedRead(file));
      if ((scanned += 1) % BACKFILL_CHUNK === 0) await yieldToMain();
    }
  }

  /** Idempotent: a content-identical touch stores the same list and wakes nobody. */
  #scan(path: string, body: string): CitationOccurrence[] {
    if (!this.#indexing) return [];
    const occurrences = scanCitekeyOccurrences(body);
    const prev = this.#citekeys.get(path);
    this.#citekeys.set(path, occurrences);
    const quiet = prev
      ? occurrencesEqual(prev, occurrences)
      : occurrences.length === 0;
    if (!quiet) this.#emitter.emit("changed", path);
    return occurrences;
  }

  async #coverFile(file: TFile): Promise<CitationOccurrence[]> {
    if (!this.#indexing) return [];
    const known = this.#citekeys.get(file.path);
    if (known) return known;
    const body = await this.#app.vault.cachedRead(file);
    // The read yields, so an event may have covered the file meanwhile.
    return this.#citekeys.get(file.path) ?? this.#scan(file.path, body);
  }

  #drop(path: string): void {
    const occurrences = this.#citekeys.get(path);
    if (!occurrences) return;
    this.#citekeys.delete(path);
    if (occurrences.length > 0) this.#emitter.emit("changed", path);
  }

  #move(oldPath: string, path: string): void {
    const occurrences = this.#citekeys.get(oldPath);
    if (!occurrences) return;
    this.#citekeys.delete(oldPath);
    this.#citekeys.set(path, occurrences);
  }

  #resolve(
    occurrence: CitationOccurrence,
    sourcePath: string,
  ): ResolvedNote | null {
    if (occurrence.kind === "wikilink") {
      const indexedKey = resolveIndexedKey(
        occurrence.raw,
        sourcePath,
        this.#app,
      );
      return indexedKey ? { indexedKey, linkpath: occurrence.raw } : null;
    }
    const [note] = this.#noteIndex.getNotesByCitationKey(occurrence.raw);
    if (!note) return null;
    const indexedKey = itemKeyFromFrontmatter(
      this.#app.metadataCache.getFileCache(note),
    );
    return indexedKey ? { indexedKey, linkpath: note.path } : null;
  }

  /** Citekey Indexing is the master switch: turning it off drops every scan result. */
  #applySettings(settings: Readonly<Settings>): void {
    const next = settings["citation.citekey-indexing"];
    if (next === this.#indexing) return;
    this.#indexing = next;
    const covered = [...this.#citekeys.keys()];
    this.#citekeys.clear();
    for (const path of covered) this.#emitter.emit("changed", path);
    if (next) {
      this.#backfilled = false;
      void this.#runBackfill();
    }
  }
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
