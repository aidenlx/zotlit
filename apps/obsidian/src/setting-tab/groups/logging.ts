import { getLogLevels, isLogLevel } from "@logtape/logtape";
import { strToU8, zipSync } from "fflate";
import {
  type ButtonComponent,
  FileSystemAdapter,
  SettingGroup,
} from "obsidian";

import { Temporal } from "@zotlit/shared/temporal";
import { saveFile } from "@/lib/file-save";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { m } from "@/paraglide/messages";
import { LOG_FILENAME } from "@/services/log/service";
import type { LogLevel } from "@/services/settings/schema";
import type ZotLitPlugin from "@/zt-main";
import { requireElectron } from "@/lib/require";
import type { SectionContext } from "@/setting-tab/section";

const logger = getLogger(["setting-tab", "logging"]);

const LOG_LEVEL_OFF_KEY = "off";

export interface LoggingSectionContext extends SectionContext {
  plugin: ZotLitPlugin;
}

export function loggingSection(ctx: LoggingSectionContext): Disposable {
  using stack = new DisposableStack();

  const snapshot = ctx.settings.current;
  if (!snapshot) {
    throw new Error("loggingSection: settings have not loaded yet");
  }

  const group = new SettingGroup(ctx.containerEl).setHeading(
    m.settings_log_heading(),
  );

  const fileButtons: ButtonComponent[] = [];
  const updateFileButtons = (toFileEnabled: boolean): void => {
    for (const button of fileButtons) {
      button.setDisabled(!toFileEnabled);
      button.setTooltip(toFileEnabled ? "" : m.settings_log_to_file_required());
    }
  };

  group.addSetting((setting) => {
    setting
      .setName(m.settings_log_level_name())
      .setDesc(m.settings_log_level_desc())
      .addDropdown((dropdown) => {
        dropdown.addOption(LOG_LEVEL_OFF_KEY, m.settings_log_level_off());
        for (const level of getLogLevels()) {
          dropdown.addOption(level, level);
        }
        dropdown
          .setValue(levelToDropdownKey(snapshot["log.level"]))
          .onChange((key) => {
            ctx.settings.update({
              "log.level": dropdownKeyToLevel(key),
            });
          });
      });
  });

  group.addSetting((setting) => {
    setting
      .setName(m.settings_log_to_file_name())
      .setDesc(m.settings_log_to_file_desc())
      .addToggle((toggle) => {
        toggle.setValue(snapshot["log.to-file"]).onChange((checked) => {
          ctx.settings.update({ "log.to-file": checked });
          updateFileButtons(checked);
        });
      });
  });

  group.addSetting((setting) => {
    setting
      .setName(m.settings_log_open_file_name())
      .setDesc(m.settings_log_open_file_desc())
      .addButton((button) => {
        button
          .setButtonText(m.settings_log_open_file_button())
          .setIcon("file-text")
          .onClick(() => {
            void openLogFile(ctx.plugin);
          });
        fileButtons.push(button);
      });
  });

  group.addSetting((setting) => {
    setting
      .setName(m.settings_log_export_name())
      .setDesc(m.settings_log_export_desc())
      .addButton((button) => {
        button
          .setButtonText(m.settings_log_export_button())
          .setIcon("download")
          .onClick(() => {
            void exportLogArchive(ctx.plugin);
          });
        fileButtons.push(button);
      });
  });

  updateFileButtons(snapshot["log.to-file"]);

  return stack.move();
}

/**
 * Maps the schema's `null` ("disabled") to the dropdown sentinel `"off"`;
 * any real LogTape level passes through unchanged.
 */
function levelToDropdownKey(level: LogLevel | null): string {
  return level ?? LOG_LEVEL_OFF_KEY;
}

/**
 * Inverse of {@link levelToDropdownKey}. Throws on unknown keys so a stray
 * dropdown value cannot silently flip the level to a bogus state.
 */
function dropdownKeyToLevel(key: string): LogLevel | null {
  if (key === LOG_LEVEL_OFF_KEY) return null;
  if (isLogLevel(key)) return key;
  throw new Error(`Unknown log level dropdown key: ${key}`);
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
