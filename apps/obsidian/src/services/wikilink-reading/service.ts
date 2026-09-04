// The Wikilink Reading Rendering service: it registers the Markdown
// post-processor, answers which Literature Note a linkpath names, and asks the
// open reading views to render again when something outside their documents
// changed the answer.

import { MarkdownView, setTooltip } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { renderProfileRecovery } from "@/lib/profile-recovery";
import { rerenderReadingViews, sectionRange } from "@/lib/reading-view";
import {
  WikilinkDisplaySettings,
  citationOfRun,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import type { RunMember } from "@/lib/wikilink-citation";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import {
  citationContent,
  sectionCoordinates,
} from "@/services/citation-text/present";
import type { ShownCitation } from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import {
  clickWikilinkCitation,
  hoverWikilinkCitation,
  markCitationClick,
} from "@/services/citekey-navigation";
import type { CitationHover } from "@/services/citekey-navigation";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";

import { renderCitationRuns, sectionCitationRuns } from "./render";
import "./style.css";

const logger = getLogger("wikilink-reading");

export interface WikilinkReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  noteIndex: Pick<NoteIndex, "on">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "on" | "peek">;
  /** The open-or-create flow every citation surface shares. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey">;
  /** What a hovered citation shows. */
  citationPopover: CitationPopover;
  settings: SettingsService;
  citationIndex: Pick<CitationIndex, "citekeyOf" | "on">;
}

/**
 * The Wikilink Reading Rendering: in reading mode a Literature Note wikilink —
 * and a whole Citation Run of them — shows the citation a style formatted.
 * Native link presentation stays in place until that render lands, while the
 * target stays Obsidian's. Hover follows the Hover Action: the Citation Popover
 * replaces Obsidian's own hover under the popover, and every other action
 * leaves the link hovering as the link it is. The click follows the
 * open-as-links choice: a plain click does nothing wherever Citations stay
 * closed as links — the Citation reads as the static text it is — and every
 * other click stays Obsidian's.
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
  readonly #citekeyEditor;
  readonly #citationPopover;
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
    this.#citekeyEditor = deps.citekeyEditor;
    this.#citationPopover = deps.citationPopover;
    this.#settings = deps.settings;
    this.#citationIndex = deps.citationIndex;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

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
    stack.defer(this.#citationText.on("changed", () => this.#rerender()));
    // A reading view holds the text this service wrote, so the views render
    // again without it once it is gone. The flag goes first: the post-processor
    // may still be registered while this runs.
    stack.defer(() => {
      this.#retired = true;
      this.#rerender();
    });

    this.commit(stack.move());
  }

  /** Replaces eligible links when complete formatted text is held. */
  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
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
    const runs = sectionCitationRuns(el, (linktext) =>
      wikilinkCitation(linktext, {
        literatureNote,
        enabled: this.#display.enabled,
      }),
    );
    if (runs.length === 0) return;

    // Read only once a Citation is on screen, so a section that writes none
    // waits for nothing. Native links stay in place while the read settles.
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    const text = file === null ? null : this.#citationText.peek(file.path);
    if (text === null) return;
    if (this.#retired) return;

    // Which occurrence each Citation of the section is, so a position-dependent
    // style shows every one of them the text rendered for its own place.
    const citations = runs.map((run) => citationOfRun(run));
    const failure = text.value.presentationFailure;
    renderProfileRecovery(el, this.#app, { path: failure?.target });
    if (failure) {
      const diagnostic = m.notice_imported_note_profile_unknown({
        stamp: failure.diagnostic.stamp,
        target: failure.target,
      });
      for (const { source } of runs.flat()) {
        source.dataset["citationPresentationError"] = "profile";
        setTooltip(source, diagnostic);
      }
    }
    const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
    const contents = citations.map((citation, index) =>
      citationContent(citation, text.value, coordinates[index]),
    );
    const shown = renderCitationRuns(
      runs,
      (_run, index) => contents[index] ?? null,
    );
    if (shown > 0) {
      logger.trace("Rendered wikilink citations", {
        path: ctx.sourcePath,
        count: shown,
      });
    }
    if (!this.#display.popoverHover && !this.#display.clickIntercepted) return;
    for (const [index, run] of runs.entries()) {
      const content = contents[index];
      // A run the style formatted no text for keeps Obsidian's own link, hover
      // and click and all; only the Citation this surface rendered carries the
      // popover.
      if (!content) continue;
      this.#attachPopover(
        run,
        { citation: citations[index]!, at: coordinates[index] },
        ctx.sourcePath,
      );
    }
  }

  /**
   * Gives one rendered Citation what this surface answers for it: the Citation
   * Popover on hover, in place of the page preview Obsidian answers a
   * Literature Note link with, and nothing at all on a plain click, in place of
   * opening that note.
   *
   * The listeners sit on the anchor the run rendered into, which is where the
   * post-processor left the Citation and where Obsidian's own delegated
   * handlers would have read the link from.
   */
  #attachPopover(
    run: readonly RunMember<HTMLAnchorElement>[],
    shown: ShownCitation,
    sourcePath: string,
  ): void {
    const element = run[0]!.source;
    const hover: CitationHover = {
      works: run.map(({ citation }) => ({
        citekey: citation.item.citekey,
        indexedKey: citation.indexedKey,
      })),
      // The occurrence this section shows in the Citation's place, which is
      // where a note-class style's own note text is read from, however often
      // the popover reads it again.
      shown,
      where: { surface: "reading" },
      open: (citekey, pane) => {
        void this.#citekeyEditor.openCitekey(citekey, pane);
      },
      showPopover: (request) => this.#citationPopover.show(request),
      hoverPreferences: () => this.#display.hover,
      hoverTarget: () => {
        const hoverParent = this.#viewOf(element);
        return hoverParent === null
          ? null
          : {
              workspace: this.#app.workspace,
              hoverParent,
              sourcePath,
            };
      },
    };
    if (this.#display.popoverHover) {
      element.addEventListener("mouseover", (event) => {
        hoverWikilinkCitation(event, element, hover);
      });
    }
    if (this.#display.clickIntercepted) {
      // The anchor states what its plain click does, which is what neutralizes
      // Obsidian's own link cursor and hover colour on it.
      markCitationClick(element, "none", { cursor: false });
      element.addEventListener("click", (event) => {
        clickWikilinkCitation(event, { where: hover.where });
      });
    }
  }

  /**
   * The Markdown view a rendered Citation sits in, which Obsidian hangs the
   * popover off. Markdown rendered outside such a view — an export, a popover
   * of its own — belongs to none, and hover stays silent there.
   */
  #viewOf(element: HTMLElement): MarkdownView | null {
    for (const leaf of this.#app.workspace.getLeavesOfType("markdown")) {
      const { view } = leaf;
      if (view instanceof MarkdownView && view.containerEl.contains(element)) {
        return view;
      }
    }
    return null;
  }

  /** A reading view holds what a post-processor produced until it renders again. */
  #rerender(): void {
    const count = rerenderReadingViews(this.#app);
    logger.debug("Rerendering reading views", { count });
  }
}
