// The Profile dialogs as Effects. Each reads the Profile, Template and Note
// Feature tags, opens its modal, and answers when the modal closes. A modal's
// callbacks run on a runner the dialog's Scope owns, so an interrupt closes
// the modal and stops the work its callbacks started.
import { Effect, FiberSet, Schema } from "effect";
import type { App } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { awaitModal } from "@/lib/effect-modal";
import type { ClosableModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { Notifier } from "@/lib/notifier";
import { Vault } from "@/lib/obsidian-vault";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { LibraryScope } from "@/services/library-scope/service";
import { installedStyles } from "@/services/note-feature/creation-view";
import { NoteFeature } from "@/services/note-feature/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { Profile, ProfileOperationError } from "@/services/profile/service";
import type {
  PreparedProfileCreation,
  PreparedProfileImport,
  ProfileCreation,
  ProfileImport,
} from "@/services/profile/service";
import { readTemplateData } from "@/services/template-workbench/data";
import type { TemplateDataServices } from "@/services/template-workbench/data";
import { readMigrationVerificationData } from "@/services/template/migration-data";
import { Template } from "@/services/template/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { CreateProfileModal } from "./create-profile-modal";
import type {
  CreatedProfile,
  CreateProfileOptions,
  ProfileCreationData,
} from "./create-profile-modal";
import { ImportProfileModal, readImportSource } from "./import-profile-modal";
import type { ImportSource } from "./import-profile-modal";
import { ProfileDestinationModal } from "./profile-destination-modal";
import { ShareProfileModal } from "./share-profile-modal";

/** What the Profile dialogs read. */
export type ProfileDialogServices =
  | Profile
  | Template
  | NoteFeature
  | Notifier
  | Vault
  | ZoteroPref
  | TemplateDataServices
  | LibraryScope;

/** What a modal's callbacks run on. */
type DialogServices = Profile | Template | NoteFeature;

/** Runs a modal callback's Effect on the dialog's runner. */
type DialogRun = <A, E>(
  effect: Effect.Effect<A, E, DialogServices>,
) => Promise<A>;

/** A Profile document the dialog created is not in the vault. */
export class ProfileDocumentMissing extends Schema.TaggedError<
  ProfileDocumentMissing,
  { readonly brand: unique symbol }
>()("ProfileDocumentMissing", { path: Schema.String }) {
  override get message(): string {
    return m.notice_profile_action_failed();
  }
}

/**
 * The modal `open` builds, opened over a runner of the dialog's own, answered
 * with what its `result` settles with. An interrupt closes the modal, and the
 * dialog's Scope then interrupts the work its callbacks started.
 */
function runDialog<A>(
  open: (run: DialogRun) => ClosableModal & {
    open(): void;
    readonly result: Promise<A>;
  },
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const run = yield* FiberSet.makeRuntimePromise<DialogServices>();
      return yield* awaitModal<A>((settle) => {
        const modal = open(run);
        void modal.result.then(settle);
        modal.open();
        return modal;
      });
    }),
  );
}

/** The default Profile, which every dialog's fields fall back to. */
const defaultProfile = Effect.gen(function* () {
  const base = yield* (yield* Profile).resolveProfile("default");
  if (!base)
    return yield* new ProfileOperationError({
      message: m.notice_profile_action_failed(),
      cause: undefined,
    });
  return base;
});

/**
 * The item data a dialog previews its note with: `indexedKey`'s item, or one
 * real item in scope. `null` when none is at hand or the read fails.
 */
const previewData = (indexedKey: string | undefined) =>
  Effect.gen(function* () {
    if (!indexedKey) {
      const data = yield* readMigrationVerificationData({ annotation: false });
      return data
        ? { note: data.note as NoteTemplateContext, filename: data.filename }
        : null;
    }
    const [note, filename] = yield* Effect.all(
      [
        readTemplateData(indexedKey, "note"),
        readTemplateData(indexedKey, "filename"),
      ],
      { concurrency: "unbounded" },
    );
    return note.kind === "data" && filename.kind === "data"
      ? { note: note.data as NoteTemplateContext, filename: filename.data }
      : null;
  }).pipe(
    recover(
      (cause) =>
        Effect.logWarning("Profile preview data is unavailable", cause).pipe(
          Effect.annotateLogs({ indexedKey }),
        ),
      Effect.succeed<ProfileCreationData | null>(null),
    ),
  );

/** The note `profile` would create for `data` from the document `source`. */
const previewNote = (
  data: ProfileCreationData,
  profile: ResolvedProfile,
  source: string,
) =>
  Effect.gen(function* () {
    const document =
      yield* (yield* Template).prepareLiteratureNoteTemplateSource(source);
    return yield* (yield* NoteFeature).prepareProfileNote({
      profile,
      document,
      ...data,
    });
  });

/** A creation plan whose write runs on `run`. */
const creationOn = (
  plan: ProfileCreation,
  run: DialogRun,
): PreparedProfileCreation => ({ ...plan, create: () => run(plan.create()) });

