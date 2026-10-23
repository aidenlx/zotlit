import "./style.css";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationIndex } from "@/services/citation-index/service";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { NoteFeature } from "@/services/note-feature";
import type { SettingsService } from "@/services/settings/service";
import type { PlainUseLedger } from "@/services/use-ledger/plain";

import { AnnotationEditorSuggest } from "./annotation-suggest";
import type { AnnotationSuggestDeps } from "./annotation-suggest";
import { CitationEditorSuggest } from "./editor-suggest";
import { InsertCitationModal } from "./insert-modal";

export interface CitationSuggestDeps {
  app: App;
  lookup: ItemLookup;
  noteFeature: Pick<NoteFeature, "renderCitation">;
  settings: SettingsService;
  /** Says whether the Citation Key of a chosen Item names several Items, and
   *  whether the snapshot that answers that has resolved at all yet. */
  citationLookup: Pick<CitationLookup, "read" | "status">;
  citationIndex: Pick<CitationIndex, "getDocumentCitationSet">;
  useLedger: Pick<PlainUseLedger, "record">;
}

/**
 * The Annotation Suggester, registered after the Citation Suggester: their
 * triggers never overlap, so at most one of them opens on any text.
 */
export function registerAnnotationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest">,
  deps: AnnotationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new AnnotationEditorSuggest(deps));
}

export function registerCitationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest" | "addCommand">,
  deps: CitationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new CitationEditorSuggest(deps));
  plugin.addCommand({
    id: "insert-citation",
    name: m.command_insert_citation_name(),
    editorCallback: (editor, ctx) => {
      new InsertCitationModal(deps, editor, ctx.file).open();
    },
  });
}
