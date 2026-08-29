// The reading-mode surface of the Citekey Editor Treatment: literal citekey citations show formatted in the reading view, and navigate like links.

import { MarkdownView, setTooltip } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { rerenderReadingViews, sectionRange } from "@/lib/reading-view";
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
import "./style.css";

const logger = getLogger("citekey-reading");

export interface CitekeyReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  /** The formatted citations every surface of one document shares. */
  citationText: Pick<CitationText, "load" | "on" | "peek">;
  /** What a literal citekey names, which is what tells missing from Ambiguous. */
  citationIndex: Pick<CitationIndex, "resolveCitekey">;
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
    // A reading view holds what a post-processor produced, so text that went
    // stale keeps showing until the view renders that section again.
    stack.defer(
      this.#citationText.on("invalidated", () => this.#rerenderReadingViews()),
    );
    stack.defer(
      this.#citationText.on("changed", () => this.#rerenderReadingViews()),
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

  /** Formats one rendered section and adds enabled navigation handlers. */
  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#active !== true) return;
    const citations = sectionCitations(el);
    if (citations.length === 0) return;
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    if (!file) return;

    const text = this.#citationText.peek(file.path);
    if (text === null) {
      void this.#citationText.load(file);
      return;
    }
    const stateOf = literalKeyStateOf(text, (citekey) =>
      citekeyState(this.#citationIndex.resolveCitekey(citekey)),
    );
    const doc = el.ownerDocument;
    // Which occurrence each citation of the section is, so a position-dependent
    // style shows every one of them the text rendered for its own place.
    const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
    replaceCitations(citations, (citation, index) => {
      const content = this.#showFormatted
        ? citationContent(citation, text, coordinates[index])
        : null;
      const states = citationKeyStates(citation, stateOf);
      const themeClasses = [
        themeHook.citationKey,
        ...citationStateHooks(citationState(states)),
      ];
      const element = citationElement(
        doc,
        content ?? citation.source,
        themeClasses,
      );
      const failure = text.presentationFailure;
      if (failure) {
        element.dataset["citationPresentationError"] = "profile";
        setTooltip(
          element,
          m.notice_imported_note_profile_unknown({
            stamp: failure.stamp,
            target: failure.target,
          }),
        );
      }
      const navigation: CitationNavigation = {
        works: citedWorks(citation, text),
        // The occurrence this section shows in the citation's place, which is
        // where a note-class style's own note text is read from, however often
        // the popover reads it again. A citation left as source text shows none.
        shown:
          content === null ? undefined : { citation, at: coordinates[index] },
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
                sourcePath: ctx.sourcePath,
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
    });
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
