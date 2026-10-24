// The one place ZotLit undoes a plugin registration before the plugin unloads.
// Obsidian has a public remove only for commands; a view, an `obsidian://`
// handler, an editor extension and a settings tab are removed through the
// private calls `Plugin` itself makes on unload. Each is a no-op for what it
// does not hold, so the plugin's own unload cleanup can run after it. A build
// without one leaves that registration to the unload cleanup.
import type { Extension } from "@codemirror/state";
import type { App, ObsidianProtocolHandler, PluginSettingTab } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger(["obsidian-private", "plugin-registrations"]);

function missing(call: string): void {
  logger.warn(
    "Obsidian lacks a private unregister call; the registration stays until the plugin unloads",
    { call },
  );
}

export function unregisterView(app: App, type: string): void {
  const registry = app.viewRegistry;
  if (!registry?.unregisterView) return missing("viewRegistry.unregisterView");
  registry.unregisterView(type);
}

export function unregisterProtocolHandler(
  app: App,
  action: string,
  handler: ObsidianProtocolHandler,
): void {
  const handlers = app.workspace.protocolHandler;
  if (!handlers?.unregister)
    return missing("workspace.protocolHandler.unregister");
  handlers.unregister(action, handler);
}

export function unregisterEditorExtension(
  app: App,
  extension: Extension,
): void {
  if (!app.workspace.unregisterEditorExtension)
    return missing("workspace.unregisterEditorExtension");
  app.workspace.unregisterEditorExtension(extension);
}

export function removeSettingTab(app: App, tab: PluginSettingTab): void {
  if (!app.setting.removeSettingTab) return missing("setting.removeSettingTab");
  app.setting.removeSettingTab(tab);
}
