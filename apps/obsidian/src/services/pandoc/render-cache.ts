// The plugin-wide cache of whole-bibliography renders every consumer of rendered citation text reads.

import type { CslItemData } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { BoundedCache } from "@/lib/bounded-cache";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { BibliographyEntry } from "./engine";
import type { PandocEngineService } from "./service";
import { StyleXmlCache, styleHasEntryMarkers } from "./styles";

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
  /** The first formatting attempt whose selected style is unavailable. */
  "style-missing": (styleId: string) => void;
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

/** A completed bibliography and whether its style supplies Entry Markers. */
export interface BibliographyRenderResult {
  entries: readonly BibliographyEntry[];
  hasEntryMarkers: boolean;
}

/** What the References Sidebar needs to replace or preserve its current list. */
export type BibliographyRenderOutcome =
  | ({ kind: "rendered" } & BibliographyRenderResult)
  | { kind: "unavailable"; reason: "engine-absent" | "style-missing" }
  | { kind: "failed" };

type RenderAttempt<T> =
  | { kind: "rendered"; value: T }
  | { kind: "style-missing" }
  | { kind: "failed" };

/**
 * Formats whole bibliographies in the Citation and References Style, and hands the same
 * render to every consumer that cites the same works in the same order.
 *
 * A bibliography entry is not a pure function of its Item — Entry Markers and
 * disambiguation depend on the whole cited set — so the whole list is the unit
 * that is cached, keyed by Citation and References Style and the ordered cited set. What
 * makes a render stale makes every render stale: a Zotero database change, a
 * Citation and References Style change, and an engine that came or went each drop the cache
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
  /** Bibliography renders by {@link renderKey}. */
  readonly #renders = new BoundedCache<
    Promise<RenderAttempt<BibliographyRenderResult>>
  >(HELD_RENDERS);
  /** In-text citation renders, held the same way and dropped by the same signals. */
  readonly #citations = new BoundedCache<
    Promise<RenderAttempt<readonly DocumentFragment[]>>
  >(HELD_RENDERS);
  /** `undefined` until the first settings snapshot names the selected style. */
  #styleId: string | null | undefined;
  /** The first unavailable selected style found in this plugin lifecycle. */
  #missingStyle: string | null = null;

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
   * The whole bibliography of `items`, formatted in the Citation and References Style.
   *
   * Entries come back in the style's own bibliography order, and the entry
   * content is shared with every other consumer of the same render — a consumer
   * clones it rather than inserting it, which is what the DOM-content helper
   * already does.
   *
   * @param items the cited works as CSL-JSON, in the order they are cited.
   * @returns the formatted bibliography, or the unavailable or failed state
   *   that tells the sidebar to show its plain list.
   */
  async render(
    items: readonly CslItemData[],
  ): Promise<BibliographyRenderOutcome> {
    await this.ready.catch(() => undefined);
    if (this.#engine.getStatus().kind !== "installed") {
      return { kind: "unavailable", reason: "engine-absent" };
    }
    if (items.length === 0) {
      return { kind: "rendered", entries: [], hasEntryMarkers: false };
    }

    const styleId = this.#styleId ?? null;
    const attempt = await this.#hold({
      held: this.#renders,
      key: renderKey(styleId, items),
      format: () => this.#runBibliography(items, styleId),
      kind: "bibliography",
    });
    switch (attempt.kind) {
      case "rendered":
        return { kind: "rendered", ...attempt.value };
      case "style-missing":
        return { kind: "unavailable", reason: "style-missing" };
      case "failed":
        return { kind: "failed" };
    }
  }

  /**
   * One document's in-text citations, formatted in the Citation and References Style.
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
   *   the engine or selected style is unavailable, or the render failed.
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
    const attempt = await this.#hold({
      held: this.#citations,
      key,
      format: () => this.#runCitations(citations, items, styleId),
      kind: "citations",
    });
    return attempt.kind === "rendered" ? attempt.value : null;
  }

  on<K extends keyof BibliographyRenderEvents>(
    event: K,
    cb: BibliographyRenderEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /** Subscribe to the first unavailable selected style, including one already found. */
  onStyleMissing(cb: BibliographyRenderEvents["style-missing"]): () => void {
    const unsubscribe = this.#emitter.on("style-missing", cb);
    if (this.#missingStyle !== null) cb(this.#missingStyle);
    return unsubscribe;
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
    logger.info(
      initial
        ? "Citation and references style selected"
        : "Citation and references style changed",
      { styleId: next },
    );
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

  /** Answer `key` from `held`, running `format` when nothing holds it yet. */
  async #hold<T>({
    held,
    key,
    format,
    kind,
  }: {
    held: BoundedCache<Promise<RenderAttempt<T>>>;
    key: string;
    format: () => Promise<RenderAttempt<T>>;
    kind: "bibliography" | "citations";
  }): Promise<RenderAttempt<T>> {
    if (held.peek(key) !== undefined) {
      logger.trace("Render cache hit", { kind });
    }
    const running = held.hold(key, format);
    const attempt = await running;
    // An unavailable or failed render is not an answer to hold: the next ask
    // tries again after the user changes the prerequisite or fixes the failure.
    if (attempt.kind !== "rendered" && held.peek(key) === running) {
      held.delete(key);
    }
    return attempt;
  }

  async #runBibliography(
    items: readonly CslItemData[],
    styleId: string | null,
  ): Promise<RenderAttempt<BibliographyRenderResult>> {
    try {
      const styleXml = await this.#resolveStyle(styleId);
      if (styleXml.kind === "missing") return { kind: "style-missing" };
      const xml = styleXml.kind === "installed" ? styleXml.xml : undefined;
      const engine = await this.#engine.getEngine();
      const entries = await engine.renderBibliography({ items, styleXml: xml });
      const hasEntryMarkers =
        styleHasEntryMarkers(xml) ||
        entries.some((entry) => entry.marker !== undefined);
      logger.debug("Bibliography rendered", {
        count: entries.length,
        hasEntryMarkers,
      });
      return {
        kind: "rendered",
        value: { entries, hasEntryMarkers },
      };
    } catch (error) {
      logger.warn("Cannot format the bibliography", { error });
      return { kind: "failed" };
    }
  }

  async #runCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    styleId: string | null,
  ): Promise<RenderAttempt<readonly DocumentFragment[]>> {
    try {
      const styleXml = await this.#resolveStyle(styleId);
      if (styleXml.kind === "missing") return { kind: "style-missing" };
      const engine = await this.#engine.getEngine();
      const rendered = await engine.renderCitations({
        citations,
        items,
        styleXml: styleXml.kind === "installed" ? styleXml.xml : undefined,
      });
      logger.debug("Citations rendered", { count: rendered.length });
      return { kind: "rendered", value: rendered };
    } catch (error) {
      logger.warn("Cannot format the citations", { error });
      return { kind: "failed" };
    }
  }

  async #resolveStyle(styleId: string | null) {
    const style = await this.#styles.resolve(this.#zoteroPref.dataDir, styleId);
    if (style.kind === "missing" && this.#missingStyle === null) {
      this.#missingStyle = style.styleId;
      logger.debug("Selected citation style is unavailable", {
        styleId: style.styleId,
      });
      this.#emitter.emit("style-missing", style.styleId);
    }
    return style;
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
