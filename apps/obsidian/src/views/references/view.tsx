// ItemView orchestrator for the References Sidebar: reads the active document's Citations from the index and renders them through the Pandoc engine.
import { ItemView } from "obsidian";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { writeClipboardRichText } from "@/lib/clipboard";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import {
  citationsEqual,
  documentCitationErrorsEqual,
  readReferenceSources,
} from "@/services/citation-index/service";
import type {
  Citation,
  CitationIndex,
  DocumentCitationError,
  DocumentCitationSet,
  ReferenceSource,
} from "@/services/citation-index/service";
import type { CitationText } from "@/services/citation-text/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import type { DatabaseService } from "@/services/database/service";
import {
  citedItems,
  documentPresentation,
  samePresentation,
} from "@/services/pandoc/document-presentation";
import type {
  DocumentPresentation,
  UnusableProperty,
} from "@/services/pandoc/document-presentation";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import type { PandocEngineService } from "@/services/pandoc/service";

import { createReferenceActions, ReferenceActionsContext } from "./actions";
import type { CopyBibliographySnapshot, ReferenceActions } from "./actions";
import type { CopiedBibliographyEntry } from "./copied-bibliography";
import { buildReferenceEntries } from "./entries";
import type { ReferenceEntry, RenderedReference } from "./entries";
import { References } from "./References";
import {
  createReferencesStore,
  minimalReferencesState,
  referencesCopyState,
  ReferencesStoreProvider,
} from "./store";
import type {
  ReferencesCopyBlock,
  ReferencesCopyState,
  ReferencesCopyTarget,
  ReferencesFormatting,
  ReferencesListMode,
} from "./store";

export const REFERENCES_VIEW_TYPE = "zotlit-references";

const logger = getLogger(["views", "references"]);

