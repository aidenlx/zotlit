// ItemView orchestrator for the References Sidebar: reads the active document's Citations from the index and renders them through the Pandoc engine.
import { ItemView } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  getAttachmentsByParents,
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import {
  citationsEqual,
  documentCitationErrorsEqual,
} from "@/services/citation-index/service";
import type {
  Citation,
  CitationIndex,
  DocumentCitationError,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { DatabaseService } from "@/services/database/service";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import type { PandocEngineService } from "@/services/pandoc/service";

import { createReferenceActions, ReferenceActionsContext } from "./actions";
import type { ReferenceActions } from "./actions";
import { buildReferenceEntries, toOpenableAttachments } from "./entries";
import type {
  OpenableAttachment,
  ReferenceSource,
  RenderedReference,
} from "./entries";
import { References } from "./References";
import {
  createReferencesStore,
  minimalReferencesState,
  ReferencesStoreProvider,
} from "./store";
import type { ReferencesListMode } from "./store";

export const REFERENCES_VIEW_TYPE = "zotlit-references";

const logger = getLogger(["views", "references"]);

export interface ReferencesViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on">;
  citationIndex: Pick<CitationIndex, "getDocumentCitationSet" | "on">;
  /** Opens the Literature Note a citekey names, creating it first when it has none. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey">;
  pandocEngine: Pick<
    PandocEngineService,
    "getStatus" | "subscribe" | "decline"
  >;
  /** The plugin-wide render cache, which owns the Citation and References Style and the engine. */
  bibliographyRender: Pick<BibliographyRenderCache, "render" | "on">;
  /** Reveals the engine row in settings, where the install lives. */
  openSettings: () => void;
  /** Reveals the Citation and References Style row in settings. */
  openStyleSettings: () => void;
}

export class ReferencesView extends ItemView {
  readonly #store = createReferencesStore();
  readonly #deps: ReferencesViewDeps;
  /**
   * Rendered bibliography entries by CSL id, in the engine's bibliography
   * order. Kept across reloads so an entry that is already formatted never
   * falls back to its summary mid-edit.
   */
  readonly #rendered = new Map<string, RenderedReference>();
  /** Marker ownership of the last completed render for the current style. */
  #listMode: ReferencesListMode = { kind: "minimal" };
  /** The current list is minimal because a completed formatting attempt failed. */
  #formattingFailed = false;
  #root: Root | null = null;
  #actions: ReferenceActions | null = null;
  /** Bumped per reload; an older render that finishes late is discarded. */
  #generation = 0;
  /** Bumped per rescan, the same way, since a query may await a file read. */
  #scan = 0;
  /** Citations of the active document, as the current list was built from. */
  #citations: readonly Citation[] = [];
  /** Explicit citation-source errors of the active document. */
  #errors: readonly DocumentCitationError[] = [];

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
    const {
      app,
      db,
      citationIndex,
      citekeyEditor,
      pandocEngine,
      bibliographyRender,
    } = this.#deps;

    this.#actions = createReferenceActions({
      app,
      getSourcePath: () => app.workspace.getActiveFile()?.path ?? null,
      openCitekey: (citekey) => void citekeyEditor.openCitekey(citekey, false),
      onOpenEngineSettings: () => this.#deps.openSettings(),
      onChangeStyle: () => this.#deps.openStyleSettings(),
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

