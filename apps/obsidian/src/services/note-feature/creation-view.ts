// Shared creation prompt for Quick Switch, citation navigation, and Companion links.
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { Notifier } from "@/lib/notifier";
import { listInstalledStyles } from "@/services/pandoc/styles";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type {
  CreateProfileDialog,
  ImportProfileDialog,
} from "@/setting-tab/profile-dialogs";
import { openLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";
import type {
  LiteratureNoteProfileChoice,
  ProfilePick,
} from "@/views/quick-switch/profile-picker";

import type {
  CreateNoteResult,
  CreationProfileSelection,
  CreationProfileSources,
  CreationSelectionProblem,
  NoteFeatureHandle,
} from "./operations";
import { describeSelectionProblem } from "./selection-copy";
import { NoteFeature } from "./service";
import { createWithNotice } from "./update-single";

const logged = withLogCategory("note-feature");

/**
 * The values the interactive creation opens: the Profile dialogs of the
 * setting tab, which run in the caller's fiber, and the App the picker and
 * the notices' recovery actions open in.
 */
export interface InteractiveCreationPorts {
  readonly app: App;
  readonly createProfile: CreateProfileDialog;
  readonly importProfile: ImportProfileDialog;
}

/** What a view holds to create a note through the Profile selection. */
export interface InteractiveCreationDeps {
  noteFeature: Pick<NoteFeatureHandle, "createNoteInteractively">;
}

export interface InteractiveCreationOptions extends CreationProfileSources {
  /**
   * Create at once after a manual choice or explicit input. Citation and
   * Companion links set it; unique matches create at once on every surface.
   */
  direct?: boolean;
}

/**
 * The CSL styles installed in the Zotero data folder, for the Profile picker's
 * previews; none without a data folder.
 */
export const installedStyles = Effect.gen(function* () {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  return dataDir
    ? yield* portCall("list-styles", () => listInstalledStyles(dataDir))
    : [];
});

/**
 * What a Profile picker's answer settles to: the Profile the user chose, or
 * the one the New profile dialog made, whose answer `created` holds. An
 * import, a closed picker and a closed dialog settle to no choice. The dialog
 * runs in this fiber, so an interrupt closes it. A New profile dialog that
 * fails is logged, and a notice tells the user.
 */
export const settleProfilePick = Effect.fnUntraced(function* (
  ports: Pick<InteractiveCreationPorts, "createProfile" | "importProfile">,
  pick: ProfilePick | undefined,
  options: { indexedKey: string | undefined; useForNote: boolean },
) {
  if (!pick || !("action" in pick))
    return { choice: pick, created: undefined } as const;
  if (pick.action === "import") {
    yield* ports.importProfile({ indexedKey: options.indexedKey });
    return { choice: undefined, created: undefined } as const;
  }
  const notifier = yield* Notifier;
  const created = yield* ports
    .createProfile(options)
    .pipe(
      recover(
        (cause) =>
          Effect.logError("Failed to open Profile creation", cause).pipe(
            Effect.andThen(notifier.show(m.notice_profile_action_failed())),
            Effect.asVoid,
          ),
        Effect.undefined,
      ),
    );
  const choice: LiteratureNoteProfileChoice | undefined = created && {
    id: created.profile.id,
    label: created.profile.label,
  };
  return { choice, created } as const;
});

/**
 * Create `item`'s Literature Note through the Profile selection, asking for a
 * Profile where the selection says to. Returns the created file, or `null`
 * when the user cancels or the create wrote nothing or failed: the create
 * notice told the user. A failed plan fails the Effect. An interrupt closes
 * the picker.
 */
export const createNoteInteractively = Effect.fn("createNoteInteractively")(
  function* (
    ports: InteractiveCreationPorts,
    item: Item,
    { direct = false, ...sources }: InteractiveCreationOptions = {},
  ) {
    const noteFeature = yield* NoteFeature;
    const [plans, styles] = yield* Effect.all(
      [noteFeature.planCreations([item.indexedKey], sources), installedStyles],
      { concurrency: "unbounded" },
    );
    const { selection, previews } = plans.get(item.indexedKey)!;
    if (!selection.shouldAsk && selection.source === "bound")
      return yield* createWithNotice(
        noteFeature.createNote(item, { profile: selection.selector }),
        { app: ports.app },
      );

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
        yield* Effect.logDebug(
          "Creating Literature Note from a resolved Profile",
        ).pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            selector: selection.selector,
            source: selection.source,
            path: preview.path,
          }),
          logged,
        );
        return yield* createPrepared(
          preview.create(),
          { label: preview.label, reason: selection.reason },
          ports.app,
        );
      }
      problem = unavailableSelection(selection);
    }
    const pick = yield* awaitModal<ProfilePick | undefined>((resolve) =>
      openLiteratureNoteProfile(
        ports.app,
        {
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
        },
        resolve,
      ),
    );
    const { choice, created } = yield* settleProfilePick(ports, pick, {
      indexedKey: item.indexedKey,
      useForNote: true,
    });
    if (!choice) {
      yield* Effect.logDebug(
        "Cancelled Literature Note Profile selection",
      ).pipe(Effect.annotateLogs({ indexedKey: item.indexedKey }), logged);
      return null;
    }
    yield* Effect.logDebug("Confirmed Literature Note Profile selection").pipe(
      Effect.annotateLogs({ indexedKey: item.indexedKey, selector: choice.id }),
      logged,
    );
    if (created) {
      const { preview, profile } = created;
      // The New profile dialog prepared this write: it writes the path the
      // dialog showed, and an interrupt stops it.
      return yield* createPrepared(
        preview.create,
        { label: profile.label },
        ports.app,
      );
    }
    const chosen = previews.find(({ selector }) => selector === choice.id)!;
    return yield* createPrepared(
      chosen.create(),
      { label: chosen.label },
      ports.app,
    );
  },
);

/** Write through the prepared preview and report its Profile and path. */
function createPrepared<E, R>(
  create: Effect.Effect<CreateNoteResult, E, R>,
  copy: { label?: string; reason?: string },
  app: App,
) {
  return createWithNotice(create, {
    app,
    created: (file) => createdNoteNotice(file, copy),
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
