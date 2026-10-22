// Search the library in Obsidian's prompt. Every picker over Zotero Items —
// the citation insert, the Explorer's paper, the annotation view's link —
// searches and draws its rows the same way; a subclass decides what a chosen
// Item does. A choice acts only on the answer to the query in the input.
import { Scope, SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { SettingsService } from "@/services/settings/service";

import { CurrentAnswer } from "./current-answer";
import { FirstAnswerGate } from "./first-answer";
import { renderSuggestion as renderSearchHit } from "./render-hit";
import { DEFAULT_LIMIT } from "./service";
import type {
  ItemLookup,
  SearchHit,
  SearchOptions,
  SearchSession,
} from "./service";

export interface ItemSearchDeps {
  app: App;
  lookup: Pick<ItemLookup, "openSession">;
  settings: SettingsService;
}

export abstract class ItemSearchModal extends SuggestModal<SearchHit> {
  readonly #search: ItemSearchDeps;
  /** The searches of this picker while it is open. */
  #session: SearchSession | null = null;
  readonly #answer = new CurrentAnswer<SearchHit>(this.resultContainerEl);
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
    // The result list takes Enter only while it has a row, so Enter typed
    // before any answer shows would do nothing. The modal's own scope takes
    // Enter first and leaves every other key to the list beneath it.
    this.scope = new Scope(this.scope);
    this.scope.register([], "Enter", (evt) => {
      if (evt.isComposing) return;
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  override onOpen(): void {
    // Before super, which asks for the first answer.
    this.#firstAnswer.open();
    this.#session = this.#search.lookup.openSession();
    void super.onOpen();
  }

  override onClose(): void {
    this.#firstAnswer.close();
    this.#session?.close();
    this.#session = null;
    this.#answer.close();
    super.onClose();
  }

  override getSuggestions(
    query: string,
    options?: Pick<SearchOptions, "cited">,
  ): SearchHit[] | Promise<SearchHit[]> {
    return this.#answer.track(
      Promise.resolve(
        this.#firstAnswer.track(
          this.#session?.search(query, { ...options, limit: this.limit }) ??
            Promise.resolve([]),
        ),
      ),
    );
  }

  /** Whether the rows answer the query in the input. */
  protected get answersTypedQuery(): boolean {
    return this.#answer.answersTypedQuery;
  }

  /**
   * Enter while the typed query's answer is pending, with an earlier query's
   * rows or no rows at all, waits for the answer and chooses its first row.
   */
  override selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void {
    if (this.answersTypedQuery) super.selectActiveSuggestion(evt);
    else this.#answer.chooseFirst((hit) => this.selectSuggestion(hit, evt));
  }

  /** A click on a row about to give way to the typed query's answer is dropped. */
  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#answer.choose(value, evt, (hit) => super.selectSuggestion(hit, evt));
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#search.settings, hit, el);
    // Rows of Items that share a title read the same; the key tells them apart.
    el.setAttribute("data-indexed-key", hit.item.indexedKey);
  }
}

/**
 * Fuzzy-search modal for choosing one Item. Resolves with the chosen Item, or
 * `null` when dismissed without a selection.
 */
class ItemPickerModal extends ItemSearchModal {
  readonly #resolvers = Promise.withResolvers<SearchHit | null>();
  /** Set by a choice, which closes the modal before it reports the Item. */
  #choosing = false;

  constructor(deps: ItemSearchDeps, placeholder: string) {
    super(deps);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#choosing = this.answersTypedQuery;
    super.selectSuggestion(value, evt);
  }

  override onChooseSuggestion(hit: SearchHit): void {
    this.#resolvers.resolve(hit);
  }

  override onClose(): void {
    super.onClose();
    if (!this.#choosing) this.#resolvers.resolve(null);
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
