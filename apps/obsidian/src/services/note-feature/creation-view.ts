// Shared creation prompt for Quick Switch, citation navigation, and Companion links.
import type { App, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { listInstalledStyles } from "@/services/pandoc/styles";
import { describeRule } from "@/services/profile-selection";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type {
  ImportProfile,
  CreateProfile,
  CreatedProfile,
} from "@/setting-tab/profiles";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import type { CreationProfileSources, NoteFeature } from "./operations";
import { describeSelectionProblem } from "./selection-copy";
import { createNoteTaskWithToast, createNoteWithToast } from "./update-single";

const logger = getLogger("note-feature");

export interface InteractiveCreationDeps {
  createProfile: CreateProfile;
  importProfile: ImportProfile;
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
  const selection = await deps.noteFeature.resolveCreationProfile({
    ...sources,
    item,
  });
  if (!selection.shouldAsk)
    return createNoteWithToast(deps.noteFeature, item, {
      profile: selection.selector,
      app: deps.app,
    });

  const [previews, styles] = await Promise.all([
    deps.noteFeature.prepareCreationProfiles(item),
    deps.zoteroPref.dataDir ? listInstalledStyles(deps.zoteroPref.dataDir) : [],
  ]);
  let created: CreatedProfile | undefined;
  const choice = await chooseLiteratureNoteProfile(deps.app, {
    preselected: selection.selector,
    source: selection.source,
    reason: selection.rule && describeRule(selection.rule),
    problem: selection.problem && describeSelectionProblem(selection.problem),
    previews,
    styles,
    onImport: async () => {
      await deps.importProfile({ indexedKey: item.indexedKey });
    },
    onNew: async () => {
      created = await deps.createProfile({
        indexedKey: item.indexedKey,
        useForNote: true,
      });
      return created
        ? { id: created.profile.id, label: created.profile.label }
        : undefined;
    },
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
  const preview =
    created?.preview ??
    previews.find(({ selector }) => selector === choice.id)!;
  return createNoteTaskWithToast(() => preview.create(), { app: deps.app });
}
