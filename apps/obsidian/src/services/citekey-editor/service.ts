import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
// The citekey editor treatment service: it follows the settings that switch the
// CodeMirror extension on and owns the click that opens a citekey's note.
import { Effect } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { AnnotationPopover } from "@/services/annotation-popover/service";
import { describeCandidates } from "@/services/citation-index/ambiguity";
import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";
import { heldResolution } from "@/services/citation-index/lookup";
import type { PlainCitationLookup } from "@/services/citation-index/plain";
import type {
  CitationLookupAnswer,
  CitationLookupObservation,
  SnapshotItem,
} from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import type { PlainCitationText } from "@/services/citation-text/plain";
import {
  CITEKEY_HOVER_SOURCE,
  hoverPreferences,
  pagePreviewRequiresMod,
} from "@/services/citekey-navigation";
import type {
  HoverPreferences,
  NavigationPane,
} from "@/services/citekey-navigation";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import type { NoteFeature } from "@/services/note-feature";
import { createNoteInteractively } from "@/services/note-feature";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { Service } from "@/services/service-base";
import type { PlainPluginSettings } from "@/services/settings/plain";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import type { ImportProfile, CreateProfile } from "@/setting-tab/profiles";

import { annotationLinkHoverExtension } from "./annotation-link";
import { citekeyDecorationsChanged, citekeyEditorExtension } from "./extension";

const logger = getLogger("citekey-editor");

export interface CitekeyEditorDeps {
  runtime: Parameters<typeof subscribe<unknown, never>>[0];
  createProfile: CreateProfile;
  importProfile: ImportProfile;
  app: App;
  plugin: Pick<Plugin, "registerEditorExtension" | "registerHoverLinkSource">;
  noteIndex: Pick<PlainNoteIndex, "whenIndexed" | "getNotesByItemKey">;
  noteFeature: NoteFeature;
  zoteroPref: Pick<PlainZoteroPref, "dataDir">;
  db: Pick<PlainZoteroReads, "state" | "reads">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<PlainCitationText, "peek" | "changed" | "invalidated">;
  /** What a hovered citation shows. */
  citationPopover: CitationPopover;
  /** What a hovered Durable Annotation Link shows. */
  annotationPopover: Pick<AnnotationPopover, "show">;
  settings: Pick<PlainPluginSettings, "current" | "subscribe">;
  citationLookup: Pick<PlainCitationLookup, "read"> & {
    observe(changed: () => void): CitationLookupObservation;
  };
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: Pick<PlainLibraryScope, "current">;
}

export type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";

/** One Ambiguous Citation Key, as the candidate picker is asked to show it. */
export interface AmbiguousCitekey {
  citekey: string;
  candidates: readonly AmbiguousCandidate[];
  /** Where the chosen candidate's Literature Note opens. */
  pane: NavigationPane;
}

interface CitekeyEditorEvents {
  "db-unavailable": (citekey: string) => void;
  "citekey-not-found": (citekey: string) => void;
  "item-unavailable": (reason: "database" | "item") => void;
  /** The citekey names several Items; a UI subscriber asks which one to open. */
  "citekey-ambiguous": (ambiguous: AmbiguousCitekey) => void;
}

/**
 * The citekey editor treatment: literal Pandoc `@citekey` text is marked in
 * the editor and opens the Literature Note of the Zotero Item its native
 * citation key names — the note an Indexed Key already points at, or a note
 * created from the matching Item.
 *
 * The CodeMirror extension is registered once as a mutable array, so the
 * setting toggles it by rewriting that array and asking Obsidian to
 * reconfigure — the mechanism `registerEditorExtension` documents.
 */
export class CitekeyEditor extends Service<void> {
  readonly #createProfile;
  readonly #importProfile;
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #noteFeature;
  readonly #zoteroPref;
  readonly #db;
  readonly #citationText;
  readonly #runtime;
  readonly #citationPopover;
  readonly #annotationPopover;
  readonly #settings;
  readonly #citationLookup;
  readonly #libraryScope;
  readonly #emitter = createNanoEvents<CitekeyEditorEvents>();
  readonly #extension: Extension;

