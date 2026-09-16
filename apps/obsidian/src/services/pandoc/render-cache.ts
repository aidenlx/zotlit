import { createHash } from "node:crypto";
// The plugin-wide cache of whole-bibliography renders every consumer of rendered citation text reads.

import type { CslItemData } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import type { ProfileService } from "@/services/profile/service";
import type { Held, QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  effectivePresentation,
  vaultPresentation,
} from "./document-presentation";
import type { EffectivePresentation } from "./document-presentation";
import type { BibliographyEntry, RenderedCitation } from "./engine";
import type { PandocEngineService } from "./service";
import { InstalledStyleCache, styleHasEntryMarkers } from "./styles";
import type { CslStyleRequest, ResolvedCslStyle } from "./styles";

const logger = getLogger(["pandoc", "render-cache"]);

/**
 * The key prefixes renders are held under; {@link renderKey} completes them.
 *
 * A render key names the very cited set it covers, so an edit to that set asks
 * under another key and the one it replaces stops being asked for. Renders
 * therefore expire on the default garbage-collection time rather than being
 * retained for the session.
 */
const BIBLIOGRAPHY_RENDER = "bibliography-render";
const CITATION_RENDER = "citation-render";

interface BibliographyRenderEvents {
  /** A held render value changed. */
  changed: (key: string) => void;
  /** A render committed, including an equal or failed read. */
  settled: (key: string, held: Held<unknown> | null) => void;
  /**
   * Every held render went stale. A consumer that keeps rendered text on screen
   * asks for its own render again.
   */
  invalidated: () => void;
  /** The first formatting attempt whose selected style is unavailable. */
  "style-missing": (styleId: string) => void;
}

export interface BibliographyRenderCacheOptions {
  profile: Pick<ProfileService, "ready" | "on">;
  db: Pick<DatabaseService, "on">;
  pandocEngine: Pick<
    PandocEngineService,
    "getStatus" | "subscribe" | "getEngine"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "on">;
  settings: Pick<SettingsService, "ready" | "subscribe">;
  /** The plugin-wide query client every Held Read is realized on. */
  queryClient: QueryClientService;
}

/**
 * The Citation Presentation one render asks for. An omitted member inherits the
 * vault selection, which is what a caller that renders the vault default asks
 * for by passing nothing at all.
 */
export interface RenderPresentation {
  /**
   * Installed CSL ID to render with, or `null` for the engine's embedded
   * default style.
   */
  styleId?: string | null;
  /** Citation Locale to render in, overriding the style's own default locale. */
  locale?: string | null;
}

/** A completed bibliography and whether its style supplies Entry Markers. */
export interface BibliographyRenderResult {
  entries: readonly BibliographyEntry[];
  hasEntryMarkers: boolean;
}

export type RenderUnavailableReason =
  | "engine-absent"
  | "style-missing"
  | "failed";

export type HeldRenderOutcome<T> =
  | { kind: "unavailable"; reason: RenderUnavailableReason }
  | { kind: "held"; key: string; record: Held<T> };

/** What the References Sidebar needs to replace or preserve its current list. */
export type BibliographyRenderOutcome =
  HeldRenderOutcome<BibliographyRenderResult>;

export type CitationRenderOutcome = HeldRenderOutcome<
  readonly RenderedCitation[]
>;

/** A Resolved CSL Style a render can actually run with. */
type RenderStyle = Exclude<ResolvedCslStyle, { kind: "failed" }>;

/**
 * Formats whole bibliographies in the Citation and References Style, and hands the same
 * render to every consumer that cites the same works in the same order.
 *
 * A bibliography entry is not a pure function of its Item — Entry Markers and
 * disambiguation depend on the whole cited set — so the whole list is the unit
 * that is cached, keyed by the Citation Presentation it was rendered under and
 * the ordered cited set. What makes a render stale makes every render stale: a
 * Zotero database change, a vault Citation Presentation change, and an engine
 * that came or went each mark all held renders stale and announce it through
 * {@link BibliographyRenderEvents.invalidated}.
 *
 * Nothing is written to disk: a render is derived from the library and the
 * style, both of which the plugin can read again.
 */
