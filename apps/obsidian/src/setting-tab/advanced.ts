import { Effect } from "effect";
import { strToU8, zipSync } from "fflate";
import type { SettingDefinitionItem } from "obsidian";

import { awaitConfirm } from "@/lib/confirm";
import { withLogCategory } from "@/lib/effect-log-category";
import { exportTimestamp, saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError, portCall } from "@/lib/legacy-port";
import { reportOutcome } from "@/lib/notifier";
import { Vault } from "@/lib/obsidian-vault";
import { requireElectron } from "@/lib/require";
import { LOG_FILENAME } from "@/services/log/service";
import { isLogLevel, LOG_LEVELS } from "@/services/settings/schema";
import type { LogLevel } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import {
  profileCustomization,
  saveProfileCustomization,
} from "@/views/template-workbench/preferences";

import type { SettingsKey, SettingTabContext } from "./context";
import { localServerItems } from "./local-server";
import {
  clearExcerptCache,
  resetCitationIndex,
  resetLanguagePacks,
} from "./recovery";
import { templateEngineItems } from "./templates";

const LOG_LEVEL_OFF_KEY = "off";

/** The vault path of the plugin's log file. */
const logPath = (ctx: SettingTabContext) =>
  `${ctx.manifest.dir}/${LOG_FILENAME}`;

/** The settings key whose stored `LogLevel | null` maps through {@link encodeLogLevel}. */
export const LOG_LEVEL_KEY: SettingsKey = "log.level";

/**
 * Maps stored `LogLevel | null` to a dropdown string (`null` → `"off"`).
 * @see decodeLogLevel
 */
export function encodeLogLevel(value: unknown): string {
  const level = value as LogLevel | null;
  return level ?? LOG_LEVEL_OFF_KEY;
}

/**
 * Maps a dropdown string back to stored `LogLevel | null` (`"off"` → `null`).
 * @throws if `value` is not a known log level or the sentinel.
 * @see encodeLogLevel
 */
export function decodeLogLevel(value: unknown): LogLevel | null {
  const key = value as string;
  if (key === LOG_LEVEL_OFF_KEY) return null;
  if (isLogLevel(key)) return key;
  throw new Error(`Unknown log level dropdown key: ${key}`);
}

const LOG_LEVEL_OPTIONS: Record<string, string> = (() => {
  const opts: Record<string, string> = {
    [LOG_LEVEL_OFF_KEY]: m.settings_log_level_off(),
  };
  for (const level of LOG_LEVELS) opts[level] = level;
  return opts;
})();

/**
 * Items for the "Advanced" sub-page: the rows a user touches once — update
 * notices, the template engine, logging, and recovery actions.
 */
