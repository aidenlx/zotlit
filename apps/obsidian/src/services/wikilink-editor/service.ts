// The Wikilink Editor Treatment service: it registers the CodeMirror extension,
// answers which Literature Note a linkpath names, and asks the open editors to
// draw again when something outside their documents changed the answer.

import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import { getLogger } from "@/lib/log";
import { WikilinkDisplaySettings } from "@/lib/wikilink-citation";
import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationText } from "@/services/citation-text/service";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";

import {
  wikilinkDecorationsChanged,
  wikilinkEditorExtension,
} from "./extension";

const logger = getLogger("wikilink-editor");

export interface WikilinkEditorDeps {
  app: App;
  plugin: Pick<Plugin, "registerEditorExtension">;
  noteIndex: Pick<NoteIndex, "on">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "peek" | "load" | "on">;
  settings: SettingsService;
  citationIndex: Pick<CitationIndex, "citekeyOf" | "on">;
}

/**
 * The Wikilink Editor Treatment: in Live Preview a Literature Note wikilink —
 * and a whole Citation Run of them — shows the citation a style formatted, or
 * its Citation Display Text until that render lands, while click, hover, drag,
 * and conceal interaction stay Obsidian's.
 *
 * The extension is registered as a mutable array, the mechanism
 * `registerEditorExtension` documents, and stays installed for the plugin's
 * lifetime. Source and display choices are read per decoration build, so a
 * setting change needs no extension re-registration.
 */
export class WikilinkEditor extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #citationText;
  readonly #settings;
  readonly #citationIndex;
  readonly #extension: Extension;

  /** Registered once; emptied on disposal, which retires the treatment. */
  readonly #extensions: Extension[] = [];

  /** The source and display settings that decide what a link displays. */
  readonly #display = new WikilinkDisplaySettings();

  ready: Promise<void>;

  constructor(deps: WikilinkEditorDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#citationText = deps.citationText;
    this.#settings = deps.settings;
    this.#citationIndex = deps.citationIndex;
    this.#extension = wikilinkEditorExtension({
      literatureNote: (linkpath, sourcePath) =>
        this.#literatureNote(linkpath, sourcePath),
      enabled: () => this.#display.enabled,
      fragmentlessDisplay: () => this.#display.fragmentlessDisplay,
      citationText: (path) => this.#citationText.peek(path),
      requestCitationText: (file) => {
        // The read announces itself when it settles, which is what brings the
        // formatted citations in.
        void this.#citationText.load(file);
      },
    });
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    this.#plugin.registerEditorExtension(this.#extensions);
    this.#extensions.push(this.#extension);
    this.#app.workspace.updateOptions();
    stack.defer(() => {
      this.#extensions.length = 0;
      this.#app.workspace.updateOptions();
    });

    stack.defer(this.#display.watch(this.#settings, () => this.#redraw()));
    // Creating, deleting, or renaming a Literature Note, or a citekey
    // resolution snapshot rebuild, changes what a link displays without
    // changing any document; the Note Index's own invalidation is coarse, so
    // every change redraws every open editor.
    stack.defer(this.#noteIndex.on("changed", () => this.#redraw()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#redraw()));
    stack.defer(
      this.#citationIndex.on("resolution-changed", () => this.#redraw()),
    );
    // A citation's formatted text is read asynchronously and shared with every
    // other surface, so the editors showing that document draw again when it
    // lands or goes stale — until then they keep the Citation Display Text.
    stack.defer(this.#citationText.on("changed", (path) => this.#redraw(path)));
    stack.defer(this.#citationText.on("invalidated", () => this.#redraw()));

    this.commit(stack.move());
  }

  #literatureNote(
    linkpath: string,
    sourcePath: string,
  ): LiteratureNoteTarget | null {
    const note = resolveLiteratureNote(linkpath, sourcePath, {
      app: this.#app,
    });
    return (
      note && {
        ...note,
        citationKey: this.#citationIndex.citekeyOf(note.indexedKey),
      }
    );
  }

  /**
   * Asks the open Markdown editors to build their decorations again. The
   * decoration layer owns what changed; this only names the reason, since what
   * a link displays lives outside the document.
   *
   * @param path the one document to reach, or nothing for every editor.
   */
  #redraw(path?: string): void {
    const reached = dispatchToMarkdownEditors(
      this.#app,
      wikilinkDecorationsChanged.of(undefined),
      { path },
    );
    logger.trace("Redrawing wikilink citations", { editors: reached, path });
  }
}
