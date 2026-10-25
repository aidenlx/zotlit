// The plugin as a service the Effect layers register their commands on.
import type { Extension } from "@codemirror/state";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import type {
  Command,
  ObsidianProtocolHandler,
  Plugin,
  PluginSettingTab,
  ViewCreator,
} from "obsidian";

import type { CliHost } from "@/lib/cli-command";
import {
  removeSettingTab,
  unregisterEditorExtension,
  unregisterProtocolHandler,
  unregisterView,
} from "@/lib/obsidian-private/plugin-registrations";

/**
 * What a layer registers on: Obsidian commands, views, editor extensions,
 * `obsidian://` handlers, the settings tab, post-processors, zotlit:*
 * commands, and the manifest.
 *
 * Each `add*` / `register*` Effect here holds its registration on the
 * caller's Scope, so closing the layer removes it. Obsidian also removes each
 * one when the plugin unloads.
 */
export interface PluginHostShape
  extends
    Pick<Plugin, "app" | "manifest" | "registerMarkdownPostProcessor">,
    CliHost {
  /** Add a command. Obsidian prefixes its id with the plugin id, as `Plugin.addCommand` does. */
  addCommand(command: Command): Effect.Effect<Command, never, Scope.Scope>;
  registerView(
    type: string,
    viewCreator: ViewCreator,
  ): Effect.Effect<void, never, Scope.Scope>;
  registerEditorExtension(
    extension: Extension,
  ): Effect.Effect<void, never, Scope.Scope>;
  registerObsidianProtocolHandler(
    action: string,
    handler: ObsidianProtocolHandler,
  ): Effect.Effect<void, never, Scope.Scope>;
  addSettingTab(
    settingTab: PluginSettingTab,
  ): Effect.Effect<void, never, Scope.Scope>;
}

/** The plugin the layer graph runs in. */
export class PluginHost extends Context.Service<PluginHost, PluginHostShape>()(
  "zotlit/obsidian/PluginHost",
) {}

/** A registration on the plugin, undone when the Scope closes. */
const held = <A>(register: () => A, release: () => void) =>
  Effect.acquireRelease(Effect.sync(register), () => Effect.sync(release));

/** The host over `plugin`. */
export function makePluginHost(plugin: Plugin & CliHost): PluginHostShape {
  return {
    get app() {
      return plugin.app;
    },
    get manifest() {
      return plugin.manifest;
    },
    registerMarkdownPostProcessor: (postProcessor, sortOrder) =>
      plugin.registerMarkdownPostProcessor(postProcessor, sortOrder),
    registerCliCommand: (name, command) =>
      plugin.registerCliCommand(name, command),
    addCommand: (command) => {
      // `Plugin.addCommand` prefixes `command.id` in place, and
      // `removeCommand` takes the id without the prefix.
      const id = command.id;
      return held(
        () => plugin.addCommand(command),
        () => plugin.removeCommand(id),
      );
    },
    registerView: (type, viewCreator) =>
      held(
        () => plugin.registerView(type, viewCreator),
        () => unregisterView(plugin.app, type),
      ),
    registerEditorExtension: (extension) =>
      held(
        () => plugin.registerEditorExtension(extension),
        () => unregisterEditorExtension(plugin.app, extension),
      ),
    registerObsidianProtocolHandler: (action, handler) =>
      held(
        () => plugin.registerObsidianProtocolHandler(action, handler),
        () => unregisterProtocolHandler(plugin.app, action, handler),
      ),
    addSettingTab: (settingTab) =>
      held(
        () => plugin.addSettingTab(settingTab),
        () => removeSettingTab(plugin.app, settingTab),
      ),
  };
}

export function layerPluginHost(
  plugin: Plugin & CliHost,
): Layer.Layer<PluginHost> {
  return Layer.succeed(PluginHost, makePluginHost(plugin));
}
