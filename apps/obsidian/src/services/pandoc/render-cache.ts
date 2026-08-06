// The plugin-wide cache of whole-bibliography renders every consumer of rendered citation text reads.

import { type CslItemData } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { type DatabaseService } from "@/services/database/service";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { type BibliographyEntry } from "./engine";
import { type PandocEngineService } from "./service";
import { StyleXmlCache } from "./styles";

const logger = getLogger(["pandoc", "render-cache"]);

/**
 * Renders held at once. A cited set the user moved away from is worth keeping
 * for the move back, and each render is a handful of formatted entries, so the
 * bound is generous; it exists so a session that visits many documents cannot
 * grow the cache without end.
 */
const HELD_RENDERS = 32;

interface BibliographyRenderEvents {
  /**
   * Every held render went stale. A consumer that keeps rendered text on screen
   * asks for its own render again.
   */
  invalidated: () => void;
}

export interface BibliographyRenderCacheOptions {
  db: Pick<DatabaseService, "on">;
  pandocEngine: Pick<
    PandocEngineService,
    "getStatus" | "subscribe" | "getEngine"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "on">;
  settings: Pick<SettingsService, "ready" | "subscribe">;
}

/**
 * Formats whole bibliographies in the References Style, and hands the same
 * render to every consumer that cites the same works in the same order.
 *
 * A bibliography entry is not a pure function of its Item — Entry Markers and
 * disambiguation depend on the whole cited set — so the whole list is the unit
 * that is cached, keyed by References Style and the ordered cited set. What
 * makes a render stale makes every render stale: a Zotero database change, a
 * References Style change, and an engine that came or went each drop the cache
 * whole and announce it through {@link BibliographyRenderEvents.invalidated}.
 *
 * Nothing is written to disk: a render is derived from the library and the
 * style, both of which the plugin can read again.
 */
export class BibliographyRenderCache extends Service<void> {
  readonly #db;
  readonly #engine;
  readonly #zoteroPref;
  readonly #settings;
  readonly #emitter = createNanoEvents<BibliographyRenderEvents>();
  readonly #styles = new StyleXmlCache();
  /** Renders by key, oldest first, so the eviction takes the least recent. */
  readonly #renders = new Map<
    string,
    Promise<readonly BibliographyEntry[] | null>
  >();
  /** In-text citation renders, held the same way and dropped by the same signals. */
  readonly #citations = new Map<
    string,
    Promise<readonly DocumentFragment[] | null>
  >();
  /** `undefined` until the first settings snapshot names the selected style. */
  #styleId: string | null | undefined;

  ready: Promise<void>;

  constructor(options: BibliographyRenderCacheOptions) {
    super();
    this.#db = options.db;
    this.#engine = options.pandocEngine;
    this.#zoteroPref = options.zoteroPref;
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  /**
   * The whole bibliography of `items`, formatted in the References Style.
   *
   * Entries come back in the style's own bibliography order, and the entry
   * content is shared with every other consumer of the same render — a consumer
   * clones it rather than inserting it, which is what the DOM-content helper
   * already does.
   *
   * @param items the cited works as CSL-JSON, in the order they are cited.
   * @returns `null` when no engine is installed, or when the render failed; an
   *   empty list when nothing is cited.
   */
  async render(
    items: readonly CslItemData[],
  ): Promise<readonly BibliographyEntry[] | null> {
    await this.ready.catch(() => undefined);
    if (this.#engine.getStatus().kind !== "installed") return null;
    if (items.length === 0) return [];

    const styleId = this.#styleId ?? null;
    return this.#hold(this.#renders, renderKey(styleId, items), () =>
      this.#runBibliography(items, styleId),
    );
  }

  /**
   * One document's in-text citations, formatted in the References Style.
   *
   * A style that numbers counts citations across the whole document, so the
   * unit rendered — and the unit cached — is every citation the document
   * writes, in document order. The formatted content is shared with every other
   * consumer of the same render, so a consumer inserts a clone of it.
   *
   * @param citations each citation as the source writes it, in document order.
   * @param items the works those citekeys resolve to, each `id` the citekey the
   *   source writes.
   * @returns one formatted citation per source, in the same order; `null` when
   *   no engine is installed or the render failed.
   */
  async renderCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
  ): Promise<readonly DocumentFragment[] | null> {
    await this.ready.catch(() => undefined);
    if (this.#engine.getStatus().kind !== "installed") return null;
    if (citations.length === 0) return [];

    const styleId = this.#styleId ?? null;
    const key = renderKey(styleId, items, citations);
    return this.#hold(this.#citations, key, () =>
      this.#runCitations(citations, items, styleId),
    );
  }

