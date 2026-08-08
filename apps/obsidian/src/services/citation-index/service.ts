// The vault-wide Citation Index: literal-citekey occurrences per file, wikilinks derived at query time.

import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import { getCitekeysByLibrary, USER_LIBRARY_ID } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import type { DatabaseService } from "@/services/database/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { groupCitations } from "./query";
import type { Citation, ResolvedNote } from "./query";
import {
  documentOccurrences,
  occurrencesEqual,
  scanCitekeyOccurrences,
} from "./scan";
import type { CitationOccurrence } from "./scan";
import { CitekeySnapshot } from "./snapshot";
import type { ReadCitekeys, SnapshotItem } from "./snapshot";
import { openCitekeyStore } from "./store";
import type { CitekeyRecord, CitekeyStore, FileScan } from "./store";

export {
  citationsEqual,
  type Citation,
  type ResolvedNote,
  type ResolveOccurrence,
} from "./query";
export {
  scanDocumentCitations,
  type CitationOccurrence,
  type CitationSyntax,
} from "./scan";
export type { SnapshotItem } from "./snapshot";
export { type CitekeyRecord, type CitekeyStore, type FileScan } from "./store";

const logger = getLogger("citation-index");

/** Files the backfill scans between two yields to the host. */
const BACKFILL_CHUNK = 20;

interface CitationIndexEvents {
  /** One document's literal-citekey occurrences changed. */
  changed: (path: string) => void;
  /** The vault-wide backfill finished; the index covers every Markdown file. */
  backfilled: () => void;
  /**
   * The citekey resolution snapshot was rebuilt and now answers differently.
   * Vault-wide, unlike `changed`: every surface that resolves a citekey redraws.
   */
  "resolution-changed": () => void;
}

export interface CitationIndexOptions {
  app: App;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on">;
  /**
   * Where scans survive a restart; a store that fails to open costs a full
   * rescan and nothing else.
   *
   * @default openCitekeyStore
   */
  openStore?: (app: App) => Promise<CitekeyStore>;
  /**
   * The bulk read the snapshot rebuilds from.
   *
   * @default getCitekeysByLibrary
   */
  readCitekeys?: ReadCitekeys;
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
 *
 * Scans persist per file, and a record describes its file for as long as the
 * file's mtime and size are the ones the scan ran against. A restart therefore
 * costs only the files that changed while the app was closed.
 */
export class CitationIndex extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #settings;
  readonly #db;
  readonly #openStore;
  readonly #readCitekeys;
  readonly #emitter = createNanoEvents<CitationIndexEvents>();
  /** Scans by path; a path it covers with matching mtime and size needs no read. */
  readonly #scans = new Map<string, FileScan>();
  readonly #snapshot = new CitekeySnapshot();
  /** Callers parked on a one-shot readiness signal; disposal flushes them. */
  readonly #waiters = new Set<() => void>();
  #store?: CitekeyStore;
  /**
   * Which build of the index is current. A reset or a re-enable starts the next
   * one, which is what keeps a backfill still in flight from writing the build
   * it belongs to into a store that has moved on.
   */
  #build = 0;
  #indexing = true;
  #backfilled = false;
  #stopped = false;
  /** Which build of the resolution snapshot is current; a rebuild bumps it. */
  #rebuildSeq = 0;
  #resolved = false;
  #libraryID: number;

  ready: Promise<void>;

  constructor(options: CitationIndexOptions) {
    super();
    this.#app = options.app;
    this.#noteIndex = options.noteIndex;
    this.#settings = options.settings;
    this.#db = options.db;
    this.#openStore = options.openStore ?? openCitekeyStore;
    this.#readCitekeys = options.readCitekeys ?? getCitekeysByLibrary;
    this.#libraryID =
      options.settings.current?.["zotero.citation-library"] ?? USER_LIBRARY_ID;
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
    await this.#waitFor("backfilled", this.#backfilled);
  }

  /** The Zotero Item a native citation key names, read synchronously. */
  resolveCitekey(citekey: string): SnapshotItem | null {
    return this.#snapshot.byCitekey(citekey);
  }

  /** The native citation key of an Item — the wikilink display text. */
  citekeyOf(indexedKey: string): string | null {
    return this.#snapshot.citekeyOf(indexedKey);
  }

  /**
   * Resolves once the snapshot has run its first rebuild — the resolution
   * counterpart of {@link whenIndexed}. Settles even on a failed read.
   */
  async whenResolved(): Promise<void> {
    await this.ready;
    await this.#waitFor("resolution-changed", this.#resolved);
  }

