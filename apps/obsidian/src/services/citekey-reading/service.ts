// The reading-mode surface of the Citekey Editor Treatment: literal citekey
// citations show formatted in the reading view, navigate like links, and are
// rewritten in place while Obsidian shows their section.

import { MarkdownView } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import {
  LiveSections,
  rerenderReadingViews,
  sectionRange,
} from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationPopover } from "@/services/citation-popover/service";
import {
  citationContent,
  citationElement,
  citationKeyStates,
  citationState,
  citationStateHooks,
  citedWorks,
  citekeyState,
  literalKeyStateOf,
  sectionCoordinates,
} from "@/services/citation-text/present";
import type {
  CitationKeyState,
  PresentedCitation,
} from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import {
  attachCitationHover,
  attachCitationNavigation,
  attachClosedCitationGestures,
  hoverPreferences,
  markCitationClick,
} from "@/services/citekey-navigation";
import type {
  CitationNavigation,
  HoverPreferences,
} from "@/services/citekey-navigation";
import { Service } from "@/services/service-base";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { replaceCitations, sectionCitations } from "./render";
import type { SectionCitation } from "./render";
import "./style.css";

const logger = getLogger("citekey-reading");

/** One held section: its citations, and the elements standing in their place. */
interface HeldSection {
  citations: readonly SectionCitation[];
  /**
   * The element standing in each citation's place, and the content it shows —
   * the source where none was formatted for it. Empty until the first show
   * puts elements in place.
   */
  placed: { element: HTMLElement; shown: PresentedCitation | string }[];
}

export interface CitekeyReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "on" | "peek">;
  /** What a literal citekey names, which is what tells missing from Ambiguous. */
  citationIndex: Pick<CitationIndex, "resolution" | "resolveCitekey">;
  /** The open-or-create flow every citekey surface shares, and what hover previews. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey" | "hoverNotePath">;
  /** What a hovered citation shows. */
  citationPopover: CitationPopover;
  settings: Pick<SettingsService, "ready" | "subscribe">;
}

/**
 * Renders literal citekey citations in reading mode, so a shared or published
 * view of a note shows formatted citations.
 *
 * A citation is formatted from the shared citation text of its document, so
 * this surface, the editor's cluster widgets, and the References Sidebar agree
 * on the References Style and go stale together. With no engine installed the
 * citation keeps its native source text.
 *
 * Navigation is independent: when enabled, one work opens on click and several
 * works open a menu at the cursor. Wherever Citations stay closed as links, a
 * plain click on a rendered citation does nothing — it reads as the static text
 * it is — and Mod-click keeps opening the work. Hover belongs to the Hover
 * Action alone, so every citation this surface renders carries it. A citation
 * none of whose keys reaches a Zotero Item stays raw source text, inert but for
 * that hover.
 *
 * A post-processor stays registered for the plugin's lifetime, so the toggles
 * are read per render rather than by adding and removing it.
 *
 * A section this surface rendered into stays held while Obsidian shows it, and
 * its citations are rewritten in place — the same Held Read text, or the fresh
 * text that replaced it — so a change to what a citation says moves nothing
 * else in the view. A toggle that changes whether the surface touches a
 * citation at all still renders the views again.
 */
