import type { Extension } from "@codemirror/state";
// The citekey editor treatment service: it follows the settings that switch the
// CodeMirror extension on and owns the click that opens a citekey's note.
import type { App, Plugin } from "obsidian";

import { getItemsByID } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { describeCandidates } from "@/services/citation-index/ambiguity";
import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";
import type {
  CitationIndex,
  SnapshotItem,
} from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import type { CitationText } from "@/services/citation-text/service";
import {
  CITEKEY_HOVER_SOURCE,
  hoverPreferences,
} from "@/services/citekey-navigation";
import type {
  HoverPreferences,
  NavigationPane,
} from "@/services/citekey-navigation";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { NoteFeature } from "@/services/note-feature";
import { createNoteInteractively } from "@/services/note-feature";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ImportProfile, CreateProfile } from "@/setting-tab/profiles";

import { citekeyDecorationsChanged, citekeyEditorExtension } from "./extension";

const logger = getLogger("citekey-editor");

export interface CitekeyEditorDeps {
  createProfile: CreateProfile;
  importProfile: ImportProfile;
  app: App;
  plugin: Pick<Plugin, "registerEditorExtension" | "registerHoverLinkSource">;
  noteIndex: NoteIndex;
  noteFeature: NoteFeature;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  db: DatabaseService;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "peek" | "load" | "on">;
  /** What a hovered citation shows. */
  citationPopover: CitationPopover;
  settings: SettingsService;
  citationIndex: Pick<CitationIndex, "resolveCitekey" | "on" | "whenResolved">;
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: Pick<LibraryScopeService, "current">;
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
  readonly #citationPopover;
  readonly #settings;
  readonly #citationIndex;
  readonly #libraryScope;
  readonly #emitter = createNanoEvents<CitekeyEditorEvents>();
  readonly #extension: Extension;

  /** Registered once; its contents are the on/off switch. */
  readonly #extensions: Extension[] = [];

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
    this.#citationPopover = deps.citationPopover;
    this.#settings = deps.settings;
    this.#citationIndex = deps.citationIndex;
    this.#libraryScope = deps.libraryScope;
    this.#extension = citekeyEditorExtension({
      open: (citekey, pane) => {
        void this.openCitekey(citekey, pane);
      },
      showPopover: (request) => this.#citationPopover.show(request),
      hoverPreferences: () => this.#hover,
      hoverNotePath: (citekey) => this.hoverNotePath(citekey),
      resolveCitekey: (citekey) => this.#citationIndex.resolveCitekey(citekey),
      navigationEnabled: () => this.#navigationEnabled,
      showFormatted: () => this.#showFormatted,
      citationText: (path) => this.#citationText.peek(path),
      requestCitationText: (file) => {
        // The read announces itself when it settles, which is what brings the
        // widgets in.
        void this.#citationText.load(file);
      },
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
    await this.#settings.ready;

    // Registered once and for the plugin's lifetime, so the row in Obsidian's
    // Page preview settings stays put while the Hover Action changes. Mod is
    // the platform convention for a citation, and Obsidian's own row owns that
    // gate wherever ZotLit hands hover to the page preview.
    this.#plugin.registerHoverLinkSource(CITEKEY_HOVER_SOURCE, {
      display: m.hover_source_citekey(),
      defaultMod: true,
    });
    this.#plugin.registerEditorExtension(this.#extensions);
    stack.defer(() => {
      this.#extensions.length = 0;
      this.#app.workspace.updateOptions();
    });
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    // A citekey resolution snapshot rebuild can flip whether a citekey
    // resolves at all, so every rebuild restyles every open editor.
    stack.defer(
      this.#citationIndex.on("resolution-changed", () =>
        this.#restyleEditors(),
      ),
    );
    // A widget's text is read asynchronously and shared with every other
    // surface, so the editors showing that document draw again when it lands
    // or goes stale — until then they keep the raw marked source.
    stack.defer(
      this.#citationText.on("changed", (path) => this.#redrawWidgets(path)),
    );
    stack.defer(
      this.#citationText.on("invalidated", () => this.#redrawWidgets()),
    );

    this.commit(stack.move());
  }

  /**
   * The one Item a citekey names. An Ambiguous Citation Key answers with
   * nothing: it adopts no candidate's identity, so every surface reading this
   * treats it as a key that opens no single Item.
   */
  #uniqueItem(citekey: string): SnapshotItem | null {
    const resolved = this.#citationIndex.resolveCitekey(citekey);
    return resolved.kind === "unique" ? resolved.item : null;
  }

  #restyleEditors(): void {
    const editors = this.#decorateAgain();
    logger.trace("Restyling citekey marks", { editors });
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
  hoverNotePath(citekey: string): string | null {
    const item = this.#uniqueItem(citekey);
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
    await Promise.all([
      this.#noteIndex.whenIndexed(),
      this.#citationIndex.whenResolved(),
    ]);

    const resolved = this.#citationIndex.resolveCitekey(citekey);
    if (resolved.kind === "ambiguous") {
      logger.debug("Citekey names several items", {
        citekey,
        candidates: resolved.candidates.length,
      });
      this.#emitter.emit("citekey-ambiguous", {
        citekey,
        candidates: describeCandidates(
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

    const [zoteroItem] = getItemsByID(this.#db.client, [item.itemID]);
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
