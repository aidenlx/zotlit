// Registers the Welcome View and its open-command, plus the shared open-or-reveal entry point.
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { DatabaseService } from "@/services/database/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { createSetupActions } from "./setup-actions";
import { WELCOME_VIEW_TYPE, WelcomeView } from "./view";

export { WELCOME_VIEW_TYPE };

export interface WelcomeRegistrationDeps {
  app: App;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
}

export function registerWelcomeView(
  plugin: Pick<
    Plugin,
    "registerView" | "addCommand" | "app" | "manifest" | "register"
  >,
  deps: WelcomeRegistrationDeps,
): void {
  const setupActions = createSetupActions({
    app: deps.app,
    settings: deps.settings,
    zoteroPref: deps.zoteroPref,
    pluginId: plugin.manifest.id,
  });
  plugin.registerView(
    WELCOME_VIEW_TYPE,
    (leaf) =>
      new WelcomeView(leaf, {
        app: deps.app,
        db: deps.db,
        zoteroPref: deps.zoteroPref,
        settings: deps.settings,
        setupActions,
      }),
  );

  plugin.addCommand({
    id: "open-welcome-view",
    name: m.command_open_welcome_name(),
    callback: () =>
      void openWelcomeView(
        plugin.app,
        deps.settings.current?.["release.migration-pending"]
          ? "upgraded"
          : "fresh",
      ),
  });

  // Fresh-device notice: the database service signals when the resolved DB
  // file is absent (auto-detect missed the install on this device). Attached
  // synchronously during onload — before the db service's first async refresh
  // can emit — so the one-per-launch signal is never missed.
  const unsubscribe = deps.db.on("db-file-missing", () => {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_db_not_found_on_device());
        renderer.addAction((button) => {
          button
            .setButtonText(m.notice_db_not_found_action())
            .onClick(() => void openWelcomeView(deps.app));
        });
      }),
      0,
    );
  });
  plugin.register(unsubscribe);
}

/** Every entry point delegates to this function: reuses an existing Welcome leaf, else opens one in the active leaf. */
export async function openWelcomeView(
  app: App,
  mode: "fresh" | "upgraded" = "fresh",
): Promise<void> {
  const { workspace } = app;
  const leaf =
    workspace.getLeavesOfType(WELCOME_VIEW_TYPE)[0] ?? workspace.getLeaf(false);
  await leaf.setViewState({
    type: WELCOME_VIEW_TYPE,
    active: true,
    state: { mode },
  });
  void workspace.revealLeaf(leaf);
}