  /** Registered once; its contents are the on/off switch. */
  readonly #extensions: Extension[] = [];
  /**
   * The annotation link hover, registered once like {@link #extensions}; it
   * holds the hover while `citation.annotation-links` is on.
   */
  readonly #annotationLinkExtensions: Extension[] = [];
  readonly #annotationLinkHover: Extension;

  #active = false;
  #navigationEnabled = false;
  #showFormatted = false;
  #hover: HoverPreferences = hoverPreferences(defaults);

  ready: Promise<void>;

  constructor(deps: CitekeyEditorDeps) {
    super();
    this.#app = deps.app;
    this.#createProfile = deps.createProfile;
    this.#importProfile = deps.importProfile;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#noteFeature = deps.noteFeature;
    this.#zoteroPref = deps.zoteroPref;
    this.#db = deps.db;
    this.#citationText = deps.citationText;
    this.#runtime = deps.runtime;
    this.#citationPopover = deps.citationPopover;
    this.#annotationPopover = deps.annotationPopover;
    this.#settings = deps.settings;
    this.#citationLookup = deps.citationLookup;
    this.#libraryScope = deps.libraryScope;
    this.#extension = citekeyEditorExtension({
      workspace: this.#app.workspace,
      open: (citekey, pane) => {
        void this.openCitekey(citekey, pane);
      },
      showPopover: (request) => this.#citationPopover.show(request),
      hoverPreferences: () => this.#hover,
      hoverNotePath: (citekey, lookup) => this.hoverNotePath(citekey, lookup),
      observeLookup: (changed) => this.#citationLookup.observe(changed),
      navigationEnabled: () => this.#navigationEnabled,
      showFormatted: () => this.#showFormatted,
      citationText: (path) => this.#citationText.peek(path),
    });
    // A Durable Annotation Link is no Pandoc citation, so its hover follows
    // the Hover Action alone, whatever the citation treatment is set to.
    this.#annotationLinkHover = annotationLinkHoverExtension({
      hoverPreferences: () => this.#hover,
      pagePreviewRequiresMod: () => pagePreviewRequiresMod(this.#app),
      showAnnotation: (request) => this.#annotationPopover.show(request),
    });
    this.ready = this.#load();
  }

  on<K extends keyof CitekeyEditorEvents>(
    event: K,
    cb: CitekeyEditorEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();

    // Registered once and for the plugin's lifetime, so the row in Obsidian's
    // Page preview settings stays put while the Hover Action changes. Mod is
    // the platform convention for a citation, and Obsidian's own row owns that
    // gate wherever ZotLit hands hover to the page preview.
    this.#plugin.registerHoverLinkSource(CITEKEY_HOVER_SOURCE, {
      display: m.hover_source_citekey(),
      defaultMod: true,
    });
    // Filled before it is registered, so the first editors start with it and
    // need no reconfiguring for it.
    if ((this.#settings.current ?? defaults)["citation.annotation-links"]) {
      this.#annotationLinkExtensions.push(this.#annotationLinkHover);
    }
    this.#plugin.registerEditorExtension(this.#annotationLinkExtensions);
    this.#plugin.registerEditorExtension(this.#extensions);
    stack.defer(() => {
      this.#annotationLinkExtensions.length = 0;
      this.#extensions.length = 0;
      this.#app.workspace.updateOptions();
    });
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    // A widget's text is read asynchronously and shared with every other
    // surface, so the editors showing that document draw again when it lands
    // or goes stale — until then they keep the raw marked source.
    stack.defer(
      subscribe(this.#runtime, this.#citationText.changed, (path) =>
        this.#redrawWidgets(path),
      ),
    );
    stack.defer(
      subscribe(this.#runtime, this.#citationText.invalidated, () =>
        this.#redrawWidgets(),
      ),
    );

    this.commit(stack.move());
  }

  /**
   * The one Item a citekey names. An Ambiguous Citation Key answers with
   * nothing: it adopts no candidate's identity, so every surface reading this
   * treats it as a key that opens no single Item.
   */
  #uniqueItem(
    citekey: string,
    lookup: CitationLookupAnswer,
  ): SnapshotItem | null {
    const resolved = heldResolution(lookup, citekey);
    return resolved?.kind === "unique" ? resolved.item : null;
  }

  /** @param path the document whose text changed, or nothing for every one. */
  #redrawWidgets(path?: string): void {
    const editors = this.#decorateAgain(path);
    logger.trace("Redrawing citation widgets", { editors, path });
  }

  /**
   * Asks the open Markdown editors to build their decorations again. The
   * decoration layer owns what changed; this only names the reason, since the
   * data behind a mark or a widget lives outside the document.
   *
   * @param path the one document to reach, or nothing for every editor.
   * @returns how many editors the effect reached.
   */
  #decorateAgain(path?: string): number {
    if (!this.#active) return 0;
    return dispatchToMarkdownEditors(
      this.#app,
      citekeyDecorationsChanged.of(undefined),
      { path },
    );
  }

  #applySettings(settings: Readonly<Settings>): void {
    // Read straight through: hover answers from the newest snapshot, and
    // nothing drawn depends on it.
    this.#hover = hoverPreferences(settings);
    this.#applyAnnotationLinks(settings["citation.annotation-links"]);
    const pandocCitations = settings["citation.pandoc-citations"];
    const navigationEnabled =
      pandocCitations && settings["citation.open-as-links"];
    const showFormatted =
      pandocCitations && settings["citation.show-formatted"];
    const active = navigationEnabled || showFormatted;
    if (
      active === this.#active &&
      navigationEnabled === this.#navigationEnabled &&
      showFormatted === this.#showFormatted
    ) {
      return;
    }
    const activeChanged = active !== this.#active;
    const treatmentChanged =
      navigationEnabled !== this.#navigationEnabled ||
      showFormatted !== this.#showFormatted;
    this.#active = active;
    this.#navigationEnabled = navigationEnabled;
    this.#showFormatted = showFormatted;
    if (activeChanged) {
      this.#extensions.length = 0;
      if (active) this.#extensions.push(this.#extension);
      this.#app.workspace.updateOptions();
    } else if (treatmentChanged) {
      this.#decorateAgain();
    }
    if (activeChanged) {
      logger.info(
        active ? "Citekey editor enabled" : "Citekey editor disabled",
      );
    } else {
      logger.debug("Citekey editor treatment changed", {
        navigationEnabled,
        showFormatted,
      });
    }
  }

  /**
   * Holds the annotation link hover while ZotLit treats Durable Annotation
   * Links, so with the setting off an editor runs none of it.
   */
  #applyAnnotationLinks(enabled: boolean): void {
    if (enabled === this.#annotationLinkExtensions.length > 0) return;
    this.#annotationLinkExtensions.length = 0;
    if (enabled) this.#annotationLinkExtensions.push(this.#annotationLinkHover);
    this.#app.workspace.updateOptions();
    logger.debug(
      enabled
        ? "Annotation link hover enabled"
        : "Annotation link hover disabled",
    );
  }

  /** The palette commands gate on this independently from presentation. */
  get navigationEnabled(): boolean {
    return this.#navigationEnabled;
  }

  /**
   * The Literature Note a page preview may show: the one note indexed under
   * the Indexed Key a citekey resolves to. A citekey with zero or several
   * notes answers with nothing, which keeps every preview path clear of the
   * create-then-open flow. An Ambiguous Citation Key names no one Item, so it
   * answers with nothing too.
   */
  hoverNotePath(
    citekey: string,
    lookup?: CitationLookupAnswer | null,
  ): string | null {
    const item = lookup ? this.#uniqueItem(citekey, lookup) : null;
    if (!item) return null;
    const matches = this.#noteIndex.getNotesByItemKey(item.indexedKey);
    return matches.length === 1 ? matches[0]!.path : null;
  }

  /**
   * The Zotero Item a citekey names decides what opens: an existing note for
   * its Indexed Key wins, and only an Item with no note at all creates one. A
   * citekey naming several Items opens nothing by itself — it reports its
   * candidates, and the choice opens one of them exactly.
   */
  async openCitekey(citekey: string, pane: NavigationPane): Promise<void> {
    let lookup: CitationLookupAnswer;
    try {
      [, lookup] = await Promise.all([
        this.#noteIndex.whenIndexed(),
        this.#citationLookup.read({ citekeys: [citekey] }),
      ]);
    } catch (error) {
      logger.warn("Cannot resolve citekey for navigation", { citekey, error });
      this.#emitter.emit("db-unavailable", citekey);
      return;
    }

    const resolved = lookup.resolve(citekey);
    if (resolved.kind === "ambiguous") {
      logger.debug("Citekey names several items", {
        citekey,
        candidates: resolved.candidates.length,
      });
      this.#emitter.emit("citekey-ambiguous", {
        citekey,
        candidates: await describeCandidates(
          { db: this.#db, libraryScope: this.#libraryScope },
          resolved.candidates,
        ),
        pane,
      });
      return;
    }
    if (resolved.kind === "missing") {
      if (this.#db.state !== "ready") {
        logger.debug("Citekey open blocked", {
          citekey,
          branch: "db-unavailable",
        });
        this.#emitter.emit("db-unavailable", citekey);
        return;
      }
      logger.debug("Citekey open blocked", {
        citekey,
        branch: "citekey-not-found",
      });
      this.#emitter.emit("citekey-not-found", citekey);
      return;
    }

    await this.#openItem(resolved.item, pane, citekey);
  }

  /**
   * Opens one candidate of an Ambiguous Citation Key by its exact Indexed Key.
   * The candidate already carries the identity the picker showed, so the
   * Citation Key is never resolved again and the choice cannot re-enter
   * ambiguity.
   */
  async openCandidate(
    candidate: AmbiguousCandidate,
    pane: NavigationPane,
  ): Promise<void> {
    await this.#noteIndex.whenIndexed();
    await this.#openItem(candidate, pane);
  }

  /** Opens an exact Item using current database identity and Literature Note paths. */
  async openIndexedKey(
    indexedKey: string,
    pane: NavigationPane,
  ): Promise<void> {
    await this.#noteIndex.whenIndexed();
    if (this.#db.state === "degraded") {
      this.#emitter.emit("item-unavailable", "database");
      return;
    }
    let item;
    try {
      item = await this.#readItem(indexedKey);
    } catch (error) {
      logger.warn("Cannot read Item for navigation", { indexedKey, error });
      this.#emitter.emit("item-unavailable", "database");
      return;
    }
    if (!item) {
      this.#emitter.emit("item-unavailable", "item");
      return;
    }
    await this.#openItem(item, pane);
  }

  /** The live Item an Indexed Key names, or `undefined` when none does. */
  async #readItem(indexedKey: string) {
    const { reads } = this.#db;
    const items = await Effect.runPromise(
      reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
    );
    return items.get(indexedKey);
  }

  /**
   * @param citekey the key the Item was reached by, for the not-found report
   *   an exact candidate has no key to name.
   */
  async #openItem(
    item: SnapshotItem,
    pane: NavigationPane,
    citekey?: string,
  ): Promise<void> {
    const { workspace } = this.#app;
    const existing = resolveLiteratureNoteWithWarning(
      this.#noteIndex.getNotesByItemKey(item.indexedKey),
    );
    if (existing) {
      logger.debug("Opened citekey note", {
        indexedKey: item.indexedKey,
        path: existing.path,
        branch: "existing",
      });
      await workspace.openLinkText(existing.path, "", pane, {
        active: true,
      });
      return;
    }

    const zoteroItem = await this.#readItem(item.indexedKey);
    if (!zoteroItem) {
      logger.debug("Citekey open blocked", {
        indexedKey: item.indexedKey,
        branch: "citekey-not-found",
      });
      this.#emitter.emit("citekey-not-found", citekey ?? item.key);
      return;
    }

    const file = await createNoteInteractively(
      {
        app: this.#app,
        noteFeature: this.#noteFeature,
        createProfile: this.#createProfile,
        importProfile: this.#importProfile,
        zoteroPref: this.#zoteroPref,
      },
      zoteroItem,
      { direct: true },
    );
    if (!file) {
      logger.debug("Citekey note creation cancelled", {
        indexedKey: item.indexedKey,
      });
      return;
    }
    logger.debug("Created citekey note", {
      indexedKey: item.indexedKey,
      path: file.path,
    });
    await workspace.openLinkText(file.path, "", pane, { active: true });
  }
}
