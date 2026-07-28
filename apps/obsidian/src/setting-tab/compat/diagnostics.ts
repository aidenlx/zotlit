import { getLogLevels, isLogLevel } from "@logtape/logtape";
import { strToU8, zipSync } from "fflate";
import { FileSystemAdapter } from "obsidian";

import { Temporal } from "@zotlit/shared/temporal";

import { confirm } from "@/lib/confirm";
import { saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { requireElectron } from "@/lib/require";
import { LOG_FILENAME } from "@/services/log/service";
import { type LogLevel } from "@/services/settings/schema";
import type ZotLitPlugin from "@/zt-main";

import { type CompatContext } from "./context";
import { sectionGroup } from "./group";

const logger = getLogger(["setting-tab", "compat", "diagnostics"]);

const LOG_LEVEL_OFF_KEY = "off";

/**
 * "Diagnostics" section: log-level dropdown, file toggle, the two log action
 * rows, and the Language Pack reset.
 */
export function diagnosticsSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = sectionGroup(containerEl, m.settings_page_diagnostics());

  const fileDisabled = (): boolean => !ctx.settings.current?.["log.to-file"];

  group.addSetting((setting) =>
    setting
      .setName(m.settings_log_level_name())
      .setDesc(m.settings_log_level_desc())
      .addDropdown((dropdown) => {
        dropdown.addOption(LOG_LEVEL_OFF_KEY, m.settings_log_level_off());
        for (const level of getLogLevels()) dropdown.addOption(level, level);
        const current = ctx.settings.current?.["log.level"] ?? null;
        dropdown.setValue(current ?? LOG_LEVEL_OFF_KEY);
        dropdown.onChange((value) => {
          let next: LogLevel | null;
          if (value === LOG_LEVEL_OFF_KEY) next = null;
          else if (isLogLevel(value)) next = value;
          else throw new Error(`Unknown log level dropdown key: ${value}`);
          ctx.settings.update({ "log.level": next });
        });
      }),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_log_to_file_name())
      .setDesc(m.settings_log_to_file_desc())
      .addToggle((toggle) =>
        toggle
          .setValue(ctx.settings.current?.["log.to-file"] ?? false)
          .onChange((value) => {
            ctx.settings.update({ "log.to-file": value });
            // Rebuild so the two action rows below pick up their disabled state.
            ctx.rerender();
          }),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_log_open_file_name())
      .setDesc(m.settings_log_open_file_desc())
      .addButton((button) =>
        button
          .setButtonText(m.settings_log_open_file_name())
          .setDisabled(fileDisabled())
          .onClick(() => void openLogFile(ctx.plugin)),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_log_export_name())
      .setDesc(m.settings_log_export_desc())
      .addButton((button) =>
        button
          .setButtonText(m.settings_log_export_name())
          .setDisabled(fileDisabled())
          .onClick(() => void exportLogArchive(ctx.plugin)),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_language_pack_reset_name())
      .setDesc(m.settings_language_pack_reset_desc())
      .addButton((button) =>
        button
          .setButtonText(m.settings_language_pack_reset_action())
          .setDestructive()
          .onClick(() => void resetLanguagePacks(ctx)),
      ),
  );
}

/**
 * Clears every downloaded Language Pack and the consent behind it. The pack
 * applied at startup keeps running, so the notice names the restart.
 */
async function resetLanguagePacks(ctx: CompatContext): Promise<void> {
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

async function openLogFile(plugin: ZotLitPlugin): Promise<void> {
  const { adapter } = plugin.app.vault;
  const logPath = `${plugin.manifest.dir}/${LOG_FILENAME}`;
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

async function exportLogArchive(plugin: ZotLitPlugin): Promise<void> {
  const { adapter } = plugin.app.vault;
  const logPath = `${plugin.manifest.dir}/${LOG_FILENAME}`;
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

/** Compact timestamp suffix for download filenames, e.g. `20260512-143000`. */
function exportTimestamp(): string {
  const now = Temporal.Now.plainDateTimeISO();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${now.year}${pad(now.month)}${pad(now.day)}-${pad(now.hour)}${pad(now.minute)}${pad(now.second)}`;
}
