// ItemView orchestrator for the References Sidebar: reads the scanned citations from the database and renders them through the Pandoc engine.
import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import {
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import {
  type Citation,
  type CitationScanner,
} from "@/services/citation-scan/service";
import { type DatabaseService } from "@/services/database/service";
import { CitationRequestSupersededError } from "@/services/pandoc/engine";
import { type PandocEngineService } from "@/services/pandoc/service";
import { loadStyleXml } from "@/services/pandoc/styles";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  createReferenceActions,
  ReferenceActionsContext,
  type ReferenceActions,
} from "./actions";
import { buildReferenceEntries, type ReferenceSource } from "./entries";
import { References } from "./References";
import { createReferencesStore, ReferencesStoreProvider } from "./store";

export const REFERENCES_VIEW_TYPE = "zotlit-references";

const logger = getLogger(["views", "references"]);

export interface ReferencesViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on">;
  citationScanner: Pick<CitationScanner, "store">;
  pandocEngine: Pick<
    PandocEngineService,
    "getStatus" | "subscribe" | "getEngine" | "decline"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "on">;
  settings: Pick<SettingsService, "current" | "subscribe">;
  /** Reveals the engine row in settings, where the install lives. */
  openSettings: () => void;
}

export class ReferencesView extends ItemView {
  readonly #store = createReferencesStore();
  readonly #deps: ReferencesViewDeps;
  /**
   * Rendered bibliography entries by CSL id. Kept across reloads so an entry
   * that is already formatted never falls back to its summary mid-edit.
   */
  readonly #rendered = new Map<string, string>();
  /** This view's own supersession slot, so two sidebars never drop each other's renders. */
  readonly #slot = `references-${crypto.randomUUID()}`;
  #root: Root | null = null;
  #actions: ReferenceActions | null = null;
  /** Bumped per reload; an older render that finishes late is discarded. */
  #generation = 0;
  #styleId: string | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ReferencesViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.contentEl.addClass("zt-references-view");
    this.#deps = deps;
  }

  override getViewType(): string {
    return REFERENCES_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.references_view_name();
  }

  override getIcon(): string {
    return "quote";
  }

  protected override async onOpen(): Promise<void> {
    const { app, db, citationScanner, pandocEngine, zoteroPref, settings } =
      this.#deps;

    this.#styleId = this.#selectedStyleId();
    this.#actions = createReferenceActions({
      app,
      db,
      getSourcePath: () => app.workspace.getActiveFile()?.path ?? null,
      onOpenEngineSettings: () => this.#deps.openSettings(),
      onDismissEngineHint: () => pandocEngine.decline(),
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ReferencesStoreProvider value={this.#store}>
        <ReferenceActionsContext value={this.#actions}>
          <References />
        </ReferenceActionsContext>
      </ReferencesStoreProvider>,
    );

    this.register(citationScanner.store.subscribe(() => this.#reload()));
    this.register(db.on("changed", () => this.#reload({ invalidate: true })));
    this.register(
      pandocEngine.subscribe(() => this.#reload({ invalidate: true })),
    );
    this.register(
      zoteroPref.on("resolved-changed", () =>
        this.#reload({ invalidate: true }),
      ),
    );
    this.register(
      settings.subscribe(() => {
        const styleId = this.#selectedStyleId();
        if (styleId === this.#styleId) return;
        this.#styleId = styleId;
        this.#reload({ invalidate: true });
      }),
    );

    this.#reload();
    await db.ready;
    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
    this.#actions = null;
  }

  #selectedStyleId(): string | null {
    return this.#deps.settings.current?.["citation.references-style"] ?? null;
  }

  /**
   * Re-read the cited Items and re-render the whole list — no incremental
   * diffing. `invalidate` drops the formatted entries too, for a change that
   * makes them stale rather than incomplete.
   */
  #reload({ invalidate = false } = {}): void {
    if (invalidate) this.#rendered.clear();
    const generation = ++this.#generation;
    const { citations } = this.#deps.citationScanner.store.getState();
    const sources = this.#readSources(citations);

    this.#store.setState({
      entries: buildReferenceEntries(citations, sources, this.#rendered),
      engine: this.#deps.pandocEngine.getStatus(),
      dbReady: this.#deps.db.state === "ready",
    });
    void this.#render(generation, citations, sources);
  }

  /**
   * The cited Items as CSL-JSON, read straight from the database so the sidebar
   * keeps working while Zotero is closed. An Item the library no longer holds
   * is left out, and its citation stays visible as an error entry.
   */
  #readSources(
    citations: readonly Citation[],
  ): ReadonlyMap<string, ReferenceSource> {
    const sources = new Map<string, ReferenceSource>();
    const { db } = this.#deps;
    if (db.state !== "ready" || citations.length === 0) return sources;

    try {
      const user = getZoteroIdentity(db.client);
      for (const { indexedKey } of citations) {
        const selector = resolveIndexedKeyLibrary(db.client, indexedKey);
        if (!selector) continue;
        const item = getItemsByKey(db.client, selector.libraryID, [
          selector.key,
        ])[0];
        if (!item || isChildItemFields(item.fields)) continue;
        sources.set(indexedKey, {
          csl: itemToCsl(item, user),
          summary: itemSummary(item, item.fields).formatted,
          itemKey: item.key,
          itemID: item.itemID,
          groupID: item.groupID,
        });
      }
    } catch (error) {
      logger.warn("Cannot read the cited items", { error });
    }
    return sources;
  }

  /** Formats the whole list in the References style, when an engine is installed. */
  async #render(
    generation: number,
    citations: readonly Citation[],
    sources: ReadonlyMap<string, ReferenceSource>,
  ): Promise<void> {
    if (this.#deps.pandocEngine.getStatus().kind !== "installed") return;
    const items = [...sources.values()].map((source) => source.csl);
    if (items.length === 0) return;

    try {
      const engine = await this.#deps.pandocEngine.getEngine();
      const styleXml = await loadStyleXml(
        this.#deps.zoteroPref.dataDir,
        this.#styleId,
      );
      const rendered = await engine.renderBibliography({
        items,
        styleXml,
        supersedes: this.#slot,
      });
      if (generation !== this.#generation) return;

      for (const { id, html } of rendered) this.#rendered.set(id, html);
      this.#store.setState({
        entries: buildReferenceEntries(citations, sources, this.#rendered),
      });
    } catch (error) {
      if (error instanceof CitationRequestSupersededError) return;
      logger.warn("Cannot format the references", { error });
    }
  }
}
