// The Wikilink Reading Rendering service: it registers the Markdown
// post-processor, answers which Literature Note a linkpath names, and asks the
// open reading views to render again when something outside their documents
// changed the answer.

import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import { rerenderReadingViews } from "@/lib/reading-view";
import {
  WikilinkDisplaySettings,
  runDisplay,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import type { CitationIndex } from "@/services/citation-index/service";
import {
  citationContent,
  citationInsert,
} from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";

import {
  markLiteratureNoteLinks,
  renderCitationRuns,
  sectionCitationRuns,
} from "./render";

const logger = getLogger("wikilink-reading");

export interface WikilinkReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  noteIndex: Pick<NoteIndex, "on">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "load" | "on">;
  settings: SettingsService;
  citationIndex: Pick<CitationIndex, "citekeyOf" | "on">;
}

/**
 * The Wikilink Reading Rendering: in reading mode a Literature Note wikilink —
 * and a whole Citation Run of them — shows the citation a style formatted, or
 * its Citation Display Text until that render lands, while the link's target,
 * navigation, and hover stay Obsidian's.
 *
 * A post-processor stays registered for the plugin's lifetime, so source and
 * display choices are read per render rather than by adding and removing it.
 *
 * Two behavior changes come with replacing an anchor's text, both intended and
 * documented for the user: dragging such a link out of reading mode and the
 * context menu's Copy carry the rendered citation rather than the raw path.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
export class WikilinkReading extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #citationText;
  readonly #settings;
  readonly #citationIndex;

  /** The source and display settings that decide what a link displays. */
  readonly #display = new WikilinkDisplaySettings();
  /** Set on disposal, which retires the treatment the post-processor applies. */
  #retired = false;

  ready: Promise<void>;

  constructor(deps: WikilinkReadingDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#citationText = deps.citationText;
    this.#settings = deps.settings;
    this.#citationIndex = deps.citationIndex;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    // The promise is handed back, so Obsidian shows the section only once the
    // citations settled and no raw source ever flashes.
    this.#plugin.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
    stack.defer(this.#display.watch(this.#settings, () => this.#rerender()));
    // Creating, deleting, or renaming a Literature Note, or a citekey
    // resolution snapshot rebuild, changes what a link displays without
    // changing any document; the Note Index's own invalidation is coarse, so
    // every change renders every open reading view again.
    stack.defer(this.#noteIndex.on("changed", () => this.#rerender()));
    stack.defer(this.#noteIndex.on("rebuilt", () => this.#rerender()));
    stack.defer(
      this.#citationIndex.on("resolution-changed", () => this.#rerender()),
    );
    // A reading view holds what a post-processor produced, so text that went
    // stale keeps showing until the view renders that section again.
    stack.defer(this.#citationText.on("invalidated", () => this.#rerender()));
    // A reading view holds the text this service wrote, so the views render
    // again without it once it is gone. The flag goes first: the post-processor
    // may still be registered while this runs.
    stack.defer(() => {
      this.#retired = true;
      this.#rerender();
    });

    this.commit(stack.move());
  }

  /** Shows every wikilink Citation of one rendered section as its own text. */
  async #process(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    if (this.#retired) return;
    const literatureNote = (linkpath: string) => {
      const note = resolveLiteratureNote(linkpath, ctx.sourcePath, {
        app: this.#app,
      });
      return (
        note && {
          ...note,
          citationKey: this.#citationIndex.citekeyOf(note.indexedKey),
        }
      );
    };
    markLiteratureNoteLinks(el, literatureNote);
    const runs = sectionCitationRuns(el, (linktext) =>
      wikilinkCitation(linktext, {
        literatureNote,
        enabled: this.#display.enabled,
        fragmentlessDisplay: this.#display.fragmentlessDisplay,
      }),
    );
    if (runs.length === 0) return;

    // Read only once a Citation is on screen, so a section that writes none
    // waits for nothing. The section is shown when the read settles, which is
    // what keeps the raw source from ever flashing.
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    const text = file === null ? null : await this.#citationText.load(file);
    if (this.#retired) return;

    const shown = renderCitationRuns(runs, (run) => {
      const { citation, text: displayText } = runDisplay(run);
      const formatted = text === null ? null : citationContent(citation, text);
      return formatted === null ? displayText : citationInsert(formatted);
    });
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
