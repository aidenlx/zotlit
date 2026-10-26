// Welcome gestures run on the plugin's view registry; conversions belong to one banner.
import { Cause, Effect, Exit } from "effect";

import { AbortError } from "@/lib/abort-error";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { requireDialog } from "@/lib/require";
import { viewRuntime } from "@/lib/view-atoms";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";
import type { SettingsPatch } from "@/services/settings/service";
import { plainTemplateError } from "@/services/template/errors";
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

export const makeConversionCommand = () =>
  viewRuntime.fn(
    (request: {
      readonly retry: boolean;
      readonly result: PromiseWithResolvers<LiteratureNoteTemplateMigrationResult>;
    }) =>
      Effect.gen(function* () {
        const migration = yield* TemplateMigration;
        const result = yield* request.retry
          ? migration.retryCleanup
          : migration.convert;
        new BaseNotice(templateMigrationNotice(result));
        request.result.resolve(result);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit))
              request.result.reject(
                Cause.hasInterruptsOnly(exit.cause)
                  ? new AbortError()
                  : plainTemplateError(Cause.squash(exit.cause)),
              );
          }),
        ),
      ),
  );

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
