// The Wikilink Reading Rendering service: it registers the Markdown
// post-processor, answers which Literature Note a linkpath names, and asks the
// open reading views to render again when something outside their documents
// changed the answer.

import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import { rerenderReadingViews } from "@/lib/reading-view";
import {
  WikilinkDisplaySettings,
  wikilinkDisplayText,
} from "@/lib/wikilink-citation";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";

import { renderWikilinkCitations } from "./render";

const logger = getLogger("wikilink-reading");

export interface WikilinkReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  noteIndex: Pick<NoteIndex, "on">;
  settings: SettingsService;
}

/**
 * The Wikilink Reading Rendering: in reading mode a Literature Note wikilink's
 * display text becomes its Citation Display Text, while the link's target,
 * navigation, and hover stay Obsidian's.
 *
 * A post-processor stays registered for the plugin's lifetime, so the toggles
 * are read per render rather than by adding and removing it: a wikilink
 * carrying a Citation Fragment is rendered whatever the settings say, and only
 * the fragment-less half of the treatment is a toggle.
 *
 * Two behavior changes come with replacing an anchor's text, both intended and
 * documented for the user: dragging such a link out of reading mode and the
 * context menu's Copy carry the Citation Display Text rather than the raw path.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
export class WikilinkReading extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #settings;

  /** The two settings that decide what a link displays. */
  readonly #display = new WikilinkDisplaySettings();
  /** Set on disposal, which retires the treatment the post-processor applies. */
  #retired = false;

  ready: Promise<void>;

  constructor(deps: WikilinkReadingDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    this.#plugin.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
    stack.defer(this.#display.watch(this.#settings, () => this.#rerender()));
    // Creating, deleting, or renaming a Literature Note, or editing its
    // Citation Key Property, changes what a link displays without changing any
    // document; the Note Index's own invalidation is coarse, so every change
    // renders every open reading view again.
    stack.defer(this.#noteIndex.on("changed", () => this.#rerender()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#rerender()));
    // A reading view holds the text this service wrote, so the views render
    // again without it once it is gone. The flag goes first: the post-processor
    // may still be registered while this runs.
    stack.defer(() => {
      this.#retired = true;
      this.#rerender();
    });

    this.commit(stack.move());
  }

  /** Shows the Citation Display Text of every wikilink in one rendered section. */
  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#retired) return;
    const shown = renderWikilinkCitations(el, (linktext) =>
      wikilinkDisplayText(linktext, {
        literatureNote: (linkpath) =>
          resolveLiteratureNote(linkpath, ctx.sourcePath, {
            app: this.#app,
            citationKeyProperty: this.#display.citationKeyProperty,
          }),
        fragmentlessDisplay: this.#display.fragmentlessDisplay,
      }),
    );
    if (shown > 0) {
      logger.trace("Rendered wikilink citations", {
        path: ctx.sourcePath,
        count: shown,
      });
    }
  }

  /** A reading view holds what a post-processor produced until it renders again. */
  #rerender(): void {
    const count = rerenderReadingViews(this.#app);
    logger.debug("Rerendering reading views", { count });
  }
}
