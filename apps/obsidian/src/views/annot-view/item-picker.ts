import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { ItemLookup, SearchHit } from "@/services/item-lookup/service";
import type { SettingsService } from "@/services/settings/service";

export interface ItemPickerDeps {
  app: App;
  lookup: Pick<ItemLookup, "search">;
  settings: SettingsService;
}

/**
 * Fuzzy-search modal for the annot view's manual-link mode. Resolves with the
 * chosen item, or `null` when dismissed without a selection.
 */
class ItemPickerModal extends SuggestModal<SearchHit> {
  readonly #deps: ItemPickerDeps;
  readonly #resolvers = Promise.withResolvers<SearchHit | null>();
  #picked = false;

  constructor(deps: ItemPickerDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setPlaceholder(m.annot_view_link_placeholder());
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
  return new ItemPickerModal(deps).requestInput();
}