export class CitekeyReading extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #citationText;
  readonly #citationIndex;
  readonly #citekeyEditor;
  readonly #citationPopover;
  readonly #settings;

  /** `undefined` until the first settings snapshot decides the treatment. */
  #active: boolean | undefined;
  #showFormatted = false;
  #navigationEnabled = false;
  #hover: HoverPreferences = hoverPreferences(defaults);
  /** The sections this surface rendered into and Obsidian still shows. */
  readonly #sections = new LiveSections();

  ready: Promise<void>;

  constructor(deps: CitekeyReadingDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#citationText = deps.citationText;
    this.#citationIndex = deps.citationIndex;
    this.#citekeyEditor = deps.citekeyEditor;
    this.#citationPopover = deps.citationPopover;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    this.#plugin.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    // What a placed citation says follows its document's Held Read: the live
    // sections of that document rewrite on its change, and every live section
    // rewrites when all text goes stale — which a citekey resolution snapshot
    // rebuild counts as.
    stack.defer(
      this.#citationText.on("invalidated", () => this.#sections.refresh()),
    );
    stack.defer(
      this.#citationText.on("changed", (path) => this.#sections.refresh(path)),
    );
    // A rendered citation carries this service's own click and hover handlers,
    // so the reading views render again without it once it is gone. The flag
    // goes first: the post-processor may still be registered while this runs.
    stack.defer(() => {
      this.#active = false;
      this.#rerenderReadingViews();
    });

    this.commit(stack.move());
  }

  #applySettings(settings: Readonly<Settings>): void {
    // Read straight through: hover answers from the newest snapshot, and
    // nothing rendered depends on it.
    this.#hover = hoverPreferences(settings);
    const pandocCitations = settings["citation.pandoc-citations"];
    const showFormatted =
      pandocCitations && settings["citation.show-formatted"];
    const navigationEnabled =
      pandocCitations && settings["citation.open-as-links"];
    const active = showFormatted || navigationEnabled;
    if (
      active === this.#active &&
      showFormatted === this.#showFormatted &&
      navigationEnabled === this.#navigationEnabled
    ) {
      return;
    }
    const initial = this.#active === undefined;
    const activeChanged = active !== this.#active;
    this.#active = active;
    this.#showFormatted = showFormatted;
    this.#navigationEnabled = navigationEnabled;
    if (activeChanged) {
      logger.info(
        active ? "Citekey reading enabled" : "Citekey reading disabled",
      );
    } else {
      logger.debug("Citekey reading treatment changed", {
        navigationEnabled,
        showFormatted,
      });
    }
    if (initial) return;
    this.#rerenderReadingViews();
  }

  /**
   * Holds one rendered section and shows its citations, which are rewritten in
   * place for as long as Obsidian shows the section.
   */
  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#active !== true) return;
    const citations = sectionCitations(el);
    if (citations.length === 0) return;
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    if (!file) return;

    const held: HeldSection = { citations, placed: [] };
    const show = () => {
      if (this.#active !== true) return;
      this.#show(el, ctx, held);
    };
    this.#sections.hold(el, ctx, show);
    show();
  }

  /**
   * Shows every citation of a section what the document's Held Read holds for
   * it. The first show splits the source text and puts an element in each
   * citation's place; every later one swaps a rebuilt element for the one there,
   * so its theme hooks and handlers follow the current answer. A citation the
   * fresh text holds nothing for keeps what it shows.
   */
  #show(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    { citations, placed }: HeldSection,
  ): void {
    const text = this.#citationText.peek(ctx.sourcePath);
    const resolutionPending = this.#citationIndex.resolution === null;
    // Source stays until a first answer: native text while the read settles,
    // and what a placed element shows until fresh text replaces it.
    if (text === null && !resolutionPending) return;
    const snapshotState = (citekey: string) =>
      citekeyState(this.#citationIndex.resolveCitekey(citekey));
    const stateOf =
      text === null
        ? snapshotState
        : literalKeyStateOf(text.value, snapshotState);
    // Which occurrence each citation of the section is, so a position-dependent
    // style shows every one of them the text rendered for its own place.
    const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
    /** Builds the element citation `index` shows as, and records it as placed. */
    const place = (citation: SectionCitation, index: number): HTMLElement => {
      const content = this.#showFormatted
        ? text === null
          ? null
          : citationContent(citation, text.value, coordinates[index])
        : null;
      const shown = content ?? placed[index]?.shown ?? citation.source;
      const element = this.#citationElement(el.ownerDocument, ctx.sourcePath, {
        content: shown,
        states: citationKeyStates(citation, stateOf),
        works: text === null ? [] : citedWorks(citation, text.value),
        at: content === null ? undefined : { citation, at: coordinates[index] },
      });
      placed[index] = { element, shown };
      return element;
    };
    if (placed.length === 0) {
      replaceCitations(citations, place);
      return;
    }
    for (const [index, citation] of citations.entries()) {
      const previous = placed[index]!.element;
      previous.replaceWith(place(citation, index));
    }
  }

  /** Builds the element one citation shows as, with its handlers attached. */
  #citationElement(
    doc: Document,
    sourcePath: string,
    {
      content,
      states,
      works,
      at,
    }: {
      content: PresentedCitation | string;
      states: CitationKeyState[];
      works: CitationNavigation["works"];
      /** The occurrence shown in the citation's place, where formatted text is. */
      at: CitationNavigation["shown"];
    },
  ): HTMLElement {
    const themeClasses = [
      themeHook.citationKey,
      ...citationStateHooks(citationState(states)),
    ];
    const element = citationElement(doc, content, themeClasses);
    const navigation: CitationNavigation = {
      works,
      // The occurrence this section shows in the citation's place, which is
      // where a note-class style's own note text is read from, however often
      // the popover reads it again. A citation left as source text shows none.
      shown: at,
      where: { surface: "reading" },
      open: (citekey, pane) => {
        void this.#citekeyEditor.openCitekey(citekey, pane);
      },
      showPopover: (request) => this.#citationPopover.show(request),
      hoverPreferences: () => this.#hover,
      hoverNotePath: (citekey) => this.#citekeyEditor.hoverNotePath(citekey),
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
    // Hover belongs to the Hover Action, so every rendered citation carries
    // it. Click is Citekey Navigation's alone: it opens the work the citation
    // names, and wherever Citations stay closed as links a plain click does
    // nothing, the way it does on any other rendered text. A citation none of
    // whose keys reaches a Zotero Item has nothing to open anyway; it stays
    // wrapped so themes can style its error state, and its entries say as
    // much. An Ambiguous Citation Key names no one Item either, so a citation
    // resting on those alone opens nothing.
    if (this.#navigationEnabled && states.includes("resolved")) {
      markCitationClick(element, "open");
      attachCitationNavigation(element, navigation);
      return element;
    }
    markCitationClick(element, "none");
    if (!this.#navigationEnabled && this.#showFormatted) {
      attachClosedCitationGestures(element, navigation);
      return element;
    }
    attachCitationHover(element, navigation);
    return element;
  }

  /**
   * The Markdown view a rendered citation sits in, which Obsidian hangs the
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
  #rerenderReadingViews(): void {
    const count = rerenderReadingViews(this.#app);
    logger.debug("Rerendering reading views", { count });
  }
}
