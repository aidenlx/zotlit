// Once-per-launch release check: onboarding branch, the update the banner announces, Release Note.

import { TFile } from "obsidian";

import { DOCS_COMPANION } from "@/lib/constants";
import { Cause, Context, Deferred, Effect, Layer } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { ObsidianApp } from "@/lib/obsidian-app";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import type {
  SettingsMutationError,
  SettingsPatch,
} from "@/services/settings/service";

import { releaseNoteUrl, V1_TEMPLATE_FOLDER } from "./constants";
import { decideRelease } from "./decide";
import type { ReleaseDecision } from "./decide";

const WEBVIEWER_PLUGIN_ID = "webviewer";
const WEBVIEWER_VIEW_TYPE = "webviewer";

/** v1's ejected template filenames, e.g. `zt-note.eta.md`; matches the `zt-*.eta.md` glob. */
const V1_EJECTED_TEMPLATE = /^zt-.+\.eta\.md$/i;

export class Release extends Context.Service<
  Release,
  {
    /** The running version, which the banner names in its update section. */
    readonly version: string;
    /** Settles once the launch check has run and opened what it opens. Never fails. */
    readonly checked: Effect.Effect<void>;
    /**
     * Open the Release Note for the current version — reusing or creating a Web
     * Viewer leaf when that core plugin is enabled, else the system browser. The
     * external page only ever opens from a user action, never automatically.
     */
    openReleaseNote(): Effect.Effect<void>;
    /**
     * Clear the Migration Prompt flag by hand. The setting-tab reminder's
     * "Mark as done" control and the dismiss control of the Welcome View banner
     * wire this up. No-op when the flag is already clear.
     */
    acknowledgeMigration(): Effect.Effect<void, SettingsMutationError>;
    /**
     * Mark the update of the running version as seen, so the banner announces
     * the next one only: "What's new" and the banner's dismiss control wire
     * this up. No-op when no update is pending.
     */
    acknowledgeUpdate(): Effect.Effect<void, SettingsMutationError>;
    /** True when `folderPath` holds at least one ejected `zt-*.eta.md` template. */
    hasV1Templates(folderPath: string): Effect.Effect<boolean>;
  }
>()("zotlit/release/Release") {}

