// The Welcome View's entry points: the command that shows its banner above
// the Library View again, the held connection readout, and the notice of a
// Zotero data directory this device does not have.
//
// @see apps/obsidian/docs/adr/0076-the-library-view-is-the-first-screen.md
import { ItemView } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { QueryClientService } from "@/services/query-client/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { openLibraryView } from "@/views/library/register";
import { LIBRARY_VIEW_TYPE } from "@/views/library/view";

import { holdConnectionReadout } from "./connection";

export interface WelcomeRegistrationDeps {
  reads: Pick<ZoteroReadsService, "on">;
  queries: Pick<QueryClientService, "invalidate">;
  settings: Pick<SettingsService, "update">;
}

export function registerWelcomeView(
  plugin: Pick<Plugin, "addCommand" | "app" | "register" | "registerView">,
  deps: WelcomeRegistrationDeps,
): void {
  plugin.registerView(
    WELCOME_VIEW_TYPE,
    (leaf) => new WelcomeTab(leaf, plugin.app),
  );
  plugin.register(
    holdConnectionReadout({ reads: deps.reads, queries: deps.queries }),
  );

  plugin.addCommand({
    id: "open-welcome-view",
    name: m.command_open_welcome_name(),
    callback: () => void openWelcomeView(plugin.app, deps.settings),
  });

  // Fresh-device notice: the database service signals when the resolved DB
  // file is absent (auto-detect missed the install on this device). Attached
  // synchronously during onload — before the db service's first async refresh
  // can emit — so the one-per-launch signal is never missed. The Library View
  // says the same and offers to locate the folder.
  const unsubscribe = deps.reads.on("db-file-missing", () => {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_db_not_found_on_device());
        renderer.addAction((button) => {
          button
            .setButtonText(m.notice_db_not_found_action())
            .onClick(() => void openLibraryView(plugin.app));
        });
      }),
      0,
    );
  });
  plugin.register(unsubscribe);
}

/** Show the Welcome View banner again, above the Library View brought forward. */
export async function openWelcomeView(
  app: App,
  settings: Pick<SettingsService, "update">,
): Promise<void> {
  settings.update({ "welcome.dismissed": false });
  await openLibraryView(app);
}

/** The view type of the Welcome tab that ZotLit had before ADR 0076. */
const WELCOME_VIEW_TYPE = "zotlit-welcome";

/**
 * A Welcome tab that a workspace saved before the Welcome View became a
 * banner. It turns into the Library View, or closes where a Library View tab
 * is already open, so no empty tab is left.
 */
class WelcomeTab extends ItemView {
  readonly #app: App;

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf);
    this.#app = app;
  }

  override getViewType(): string {
    return WELCOME_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.library_view_name();
  }

  protected override async onOpen(): Promise<void> {
    const { workspace } = this.#app;
    // A restored tab opens while the workspace still loads its layout, and
    // the leaf takes no other view until this one has opened: the change
    // waits for both.
    workspace.onLayoutReady(() =>
      this.contentEl.win.setTimeout(() => {
        if (workspace.getLeavesOfType(LIBRARY_VIEW_TYPE).length > 0)
          this.leaf.detach();
        else void this.leaf.setViewState({ type: LIBRARY_VIEW_TYPE });
      }),
    );
  }
}
