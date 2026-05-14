import "./style.css";
import type { App, Plugin } from "obsidian";

import type { ItemLookup } from "@/services/item-lookup/service";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import { CitationEditorSuggest } from "./editor-suggest";

export interface CitationSuggestDeps {
  app: App;
  lookup: ItemLookup;
  template: TemplateService;
  settings: SettingsService;
}

export function registerCitationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest">,
  deps: CitationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new CitationEditorSuggest(deps));
}
