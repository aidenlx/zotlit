import "./style.css";
import { type App, type Plugin } from "obsidian";

import * as m from "@/paraglide/messages";
import { type ItemLookup } from "@/services/item-lookup/service";
import { type NoteFeatureContext } from "@/services/note-feature";
import { type SettingsService } from "@/services/settings/service";

import { CitationEditorSuggest } from "./editor-suggest";
import { InsertCitationModal } from "./insert-modal";

export interface CitationSuggestDeps {
  app: App;
  lookup: ItemLookup;
  noteFeatures: NoteFeatureContext;
  settings: SettingsService;
}

export function registerCitationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest" | "addCommand">,
  deps: CitationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new CitationEditorSuggest(deps));
  plugin.addCommand({
    id: "insert-citation",
    name: m.command_insert_citation_name(),
    editorCallback: (editor) => {
      new InsertCitationModal(deps, editor).open();
    },
  });
}