export function advancedPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const fileDisabled = (): boolean =>
    !ctx.tab.sync(PluginSettings.use((settings) => settings.current))[
      "log.to-file"
    ];
  return [
    ...(ctx.webWorkbenchEnabled
      ? [
          {
            id: "template_workbench_preference",
            name: m.template_workbench_preference_name(),
            desc: m.template_workbench_preference_desc(),
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOptions({
                    ask: m.template_workbench_preference_ask(),
                    web: m.template_workbench_preference_web(),
                    native: m.template_workbench_name(),
                  })
                  .setValue(profileCustomization(ctx.app))
                  .onChange((value) => {
                    if (
                      value === "ask" ||
                      value === "web" ||
                      value === "native"
                    )
                      saveProfileCustomization(ctx.app, value);
                  }),
              );
            },
          } satisfies SettingDefinitionItem<SettingsKey>,
        ]
      : []),
    {
      id: "settings_update_notices",
      name: m.settings_update_notices_name(),
      desc: m.settings_update_notices_desc(),
      control: { type: "toggle", key: "release.notices-enabled" },
    },
    {
      type: "group",
      id: "settings_advanced_template_engine",
      heading: m.settings_advanced_template_engine_heading(),
      items: templateEngineItems(ctx),
    },
    {
      type: "group",
      id: "settings_advanced_local_server",
      heading: m.settings_advanced_local_server_heading(),
      items: localServerItems(ctx),
    },
    {
      type: "group",
      id: "settings_advanced_logging",
      heading: m.settings_advanced_logging_heading(),
      items: [
        {
          id: "settings_log_level",
          name: m.settings_log_level_name(),
          desc: m.settings_log_level_desc(),
          control: {
            type: "dropdown",
            key: "log.level",
            defaultValue: LOG_LEVEL_OFF_KEY,
            options: LOG_LEVEL_OPTIONS,
          },
        },
        {
          id: "settings_log_to_file",
          name: m.settings_log_to_file_name(),
          desc: m.settings_log_to_file_desc(),
          control: { type: "toggle", key: "log.to-file" },
        },
        {
          id: "settings_log_open_file",
          name: m.settings_log_open_file_name(),
          desc: m.settings_log_open_file_desc(),
          disabled: fileDisabled,
          action: () => void ctx.tab.run(openLogFile(logPath(ctx))),
        },
        {
          id: "settings_log_export",
          name: m.settings_log_export_name(),
          desc: m.settings_log_export_desc(),
          disabled: fileDisabled,
          action: () => void ctx.tab.run(exportLogArchive(logPath(ctx))),
        },
      ],
    },
    {
      type: "group",
      id: "settings_advanced_recovery",
      heading: m.settings_advanced_recovery_heading(),
      items: [
        {
          id: "settings_excerpt_cache_clear",
          name: m.settings_excerpt_cache_clear_name(),
          desc: m.settings_excerpt_cache_clear_desc(),
          action: () =>
            void ctx.tab.run(
              clearExcerptCache(
                awaitConfirm(
                  {
                    title: m.settings_excerpt_cache_clear_name(),
                    content: m.settings_excerpt_cache_clear_confirm_body(),
                    action: m.settings_excerpt_cache_clear_action(),
                    destructive: true,
                  },
                  ctx.app,
                ),
              ),
            ),
        },
        {
          id: "settings_citation_index_reset",
          name: m.settings_citation_index_reset_name(),
          desc: m.settings_citation_index_reset_desc(),
          action: () =>
            void ctx.tab.run(
              resetCitationIndex(
                awaitConfirm(
                  {
                    title: m.settings_citation_index_reset_confirm_title(),
                    content: m.settings_citation_index_reset_confirm_body(),
                    action: m.settings_citation_index_reset_action(),
                    destructive: true,
                  },
                  ctx.app,
                ),
              ),
            ),
        },
        {
          id: "settings_language_pack_reset",
          name: m.settings_language_pack_reset_name(),
          desc: m.settings_language_pack_reset_desc(),
          action: () =>
            void ctx.tab.run(
              resetLanguagePacks(
                awaitConfirm(
                  {
                    title: m.settings_language_pack_reset_confirm_title(),
                    content: m.settings_language_pack_reset_confirm_body(),
                    action: m.settings_language_pack_reset_action(),
                    destructive: true,
                  },
                  ctx.app,
                ),
              ),
              m.settings_failed_language_pack_reset(),
            ),
        },
      ],
    },
  ];
}

/**
 * Open the log file at the vault path `path` in the system's default app. It
 * fails with a `LegacyPortError` when the system names a reason it cannot.
 */
export const openLogFileInSystem = Effect.fnUntraced(function* (path: string) {
  const fullPath = yield* (yield* Vault).fullPath(path);
  // Desktop-only plugin: the vault is always on a file system.
  if (fullPath === null)
    return yield* Effect.die(new Error("The vault is not on disk"));
  const refused = yield* portCall("open-log-file", () =>
    requireElectron().shell.openPath(fullPath),
  );
  if (refused)
    return yield* new LegacyPortError({
      step: "open-log-file",
      cause: new Error(refused),
    });
});

/**
 * {@link openLogFileInSystem} for the settings row. A failure is logged and a
 * notice tells the user.
 */
const openLogFile = Effect.fn("SettingTab.openLogFile")(
  function* (path: string) {
    yield* reportOutcome(openLogFileInSystem(path), {
      success: () => undefined,
      error: () => m.notice_open_log_file_failed(),
    }).pipe(Effect.annotateLogs({ path }));
  },
  withLogCategory("setting-tab", "advanced"),
);

/**
 * Save the log file at the vault path `path` as a zip the user downloads. It
 * fails with the Vault's read error when the log file cannot be read.
 */
export const saveLogArchive = Effect.fnUntraced(function* (path: string) {
  const text = yield* (yield* Vault).readPath(path);
  yield* Effect.sync(() => {
    const zipBytes = zipSync({ [LOG_FILENAME]: strToU8(text) });
    const blob = new Blob([zipBytes as BlobPart], {
      type: "application/zip",
    });
    saveFile(blob, `zotlit-logs-${exportTimestamp()}.zip`);
  });
});

/**
 * {@link saveLogArchive} for the settings row. A failure is logged and a
 * notice tells the user.
 */
const exportLogArchive = Effect.fn("SettingTab.exportLogArchive")(
  function* (path: string) {
    yield* reportOutcome(saveLogArchive(path), {
      success: () => undefined,
      error: () => m.notice_export_log_file_failed(),
    }).pipe(Effect.annotateLogs({ path }));
  },
  withLogCategory("setting-tab", "advanced"),
);
