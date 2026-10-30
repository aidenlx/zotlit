// The Welcome View's entry points: the command that shows its banner above
// the Library View again, the held connection readout, and the notice of a
// Zotero data directory this device does not have.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import { Effect } from "effect";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { zoteroStateAtom } from "@/services/zotero-reads/atoms";
import { openLibraryView } from "@/views/library/register";
import { LIBRARY_VIEW_TYPE } from "@/views/library/view";

import {
  dismissWelcomeCommand,
  keepWelcomeCommand,
  openReleaseNoteCommand,
} from "./atoms";
import { connectionLifecycleAtom } from "./connection";
import { notFoundNoticeChange } from "./not-found-notice";
import type { NotFoundSignal } from "./not-found-notice";
import { holdSetupCommands } from "./setup-actions";

export interface WelcomeRegistrationDeps {
  registry: ViewRegistryHandle;
}

const openWelcomeCommand = viewRuntime.fn((app: App) =>
  Effect.promise(() => openWelcomeView(app)),
);

export function registerWelcomeView(
  plugin: Pick<Plugin, "addCommand" | "app" | "register">,
  deps: WelcomeRegistrationDeps,
): void {
  const { registry } = deps;
  plugin.register(registry.mount(connectionLifecycleAtom));
  for (const command of [
    keepWelcomeCommand,
    dismissWelcomeCommand,
    openReleaseNoteCommand,
    openWelcomeCommand,
  ])
    plugin.register(registry.mount(command));
  plugin.register(holdSetupCommands(registry));

  plugin.addCommand({
    id: "open-welcome-view",
    name: m.command_open_welcome_name(),
    callback: () => registry.set(openWelcomeCommand, plugin.app),
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

/** Publish the current missing-folder state and subsequent workspace changes. */
export function watchNotFound(
  plugin: Pick<Plugin, "app" | "register">,
  { registry }: WelcomeRegistrationDeps,
  apply: (signal: NotFoundSignal) => void,
): void {
  let missing = false;
  plugin.register(
    registry.subscribe(
      zoteroStateAtom,
      (state) => {
        if (state.dbFileMissing === missing) return;
        missing = state.dbFileMissing;
        apply(missing ? "db-file-missing" : "changed");
      },
      { immediate: true },
    ),
  );
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
export async function openWelcomeView(app: App): Promise<void> {
  const view = await openLibraryView(app);
  view?.welcome.request();
}
