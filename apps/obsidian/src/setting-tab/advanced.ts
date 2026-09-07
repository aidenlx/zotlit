import { getLogLevels, isLogLevel } from "@logtape/logtape";
import { strToU8, zipSync } from "fflate";
import { FileSystemAdapter } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import { confirm } from "@/lib/confirm";
import { exportTimestamp, saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { requireElectron } from "@/lib/require";
import { LOG_FILENAME } from "@/services/log/service";
import type { LogLevel } from "@/services/settings/schema";

import type { SettingsKey, SettingTabContext } from "./context";
import { templateEngineItems } from "./templates";

const logger = getLogger(["setting-tab", "advanced"]);

const LOG_LEVEL_OFF_KEY = "off";

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
  for (const level of getLogLevels()) opts[level] = level;
  return opts;
})();

/**
 * Items for the "Advanced" sub-page: the rows a user touches once — update
 * notices, the template engine, logging, and recovery actions.
 */
export function advancedPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const fileDisabled = (): boolean => !ctx.settings.current?.["log.to-file"];
  return [
    {
      name: m.settings_update_notices_name(),
      desc: m.settings_update_notices_desc(),
      control: { type: "toggle", key: "release.notices-enabled" },
    },
    {
      type: "group",
      heading: m.settings_advanced_template_engine_heading(),
      items: templateEngineItems(ctx),
    },
    {
      type: "group",
      heading: m.settings_advanced_logging_heading(),
      items: [
        {
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
          name: m.settings_log_to_file_name(),
          desc: m.settings_log_to_file_desc(),
          control: { type: "toggle", key: "log.to-file" },
        },
        {
          name: m.settings_log_open_file_name(),
          desc: m.settings_log_open_file_desc(),
          disabled: fileDisabled,
          action: () => void openLogFile(ctx),
        },
        {
          name: m.settings_log_export_name(),
          desc: m.settings_log_export_desc(),
          disabled: fileDisabled,
          action: () => void exportLogArchive(ctx),
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_advanced_recovery_heading(),
      items: [
        {
          name: m.settings_citation_index_reset_name(),
          desc: m.settings_citation_index_reset_desc(),
          action: () => void resetCitationIndex(ctx),
        },
        {
          name: m.settings_language_pack_reset_name(),
          desc: m.settings_language_pack_reset_desc(),
          action: () => void resetLanguagePacks(ctx),
        },
      ],
    },
  ];
}

/**
 * Clears every stored citekey scan and rebuilds it from the vault. The rebuild
 * runs on past this call, so the notice names it rather than claiming it is done.
 */
async function resetCitationIndex(ctx: SettingTabContext): Promise<void> {
  const confirmed = await confirm(
    {
      title: m.settings_citation_index_reset_confirm_title(),
      content: m.settings_citation_index_reset_confirm_body(),
      action: m.settings_citation_index_reset_action(),
      destructive: true,
    },
    ctx.app,
  );
  if (!confirmed) return;
  try {
    await ctx.citationIndex.reset();
    new BaseNotice(m.notice_citation_index_reset());
  } catch (error) {
    logger.error("Failed to reset the citation index", { error });
    new BaseNotice(m.notice_citation_index_reset_failed());
  }
}

/**
 * Clears every downloaded Language Pack and the consent behind it. The pack
 * applied at startup keeps running, so the notice names the restart.
 */
async function resetLanguagePacks(ctx: SettingTabContext): Promise<void> {
  const confirmed = await confirm(
    {
      title: m.settings_language_pack_reset_confirm_title(),
      content: m.settings_language_pack_reset_confirm_body(),
      action: m.settings_language_pack_reset_action(),
      destructive: true,
    },
    ctx.app,
  );
  if (!confirmed) return;
  ctx.languagePack.reset();
  new BaseNotice(m.notice_language_pack_reset());
}

async function openLogFile(ctx: SettingTabContext): Promise<void> {
  const { adapter } = ctx.app.vault;
  const logPath = `${ctx.manifest.dir}/${LOG_FILENAME}`;
  if (!(adapter instanceof FileSystemAdapter)) {
    new BaseNotice(m.notice_open_log_file_failed());
    logger.error("Vault adapter is not a FileSystemAdapter", { logPath });
    return;
  }
  const fullPath = adapter.getFullPath(logPath);
  try {
    const { shell } = requireElectron();
    const errMsg = await shell.openPath(fullPath);
    if (errMsg) throw new Error(errMsg);
  } catch (error) {
    logger.error("Failed to open log file", { fullPath, error });
    new BaseNotice(m.notice_open_log_file_failed());
  }
}

async function exportLogArchive(ctx: SettingTabContext): Promise<void> {
  const { adapter } = ctx.app.vault;
  const logPath = `${ctx.manifest.dir}/${LOG_FILENAME}`;
  try {
    const text = await adapter.read(logPath);
    const zipBytes = zipSync({ [LOG_FILENAME]: strToU8(text) });
    const blob = new Blob([zipBytes as BlobPart], { type: "application/zip" });
    saveFile(blob, `zotlit-logs-${exportTimestamp()}.zip`);
  } catch (error) {
    logger.error("Failed to export log archive", { logPath, error });
    new BaseNotice(m.notice_export_log_file_failed());
  }
}
