// The citekey editor treatment service: it follows the settings that switch the
// CodeMirror extension on and owns the click that opens a citekey's note.

import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { getItemIDByCitekey, getItemsByID, USER_LIBRARY_ID } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
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
}

interface CitekeyEditorEvents {
  "missing-property": (property: string) => void;
  "db-unavailable": (citekey: string) => void;
  "citekey-not-found": (citekey: string) => void;
}

/**
 * The citekey editor treatment: literal Pandoc `@citekey` text is marked in the
 * editor and opens its Literature Note on click — the note the Citation Key
 * Property points at, or a note created from the matching Zotero Item.
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
  readonly #emitter = createNanoEvents<CitekeyEditorEvents>();
  readonly #extension: Extension;

  /** Registered once; its contents are the on/off switch. */
  readonly #extensions: Extension[] = [];

  #enabled = false;
  #missingProperty: string | null = null;

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
    this.#extension = citekeyEditorExtension({
      open: (citekey, pane) => {
        void this.openCitekey(citekey, pane);
      },
      hoverNotePath: (citekey) => this.hoverNotePath(citekey),
      resolves: (citekey) => this.#resolves(citekey),
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
    // Creating, deleting, or renaming a Literature Note, or editing its
    // Citation Key Property, can flip a citekey's resolution; the Note Index's
    // own invalidation is coarse, so every change restyles every open editor.
    stack.defer(this.#noteIndex.on("changed", () => this.#restyleEditors()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#restyleEditors()));
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
    return this.#noteIndex.getNotesByCitationKey(citekey).length > 0;
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
    if (!this.#enabled) return 0;
    return dispatchToMarkdownEditors(
      this.#app,
      citekeyDecorationsChanged.of(undefined),
      { path },
    );
  }

  #applySettings(settings: Readonly<Settings>): void {
    // Citekey Indexing is the master switch for every literal-citekey surface,
    // so the treatment runs only while both it and the editor toggle are on.
    const enabled =
      settings["citation.citekey-indexing"] &&
      settings["citation.citekey-editor"];
    const property = settings["citation.key-links-frontmatter-key"];
    const missingProperty =
      enabled &&
      !settings["note.frontmatter-fields"].some(
        (field) => field.key === property,
      )
        ? property
        : null;
    if (missingProperty !== null && missingProperty !== this.#missingProperty) {
      this.#emitter.emit("missing-property", property);
    }
    this.#missingProperty = missingProperty;

    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    this.#extensions.length = 0;
    if (enabled) this.#extensions.push(this.#extension);
    this.#app.workspace.updateOptions();
    logger.info(enabled ? "Citekey editor enabled" : "Citekey editor disabled");
  }

  /**
   * Whether the editor treatment runs: Citekey Indexing and the citekey
   * editor toggle are both on. The palette commands gate on it.
   */
  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * The Literature Note a hover preview may show: the one note indexed under
   * `citekey`. A key with zero or several notes answers with nothing, which
   * keeps every popover path clear of the create-then-open flow.
   */
  hoverNotePath(citekey: string): string | null {
    const matches = this.#noteIndex.getNotesByCitationKey(citekey);
    return matches.length === 1 ? matches[0]!.path : null;
  }

  /**
   * A citekey with exactly one indexed Literature Note opens it directly.
   * Otherwise the Zotero Item decides: an existing note for its Indexed Key
   * wins, and only a key with no note at all creates one.
   */
  async openCitekey(citekey: string, pane: NavigationPane): Promise<void> {
    const { workspace } = this.#app;
    await this.#noteIndex.whenIndexed();

    const directMatches = this.#noteIndex.getNotesByCitationKey(citekey);
    if (directMatches.length === 1) {
      const existing = directMatches[0]!;
      logger.debug("Opened citekey note", {
        citekey,
        path: existing.path,
        branch: "direct",
      });
      await workspace.openLinkText(existing.path, "", pane, {
        active: true,
      });
      return;
    }

    if (this.#db.state !== "ready") {
      logger.debug("Citekey open blocked", {
        citekey,
        branch: "db-unavailable",
      });
      this.#emitter.emit("db-unavailable", citekey);
      return;
    }
    const item = this.#resolveItem(citekey);
    if (!item) {
      logger.debug("Citekey open blocked", {
        citekey,
        branch: "citekey-not-found",
      });
      this.#emitter.emit("citekey-not-found", citekey);
      return;
    }

    const authoritative = this.#noteIndex.getNotesByItemKey(item.indexedKey)[0];
    if (authoritative) {
      logger.debug("Opened citekey note", {
        citekey,
        path: authoritative.path,
        branch: "authoritative",
      });
      await workspace.openLinkText(authoritative.path, "", pane, {
        active: true,
      });
      return;
    }

    const file = await createNoteWithToast(this.#noteFeature, item);
    if (!file) {
      logger.debug("Citekey note creation cancelled", { citekey });
      return;
    }
    logger.debug("Created citekey note", { citekey, path: file.path });
    await workspace.openLinkText(file.path, "", pane, { active: true });
  }

  /** Resolve the Zotero item for `citekey` in the configured citation library. */
  #resolveItem(citekey: string): Item | null {
    const client = this.#db.client;
    const libraryID =
      this.#settings.current?.["zotero.citation-library"] ?? USER_LIBRARY_ID;
    const itemID = getItemIDByCitekey(client, libraryID, citekey);
    if (itemID == null) return null;
    const [item] = getItemsByID(client, [itemID]);
    return item ?? null;
  }
}