  /**
   * Waits for a one-shot readiness signal, which disposal settles too: the pass
   * that would emit the signal returns early once the service is stopped, so a
   * caller torn down alongside the service would otherwise wait on nothing.
   */
  #waitFor(
    event: "backfilled" | "resolution-changed",
    settled: boolean,
  ): Promise<void> {
    if (settled || this.#stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        off();
        this.#waiters.delete(wake);
        resolve();
      };
      const off = this.once(event, wake);
      this.#waiters.add(wake);
    });
  }

  /**
   * Discards every stored scan and rebuilds from the vault — the recovery hatch
   * for an index that disagrees with the vault, over data the vault can always
   * produce again. Returns once the store is empty; the rebuild runs on from
   * there, and {@link whenIndexed} is what waits for it.
   */
  async reset(): Promise<void> {
    await this.ready;
    this.#build += 1;
    const covered = [...this.#scans.keys()];
    logger.debug("Citation index reset", { covered: covered.length });
    this.#scans.clear();
    this.#backfilled = false;
    await this.#store?.clear();
    for (const path of covered) this.#emitter.emit("changed", path);
    void this.#runBackfill();
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
          if (isMarkdownFile(file)) this.#scan(file, data);
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
    stack.defer(this.#db.on("changed", () => void this.#rebuildSnapshot()));

    // A store that fails to open leaves the index whole and unpersisted, so the
    // failure costs a rescan per launch rather than the feature.
    try {
      this.#store = stack.use(await this.#openStore(this.#app));
      const loaded = await this.#store.load();
      let restored = 0;
      for (const { path, ...scan } of loaded) {
        // An event that already scanned the file during startup is fresher.
        if (!this.#scans.has(path)) {
          this.#scans.set(path, scan);
          restored += 1;
        }
      }
      logger.debug("Citation index store loaded", {
        count: loaded.length,
        restored,
      });
    } catch (error) {
      logger.error("Citation index store unavailable", { error });
    }

    // The vault holds no files before layout-ready, and `onLayoutReady` is a
    // one-shot with no unregister, so the run gates on disposal instead.
    workspace.onLayoutReady(() => void this.#runBackfill());

    void this.#rebuildSnapshot();
    // Registered last so it runs first on disposal (stack is LIFO): the flag
    // must flip before the store and listeners tear down, so a persist or a
    // db-driven rebuild still in flight during the async disposal window
    // no-ops instead of writing to a closed store or emitting mid-disposal.
    stack.defer(() => {
      this.#stopped = true;
      for (const wake of this.#waiters) wake();
    });
    this.commit(stack.move());
  }

  /** Readiness settles even on a failed pass, so no consumer waits forever. */
  async #runBackfill(): Promise<void> {
    const build = this.#build;
    logger.debug("Citation index backfill started", { build });
    try {
      await this.#backfill(build);
    } catch (error) {
      logger.error("Citation index backfill failed", { error });
    }
    if (this.#stopped || build !== this.#build) return;
    logger.debug("Citation index backfilled", { count: this.#scans.size });
    this.#backfilled = true;
    this.#emitter.emit("backfilled");
  }

  /**
   * The vault pass that covers the files neither an event nor the store reached.
   * It streams one body at a time rather than holding the vault in memory, and
   * yields to the host between chunks so a large vault never freezes the app.
   */
  async #backfill(build: number): Promise<void> {
    let scanned = 0;
    const present = new Set<string>();
    for (const file of this.#app.vault.getMarkdownFiles()) {
      if (this.#stale(build)) return;
      present.add(file.path);
      if (this.#covered(file)) continue;
      const body = await this.#app.vault.cachedRead(file);
      // The read yields, so this build may have been superseded meanwhile.
      if (this.#stale(build)) return;
      this.#scan(file, body);
      if ((scanned += 1) % BACKFILL_CHUNK === 0) await yieldToMain();
    }
    // A file deleted while the app was closed fires no event of its own, so the
    // pass is also what prunes the scans the vault no longer has a file for.
    for (const path of this.#scans.keys().toArray()) {
      if (!present.has(path)) this.#drop(path);
    }
  }

  /** Whether a build other than `build` has taken over, or none should run at all. */
  #stale(build: number): boolean {
    return this.#stopped || !this.#indexing || build !== this.#build;
  }

  /**
   * Rebuilds the resolution snapshot from one bulk database read. Sequenced by
   * {@link #rebuildSeq}, so a rebuild superseded mid-flight by a newer one
   * settles without touching the maps. A degraded database, or a read that
   * throws, leaves the maps as they were rather than clearing them.
   */
  async #rebuildSnapshot(): Promise<void> {
    this.#rebuildSeq += 1;
    const seq = this.#rebuildSeq;
    await this.#db.ready;
    if (this.#stopped || seq !== this.#rebuildSeq) return;

    let changed = false;
    if (this.#db.state !== "ready") {
      logger.debug("Resolution snapshot rebuild skipped, database not ready", {
        libraryID: this.#libraryID,
      });
    } else {
      try {
        const rows = this.#readCitekeys(this.#db.client, this.#libraryID);
        changed = this.#snapshot.replace(rows);
        logger.debug("Resolution snapshot rebuilt", {
          libraryID: this.#libraryID,
          count: rows.length,
          changed,
        });
      } catch (error) {
        logger.warn("Resolution snapshot rebuild failed", { error });
      }
    }

    const firstSettle = !this.#resolved;
    this.#resolved = true;
    if (changed || firstSettle) this.#emitter.emit("resolution-changed");
  }

  /** Idempotent: a content-identical touch stores the same list and wakes nobody. */
  #scan(file: TFile, body: string): CitationOccurrence[] {
    if (!this.#indexing) return [];
    const occurrences = scanCitekeyOccurrences(body);
    const prev = this.#scans.get(file.path);
    const { mtime, size } = file.stat;
    this.#scans.set(file.path, { mtime, size, occurrences });
    this.#persist({ path: file.path, mtime, size, occurrences });
    const quiet = prev
      ? occurrencesEqual(prev.occurrences, occurrences)
      : occurrences.length === 0;
    if (!quiet) {
      logger.trace("Citation scan changed", {
        path: file.path,
        count: occurrences.length,
      });
      this.#emitter.emit("changed", file.path);
    }
    return occurrences;
  }

  /**
   * @returns the scan that still describes `file`, or `null` when the file's
   *   mtime or size has moved past the one it ran against.
   */
  #covered(file: TFile): CitationOccurrence[] | null {
    const scan = this.#scans.get(file.path);
    if (!scan) return null;
    const { mtime, size } = file.stat;
    return scan.mtime === mtime && scan.size === size ? scan.occurrences : null;
  }

  async #coverFile(file: TFile): Promise<CitationOccurrence[]> {
    if (!this.#indexing) return [];
    const known = this.#covered(file);
    if (known) return known;
    const body = await this.#app.vault.cachedRead(file);
    // The read yields, so an event may have covered the file meanwhile.
    return this.#covered(file) ?? this.#scan(file, body);
  }

  #drop(path: string): void {
    const scan = this.#scans.get(path);
    if (!scan) return;
    this.#scans.delete(path);
    this.#forget(path);
    if (scan.occurrences.length > 0) this.#emitter.emit("changed", path);
  }

  #move(oldPath: string, path: string): void {
    const scan = this.#scans.get(oldPath);
    if (!scan) return;
    this.#scans.delete(oldPath);
    this.#scans.set(path, scan);
    this.#forget(oldPath);
    this.#persist({ path, ...scan });
  }

  /**
   * Writes are per file and never awaited: the store is derived data, so a
   * failed write costs one rescan on the next launch. Every caller runs on the
   * current build, which is what keeps a superseded one out of the store.
   */
  #persist(record: CitekeyRecord): void {
    if (this.#stopped) return;
    void this.#store?.put(record).catch((error: unknown) => {
      logger.error("Failed to persist a citation scan", {
        path: record.path,
        error,
      });
    });
  }

  #forget(path: string): void {
    if (this.#stopped) return;
    void this.#store?.drop(path).catch((error: unknown) => {
      logger.error("Failed to drop a citation scan", { path, error });
    });
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
    const item = this.#snapshot.byCitekey(occurrence.raw);
    if (!item) return null;
    const [note] = this.#noteIndex.getNotesByItemKey(item.indexedKey);
    return { indexedKey: item.indexedKey, linkpath: note?.path ?? null };
  }

  /**
   * Citekey Indexing is the master switch: turning it off drops every scan the
   * index holds in memory, while the store keeps its records for the next
   * launch to start from. Turning it back on within the same session starts the
   * next build, which reads the vault again.
   */
  #applySettings(settings: Readonly<Settings>): void {
    const nextLibraryID = settings["zotero.citation-library"];
    if (nextLibraryID !== this.#libraryID) {
      logger.info("Citation library changed", {
        prev: this.#libraryID,
        next: nextLibraryID,
      });
      this.#libraryID = nextLibraryID;
      void this.#rebuildSnapshot();
    }

    const next = settings["citation.citekey-indexing"];
    if (next === this.#indexing) return;
    this.#indexing = next;
    logger.info("Citation indexing changed", { enabled: next });
    const covered = [...this.#scans.keys()];
    if (!next) this.#scans.clear();
    for (const path of covered) this.#emitter.emit("changed", path);
    if (next) {
      this.#build += 1;
      this.#backfilled = false;
      void this.#runBackfill();
    }
  }
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
