// Headerless resources strip and migration reminder for the compat (<1.13) setting tab.

import { type Setting, SettingGroup } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import {
  BUG_REPORT,
  COMMUNITY,
  DOCS_GETTING_STARTED,
  MIGRATION_GUIDE,
} from "@/views/welcome/links";

import { type CompatContext } from "./context";

/**
 * "Finish migrating from v1" reminder row. Callers add this row only while
 * migration is pending — the whole compat tab rebuilds via `display()` on
 * every settings change, so conditional rendering is always correct here
 * (no `visible`-style in-place hide to worry about, unlike the declarative
 * path).
 */
export function renderMigrationReminderRow(
  setting: Setting,
  ctx: CompatContext,
): void {
  setting
    .setName(m.settings_migration_reminder_name())
    .setDesc(m.welcome_migration_body());
  setting.addButton((btn) =>
    btn
      .setButtonText(m.welcome_action_open_migration_guide())
      .setCta()
      .onClick(() => window.open(MIGRATION_GUIDE)),
  );
  setting.addButton((btn) =>
    // No blur here: unlike the declarative path's reconciler, this whole tab
    // rebuilds from scratch via display(), so there is no focused row to skip.
    btn
      .setButtonText(m.settings_migration_reminder_mark_done())
      .onClick(() => ctx.release.acknowledgeMigration()),
  );
}

/**
 * Headerless group at the top of the tab: the migration reminder (only
 * while pending) followed by the resources strip — what's new, docs, and
 * community links.
 */
export function resourcesSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = new SettingGroup(containerEl);

  if (ctx.settings.current?.["release.migration-pending"] === true) {
    group.addSetting((setting) => renderMigrationReminderRow(setting, ctx));
  }

  group.addSetting((setting) =>
    setting
      .setName(
        m.settings_resources_whats_new_name({
          version: ctx.plugin.manifest.version,
        }),
      )
      .setDesc(m.settings_resources_whats_new_desc())
      .addButton((btn) =>
        btn
          .setButtonText(m.settings_resources_whats_new_button())
          .onClick(() => void ctx.release.openReleaseNote()),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_resources_docs_name())
      .setDesc(m.settings_resources_docs_desc())
      .addButton((btn) =>
        btn
          .setButtonText(m.settings_resources_docs_button())
          .onClick(() => window.open(DOCS_GETTING_STARTED)),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_resources_help_name())
      .setDesc(m.settings_resources_help_desc())
      .addButton((btn) =>
        btn
          .setButtonText(m.settings_resources_help_button())
          .onClick(() => window.open(COMMUNITY)),
      ),
  );

  group.addSetting((setting) =>
    setting
      .setName(m.settings_resources_bug_report_name())
      .setDesc(m.settings_resources_bug_report_desc())
      .addButton((btn) =>
        btn
          .setButtonText(m.settings_resources_bug_report_button())
          .onClick(() => window.open(BUG_REPORT)),
      ),
  );
}
