import type { App, TFile } from "obsidian";

import { isIndexedKey } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import { Service } from "@/services/service-base";

export type UseKind = "opened" | "read" | "cited";

export interface Use {
  readonly instant: Temporal.Instant;
  readonly kind: UseKind;
}

interface UseLedgerEvents {
  changed: () => void;
}

interface UseLedgerDeps {
  app: App;
  now?: () => Temporal.Instant;
}

const STORAGE_KEY = "zotlit-use-ledger";
const CAPACITY = 300;

/** The last Use of each Item on this device, persisted per vault. */
export class UseLedger extends Service {
  readonly #app;
  readonly #now;
  readonly #emitter = createNanoEvents<UseLedgerEvents>();
  readonly #excludedOpens = new Map<TFile, number>();
  #current: Readonly<Record<string, Use>> = {};
  ready: Promise<void>;

  constructor({ app, now = () => Temporal.Now.instant() }: UseLedgerDeps) {
    super();
    this.#app = app;
    this.#now = now;
    this.ready = this.#load();
  }

  get current(): Readonly<Record<string, Use>> {
    return this.#current;
  }

  get(itemKey: string): Use | undefined {
    return this.#current[itemKey];
  }

  /** A snapshot for the query worker and the empty Item search. */
  get uses(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      Object.entries(this.#current).map(([key, use]) => [
        key,
        use.instant.epochMilliseconds,
      ]),
    );
  }

  on<K extends keyof UseLedgerEvents>(
    event: K,
    callback: UseLedgerEvents[K],
  ): () => void {
    return this.#emitter.on(event, callback);
  }

  /** Keeps the newest Use and returns this action for live read write-back. */
  record(itemKey: string, kind: UseKind, instant = this.#now()): Use {
    const use = Object.freeze({ instant, kind });
    if (this.disposing || !isIndexedKey(itemKey)) return use;
    const previous = this.get(itemKey);
    if (previous && Temporal.Instant.compare(previous.instant, instant) > 0)
      return use;
    this.#current = newest({ ...this.#current, [itemKey]: use });
    this.#app.saveLocalStorage(
      STORAGE_KEY,
      Object.fromEntries(
        Object.entries(this.#current).map(([key, entry]) => [
          key,
          { instant: entry.instant.toString(), kind: entry.kind },
        ]),
      ),
    );
    this.#emitter.emit("changed");
    return use;
  }

  /** Keep a Companion update's own navigation outside the Use timeline. */
  async withoutNoteUse<T>(file: TFile, open: () => Promise<T>): Promise<T> {
    const flush = () => this.#app.workspace.requestActiveLeafEvents.run();
    // Deliver a preceding user gesture before entering the operation's scope.
    flush();
    this.#excludedOpens.set(file, (this.#excludedOpens.get(file) ?? 0) + 1);
    try {
      return await open();
    } finally {
      try {
        // Obsidian defers file-open. Deliver this open before releasing it.
        flush();
      } finally {
        const remaining = this.#excludedOpens.get(file)! - 1;
        if (remaining) this.#excludedOpens.set(file, remaining);
        else this.#excludedOpens.delete(file);
      }
    }
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const raw: unknown = this.#app.loadLocalStorage(STORAGE_KEY);
    const loaded: Record<string, Use> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (!isIndexedKey(key) || !value || typeof value !== "object") continue;
        if (
          !("instant" in value) ||
          typeof value.instant !== "string" ||
          !("kind" in value)
        )
          continue;
        const { kind } = value;
        if (kind !== "opened" && kind !== "read" && kind !== "cited") continue;
        try {
          loaded[key] = Object.freeze({
            instant: Temporal.Instant.from(value.instant),
            kind,
          });
        } catch {
          /* An unreadable entry carries no Use. */
        }
      }
    }
    this.#current = newest(loaded);
    const { workspace, metadataCache } = this.#app;
    let enabled = false;
    let pending: { file: TFile; instant: Temporal.Instant } | null = null;
    workspace.onLayoutReady(() => {
      if (this.disposing) return;
      enabled = true;
    });
    stack.use(
      registerEvent(
        workspace.on("file-open", (file) => {
          if (!enabled || this.disposing) return;
          pending = null;
          if (!file || file.extension !== "md" || this.#excludedOpens.has(file))
            return;
          const instant = this.#now();
          const cache = metadataCache.getFileCache(file);
          const key = itemKeyFromFrontmatter(cache);
          if (key) this.record(key, "opened", instant);
          else if (!cache) pending = { file, instant };
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("changed", (file, _text, cache) => {
          if (
            !pending ||
            pending.file !== file ||
            workspace.getActiveFile() !== file
          )
            return;
          const { instant } = pending;
          pending = null;
          const key = itemKeyFromFrontmatter(cache);
          if (key) this.record(key, "opened", instant);
        }),
      ),
    );
    this.commit(stack.move());
  }
}

function newest(
  entries: Readonly<Record<string, Use>>,
): Readonly<Record<string, Use>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries)
        .sort(([, a], [, b]) => Temporal.Instant.compare(b.instant, a.instant))
        .slice(0, CAPACITY),
    ),
  );
}
