// Shared creation prompt for Quick Switch, citation navigation, and Companion links.
import type { App, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
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
  NoteFeatureHandle,
  PreparedCreationProfile,
} from "./operations";
import { describeSelectionProblem } from "./selection-copy";
import { createNoteTaskWithToast, createNoteWithToast } from "./update-single";

const logger = getLogger("note-feature");

export interface InteractiveCreationDeps {
  createProfile: CreateProfile;
  importProfile: ImportProfile;
  app: App;
  noteFeature: Pick<NoteFeatureHandle, "createNote" | "planCreations">;
  zoteroPref: Pick<PlainZoteroPref, "dataDir">;
}

export interface InteractiveCreationOptions extends CreationProfileSources {
  /**
   * Create at once after a manual choice or explicit input. Citation and
   * Companion links set it; unique matches create at once on every surface.
   */
  direct?: boolean;
}

export async function createNoteInteractively(
  deps: InteractiveCreationDeps,
  item: Item,
  { direct = false, ...sources }: InteractiveCreationOptions = {},
): Promise<TFile | null> {
  const [plans, styles] = await Promise.all([
    deps.noteFeature.planCreations([item.indexedKey], sources),
    deps.zoteroPref.dataDir ? listInstalledStyles(deps.zoteroPref.dataDir) : [],
  ]);
  const { selection, previews } = plans.get(item.indexedKey)!;
  if (!selection.shouldAsk && selection.source === "bound")
    return createNoteWithToast(deps.noteFeature, item, {
      profile: selection.selector,
      app: deps.app,
    });

  // The selection is fixed for this operation; a Profile that became
  // unavailable since asks for another choice instead of a different target.
  let problem = selection.problem;
  if (
    (!selection.shouldAsk || direct) &&
    selection.source !== "bound" &&
    !problem
  ) {
    const preview = previews.find(
      ({ selector }) => selector === selection.selector,
    );
    if (preview && !preview.unavailable) {
      logger.debug("Creating Literature Note from a resolved Profile", {
        indexedKey: item.indexedKey,
        selector: selection.selector,
        source: selection.source,
        path: preview.path,
      });
      return createPrepared(preview, deps.app, selection.reason);
    }
    problem = unavailableSelection(selection);
  }
  let created: CreatedProfile | undefined;
  const choice = await chooseLiteratureNoteProfile(deps.app, {
    preselected: selection.selector,
    source: selection.source,
    reason: selection.reason,
    candidates:
      problem?.kind === "overlap"
        ? problem.candidates.map(({ id }) => id)
        : undefined,
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
  if (created)
    return createPrepared(
      { ...created.preview, label: created.profile.label },
      deps.app,
    );
  return createPrepared(
    previews.find(({ selector }) => selector === choice.id)!,
    deps.app,
  );
}

/** Write through the prepared preview and report its Profile and path. */
function createPrepared(
  preview: Pick<PreparedCreationProfile, "create" | "label">,
  app: App,
  reason?: string,
): Promise<TFile | null> {
  return createNoteTaskWithToast(() => preview.create(), {
    app,
    created: (file) =>
      createdNoteNotice(file, { label: preview.label, reason }),
  });
}

/**
 * The words for a note created through a prepared Profile: the Match that
 * chose it, or the Profile it was made under, and the new note's path.
 */
export function createdNoteNotice(
  file: Pick<TFile, "path">,
  { label, reason }: { label?: string; reason?: string },
): string {
  return reason
    ? m.notice_created_note_from_match({ reason, path: file.path })
    : m.notice_created_note_under_profile({
        profile: label ?? m.settings_profile_default_name(),
        path: file.path,
      });
}

/** The resolved Profile lost its preview: the same problem its source reports. */
function unavailableSelection(
  selection: Exclude<CreationProfileSelection, { source: "bound" }>,
): CreationSelectionProblem {
  return { kind: "unavailable-profile", selector: selection.selector };
}
