// The Wikilink Editor Treatment service: it registers the CodeMirror extension,
// answers which Literature Note a linkpath names, and asks the open editors to
// draw again when something outside their documents changed the answer.

import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import { getLogger } from "@/lib/log";
import { WikilinkDisplaySettings } from "@/lib/wikilink-citation";
import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";
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
  settings: SettingsService;
}

/**
 * The Wikilink Editor Treatment: in Live Preview a Literature Note wikilink
 * shows its Citation Display Text instead of its raw path and Citation
 * Fragment, while click, hover, drag, and conceal interaction stay Obsidian's.
 *
 * The extension is registered as a mutable array, the mechanism
 * `registerEditorExtension` documents, and stays installed for the plugin's
 * lifetime: a wikilink carrying a Citation Fragment is decorated whatever the
 * settings say, so only the fragment-less half of the treatment is a toggle,
 * and that half is decided per link while the decorations are built.
 */
export class WikilinkEditor extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #settings;
  readonly #extension: Extension;

  /** Registered once; emptied on disposal, which retires the treatment. */
  readonly #extensions: Extension[] = [];

  /** The two settings that decide what a link displays. */
  readonly #display = new WikilinkDisplaySettings();

  ready: Promise<void>;

  constructor(deps: WikilinkEditorDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#settings = deps.settings;
    this.#extension = wikilinkEditorExtension({
      literatureNote: (linkpath, sourcePath) =>
        this.#literatureNote(linkpath, sourcePath),
      fragmentlessDisplay: () => this.#display.fragmentlessDisplay,
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
    // Creating, deleting, or renaming a Literature Note, or editing its
    // Citation Key Property, changes what a link displays without changing any
    // document; the Note Index's own invalidation is coarse, so every change
    // redraws every open editor.
    stack.defer(this.#noteIndex.on("changed", () => this.#redraw()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#redraw()));

    this.commit(stack.move());
  }

  #literatureNote(
    linkpath: string,
    sourcePath: string,
  ): LiteratureNoteTarget | null {
    return resolveLiteratureNote(linkpath, sourcePath, {
      app: this.#app,
      citationKeyProperty: this.#display.citationKeyProperty,
    });
  }

  /**
   * Asks the open Markdown editors to build their decorations again. The
   * decoration layer owns what changed; this only names the reason, since what
   * a link displays lives outside the document.
   */
  #redraw(): void {
    const reached = dispatchToMarkdownEditors(
      this.#app,
      wikilinkDecorationsChanged.of(undefined),
    );
    logger.trace("Redrawing wikilink citations", { editors: reached });
  }
}
