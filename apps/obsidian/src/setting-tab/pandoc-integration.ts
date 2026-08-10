// Local Pandoc CLI Guide and pair-save action for the Citations settings page.

import type { Setting, SettingDefinitionGroup } from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { requireDialog } from "@/lib/require";
import {
  pandocIntegrationFiles,
  renderPandocGuide,
  savePandocIntegrationFiles,
} from "@/services/pandoc/integration";

import type { SettingsKey, SettingTabContext } from "./context";

const logger = getLogger(["setting-tab", "pandoc-integration"]);

export function pandocIntegrationDefinition(
  ctx: SettingTabContext,
): SettingDefinitionGroup<SettingsKey> {
  return {
    type: "group",
    heading: m.settings_citation_native_pandoc_heading(),
    items: [
      {
        name: m.settings_citation_pandoc_guide_name(),
        desc: guideDescription(ctx.plugin.manifest.version),
      },
      {
        name: m.settings_citation_pandoc_files_name(),
        desc: m.settings_citation_pandoc_files_desc(),
        render: (setting) => renderSaveAction(setting, ctx),
      },
    ],
  };
}

function guideDescription(pluginVersion: string): DocumentFragment {
  return createFragment((fragment) => {
    fragment.append(m.settings_citation_pandoc_guide_desc());
    const guide = fragment.ownerDocument.createElement("pre");
    guide.textContent = renderPandocGuide(pluginVersion);
    fragment.append(guide);
  });
}

function renderSaveAction(setting: Setting, ctx: SettingTabContext): void {
  setting.addButton((button) =>
    button
      .setButtonText(m.settings_citation_pandoc_files_save())
      .setCta()
      .onClick(() => {
        button.buttonEl.blur();
        void selectAndSave(ctx);
      }),
  );
}

async function selectAndSave(ctx: SettingTabContext): Promise<void> {
  try {
    const selected = await requireDialog().showOpenDialog({
      title: m.settings_citation_pandoc_folder_title(),
      properties: ["openDirectory"],
    });
    if (selected.canceled || selected.filePaths.length === 0) return;

    const result = await savePandocIntegrationFiles({
      folder: selected.filePaths[0]!,
      files: pandocIntegrationFiles(),
      confirmReplacement: (filenames) =>
        confirm(
          {
            title: m.settings_citation_pandoc_replace_title(),
            content: m.settings_citation_pandoc_replace_body({
              files: filenames.join(", "),
            }),
            action: m.settings_citation_pandoc_replace_action(),
            destructive: true,
          },
          ctx.app,
        ),
    });

    if (result.kind === "saved") {
      new BaseNotice(
        m.notice_pandoc_integration_saved({ folder: result.folder }),
      );
    } else if (result.kind === "failed") {
      logger.error("Failed to save the Pandoc Integration Pair", {
        folder: selected.filePaths[0]!,
        error: result.error,
        restored: result.restored,
      });
      new BaseNotice(
        result.restored
          ? m.notice_pandoc_integration_save_failed()
          : m.notice_pandoc_integration_restore_failed(),
      );
    }
  } catch (error) {
    logger.error("Failed to select a Pandoc integration folder", { error });
    new BaseNotice(m.notice_pandoc_integration_save_failed());
  }
}