export interface ReferencesViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client" | "ready" | "on">;
  citationIndex: Pick<CitationIndex, "getDocumentCitationSet" | "on">;
  /** Opens the Literature Note a citekey names, creating it first when it has none. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey">;
  /**
   * The active document's formatted citations, which say whether that document
   * shows Entry Serials — the gutter follows what the citations show.
   */
  citationText: Pick<CitationText, "peek" | "load" | "on">;
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
  /**
   * Entry Marker ownership of the last completed render for the current style,
   * or `null` while the list on screen is the minimal one.
   */
  #entryMarkers: boolean | null = null;
  /** Whether the document's citations put this list's gutter on Entry Serials. */
  #entrySerials = false;
  /** The current list is minimal because a completed formatting attempt failed. */
  #formattingFailed = false;
  #root: Root | null = null;
  #actions: ReferenceActions | null = null;
  /** Bumped per reload; an older render that finishes late is discarded. */
  #generation = 0;
  /** Bumped per rescan, the same way, since a query may await a file read. */
  #scan = 0;
  /** The Markdown note the current list was read from; `null` for none. */
  #file: TFile | null = null;
  /** Path of that note, which is what a document-scoped event names. */
  #path: string | null = null;
  /** Citations of that note, as the current list was built from. */
  #citations: readonly Citation[] = [];
  /** Explicit citation-source errors of that note. */
  #errors: readonly DocumentCitationError[] = [];
  /** Citation Presentation of that note, as the current list was rendered under. */
  #presentation: DocumentPresentation = { kind: "read", presentation: {} };
  /**
   * The note property that put the current minimal list on screen; `null` while
   * the note's own presentation is not what stopped the render.
   */
  #documentPresentationError: UnusableProperty | null = null;
  /** Where the current list's render stands, as copy readiness reads it. */
  #formatting: ReferencesFormatting = "pending";
  /** Copy readiness as it was last published, so only a change is logged. */
  #copyLabel: "ready" | ReferencesCopyBlock = "no-note";
  /** The bibliography a copy would take; `null` while copy is unavailable. */
  #copySnapshot: CopyBibliographySnapshot | null = null;

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
      citationText,
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
      getCopySnapshot: () => this.#copySnapshot,
      writeClipboard: writeClipboardRichText,
      notify: (message) => void new BaseNotice(message),
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
    // rescan that finds the same Citations of the same note rebuilds nothing.
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
    // What the document's own citations show decides what this gutter shows,
    // so a fresh read of the note on screen republishes the list.
    this.register(
      citationText.on("changed", (path) => {
        if (path === this.#path) this.#reload();
      }),
    );
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
   *
   * A rescan starts when the active note may have moved on, while the list
   * still answers for the note its Citations were read from, so copy readiness
   * is republished before the read rather than after it. The note is part of
   * the answer, so a switch to a note citing the same works rebuilds the list
   * all the same, and the copy it offers names the note now on screen.
   */
  #rescan(): void {
    const scan = ++this.#scan;
    this.#refreshCopy();
    void this.#readCitationSet().then(({ file, citations, errors }) => {
      const path = file?.path ?? null;
      // The note's own presentation properties decide what its list is rendered
      // under, so a frontmatter edit that leaves the Citations untouched still
      // moves this list — and the entries formatted before it are stale.
      const presentation = this.#readPresentation(file);
      const restyled = !samePresentation(this.#presentation, presentation);
      if (
        scan !== this.#scan ||
        (path === this.#path &&
          !restyled &&
          citationsEqual(this.#citations, citations) &&
          documentCitationErrorsEqual(this.#errors, errors))
      ) {
        return;
      }
      this.#file = file;
      this.#path = path;
      this.#citations = citations;
      this.#errors = errors;
      this.#presentation = presentation;
      logger.trace("References citations changed", {
        path,
        count: citations.length,
        restyled,
      });
      this.#reload({ invalidate: restyled });
    });
  }

  /**
   * Scope is `.md`, the only files the index covers. The note travels with the
   * answer, so the list keeps naming the note it was read from however the
   * active note moves while the read runs.
   */
  async #readCitationSet(): Promise<
    DocumentCitationSet & { file: TFile | null }
  > {
    const file = this.#deps.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      return { file: null, occurrences: [], citations: [], errors: [] };
    }
    return {
      file,
      ...(await this.#deps.citationIndex.getDocumentCitationSet(file)),
    };
  }

  /** The Citation Presentation one note renders under; no note renders as none. */
  #readPresentation(file: TFile | null): DocumentPresentation {
    return file === null
      ? { kind: "read", presentation: {} }
      : documentPresentation(this.#deps.app.metadataCache, file);
  }

  /**
   * Re-read the cited Items and re-render the whole list — no incremental
   * diffing. `invalidate` drops the formatted entries too, for a change that
   * makes them stale rather than incomplete.
   */
  #reload({ invalidate = false } = {}): void {
    if (invalidate) {
      this.#rendered.clear();
      this.#entryMarkers = null;
      this.#formattingFailed = false;
      this.#documentPresentationError = null;
    }
    this.#entrySerials = this.#readEntrySerials();
    const generation = ++this.#generation;
    const citations = this.#citations;
    const { sources } = readReferenceSources(this.#deps.db, citations);
    const engine = this.#deps.pandocEngine.getStatus();
    const entries = buildReferenceEntries(citations, sources, {
      bibliography: {
        entries: this.#rendered,
        complete: false,
      },
      errors: this.#errors,
    });

    // Retained formatted entries answer for the render that is about to be
    // replaced, so the reload alone puts copy out of reach.
    this.#formatting = engine.kind === "installed" ? "pending" : "unavailable";
    this.#store.setState({
      entries,
      listMode: this.#listMode(),
      engine,
      formattingFailed: this.#formattingFailed,
      documentPresentationError: this.#documentPresentationError,
      dbReady: this.#deps.db.state === "ready",
      copy: this.#trackCopy(entries),
    });
    void this.#render(generation, citations, sources);
  }

  /**
   * Publish copy readiness, and hold the bibliography a ready copy takes.
   *
   * The note travels with the Citations the list was built from, rather than
   * being read back off the workspace here: once another note takes over, the
   * list on screen answers for the note it was read from alone, so copy waits
   * for the rescan that follows the switch whatever this render did.
   *
   * The snapshot names the note and the generation it answers for, so the copy
   * action can refuse a write once either has moved on.
   */
  #trackCopy(entries: readonly ReferenceEntry[]): ReferencesCopyState {
    const path = this.#path;
    const generation = this.#generation;
    const copy = referencesCopyState({
      path,
      generation,
      entries,
      // A list the active note has moved past is the previous note's until the
      // rescan that follows the switch hands this pane the new note's own
      // Citations, so it waits on that rescan the way it waits on a render.
      formatting:
        this.#activeMarkdownPath() === path ? this.#formatting : "pending",
    });
    // The list a snapshot is taken from stands for one note and one generation,
    // and neither moves without a reload, so a snapshot already taken for the
    // same pair is the same snapshot and the entries are shown once for it.
    this.#copySnapshot =
      copy.kind === "ready"
        ? (this.#heldSnapshot(copy.target) ?? {
            ...copy.target,
            entries: copiedEntries(entries),
          })
        : null;

    const label = copy.kind === "ready" ? "ready" : copy.reason;
    if (label !== this.#copyLabel) {
      this.#copyLabel = label;
      logger.debug("References copy readiness changed", {
        state: label,
        path,
        generation,
      });
    }
    return copy;
  }

  /** The snapshot already taken for `target`, when one was. */
  #heldSnapshot(target: ReferencesCopyTarget): CopyBibliographySnapshot | null {
    const held = this.#copySnapshot;
    return held?.path === target.path && held.generation === target.generation
      ? held
      : null;
  }

  /**
   * Republish copy readiness alone, for a change that leaves the list itself
   * standing: the active note moving away from the note the list answers for,
   * and back to it. The readiness label carries that whole change — neither the
   * note nor the generation of a ready copy moves without a reload — so an
   * unchanged label publishes nothing and the pane stays put.
   */
  #refreshCopy(): void {
    const label = this.#copyLabel;
    const copy = this.#trackCopy(this.#store.getState().entries);
    if (label !== this.#copyLabel) this.#store.setState({ copy });
  }

  /** The active file when it is a note the citation index answers for. */
  #activeMarkdownPath(): string | null {
    const file = this.#deps.app.workspace.getActiveFile();
    return file?.extension === "md" ? file.path : null;
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
   *
   * A note whose own presentation is unusable never reaches the vault
   * selections: it shows the minimal list with the error that names the note as
   * the thing to repair, which also leaves the Copied Bibliography out of reach.
   */
  async #render(
    generation: number,
    citations: readonly Citation[],
    sources: ReadonlyMap<string, ReferenceSource>,
  ): Promise<void> {
    const declared = this.#presentation;
    if (declared.kind === "unusable") {
      this.#documentPresentationError = declared.property;
      this.#showMinimal(citations, sources, false);
      return;
    }

    const { presentation } = declared;
    const outcome = await this.#deps.bibliographyRender.render(
      citedItems(sources),
      presentation,
    );
    if (generation !== this.#generation) return;

    if (outcome.kind !== "rendered") {
      this.#documentPresentationError =
        outcome.kind === "unavailable" &&
        outcome.reason === "style-missing" &&
        presentation.styleId !== undefined
          ? "style"
          : null;
      this.#showMinimal(citations, sources, outcome.kind === "failed");
      return;
    }
    this.#documentPresentationError = null;

    // Refilled rather than merged: the render covers every cited Item, so
    // what it leaves out is no longer cited, and the map's order is the
    // bibliography order the list reads in.
    this.#rendered.clear();
    for (const { id, marker, content } of outcome.entries) {
      this.#rendered.set(id, { marker, content });
    }
    this.#entryMarkers = outcome.hasEntryMarkers;
    this.#formattingFailed = false;
    this.#formatting = "complete";
    logger.debug("References bibliography rendered", {
      count: outcome.entries.length,
      hasEntryMarkers: outcome.hasEntryMarkers,
    });
    const entries = buildReferenceEntries(citations, sources, {
      bibliography: {
        entries: this.#rendered,
        complete: true,
      },
      errors: this.#errors,
    });
    this.#store.setState({
      entries,
      listMode: this.#listMode(),
      formattingFailed: false,
      documentPresentationError: null,
      copy: this.#trackCopy(entries),
    });
  }

  /**
   * Which list is on screen, and what its gutter carries.
   *
   * The two answers are read apart — a completed render says whether the style
   * writes Entry Markers, the document's own citations say whether they show
   * Entry Serials — and either can settle first, so the mode is composed as it
   * is published rather than held.
   */
  #listMode(): ReferencesListMode {
    return this.#entryMarkers === null
      ? { kind: "minimal" }
      : {
          kind: "bibliography",
          hasEntryMarkers: this.#entryMarkers,
          entrySerials: this.#entrySerials,
        };
  }

  /**
   * Whether the note this list answers for shows Entry Serials.
   *
   * The answer is the held citation text of that note — the very text its own
   * surfaces show — so the digits in this gutter are the digits those surfaces
   * print. A note nothing has read yet is read now, and that read announces
   * itself when it settles.
   */
  #readEntrySerials(): boolean {
    const file = this.#file;
    if (file === null) return false;
    const held = this.#deps.citationText.peek(file.path);
    if (held !== null) return held.entrySerials;
    void this.#deps.citationText.load(file);
    return false;
  }

  /** Replace stale formatted entries with the current minimal reference list. */
  #showMinimal(
    citations: readonly Citation[],
    sources: ReadonlyMap<string, ReferenceSource>,
    formattingFailed: boolean,
  ): void {
    this.#rendered.clear();
    this.#entryMarkers = null;
    this.#formattingFailed = formattingFailed;
    this.#formatting = formattingFailed ? "failed" : "unavailable";
    const minimal = minimalReferencesState({
      citations,
      sources,
      errors: this.#errors,
      formattingFailed,
    });
    this.#store.setState({
      ...minimal,
      documentPresentationError: this.#documentPresentationError,
      copy: this.#trackCopy(minimal.entries),
    });
  }
}

/**
 * The completed entries of a ready list, in the style's bibliography order.
 *
 * The clipboard serializer reads the formatted flows themselves, so an entry
 * travels as the engine handed it over and is written for the destination once,
 * at the copy.
 */
function copiedEntries(
  entries: readonly ReferenceEntry[],
): CopiedBibliographyEntry[] {
  return entries
    .filter((entry) => entry.kind === "rendered")
    .map(({ marker, content }) => ({ marker, content }));
}