export class BibliographyRenderCache extends Service<void> {
  readonly #db;
  readonly #engine;
  readonly #zoteroPref;
  readonly #settings;
  readonly #profile;
  readonly #queries;
  readonly #emitter = createNanoEvents<BibliographyRenderEvents>();
  readonly #styles = new InstalledStyleCache();
  /** `undefined` until the first settings snapshot names the vault selections. */
  #vault: EffectivePresentation | undefined;
  /** The first unavailable selected style found in this plugin lifecycle. */
  #missingStyle: string | null = null;

  ready: Promise<void>;

  constructor(options: BibliographyRenderCacheOptions) {
    super();
    this.#db = options.db;
    this.#engine = options.pandocEngine;
    this.#zoteroPref = options.zoteroPref;
    this.#settings = options.settings;
    this.#profile = options.profile;
    this.#queries = options.queryClient;
    this.ready = this.#load();
  }

  /**
   * The whole bibliography of `items`, formatted in the Citation and References Style.
   *
   * Entries come back in the style's own bibliography order, as typed AST. The
   * rendered value is deeply immutable and shared: every consumer of one render
   * gets the identical value, so a consumer holds it as long as it likes and
   * compares renders by reference.
   *
   * @param items the cited works as CSL-JSON, in the order they are cited.
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @returns the formatted bibliography, or the unavailable or failed state
   *   that tells the sidebar to show its plain list.
   */
  async render(
    items: readonly CslItemData[],
    presentation?: RenderPresentation,
  ): Promise<BibliographyRenderOutcome> {
    // A document that cites nothing still renders under the style it names, so
    // an unusable one is answered here rather than passed over.
    const prepared = await this.#prepare(presentation);
    if ("reason" in prepared) {
      return { kind: "unavailable", reason: prepared.reason };
    }
    const key = renderKey({ ...prepared, items });
    const record = await this.#askThenPeek<BibliographyRenderResult>(
      [BIBLIOGRAPHY_RENDER, key],
      () => this.#runBibliography(items, prepared.style),
    );
    return record === null
      ? { kind: "unavailable", reason: "failed" }
      : { kind: "held", key, record };
  }

  /**
   * The bibliography of `items` once the render behind it stands, for a caller
   * that shows no stale list of its own — the citation text service numbers its
   * cited entries off the very list the References Sidebar shows.
   *
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @param signal ends the wait; the shared render runs on for every other
   *   caller that joined it.
   * @returns null where nothing can be rendered or the render failed.
   */
  async readBibliography(
    items: readonly CslItemData[],
    {
      presentation,
      signal,
    }: { presentation?: RenderPresentation; signal?: AbortSignal } = {},
  ): Promise<BibliographyRenderResult | null> {
    const prepared = await this.#prepare(presentation);
    if ("reason" in prepared) return null;
    return await this.#queries.read<BibliographyRenderResult>(
      [BIBLIOGRAPHY_RENDER, renderKey({ ...prepared, items })],
      () => this.#runBibliography(items, prepared.style),
      signal,
    );
  }

  /**
   * One document's in-text citations, formatted in the Citation and References Style,
   * each paired with the works it names.
   *
   * A style that numbers counts citations across the whole document, so the
   * unit rendered — and the unit cached — is every citation the document
   * writes, in document order. The rendered value is shared under the same
   * contract as {@link render}.
   *
   * @param citations each citation as the source writes it, in document order.
   * @param items the works those citations name, each `id` the key the source
   *   names that work by.
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @returns one held formatted-citation result, or the unavailable reason.
   */
  async renderCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    presentation?: RenderPresentation,
  ): Promise<CitationRenderOutcome> {
    const prepared = await this.#prepare(presentation);
    if ("reason" in prepared) {
      return { kind: "unavailable", reason: prepared.reason };
    }
    const key = renderKey({ ...prepared, items, citations });
    const record = await this.#askThenPeek<readonly RenderedCitation[]>(
      [CITATION_RENDER, key],
      () => this.#runCitations(citations, items, prepared.style),
    );
    return record === null
      ? { kind: "unavailable", reason: "failed" }
      : { kind: "held", key, record };
  }

  /**
   * One document's in-text citations once the render behind them stands, for a
   * caller that shows no stale text of its own — the citation text service
   * holds the formatted text every surface of that document reads.
   *
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @param signal ends the wait; the shared render runs on for every other
   *   caller that joined it.
   * @returns null where nothing can be rendered or the render failed.
   */
  async readCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    {
      presentation,
      signal,
    }: { presentation?: RenderPresentation; signal?: AbortSignal } = {},
  ): Promise<readonly RenderedCitation[] | null> {
    const prepared = await this.#prepare(presentation);
    if ("reason" in prepared) return null;
    return await this.#queries.read<readonly RenderedCitation[]>(
      [CITATION_RENDER, renderKey({ ...prepared, items, citations })],
      () => this.#runCitations(citations, items, prepared.style),
      signal,
    );
  }

  /**
   * The vault Citation Presentation each document inherits the halves it leaves
   * unsaid from — Style default for both until the first settings snapshot
   * names the selections. A surface composing one document's whole presentation
   * reads it from here, so it renders under what this cache renders under.
   */
  get vaultPresentation(): EffectivePresentation {
    return this.#vault ?? { styleId: null, locale: null };
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
    await Promise.all([this.#settings.ready, this.#profile.ready]);
    stack.defer(this.#profile.on("changed", () => this.#invalidate()));

    stack.defer(this.#db.on("changed", () => this.#invalidate()));
    stack.defer(this.#engine.subscribe(() => this.#invalidate()));
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () => this.#invalidate()),
    );
    // Fires synchronously with the loaded settings, which is where the vault
    // selections are first read; only a later one is a change.
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    for (const prefix of [BIBLIOGRAPHY_RENDER, CITATION_RENDER]) {
      stack.defer(
        this.#queries.watch([prefix], {
          changed: (key) => this.#emitter.emit("changed", renderKeyOf(key)),
          settled: (key, held) =>
            this.#emitter.emit("settled", renderKeyOf(key), held),
        }),
      );
    }

    this.commit(stack.move());
  }

  #applySettings(settings: Readonly<Settings>): void {
    const next = vaultPresentation(settings);
    const held = this.#vault;
    if (held && held.styleId === next.styleId && held.locale === next.locale) {
      return;
    }
    this.#vault = next;
    logger.info(
      held
        ? "Citation presentation settings changed"
        : "Vault citation presentation selected",
      { styleId: next.styleId, locale: next.locale },
    );
    if (held) this.#invalidate();
  }

  /** Marks every held render stale and announces the drop. */
  #invalidate(): void {
    logger.debug("Bibliography renders went stale");
    for (const prefix of [BIBLIOGRAPHY_RENDER, CITATION_RENDER]) {
      this.#queries.invalidate([prefix]);
    }
    this.#emitter.emit("invalidated");
  }

  /**
   * What a render request stands on before its key can be built: the engine,
   * the Citation Presentation it resolves to, and the style it formats with.
   */
  async #prepare(
    presentation: RenderPresentation | undefined,
  ): Promise<
    | { request: CslStyleRequest; style: RenderStyle }
    | { reason: RenderUnavailableReason }
  > {
    await this.ready.catch(() => undefined);
    if (this.#engine.getStatus().kind !== "installed") {
      return { reason: "engine-absent" };
    }
    const request = this.#styleRequest(presentation);
    const style = await this.#resolveStyle(request);
    return style.kind === "failed"
      ? { reason: "style-missing" }
      : { request, style };
  }

  /**
   * Asks for one render key and peeks at what it holds: a stale record answers
   * at once while the render replacing it runs, and only a first read is waited
   * on.
   */
  async #askThenPeek<T>(
    queryKey: readonly string[],
    render: () => Promise<T>,
  ): Promise<Held<T> | null> {
    const asking = this.#queries.ask(queryKey, render);
    const held = this.#queries.peek<T>(queryKey);
    if (held !== null) return held;
    await asking;
    return this.#queries.peek<T>(queryKey);
  }

  async #runBibliography(
    items: readonly CslItemData[],
    style: RenderStyle,
  ): Promise<BibliographyRenderResult> {
    if (items.length === 0) return { entries: [], hasEntryMarkers: false };
    try {
      const presentation = enginePresentation(style);
      const engine = await this.#engine.getEngine();
      const entries = await engine.renderBibliography({
        items,
        ...presentation,
      });
      const hasEntryMarkers =
        styleHasEntryMarkers(presentation.styleXml) ||
        entries.some((entry) => entry.marker !== undefined);
      logger.debug("Bibliography rendered", {
        count: entries.length,
        hasEntryMarkers,
      });
      return { entries, hasEntryMarkers };
    } catch (error) {
      logger.warn("Cannot format the bibliography", { error });
      throw error;
    }
  }

  async #runCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    style: RenderStyle,
  ): Promise<readonly RenderedCitation[]> {
    if (citations.length === 0) return [];
    try {
      const engine = await this.#engine.getEngine();
      const rendered = await engine.renderCitations({
        citations,
        items,
        ...enginePresentation(style),
      });
      logger.debug("Citations rendered", { count: rendered.length });
      return rendered;
    } catch (error) {
      logger.warn("Cannot format the citations", { error });
      throw error;
    }
  }

  /** The vault selections where `presentation` names none of its own. */
  #styleRequest(presentation: RenderPresentation | undefined): CslStyleRequest {
    return effectivePresentation(presentation ?? {}, this.vaultPresentation);
  }

  /**
   * A style the vault selected and Zotero cannot supply is a vault-level
   * repair, which is the one the warning and the lifecycle notice guide to. A
   * request that names its own style speaks for the document that named it, so
   * it fails without claiming the vault selection is at fault.
   */
  async #resolveStyle(request: CslStyleRequest): Promise<ResolvedCslStyle> {
    const style = await this.#styles.resolve(this.#zoteroPref.dataDir, request);
    if (style.kind !== "failed") return style;

    logger.debug("Cannot resolve the requested citation style", {
      styleId: style.styleId,
      parentId: style.parentId,
      reason: style.reason,
    });
    const selected = this.#vault?.styleId ?? null;
    if (style.styleId === selected && this.#missingStyle === null) {
      this.#missingStyle = style.styleId;
      this.#emitter.emit("style-missing", style.styleId);
    }
    return style;
  }
}

