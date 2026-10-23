// The Welcome View's entry points: the command that shows its banner above
// the Library View again, the held connection readout, and the notice of a
// Zotero data directory this device does not have.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { QueryClientService } from "@/services/query-client/service";
import type { PlainPluginSettings } from "@/services/settings/plain";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { openLibraryView } from "@/views/library/register";
import { LIBRARY_VIEW_TYPE } from "@/views/library/view";

import { holdConnectionReadout } from "./connection";
import { notFoundNoticeChange } from "./not-found-notice";
import type { NotFoundSignal } from "./not-found-notice";

export interface WelcomeRegistrationDeps {
  reads: Pick<ZoteroReadsService, "on">;
  queries: Pick<QueryClientService, "invalidate">;
  settings: Pick<PlainPluginSettings, "update">;
}

export function registerWelcomeView(
  plugin: Pick<Plugin, "addCommand" | "app" | "register">,
  deps: WelcomeRegistrationDeps,
): void {
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
  // can emit — so the signal is never missed. `notFoundNoticeChange` decides
  // what each signal does to the notice.
  let notice: BaseNotice | null = null;
  const hide = () => {
    notice?.hide();
    notice = null;
  };
  const apply = (signal: NotFoundSignal) => {
    const change = notFoundNoticeChange(signal, {
      shown: notice?.noticeEl.isConnected ?? false,
      libraryOpen:
        plugin.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE).length > 0,
    });
    if (change === "hide") hide();
    if (change === "show")
      notice = notFoundNotice(() => {
        hide();
        void openLibraryView(plugin.app);
      });
  };
  plugin.register(
    deps.reads.on("db-file-missing", () => apply("db-file-missing")),
  );
  plugin.register(deps.reads.on("changed", () => apply("changed")));
  const layout = plugin.app.workspace.on("layout-change", () =>
    apply("layout-change"),
  );
  plugin.register(() => plugin.app.workspace.offref(layout));
}

/**
 * The notice that Zotero's data folder is not on this device, whose action
 * runs `locate`; it stays until dismissed.
 */
function notFoundNotice(locate: () => void): BaseNotice {
  return new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_db_not_found_on_device());
      renderer.addAction((button) => {
        button.setButtonText(m.notice_db_not_found_action()).onClick(locate);
      });
    }),
    0,
  );
}

/** Show the Welcome View banner again, above the Library View brought forward. */
export async function openWelcomeView(
  app: App,
  settings: Pick<PlainPluginSettings, "update">,
): Promise<void> {
  settings.update({ "welcome.dismissed": false });
  const view = await openLibraryView(app);
  view?.welcome.request();
}
