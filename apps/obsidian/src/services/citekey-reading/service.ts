// The reading-mode surface of the Citekey Editor Treatment: literal citekey citations show formatted in the reading view, and navigate like links.

import { MarkdownView } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import { rerenderReadingViews } from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import {
  citationContent,
  citationElement,
  citedWorks,
  literalSummaryOf,
  unresolvedKeys,
} from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
import type { CitekeyEditor } from "@/services/citekey-editor/service";
import { attachCitationNavigation } from "@/services/citekey-navigation";
import { Service } from "@/services/service-base";
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
  /** The open-or-create flow and the hover resolution every citekey surface shares. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey" | "hoverNotePath">;
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
 * Navigation is independent: when enabled, one work opens on click, several
 * works open a menu at the cursor, and hover previews the Literature Note of a
 * single resolved key. A citation none of whose keys reaches a Zotero Item
 * stays raw source text and inert.
 *
 * A post-processor stays registered for the plugin's lifetime, so the toggles
 * are read per render rather than by adding and removing it.
 */
export class CitekeyReading extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #citationText;
  readonly #citekeyEditor;
  readonly #settings;

  /** `undefined` until the first settings snapshot decides the treatment. */
  #active: boolean | undefined;
  #showFormatted = false;
  #navigationEnabled = false;

  ready: Promise<void>;

  constructor(deps: CitekeyReadingDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#citationText = deps.citationText;
    this.#citekeyEditor = deps.citekeyEditor;
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
    const pandocCitations = settings["citation.pandoc-citations"];
    const showFormatted =
      pandocCitations && settings["citation.show-formatted"];
    const navigationEnabled =
      pandocCitations && settings["citation.open-pandoc-links"];
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
    const summaryOf = literalSummaryOf(text);
    const doc = el.ownerDocument;
    replaceCitations(citations, (citation) => {
      const content = this.#showFormatted
        ? citationContent(citation, text)
        : null;
      const unresolved = unresolvedKeys(citation, summaryOf);
      const themeClasses = [
        themeHook.citationKey,
        ...(unresolved === 0
          ? []
          : [
              unresolved === citation.keys.length
                ? themeHook.citationKeyUnresolved
                : themeHook.citationKeyPartiallyUnresolved,
            ]),
      ];
      const element = citationElement(
        doc,
        content ?? citation.source,
        themeClasses,
      );
      // A citation none of whose keys reaches a Zotero Item remains wrapped so
      // themes can style its error state, but has no target to navigate to.
      if (!this.#navigationEnabled || unresolved === citation.keys.length) {
        return element;
      }
      attachCitationNavigation(element, {
        works: citedWorks(citation, summaryOf),
        where: { surface: "reading" },
        open: (citekey, pane) => {
          void this.#citekeyEditor.openCitekey(citekey, pane);
        },
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
      });
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