  on<K extends keyof BibliographyRenderEvents>(
    event: K,
    cb: BibliographyRenderEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    stack.defer(this.#db.on("changed", () => this.#invalidate()));
    stack.defer(this.#engine.subscribe(() => this.#invalidate()));
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () => this.#invalidate()),
    );
    // Fires synchronously with the loaded settings, which is where the selected
    // style is first read; only a later one is a change.
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    stack.defer(() => {
      this.#renders.clear();
      this.#citations.clear();
    });

    this.commit(stack.move());
  }

  #applySettings(settings: Readonly<Settings>): void {
    const next = settings["citation.references-style"];
    if (next === this.#styleId) return;
    const initial = this.#styleId === undefined;
    this.#styleId = next;
    if (!initial) this.#invalidate();
  }

  /**
   * A render in flight keeps running, and its awaiters get what it produces —
   * the consumer that asked is also the one the event tells to ask again.
   */
  #invalidate(): void {
    logger.debug("Dropped the bibliography renders", {
      count: this.#renders.size + this.#citations.size,
    });
    this.#renders.clear();
    this.#citations.clear();
    this.#emitter.emit("invalidated");
  }

  /**
   * Answer `key` from `held`, running `format` when nothing holds it yet.
   *
   * @param held renders of one kind, oldest first, so the eviction takes the
   *   least recent.
   */
  async #hold<T>(
    held: Map<string, Promise<T | null>>,
    key: string,
    format: () => Promise<T | null>,
  ): Promise<T | null> {
    const pending = held.get(key);
    if (pending) {
      // Re-insert, so the most recently asked-for render is the last to go.
      held.delete(key);
      held.set(key, pending);
      return pending;
    }

    const running = format();
    held.set(key, running);
    while (held.size > HELD_RENDERS) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
    const rendered = await running;
    // A failed render is not an answer to hold: the next ask tries again.
    if (rendered === null && held.get(key) === running) held.delete(key);
    return rendered;
  }

  /** A failed render is a missing one: the consumer falls back to its own text. */
  async #runBibliography(
    items: readonly CslItemData[],
    styleId: string | null,
  ): Promise<readonly BibliographyEntry[] | null> {
    try {
      const engine = await this.#engine.getEngine();
      return await engine.renderBibliography({
        items,
        styleXml: await this.#styleXml(styleId),
      });
    } catch (error) {
      logger.warn("Cannot format the bibliography", { error });
      return null;
    }
  }

  async #runCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    styleId: string | null,
  ): Promise<readonly DocumentFragment[] | null> {
    try {
      const engine = await this.#engine.getEngine();
      return await engine.renderCitations({
        citations,
        items,
        styleXml: await this.#styleXml(styleId),
      });
    } catch (error) {
      logger.warn("Cannot format the citations", { error });
      return null;
    }
  }

  #styleXml(styleId: string | null): Promise<string | undefined> {
    return this.#styles.load(this.#zoteroPref.dataDir, styleId);
  }
}

/**
 * The identity of one render: the style that formats it, the works it covers in
 * the order they are cited, and — for an in-text render — the citations it
 * formats. A CSL id is a Zotero item URI or a citation key, so neither can
 * carry the separator, and the empty line between the two lists keeps them
 * apart.
 */
function renderKey(
  styleId: string | null,
  items: readonly CslItemData[],
  citations: readonly string[] = [],
): string {
  return [
    styleId ?? "",
    ...items.map((item) => item.id),
    ...(citations.length > 0 ? ["", ...citations] : []),
  ].join("\n");
}