/**
 * The New profile dialog. It answers the created Profile and the note it
 * previewed, whose `create` writes that note at the path the dialog showed;
 * `undefined` when the user cancels.
 */
export const createProfileDialog = Effect.fn("createProfileDialog")(function* (
  app: App,
  options: CreateProfileOptions = {},
) {
  const profile = yield* Profile;
  const [data, styles, base, profiles] = yield* Effect.all(
    [
      previewData(options.indexedKey),
      installedStyles,
      defaultProfile,
      profile.profiles,
    ],
    { concurrency: "unbounded" },
  );
  const created = yield* runDialog<CreatedProfile | undefined>(
    (run) =>
      new CreateProfileModal(
        {
          app,
          base,
          profiles,
          prepareCreate: (create) =>
            run(
              profile
                .prepareCreate(create)
                .pipe(Effect.map((plan) => creationOn(plan, run))),
            ),
          previewNote: data
            ? (draft, source) => run(previewNote(data, draft, source))
            : undefined,
        },
        { ...options, styles },
      ),
  );
  if (created && !options.useForNote)
    yield* (yield* Notifier).show(
      m.notice_profile_created({ label: created.profile.label }),
    );
  return created;
});

/**
 * Import a Profile from `source`, or from the source the user picks, after
 * the user consents. Answers the imported Profile, or `undefined` when the
 * user cancels or the import cannot start; a notice then says why.
 */
export const importProfileDialog = Effect.fn("importProfileDialog")(
  function* (
    app: App,
    options: { indexedKey?: string; source?: ImportSource } = {},
  ) {
    const notifier = yield* Notifier;
    const source = yield* portCall("read-profile-source", () =>
      readImportSource(app, options.source),
    );
    if (source === undefined) return undefined;
    const profile = yield* Profile;
    const plan = yield* profile
      .prepareImport(source, {})
      .pipe(
        Effect.catchTag("ProfileOperationError", (error) =>
          Effect.logDebug("Refused Profile import source", error).pipe(
            Effect.andThen(
              notifier.show(error.message || m.profile_import_invalid()),
            ),
            Effect.as(undefined),
          ),
        ),
      );
    if (!plan) return undefined;
    const [data, styles] =
      plan.kind === "replace"
        ? [null, []]
        : yield* Effect.all(
            [previewData(options.indexedKey), installedStyles],
            { concurrency: "unbounded" },
          );
    const base = yield* defaultProfile;
    const runSync = Effect.runSyncWith(yield* Effect.context<never>());
    const importOn = (
      plan: ProfileImport,
      run: DialogRun,
    ): PreparedProfileImport => ({
      ...plan,
      previewSource: (preview) => runSync(plan.previewSource(preview)),
      import: (choice) => run(plan.import(choice)),
    });
    return yield* runDialog(
      (run) =>
        new ImportProfileModal(
          {
            app,
            base,
            prepareImport: (text, choice) =>
              run(
                profile
                  .prepareImport(text, choice)
                  .pipe(Effect.map((next) => importOn(next, run))),
              ),
            previewNote: data
              ? (draft, text) => run(previewNote(data, draft, text))
              : undefined,
          },
          { source, plan: importOn(plan, run), styles },
        ),
    );
  },
  (effect) =>
    Notifier.use((notifier) =>
      effect.pipe(
        recover(
          (cause) =>
            Effect.logError("Failed to open Profile import", cause).pipe(
              Effect.andThen(notifier.show(m.notice_profile_action_failed())),
              Effect.asVoid,
            ),
          Effect.undefined,
        ),
      ),
    ),
);

/**
 * Add profile from settings: ask a name and folder, create the document, and
 * open it in the Template Workbench to name its look.
 */
export const addProfileDestination = Effect.fn("addProfileDestination")(
  function* (app: App) {
    const profile = yield* Profile;
    const base = yield* defaultProfile;
    const created = yield* runDialog(
      (run) =>
        new ProfileDestinationModal({
          app,
          defaultFolder: base.bindings["note.literature-folder"],
          prepareCreate: (create) =>
            run(
              profile
                .prepareCreate(create)
                .pipe(Effect.map((plan) => creationOn(plan, run))),
            ),
        }),
    );
    if (!created) return;
    app.setting.close();
    const file = yield* (yield* Vault).getFileByPath(created.path);
    if (!file) return yield* new ProfileDocumentMissing({ path: created.path });
    yield* portCall("open-template-workbench", () =>
      openTemplateWorkbench(app, file, { tab: "name", customize: true }),
    );
    yield* (yield* Notifier).show(
      m.notice_profile_created({ label: created.label }),
    );
  },
);

/** Open the Share dialog over one snapshot of `selector`'s Profile. */
export const shareProfile = Effect.fn("shareProfile")(function* (
  app: App,
  selector: ProfileSelector,
) {
  const plan = yield* (yield* Profile).prepareShare(selector);
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  new ShareProfileModal(app, {
    ...plan,
    render: (options) => runSync(plan.render(options)),
  }).open();
});
