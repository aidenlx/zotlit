// Search the library in Obsidian's prompt. Every picker over Zotero Items —
// the citation insert, the Explorer's paper, the annotation view's link —
// searches and draws its rows the same way; a subclass decides what a chosen
// Item does.
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { SettingsService } from "@/services/settings/service";

import { FirstAnswerGate } from "./first-answer";
import { renderSuggestion as renderSearchHit } from "./render-hit";
import { DEFAULT_LIMIT } from "./service";
import type { ItemLookup, SearchHit } from "./service";

export interface ItemSearchDeps {
  app: App;
  lookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
}

export abstract class ItemSearchModal extends SuggestModal<SearchHit> {
  readonly #search: ItemSearchDeps;
  readonly #firstAnswer = new FirstAnswerGate({
    // The container holds the dim backdrop too, so both show in one frame. A
    // layered utility holds while Obsidian sets no opacity on
    // `.modal-container`; the End-to-end Run's quick-switcher step checks it.
    hide: () => this.containerEl.addClass("zt:opacity-0"),
    reveal: () => this.containerEl.removeClass("zt:opacity-0"),
    showLoading: () =>
      this.resultContainerEl.createDiv({
        cls: "suggestion-empty",
        text: m.modal_item_search_loading(),
      }),
  });

  constructor(deps: ItemSearchDeps) {
    super(deps.app);
    this.#search = deps;
    this.limit = DEFAULT_LIMIT;
  }

  override onOpen(): void {
    // Before super, which asks for the first answer.
    this.#firstAnswer.open();
    void super.onOpen();
  }

  override onClose(): void {
    this.#firstAnswer.close();
    super.onClose();
  }

  override getSuggestions(query: string): SearchHit[] | Promise<SearchHit[]> {
    return this.#firstAnswer.track(
      this.#search.lookup.search(query, { limit: this.limit }),
    );
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#search.settings, hit, el);
  }
}

/**
 * Fuzzy-search modal for choosing one Item. Resolves with the chosen Item, or
 * `null` when dismissed without a selection.
 */
class ItemPickerModal extends ItemSearchModal {
  readonly #resolvers = Promise.withResolvers<SearchHit | null>();
  #picked = false;

  constructor(deps: ItemSearchDeps, placeholder: string) {
    super(deps);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  /** Mark selected before super triggers close → onClose. */
  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#picked = true;
    super.selectSuggestion(value, evt);
  }

  override onChooseSuggestion(hit: SearchHit): void {
    this.#resolvers.resolve(hit);
  }

  override onClose(): void {
    super.onClose();
    if (!this.#picked) this.#resolvers.resolve(null);
  }

  requestInput(): Promise<SearchHit | null> {
    this.open();
    return this.#resolvers.promise;
  }
}

/** Ask the reader for one Item; `placeholder` says what it is for. */
export function pickItem(
  deps: ItemSearchDeps,
  placeholder: string,
): Promise<SearchHit | null> {
  return new ItemPickerModal(deps, placeholder).requestInput();
}
