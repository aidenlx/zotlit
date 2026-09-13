// The Wikilink Reading Rendering service: it registers the Markdown
// post-processor, answers which Literature Note a linkpath names, rewrites the
// Citations it placed when their text changes, and asks the open reading views
// to render again when something outside their documents changed which links
// it touches.

import { MarkdownView } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import {
  LiveSections,
  rerenderReadingViews,
  sectionRange,
} from "@/lib/reading-view";
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
  showCitation,
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

import {
  hasInternalLink,
  renderCitationRuns,
  sectionCitationRuns,
} from "./render";
import type { SectionRuns } from "./render";
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
 * A section this surface rendered into stays held while Obsidian shows it, and
 * its Citations are rewritten in place — the same Held Read text, or the fresh
 * text that replaced it — so a change to what a Citation says moves nothing
 * else in the view. A change to which links are Citations at all still renders
 * the views again.
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
  /** The sections this surface rendered into and Obsidian still shows. */
  readonly #sections = new LiveSections();
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
    // Creating, deleting, or renaming a Literature Note changes which links
    // are Citations without changing any document, so every open reading view
    // renders again. The Note Index reports every moved mapping as `changed`;
    // its one Full Scan per session is silent.
    stack.defer(this.#noteIndex.on("changed", () => this.#rerender()));
    // What a placed Citation says follows its document's Held Read: the live
    // sections of that document rewrite on its change, and every live section
    // rewrites when all text goes stale or the citekey resolution snapshot
    // rebuilds.
    stack.defer(
      this.#citationIndex.on("resolution-changed", () =>
        this.#sections.refresh(),
      ),
    );
    stack.defer(
      this.#citationText.on("invalidated", () => this.#sections.refresh()),
    );
    stack.defer(
      this.#citationText.on("changed", (path) => this.#sections.refresh(path)),
    );
    // A reading view holds the text this service wrote, so the views render
    // again without it once it is gone. The flag goes first: the post-processor
    // may still be registered while this runs.
    stack.defer(() => {
      this.#retired = true;
      this.#rerender();
    });

    this.commit(stack.move());
  }

  /**
   * Holds one rendered section and shows its Citations, which are rewritten in
   * place for as long as Obsidian shows the section.
   */
  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#retired) return;
    // Any internal link, Citation or not: a link whose Item gains a native
    // citation key at the next snapshot rebuild becomes a Citation in place.
    if (!hasInternalLink(el)) return;
    /** The runs that show formatted text, each collapsed into its first anchor. */
    const rendered: SectionRuns = [];
    /** Retires the gesture listeners the previous rewrite attached. */
    let gestures = new AbortController();
    const show = () => {
      if (this.#retired) return;
      gestures.abort();
      gestures = new AbortController();
      this.#show(el, ctx, { rendered, signal: gestures.signal });
    };
    this.#sections.hold(el, ctx, show);
    show();
  }

  /**
   * The Citation Runs of a section's native links, which is every run that has
   * not rendered yet: a rendered run's anchor shows formatted text, so the scan
   * passes it by.
   */
  #sectionRuns(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): SectionRuns {
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
    return sectionCitationRuns(el, (linktext) =>
      wikilinkCitation(linktext, {
        literatureNote,
        enabled: this.#display.enabled,
      }),
    );
  }

  /**
   * Shows every Citation Run of a section what the document's Held Read holds
   * for it. A run that has not rendered collapses into its first anchor once
   * text is held for it; a run that has keeps that anchor and its current text
   * until fresh text differs. Native links stay in place while the read
   * settles.
   *
   * @param rendered the runs that already show formatted text, in the order
   *   they rendered; a run this call renders is appended.
   * @param signal retires the gesture listeners this call attaches.
   */
  #show(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    { rendered, signal }: { rendered: SectionRuns; signal: AbortSignal },
  ): void {
    // Read only once a Citation is on screen, so a section that writes none
    // waits for nothing.
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    const text = file === null ? null : this.#citationText.peek(file.path);
    if (text === null) return;

    const runs = [...rendered, ...this.#sectionRuns(el, ctx)].sort((a, b) =>
      documentOrder(a[0]!.source, b[0]!.source),
    );
    // Which occurrence each Citation of the section is, so a position-dependent
    // style shows every one of them the text rendered for its own place.
    const citations = runs.map((run) => citationOfRun(run));
    const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
    const contents = citations.map((citation, index) =>
      citationContent(citation, text.value, coordinates[index]),
    );
    // A run that rendered before keeps its one anchor: the collapse never runs
    // on it again, and its text follows the fresh content where there is one.
    const collapsed = new Set(rendered);
    const shown = renderCitationRuns(runs, (run, index) => {
      const content = contents[index] ?? null;
      if (!collapsed.has(run)) {
        if (content !== null) rendered.push(run);
        return content;
      }
      if (content !== null) showCitation(run[0]!.source, content, "suppress");
      return null;
    });
    if (shown > 0) {
      logger.trace("Rendered wikilink citations", {
        path: ctx.sourcePath,
        count: shown,
      });
    }
    if (!this.#display.popoverHover && !this.#display.clickIntercepted) return;
    for (const [index, run] of runs.entries()) {
      // A run the style formatted no text for keeps Obsidian's own link, hover
      // and click and all; only the Citation this surface rendered carries the
      // popover.
      if (!rendered.includes(run)) continue;
      this.#attachPopover(
        run,
        { citation: citations[index]!, at: coordinates[index] },
        { sourcePath: ctx.sourcePath, signal },
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
   * handlers would have read the link from. They last until `signal` aborts,
   * which is when the section rewrites and attaches the next ones.
   */
  #attachPopover(
    run: readonly RunMember<HTMLAnchorElement>[],
    shown: ShownCitation,
    { sourcePath, signal }: { sourcePath: string; signal: AbortSignal },
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
      element.addEventListener(
        "mouseover",
        (event) => {
          hoverWikilinkCitation(event, element, hover);
        },
        { signal },
      );
    }
    if (this.#display.clickIntercepted) {
      // The anchor states what its plain click does, which is what neutralizes
      // Obsidian's own link cursor and hover colour on it.
      markCitationClick(element, "none", { cursor: false });
      element.addEventListener(
        "click",
        (event) => {
          clickWikilinkCitation(event, { where: hover.where });
        },
        { signal },
      );
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

/** Sorts two nodes into document order. */
function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}
