// Tracks the active document's Literature Note Citations in a vanilla store.

import { type App } from "obsidian";
import { createStore, type StoreApi } from "zustand/vanilla";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { resolveIndexedKey } from "@/services/note-index/service";
import { Service } from "@/services/service-base";

import { citationsEqual, scanCitations, type Citation } from "./scan";

export {
  citationsEqual,
  scanCitations,
  type Citation,
  type CitationOccurrence,
  type ResolveIndexedKey,
} from "./scan";

const logger = getLogger("citation-scan");

/** Literature Note Citations of the active document, in document order. */
export interface CitationScanState {
  citations: Citation[];
}

export type CitationScanStore = StoreApi<CitationScanState>;

export interface CitationScannerOptions {
  app: App;
}

/**
 * Keeps {@link store} holding the Literature Note Citations of whichever
 * document is active. Rescans on active-leaf change and on any metadata change,
 * since a linked note gaining or losing `zotero-key` also moves it in or out of
 * the citation list. A rescan that produces the same list leaves the store —
 * and therefore its subscribers — untouched.
 */
export class CitationScanner extends Service<void> {
  readonly #app;
  readonly store: CitationScanStore = createStore<CitationScanState>(() => ({
    citations: [],
  }));

  ready: Promise<void>;

  constructor(options: CitationScannerOptions) {
    super();
    this.#app = options.app;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { workspace, metadataCache } = this.#app;

    stack.use(
      registerEvent(
        workspace.on("active-leaf-change", () => {
          this.#rescan();
        }),
      ),
    );
    stack.use(
      registerEvent(
        metadataCache.on("changed", () => {
          this.#rescan();
        }),
      ),
    );
    // Link caches read before the initial vault scan finishes are incomplete,
    // so the first useful scan may only be possible on "resolved".
    stack.use(
      registerEvent(
        metadataCache.on("resolved", () => {
          this.#rescan();
        }),
      ),
    );

    if (metadataCache.initialized) this.#rescan();

    this.commit(stack.move());
  }

  #rescan(): void {
    const citations = this.#scanActiveFile();
    if (citationsEqual(this.store.getState().citations, citations)) return;
    this.store.setState({ citations });
    logger.debug("Citations rescanned", { count: citations.length });
  }

  #scanActiveFile(): Citation[] {
    const { workspace, metadataCache } = this.#app;
    const file = workspace.getActiveFile();
    if (!file) return [];
    const links = metadataCache.getFileCache(file)?.links;
    if (!links) return [];

    return scanCitations(links, (linkpath) =>
      resolveIndexedKey(linkpath, file.path, this.#app),
    );
  }
}
