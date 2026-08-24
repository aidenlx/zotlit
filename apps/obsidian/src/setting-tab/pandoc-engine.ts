// Install and uninstall controls for the device-wide Pandoc engine binary.

import type { Setting, SettingDefinition } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import type {
  PandocEngineFailure,
  PandocEngineStatus,
} from "@/services/pandoc/service";

import type { SettingsKey, SettingTabContext } from "./context";

/**
 * The engine row: what the engine is, where it stands, and the one action that
 * moves it. The download is device-wide, so uninstall reaches every vault.
 */
export function pandocEngineDefinition(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  const status = ctx.pandocEngine.getStatus();
  return {
    name: m.settings_citation_engine_name(),
    desc: `${m.settings_citation_engine_desc()} ${statusSentence(status)}`,
    render: (setting) => renderEngineActions(setting, ctx, status),
  };
}

/** One sentence per arm, so the row never derives its own combination of flags. */
function statusSentence(status: PandocEngineStatus): string {
  switch (status.kind) {
    case "installed":
      return m.settings_citation_engine_status_installed({
        version: status.version,
      });
    case "installing":
      return m.settings_citation_engine_status_installing();
    case "failed":
      return failureSentence(status.failure);
    default:
      return m.settings_citation_engine_status_absent();
  }
}

function failureSentence(failure: PandocEngineFailure): string {
  switch (failure.code) {
    case "download-failed":
      return m.settings_citation_engine_status_download_failed({
        detail: failure.detail,
      });
    case "hash-mismatch":
      return m.settings_citation_engine_status_hash_mismatch();
    case "init-failed":
      return m.settings_citation_engine_status_init_failed({
        detail: failure.detail,
      });
  }
}

function renderEngineActions(
  setting: Setting,
  ctx: SettingTabContext,
  status: PandocEngineStatus,
): void {
  if (status.kind === "installed") {
    setting.addButton((btn) =>
      btn
        .setButtonText(m.settings_citation_engine_uninstall())
        .setWarning()
        .onClick(() => {
          // See the blur comment in resources.ts: the reconciler skips
          // re-rendering the row that holds document.activeElement.
          btn.buttonEl.blur();
          void toast.promise(ctx.pandocEngine.uninstall(), {
            success: m.notice_pandoc_engine_removed(),
            error: m.notice_pandoc_engine_remove_failed(),
          });
        }),
    );
    return;
  }

  setting.addButton((btn) =>
    btn
      .setButtonText(installLabel(status))
      .setCta()
      .setDisabled(status.kind === "installing")
      .onClick(() => {
        btn.buttonEl.blur();
        void toast.promise(ctx.pandocEngine.install(), {
          loading: m.notice_pandoc_engine_downloading(),
          success: m.notice_pandoc_engine_installed(),
          error: m.notice_pandoc_engine_install_failed(),
        });
      }),
  );
}

function installLabel(status: PandocEngineStatus): string {
  switch (status.kind) {
    case "installing":
      return m.settings_citation_engine_installing();
    case "failed":
      return m.settings_citation_engine_retry();
    default:
      return m.settings_citation_engine_install();
  }
}
