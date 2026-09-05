// Shared creation prompt for Quick Switch, citation navigation, and Companion links.
import type { App, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
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

import type {
  CreationProfileSelection,
  CreationProfileSources,
  CreationSelectionProblem,
  NoteFeature,
  PreparedCreationProfile,
} from "./operations";
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

export interface InteractiveCreationOptions extends CreationProfileSources {
  /**
   * Create at once when a manual choice, explicit input, or rule resolves the
   * Profile, then report the Profile and path. Citation and Companion links
   * set it; Quick Switch leaves it unset and confirms through the picker.
   */
  direct?: boolean;
}

export async function createNoteInteractively(
  deps: InteractiveCreationDeps,
  item: Item,
  { direct = false, ...sources }: InteractiveCreationOptions = {},
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
  // The selection is fixed for this operation; a Profile that became
  // unavailable since asks for another choice instead of a different target.
  let problem = selection.problem;
  if (direct && selection.source !== "bound" && !problem) {
    const preview = previews.find(
      ({ selector }) => selector === selection.selector,
    );
    if (preview && !preview.unavailable) {
      logger.debug("Creating Literature Note from a resolved Profile", {
        indexedKey: item.indexedKey,
        selector: selection.selector,
        source: selection.source,
        rule: selection.rule?.id,
        path: preview.path,
      });
      return createPrepared(preview, deps.app);
    }
    problem = unavailableSelection(selection);
  }
  let created: CreatedProfile | undefined;
  const choice = await chooseLiteratureNoteProfile(deps.app, {
    preselected: selection.selector,
    source: selection.source,
    reason: selection.rule && describeRule(selection.rule),
    problem: problem && describeSelectionProblem(problem),
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

/** Write through the prepared preview and report its Profile and path. */
function createPrepared(
  preview: PreparedCreationProfile,
  app: App,
): Promise<TFile | null> {
  return createNoteTaskWithToast(() => preview.create(), {
    app,
    created: (file) =>
      m.notice_created_note_under_profile({
        profile: preview.label ?? m.settings_profile_default_name(),
        path: file.path,
      }),
  });
}

/** The resolved Profile lost its preview: the same problem its source reports. */
function unavailableSelection(
  selection: Exclude<CreationProfileSelection, { source: "bound" }>,
): CreationSelectionProblem {
  return selection.source === "rule"
    ? {
        kind: "unavailable-target",
        rule: selection.rule,
        selector: selection.selector,
      }
    : {
        kind: "invalid-selector",
        source: selection.source,
        selector: selection.selector,
      };
}
