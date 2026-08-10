// The citekey editor treatment service: it follows the settings that switch the
// CodeMirror extension on and owns the click that opens a citekey's note.

import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { getItemsByID } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationText } from "@/services/citation-text/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { NavigationPane } from "@/services/citekey-navigation";
import type { DatabaseService } from "@/services/database/service";
import type { NoteFeature } from "@/services/note-feature";
import { createNoteWithToast } from "@/services/note-feature/update-single";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { citekeyDecorationsChanged, citekeyEditorExtension } from "./extension";

const logger = getLogger("citekey-editor");

export interface CitekeyEditorDeps {
  app: App;
  plugin: Pick<Plugin, "registerEditorExtension" | "registerHoverLinkSource">;
  noteIndex: NoteIndex;
  noteFeature: NoteFeature;
  db: DatabaseService;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "peek" | "load" | "on">;
  settings: SettingsService;
  citationIndex: Pick<CitationIndex, "resolveCitekey" | "on" | "whenResolved">;
}

interface CitekeyEditorEvents {
  "db-unavailable": (citekey: string) => void;
  "citekey-not-found": (citekey: string) => void;
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
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #noteFeature;
  readonly #db;
  readonly #citationText;
  readonly #settings;
  readonly #citationIndex;
  readonly #emitter = createNanoEvents<CitekeyEditorEvents>();
  readonly #extension: Extension;

  /** Registered once; its contents are the on/off switch. */
  readonly #extensions: Extension[] = [];

  #active = false;
  #navigationEnabled = false;
  #showFormatted = false;

  ready: Promise<void>;

  constructor(deps: CitekeyEditorDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#noteFeature = deps.noteFeature;
    this.#db = deps.db;
    this.#citationText = deps.citationText;
    this.#settings = deps.settings;
    this.#citationIndex = deps.citationIndex;
    this.#extension = citekeyEditorExtension({
      open: (citekey, pane) => {
        void this.openCitekey(citekey, pane);
      },
      hoverNotePath: (citekey) => this.hoverNotePath(citekey),
      resolves: (citekey) => this.#resolves(citekey),
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
    // Page preview settings stays put while the treatment toggles.
    this.#plugin.registerHoverLinkSource(CITEKEY_HOVER_SOURCE, {
      display: m.hover_source_citekey(),
      defaultMod: false,
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

  #resolves(citekey: string): boolean {
    return this.#citationIndex.resolveCitekey(citekey) !== null;
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
    const pandocCitations = settings["citation.pandoc-citations"];
    const navigationEnabled =
      pandocCitations && settings["citation.open-pandoc-links"];
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
   * The Literature Note a hover preview may show: the one note indexed under
   * the Indexed Key a citekey resolves to. A citekey with zero or several
   * notes answers with nothing, which keeps every popover path clear of the
   * create-then-open flow.
   */
  hoverNotePath(citekey: string): string | null {
    const item = this.#citationIndex.resolveCitekey(citekey);
    if (!item) return null;
    const matches = this.#noteIndex.getNotesByItemKey(item.indexedKey);
    return matches.length === 1 ? matches[0]!.path : null;
  }

  /**
   * The Zotero Item a citekey names decides what opens: an existing note for
   * its Indexed Key wins, and only an Item with no note at all creates one.
   */
  async openCitekey(citekey: string, pane: NavigationPane): Promise<void> {
    const { workspace } = this.#app;
    await Promise.all([
      this.#noteIndex.whenIndexed(),
      this.#citationIndex.whenResolved(),
    ]);

    const item = this.#citationIndex.resolveCitekey(citekey);
    if (!item) {
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

    const existing = this.#noteIndex.getNotesByItemKey(item.indexedKey)[0];
    if (existing) {
      logger.debug("Opened citekey note", {
        citekey,
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
        citekey,
        branch: "citekey-not-found",
      });
      this.#emitter.emit("citekey-not-found", citekey);
      return;
    }

    const file = await createNoteWithToast(this.#noteFeature, zoteroItem);
    if (!file) {
      logger.debug("Citekey note creation cancelled", { citekey });
      return;
    }
    logger.debug("Created citekey note", { citekey, path: file.path });
    await workspace.openLinkText(file.path, "", pane, { active: true });
  }
}