    // The index answers for the active document alone, so the pane follows
    // whichever document that is, and every signal that can change its
    // Citations: its own citekeys through the index, its wikilinks and the
    // frontmatter that resolves either syntax through the metadata cache. A
    // rescan that finds the same Citations rebuilds nothing.
    this.registerEvent(
      app.workspace.on("active-leaf-change", () => this.#rescan()),
    );
    this.register(
      citationIndex.on("changed", (path) => {
        if (path === app.workspace.getActiveFile()?.path) this.#rescan();
      }),
    );
    // Vault-wide: the citekey resolution snapshot rebuilt and now answers
    // differently, so the active document's Citations may resolve to a
    // different Item — or a citekey that resolved before now resolves to
    // none — regardless of which document changed to trigger the rebuild.
    this.register(citationIndex.on("resolution-changed", () => this.#rescan()));
    this.register(citationIndex.on("membership-changed", () => this.#rescan()));
    this.registerEvent(app.metadataCache.on("changed", () => this.#rescan()));
    this.register(db.on("changed", () => this.#reload()));
    this.register(pandocEngine.subscribe(() => this.#reload()));
    // What the cache holds is what this pane shows, so its wholesale drop —
    // for a Zotero change, a Citation and References Style change, or an engine that came or
    // went — is the one signal that makes the formatted entries here stale.
    this.register(
      bibliographyRender.on("invalidated", () =>
        this.#reload({ invalidate: true }),
      ),
    );
    this.#reload();
    this.#rescan();
    await db.ready;
    this.#reload();
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
    this.#actions = null;
  }

  /**
   * Ask the index what the active document cites, and rebuild the list when the
   * answer differs. The query is answered from the index, so a document the
   * vault-wide backfill has not reached is scanned on demand rather than waited
   * for; the read yields, so a stale answer is discarded.
   */
  #rescan(): void {
    const scan = ++this.#scan;
    void this.#readCitationSet().then(({ citations, errors }) => {
      if (
        scan !== this.#scan ||
        (citationsEqual(this.#citations, citations) &&
          documentCitationErrorsEqual(this.#errors, errors))
      ) {
        return;
      }
      this.#citations = citations;
      this.#errors = errors;
      logger.trace("References citations changed", {
        path: this.#deps.app.workspace.getActiveFile()?.path,
        count: citations.length,
      });
      this.#reload();
    });
  }

  /** Scope is `.md`, the only files the index covers. */
  async #readCitationSet(): Promise<DocumentCitationSet> {
    const file = this.#deps.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      return { occurrences: [], citations: [], errors: [] };
    }
    return this.#deps.citationIndex.getDocumentCitationSet(file);
  }

  /**
   * Re-read the cited Items and re-render the whole list — no incremental
   * diffing. `invalidate` drops the formatted entries too, for a change that
   * makes them stale rather than incomplete.
   */
  #reload({ invalidate = false } = {}): void {
    if (invalidate) {
      this.#rendered.clear();
      this.#listMode = { kind: "minimal" };
      this.#formattingFailed = false;
    }
    const generation = ++this.#generation;
    const citations = this.#citations;
    const sources = this.#readSources(citations);

    this.#store.setState({
      entries: buildReferenceEntries(citations, sources, {
        bibliography: {
          entries: this.#rendered,
          complete: false,
        },
        errors: this.#errors,
      }),
      listMode: this.#listMode,
      engine: this.#deps.pandocEngine.getStatus(),
      formattingFailed: this.#formattingFailed,
      dbReady: this.#deps.db.state === "ready",
    });
    void this.#render(generation, citations, sources);
  }

  /**
   * The cited Items as CSL-JSON, read straight from the database so the sidebar
   * keeps working while Zotero is closed. An Item the library no longer holds
   * is left out, and its citation stays visible as an error entry. Attachments
   * come in one batched read, so the row knows what it can open before the
   * reader clicks.
   */
  #readSources(
    citations: readonly Citation[],
  ): ReadonlyMap<string, ReferenceSource> {
    const sources = new Map<string, ReferenceSource>();
    const { db } = this.#deps;
    if (db.state !== "ready" || citations.length === 0) return sources;

    try {
      const user = getZoteroIdentity(db.client);
      const cited: { indexedKey: string; item: Item; summary: string }[] = [];
      for (const { indexedKey } of citations) {
        // A citekey naming no live Zotero Item names nothing to read; the
        // entry builder keeps it as an error row of its own.
        if (indexedKey === null) continue;
        const selector = resolveIndexedKeyLibrary(db.client, indexedKey);
        if (!selector) continue;
        const item = getItemsByKey(db.client, selector.libraryID, [
          selector.key,
        ])[0];
        if (!item) continue;
        const { fields } = item;
        if (isChildItemFields(fields)) continue;
        cited.push({
          indexedKey,
          item,
          summary: itemSummary(item, fields).formatted,
        });
      }

      // Contained on its own: an unreadable attachment table costs the open
      // action alone, where letting it escape would empty the whole list and
      // show every citation as a missing Item.
      const attachments = new Map<number, OpenableAttachment[]>();
      try {
        const rows = getAttachmentsByParents(
          db.client,
          cited.map(({ item }) => item.itemID),
        );
        for (const [itemID, group] of Map.groupBy(
          rows,
          (row) => row.parentItemID,
        )) {
          attachments.set(itemID, toOpenableAttachments(group));
        }
      } catch (error) {
        logger.warn("Cannot read the attachments of the cited items", {
          error,
        });
      }

      for (const { indexedKey, item, summary } of cited) {
        sources.set(indexedKey, {
          csl: itemToCsl(item, user),
          summary,
          itemKey: item.key,
          itemID: item.itemID,
          groupID: item.groupID,
          attachments: attachments.get(item.itemID) ?? [],
        });
      }
    } catch (error) {
      logger.warn("Cannot read the cited items", { error });
    }
    return sources;
  }

  /**
   * Formats the whole list through the plugin-wide render cache, which answers
   * from a render another consumer already paid for whenever this document
   * cites the same works in the same order.
   *
   * Formatted entries stay on screen while a render is pending. An unavailable
   * style or engine returns the list to its supported minimal state. A failed
   * completed render also shows the failure state. A completed render is
   * applied even when it is empty, so each source it omitted becomes a
   * Reference Error.
   */
  async #render(
    generation: number,
    citations: readonly Citation[],
    sources: ReadonlyMap<string, ReferenceSource>,
  ): Promise<void> {
    const items = [...sources.values()].map((source) => source.csl);
    const outcome = await this.#deps.bibliographyRender.render(items);
    if (generation !== this.#generation) return;

    if (outcome.kind !== "rendered") {
      this.#showMinimal(citations, sources, outcome.kind === "failed");
      return;
    }

    // Refilled rather than merged: the render covers every cited Item, so
    // what it leaves out is no longer cited, and the map's order is the
    // bibliography order the list reads in.
    this.#rendered.clear();
    for (const { id, marker, content } of outcome.entries) {
      this.#rendered.set(id, { marker, content });
    }
    this.#listMode = {
      kind: "bibliography",
      hasEntryMarkers: outcome.hasEntryMarkers,
    };
    this.#formattingFailed = false;
    logger.debug("References bibliography rendered", {
      count: outcome.entries.length,
      hasEntryMarkers: outcome.hasEntryMarkers,
    });
    this.#store.setState({
      entries: buildReferenceEntries(citations, sources, {
        bibliography: {
          entries: this.#rendered,
          complete: true,
        },
        errors: this.#errors,
      }),
      listMode: this.#listMode,
      formattingFailed: false,
    });
  }

  /** Replace stale formatted entries with the current minimal reference list. */
  #showMinimal(
    citations: readonly Citation[],
    sources: ReadonlyMap<string, ReferenceSource>,
    formattingFailed: boolean,
  ): void {
    this.#rendered.clear();
    this.#listMode = { kind: "minimal" };
    this.#formattingFailed = formattingFailed;
    this.#store.setState(
      minimalReferencesState({
        citations,
        sources,
        errors: this.#errors,
        formattingFailed,
      }),
    );
  }
}
