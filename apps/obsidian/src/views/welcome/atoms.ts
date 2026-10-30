// Welcome gestures run on the plugin's view registry; conversions belong to one banner.
import { Cause, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { requireDialog } from "@/lib/require";
import { viewRuntime } from "@/lib/view-atoms";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";
import type { SettingsPatch } from "@/services/settings/service";
import { TemplateMigration } from "@/services/template/migration";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";
import { ZoteroPref } from "@/services/zotero-pref/service";

import { templateMigrationNotice } from "./migration-notice";

/** A settings write also flushes, so an immediate reload keeps the gesture. */
export const keepWelcomeCommand = viewRuntime.fn(
  (patch: SettingsPatch) =>
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      yield* settings.update(patch);
      yield* settings.flush;
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (error) =>
          Effect.logWarning(
            "The Welcome View banner could not keep its state",
            {
              error,
            },
          ),
      ),
      withLogCategory("welcome", "banner"),
    ),
  { concurrent: true },
);

export const dismissWelcomeCommand = viewRuntime.fn(
  () =>
    Effect.gen(function* () {
      const release = yield* Release;
      yield* Effect.gen(function* () {
        yield* release.acknowledgeMigration;
        yield* release.acknowledgeUpdate;
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (error) =>
            Effect.logWarning(
              "The Welcome View banner could not acknowledge the release",
              { error },
            ),
        ),
      );
      const settings = yield* PluginSettings;
      yield* settings.update({
        "welcome.dismissed": true,
        "welcome.requested": false,
        "welcome.steps-shown": false,
      });
      yield* settings.flush;
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (error) =>
          Effect.logWarning(
            "The Welcome View banner could not keep its state",
            {
              error,
            },
          ),
      ),
      withLogCategory("welcome", "banner"),
    ),
  { concurrent: true },
);

export const openReleaseNoteCommand = viewRuntime.fn(() =>
  Effect.gen(function* () {
    const release = yield* Release;
    yield* Effect.all([release.openReleaseNote, release.acknowledgeUpdate], {
      concurrency: "unbounded",
    });
  }),
);

/**
 * One banner's template conversion. Its result is the atom's value, which
 * the banner reads; closing the banner interrupts the conversion before its
 * notice.
 */
export const makeConversionCommand = () =>
  Atom.setIdleTTL(
    viewRuntime.fn((request: { readonly retry: boolean }) =>
      Effect.gen(function* () {
        const migration = yield* TemplateMigration;
        const result = yield* request.retry
          ? migration.retryCleanup
          : migration.convert;
        yield* Notifier.use((notifier) =>
          notifier.show(templateMigrationNotice(result)),
        );
        return { retry: request.retry, result };
      }).pipe(
        Effect.tapCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (error) =>
            Effect.logWarning(
              "The Welcome View banner could not convert the templates",
              { error },
            ),
        ),
        withLogCategory("welcome", "banner"),
      ),
    ),
    // A closed banner stops the conversion at once, not after the registry's
    // idle delay; the conversion's own writes still finish.
    0,
  );

/** What one run of the conversion command answered. */
export interface ConversionRun {
  readonly retry: boolean;
  readonly result: LiteratureNoteTemplateMigrationResult;
}

export const setFolderCommand = viewRuntime.fn((path: string) =>
  PluginSettings.use((settings) =>
    settings.updateDefaultLiteratureNoteProfileBindings({
      "note.literature-folder": path,
    }),
  ),
);

export const locateZoteroCommand = viewRuntime.fn(() =>
  Effect.gen(function* () {
    const pref = yield* ZoteroPref;
    const current = yield* pref.current;
    const result = yield* Effect.tryPromise(() =>
      requireDialog().showOpenDialog({
        title: m.settings_db_data_dir_dialog_title(),
        defaultPath: current.dataDir,
        properties: ["openDirectory"],
      }),
    );
    if (!result.canceled && result.filePaths.length > 0)
      yield* pref.setDataDir(result.filePaths[0]!);
  }).pipe(
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (error) =>
        Effect.logError("Failed to open Zotero data directory dialog", {
          error,
        }),
    ),
    withLogCategory("views", "welcome"),
  ),
);
