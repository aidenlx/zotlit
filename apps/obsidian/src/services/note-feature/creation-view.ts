// Shared interactive creation prompt for Quick Switch and citation navigation.
import type { App, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import type { CreationProfileSources, NoteFeature } from "./operations";
import { createNoteTaskWithToast, createNoteWithToast } from "./update-single";

const logger = getLogger("note-feature");

export interface InteractiveCreationDeps {
  app: App;
  noteFeature: Pick<
    NoteFeature,
    "createNote" | "resolveCreationProfile" | "prepareCreationProfiles"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
}

export async function createNoteInteractively(
  deps: InteractiveCreationDeps,
  item: Item,
  sources: CreationProfileSources = {},
): Promise<TFile | null> {
  const selection = await deps.noteFeature.resolveCreationProfile(sources);
  if (!selection.shouldAsk)
    return createNoteWithToast(deps.noteFeature, item, {
      profile: selection.selector,
      app: deps.app,
    });

  const [previews, styles] = await Promise.all([
    deps.noteFeature.prepareCreationProfiles(item),
    deps.zoteroPref.dataDir ? listInstalledStyles(deps.zoteroPref.dataDir) : [],
  ]);
  const choice = await chooseLiteratureNoteProfile(deps.app, {
    preselected: selection.selector,
    source: selection.source,
    previews,
    styles,
  });
  if (!choice) {
    logger.debug("Cancelled Literature Note Profile selection", {
      indexedKey: item.indexedKey,
    });
    return null;
  }
  logger.debug("Confirmed Literature Note Profile selection", {
    indexedKey: item.indexedKey,
    selector: choice.id,
  });
  const preview = previews.find(({ selector }) => selector === choice.id)!;
  return createNoteTaskWithToast(() => preview.create(), { app: deps.app });
}
