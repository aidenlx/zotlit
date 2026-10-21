// Search the library in Obsidian's prompt. Every picker over Zotero Items —
// the citation insert, the Explorer's paper, the annotation view's link —
// searches and draws its rows the same way; a subclass decides what a chosen
// Item does. A choice acts only on the answer to the query in the input.
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { SettingsService } from "@/services/settings/service";

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
  /**
   * The answer to the query last typed, or `null` once it shows. Until then
   * the rows answer an earlier query.
   */
  #pending: Promise<SearchHit[]> | null = null;
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
    this.#session = this.#search.lookup.openSession();
    void super.onOpen();
  }

  override onClose(): void {
    this.#firstAnswer.close();
    this.#session?.close();
    this.#session = null;
    this.#settle(this.#pending);
    super.onClose();
  }

  override getSuggestions(
    query: string,
    options?: Pick<SearchOptions, "cited">,
  ): SearchHit[] | Promise<SearchHit[]> {
    const answer = Promise.resolve(
      this.#firstAnswer.track(
        this.#session?.search(query, { ...options, limit: this.limit }) ??
          Promise.resolve([]),
      ),
    );
    // Obsidian shows the rows once the returned answer settles, right after
    // this step; an answer superseded by a later query settles the later one.
    const shown: Promise<SearchHit[]> = answer.finally(() =>
      this.#settle(shown),
    );
    this.#pending = shown;
    this.resultContainerEl.setAttribute("aria-busy", "true");
    return shown;
  }

  #settle(answer: Promise<SearchHit[]> | null): void {
    if (this.#pending !== answer) return;
    this.#pending = null;
    this.resultContainerEl.removeAttribute("aria-busy");
  }

  /**
   * Enter or a click on a row while the typed query's answer is pending would
   * choose from an earlier query's rows, where another Item can stand in the
   * same place, or under the same title. Enter then waits for the answer and
   * chooses its first row, the row Obsidian selects when it shows; a click
   * on a row about to go is dropped.
   */
  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    if (!this.#pending) {
      super.selectSuggestion(value, evt);
      return;
    }
    if ("key" in evt) void this.#chooseOnAnswer(evt);
  }

  async #chooseOnAnswer(evt: KeyboardEvent): Promise<void> {
    let hits: SearchHit[] = [];
    // A query typed after Enter supersedes the one Enter waited for.
    for (let pending = this.#pending; pending; pending = this.#pending) {
      hits = await pending.catch(() => []);
      if (!this.#session) return;
    }
    const [first] = hits;
    if (first) this.selectSuggestion(first, evt);
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

  constructor(deps: ItemSearchDeps, placeholder: string) {
    super(deps);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override onChooseSuggestion(hit: SearchHit): void {
    this.#resolvers.resolve(hit);
  }

  override onClose(): void {
    super.onClose();
    // A choice closes the modal before it calls onChooseSuggestion, which
    // settles the answer first.
    queueMicrotask(() => this.#resolvers.resolve(null));
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
