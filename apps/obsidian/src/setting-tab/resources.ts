// Headerless resources strip and migration reminder for the declarative (>=1.13) setting tab.

import {
  type Setting,
  type SettingDefinition,
  type SettingDefinitionGroup,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { languagePackSettingCopy } from "@/lib/i18n/settings-copy";
import {
  BUG_REPORT,
  COMMUNITY,
  DOCS_GETTING_STARTED,
  MIGRATION_GUIDE,
} from "@/views/welcome/links";

import { type SettingsKey, type SettingTabContext } from "./context";
import { languagePackDefinition } from "./language-pack";

/**
 * "Finish migrating from v1" reminder row. Callers include this item only
 * while migration is pending — never via `visible` — because a group's row
 * divider is a `::before` suppressed only on the group's `:first-child`, and
 * a `visible:false` row still renders `display:none` in place, so it still
 * counts as `:first-child` and the next row draws a stray top border.
 */
export function migrationReminderItem(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return {
    name: m.settings_migration_reminder_name(),
    desc: m.welcome_migration_body(),
    render: (setting) => {
      renderMigrationReminderButtons(setting, ctx);
    },
  };
}

function renderMigrationReminderButtons(
  setting: Setting,
  ctx: SettingTabContext,
): void {
  setting.addButton((btn) =>
    btn
      .setButtonText(m.welcome_action_open_migration_guide())
      .setCta()
      .onClick(() => window.open(MIGRATION_GUIDE)),
  );
  setting.addButton((btn) =>
    btn.setButtonText(m.settings_migration_reminder_mark_done()).onClick(() => {
      // See the blur comment in templates.ts's renderJsTemplatesButton: the
      // reconciler skips re-rendering the row containing document.activeElement.
      btn.buttonEl.blur();
      ctx.release.acknowledgeMigration();
    }),
  );
}

/**
 * Headerless group at the top of the tab: the migration reminder (only
 * while pending, included structurally — see {@link migrationReminderItem})
 * followed by the resources strip — what's new, docs, and community links.
 */
export function resourcesGroup(
  ctx: SettingTabContext,
): SettingDefinitionGroup<SettingsKey> {
  const pending = ctx.settings.current?.["release.migration-pending"] === true;
  const languagePack = languagePackSettingCopy(ctx.languagePack);
  return {
    type: "group",
    items: [
      ...(pending ? [migrationReminderItem(ctx)] : []),
      ...(languagePack ? [languagePackDefinition(languagePack)] : []),
      ...resourcesItems(ctx),
    ],
  };
}

function resourcesItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  return [
    {
      name: m.settings_resources_whats_new_name({
        version: ctx.plugin.manifest.version,
      }),
      desc: m.settings_resources_whats_new_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_whats_new_button())
            .onClick(() => void ctx.release.openReleaseNote()),
        );
      },
    },
    {
      name: m.settings_resources_docs_name(),
      desc: m.settings_resources_docs_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_docs_button())
            .onClick(() => window.open(DOCS_GETTING_STARTED)),
        );
      },
    },
    {
      name: m.settings_resources_help_name(),
      desc: m.settings_resources_help_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_help_button())
            .onClick(() => window.open(COMMUNITY)),
        );
      },
    },
    {
      name: m.settings_resources_bug_report_name(),
      desc: m.settings_resources_bug_report_desc(),
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(m.settings_resources_bug_report_button())
            .onClick(() => window.open(BUG_REPORT)),
        );
      },
    },
  ];
}
