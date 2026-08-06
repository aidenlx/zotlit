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
    const key = renderKey(styleId, items);
    const held = this.#renders.get(key);
    if (held) {
      // Re-insert, so the most recently asked-for render is the last to go.
      this.#renders.delete(key);
      this.#renders.set(key, held);
      return held;
    }

    const pending = this.#run(items, styleId);
    this.#renders.set(key, pending);
    this.#evict();
    const entries = await pending;
    // A failed render is not an answer to hold: the next ask tries again.
    if (entries === null && this.#renders.get(key) === pending) {
      this.#renders.delete(key);
    }
    return entries;
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
    stack.defer(() => this.#renders.clear());

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
      count: this.#renders.size,
    });
    this.#renders.clear();
    this.#emitter.emit("invalidated");
  }

  #evict(): void {
    while (this.#renders.size > HELD_RENDERS) {
      const oldest = this.#renders.keys().next().value;
      if (oldest === undefined) return;
      this.#renders.delete(oldest);
    }
  }

  /** A failed render is a missing one: the consumer falls back to its own text. */
  async #run(
    items: readonly CslItemData[],
    styleId: string | null,
  ): Promise<readonly BibliographyEntry[] | null> {
    try {
      const engine = await this.#engine.getEngine();
      const styleXml = await this.#styles.load(
        this.#zoteroPref.dataDir,
        styleId,
      );
      return await engine.renderBibliography({ items, styleXml });
    } catch (error) {
      logger.warn("Cannot format the bibliography", { error });
      return null;
    }
  }
}

/**
 * The identity of one render: the style that formats it, and the works it
 * covers in the order they are cited. A CSL id is a Zotero item URI or a
 * citation key, so neither part can carry the separator.
 */
function renderKey(
  styleId: string | null,
  items: readonly CslItemData[],
): string {
  return [styleId ?? "", ...items.map((item) => item.id)].join("\n");
}
