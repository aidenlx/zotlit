import "./style.css";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationIndex } from "@/services/citation-index/service";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { NoteFeature } from "@/services/note-feature";
import type { SettingsService } from "@/services/settings/service";

import { CitationEditorSuggest } from "./editor-suggest";
import { InsertCitationModal } from "./insert-modal";

export interface CitationSuggestDeps {
  app: App;
  lookup: ItemLookup;
  noteFeature: Pick<NoteFeature, "renderCitation">;
  settings: SettingsService;
  /** Says whether the Citation Key of a chosen Item names several Items, and
   *  whether the snapshot that answers that has resolved at all yet. */
  citationIndex: Pick<CitationIndex, "resolveCitekey" | "resolution">;
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
