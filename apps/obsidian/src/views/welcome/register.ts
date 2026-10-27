// The Welcome View's entry points: the command that shows its banner above
// the Library View again, the held connection readout, and the notice of a
// Zotero data directory this device does not have.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import { Stream } from "effect";
import type { App, Plugin } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { PlainQueryClients } from "@/services/query-client/plain";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { openLibraryView } from "@/views/library/register";
import { LIBRARY_VIEW_TYPE } from "@/views/library/view";

import { holdConnectionReadout } from "./connection";
import { notFoundNoticeChange } from "./not-found-notice";
import type { NotFoundSignal } from "./not-found-notice";

export interface WelcomeRegistrationDeps {
  runtime: SubscriptionRuntime;
  reads: Pick<
    PlainZoteroReads,
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
    | "changes"
    | "dbFileMissing"
  >;
  queries: Pick<PlainQueryClients, "invalidate">;
  settings: Pick<PluginSettings["Service"], "update">;
  bridge: Pick<EffectBridge, "runSync">;
}

export function registerWelcomeView(
  plugin: Pick<Plugin, "addCommand" | "app" | "register">,
  deps: WelcomeRegistrationDeps,
): void {
  plugin.register(
    holdConnectionReadout({
      runtime: deps.runtime,
      reads: deps.reads,
      queries: deps.queries,
    }),
  );

  plugin.addCommand({
    id: "open-welcome-view",
    name: m.command_open_welcome_name(),
    callback: () =>
      void openWelcomeView(plugin.app, deps.settings, deps.bridge),
  });

  // The missing-file state survives startup, so a view registered after the
  // first database load still offers to locate Zotero on this device.
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
  watchNotFound(plugin, deps, apply);
}

/**
 * Hand `apply` each signal that changes the notice of a missing Zotero data
 * folder: the missing state a registration finds, each change of that state,
 * and each change of the workspace's tabs.
 */
export function watchNotFound(
  plugin: Pick<Plugin, "app" | "register">,
  deps: Pick<WelcomeRegistrationDeps, "runtime" | "reads">,
  apply: (signal: NotFoundSignal) => void,
): void {
  let missing = deps.reads.dbFileMissing;
  plugin.register(
    subscribe(deps.runtime, Stream.drop(deps.reads.changes, 1), (state) => {
      if (state.dbFileMissing === missing) return;
      missing = state.dbFileMissing;
      apply(missing ? "db-file-missing" : "changed");
    }),
  );
  if (missing) apply("db-file-missing");
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
  settings: Pick<PluginSettings["Service"], "update">,
  bridge: Pick<EffectBridge, "runSync">,
): Promise<void> {
  bridge.runSync(settings.update({ "welcome.dismissed": false }));
  const view = await openLibraryView(app);
  view?.welcome.request();
}