/**
 * What the engine formats one Resolved CSL Style with: an installed style hands
 * over its content, and the embedded default style takes the Citation Locale as
 * the locale to render in.
 */
function enginePresentation(style: RenderStyle): {
  styleXml?: string;
  locale?: string;
} {
  return style.kind === "installed"
    ? { styleXml: style.xml }
    : { locale: style.locale };
}

/**
 * The identity of one render: the style and Citation Locale that format it, the
 * independent parent the style resolved through, the very CSL content it is
 * formatted by, the works it covers in the order they are cited, and — for an
 * in-text render — the citations it formats.
 *
 * The parent belongs to that identity because a dependent style that starts
 * naming another parent renders another way under the same style ID, and the
 * content belongs to it because a style edited in Zotero renders another way
 * under the same style ID and the same parent.
 *
 * A CSL id names one Item — a Zotero item URI, an Indexed Key, or a citation
 * key — and none of the three can carry the separator, so the empty line
 * between the two lists keeps them apart.
 */
function renderKey({
  request,
  style,
  items,
  citations = [],
}: {
  request: CslStyleRequest;
  style: RenderStyle;
  items: readonly CslItemData[];
  citations?: readonly string[];
}): string {
  return [
    request.styleId ?? "",
    style.kind === "installed" ? (style.parentId ?? "") : "",
    request.locale ?? "",
    contentIdentity(style),
    ...items.map((item) => item.id),
    ...(citations.length > 0 ? ["", ...citations] : []),
  ].join("\n");
}

/** The {@link renderKey} a held render's query key carries. */
function renderKeyOf(key: readonly unknown[]): string {
  return String(key[1]);
}

/**
 * What the resolved style formats with, as a value that changes with it: the
 * digest of the CSL content the engine is handed. The embedded default style
 * ships with the engine and carries no content of its own here, so it stands
 * on the request alone.
 */
function contentIdentity(style: RenderStyle): string {
  return style.kind === "installed"
    ? createHash("sha256").update(style.xml).digest("base64")
    : "";
}
