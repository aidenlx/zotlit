// The Wikilink Editor Treatment service: it registers the CodeMirror extension,
// answers which Literature Note a linkpath names, and asks the open editors to
// draw again when something outside their documents changed the answer.

import type { Extension } from "@codemirror/state";
import type { App, Plugin } from "obsidian";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import { getLogger } from "@/lib/log";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type { LiteratureNoteTarget } from "./decorate";
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

  #fragmentlessDisplay = false;
  #citationKeyProperty: string | null = null;

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
      fragmentlessDisplay: () => this.#fragmentlessDisplay,
    });
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    // SettingsService.subscribe invokes its listener immediately with this
    // same snapshot, so seeding the state here makes that first callback a
    // no-op instead of a startup redraw.
    const settings = this.#settings.current;
    if (settings) {
      const seed = WikilinkEditor.#readSettings(settings);
      this.#fragmentlessDisplay = seed.fragmentlessDisplay;
      this.#citationKeyProperty = seed.citationKeyProperty;
    }

    this.#plugin.registerEditorExtension(this.#extensions);
    this.#extensions.push(this.#extension);
    this.#app.workspace.updateOptions();
    stack.defer(() => {
      this.#extensions.length = 0;
      this.#app.workspace.updateOptions();
    });

    stack.defer(
      this.#settings.subscribe((next) => {
        if (next) this.#applySettings(next);
      }),
    );
    // Creating, deleting, or renaming a Literature Note, or editing its
    // Citation Key Property, changes what a link displays without changing any
    // document; the Note Index's own invalidation is coarse, so every change
    // redraws every open editor.
    stack.defer(this.#noteIndex.on("changed", () => this.#redraw()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#redraw()));

    this.commit(stack.move());
  }

  /**
   * Everything the decoration build reads out of the settings. Wikilink
   * Citations is the master switch for reading wikilinks as Citations at all;
   * the display toggle decides whether the fragment-less ones show their
   * Citation Display Text.
   */
  static #readSettings(settings: Readonly<Settings>): {
    fragmentlessDisplay: boolean;
    citationKeyProperty: string;
  } {
    return {
      fragmentlessDisplay:
        settings["citation.wikilink-citations"] &&
        settings["citation.wikilink-display"],
      citationKeyProperty: settings["citation.key-links-frontmatter-key"],
    };
  }

  #applySettings(settings: Readonly<Settings>): void {
    const next = WikilinkEditor.#readSettings(settings);
    if (
      next.fragmentlessDisplay === this.#fragmentlessDisplay &&
      next.citationKeyProperty === this.#citationKeyProperty
    ) {
      return;
    }
    this.#fragmentlessDisplay = next.fragmentlessDisplay;
    this.#citationKeyProperty = next.citationKeyProperty;
    logger.debug("Wikilink display settings changed", next);
    this.#redraw();
  }

  #literatureNote(
    linkpath: string,
    sourcePath: string,
  ): LiteratureNoteTarget | null {
    return resolveLiteratureNote(linkpath, sourcePath, {
      app: this.#app,
      citationKeyProperty: this.#citationKeyProperty,
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