export function layerRelease(options: {
  /** The plugin's current version, from the manifest. */
  readonly version: string;
  readonly openFirstScreen?: () => void | Promise<void>;
}): Layer.Layer<Release, never, ObsidianApp | PluginSettings> {
  return Layer.effect(
    Release,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      const settings = yield* PluginSettings;
      const checked = yield* Deferred.make<void>();
      const events = yield* obsidianEvents<{ layoutReady: [] }>();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      let stopped = false;

      const hasV1Templates = (folderPath: string): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const folder = app.vault.getFolderByPath(folderPath);
          if (!folder) return false;
          return folder.children.some(
            (child) =>
              child instanceof TFile && V1_EJECTED_TEMPLATE.test(child.name),
          );
        });

      const openReleaseNote = Effect.fn("Release.openReleaseNote")(
        function* () {
          const url = releaseNoteUrl(options.version);
          const { workspace } = app;
          if (!app.internalPlugins.getEnabledPluginById(WEBVIEWER_PLUGIN_ID)) {
            window.open(url);
            yield* Effect.logInfo("Opened Release Note").pipe(
              Effect.annotateLogs({ url, target: "system-browser" }),
            );
            return;
          }
          const leaf =
            workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE)[0] ??
            workspace.getLeaf("tab");
          yield* Effect.promise(async () => {
            await leaf.setViewState({
              type: WEBVIEWER_VIEW_TYPE,
              active: true,
              state: { url },
            });
            void workspace.revealLeaf(leaf);
          });
          yield* Effect.logInfo("Opened Release Note").pipe(
            Effect.annotateLogs({ url, target: "web-viewer" }),
          );
        },
        Effect.catchCause((cause) =>
          Effect.logWarning("Cannot open the release note").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
          ),
        ),
      );

      const acknowledgeMigration = Effect.fn("Release.acknowledgeMigration")(
        function* () {
          const current = yield* settings.current;
          if (current["release.migration-pending"] !== true) return;
          yield* settings.update({ "release.migration-pending": false });
          yield* Effect.logInfo("Migration Prompt acknowledged");
        },
      );

      const acknowledgeUpdate = Effect.fn("Release.acknowledgeUpdate")(
        function* () {
          const current = yield* settings.current;
          if (current["release.update-pending"] !== true) return;
          yield* settings.update({ "release.update-pending": false });
          yield* Effect.logInfo("Update acknowledged").pipe(
            Effect.annotateLogs({ version: options.version }),
          );
        },
      );

      const recordState = Effect.fn("Release.recordState")(function* (
        current: Readonly<Settings>,
        decision: ReleaseDecision,
      ) {
        const patch: SettingsPatch = {};
        if (current["release.previous-version"] !== decision.recordVersion) {
          patch["release.previous-version"] = decision.recordVersion;
        }
        if (
          decision.setMigrationPending !== undefined &&
          current["release.migration-pending"] !== decision.setMigrationPending
        ) {
          patch["release.migration-pending"] = decision.setMigrationPending;
        }
        if (
          decision.setUpdatePending !== undefined &&
          current["release.update-pending"] !== decision.setUpdatePending
        ) {
          patch["release.update-pending"] = decision.setUpdatePending;
        }
        if (
          decision.setTemplateFolder !== undefined &&
          current["template.folder"] !== decision.setTemplateFolder
        ) {
          patch["template.folder"] = decision.setTemplateFolder;
        }
        if (Object.keys(patch).length > 0) yield* settings.update(patch);
      });

      const showCompanionNotice = (): void => {
        new BaseNotice(
          BaseNotice.render((renderer) => {
            renderer.setTitle(m.companion_zotero_10_guidance());
            renderer.addAction((button) => {
              button
                .setButtonText(m.notice_update_see_whats_new())
                .onClick(() => void runPromise(openReleaseNote()));
            });
            renderer.addAction((button) => {
              button
                .setButtonText(m.notice_companion_install_action())
                .onClick(() => window.open(DOCS_COMPANION));
            });
          }),
          0,
        );
      };

      const runCheck = Effect.fn("Release.runCheck")(function* () {
        const current = yield* settings.current;
        if (stopped) return;

        const origin = (yield* settings.hydrationOrigin) ?? "current";
        const migrationPending = current["release.migration-pending"];
        // Absent origin probes v1's default folder for templates-only detection;
        // a pending flag instead probes the user's configured folder to decide
        // whether the flag should auto-clear.
        const legacyTemplatesPresent =
          origin === "absent"
            ? yield* hasV1Templates(V1_TEMPLATE_FOLDER)
            : migrationPending
              ? yield* hasV1Templates(current["template.folder"])
              : false;

        const decision = decideRelease({
          origin,
          recordedVersion: current["release.previous-version"],
          currentVersion: options.version,
          migrationPending,
          noticesEnabled: current["release.notices-enabled"],
          legacyTemplatesPresent,
        });

        yield* recordState(current, decision);

        yield* Effect.logInfo("Release check complete").pipe(
          Effect.annotateLogs({
            branch: decision.branch,
            legacyTemplatesPresent,
          }),
        );
        switch (decision.branch) {
          case "companion-notice":
            showCompanionNotice();
            break;
          // An update opens the first screen too: its banner announces the update
          // while `release.update-pending` holds.
          case "update":
          case "welcome-fresh":
          case "welcome-upgraded":
            yield* Effect.promise(async () => {
              await options.openFirstScreen?.();
            });
            break;
          case "none":
            break;
        }
      });

      // `onLayoutReady` is a one-shot with no unregister, so gate the deferred
      // check on disposal to avoid touching settings after the plugin unloads.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopped = true;
        }).pipe(Effect.andThen(Deferred.succeed(checked, undefined))),
      );

      // The launch check needs settings loaded and the workspace ready to open
      // leaves; the layer settles before the check runs.
      app.workspace.onLayoutReady(events.callback("layoutReady"));
      yield* events
        .consume(() =>
          runCheck().pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Release check failed").pipe(
                Effect.annotateLogs({ error: Cause.squash(cause) }),
              ),
            ),
            Effect.ensuring(Deferred.succeed(checked, undefined)),
          ),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }));

      return Release.of({
        version: options.version,
        checked: Deferred.await(checked),
        openReleaseNote,
        acknowledgeMigration,
        acknowledgeUpdate,
        hasV1Templates,
      });
    }).pipe(withLogCategory("release")),
  );
}
