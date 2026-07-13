import { type App, SuggestModal } from "obsidian";

import * as m from "@/paraglide/messages";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import {
  DEFAULT_LIMIT,
  type ItemLookup,
  type SearchHit,
} from "@/services/item-lookup/service";
import { type SettingsService } from "@/services/settings/service";

export interface ItemPickerDeps {
  app: App;
  lookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
}

/**
 * Fuzzy-search modal for choosing the item the explorer displays. Resolves
 * with the chosen item, or `null` when dismissed without a selection.
 */
class ExplorerItemPickerModal extends SuggestModal<SearchHit> {
  readonly #deps: ItemPickerDeps;
  readonly #resolvers = Promise.withResolvers<SearchHit | null>();
  #picked = false;

  constructor(deps: ItemPickerDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setPlaceholder(m.template_data_explorer_pick_placeholder());
  }

  override getSuggestions(query: string): SearchHit[] | Promise<SearchHit[]> {
    return this.#deps.lookup.search(query, { limit: this.limit });
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
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

export function pickItem(deps: ItemPickerDeps): Promise<SearchHit | null> {
  return new ExplorerItemPickerModal(deps).requestInput();
}
