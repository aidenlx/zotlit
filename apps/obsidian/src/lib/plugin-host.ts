// The plugin as a service the Effect layers register their commands on.
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import type { Command, Plugin, PluginSettingTab } from "obsidian";

import type { CliHost } from "@/lib/cli-command";

/**
 * What a layer registers on: Obsidian commands, post-processors, zotlit:*
 * commands, and the manifest.
 *
 * Obsidian removes every registration when the plugin unloads. `addCommand`
 * also removes its command when the caller's Scope closes, so a startup that
 * fails after it leaves no command on a disposed runtime.
 */
export interface PluginHostShape
  extends
    Pick<Plugin, "app" | "manifest" | "registerMarkdownPostProcessor">,
    CliHost {
  /** Add a command. Obsidian prefixes its id with the plugin id, as `Plugin.addCommand` does. */
  addCommand(command: Command): Effect.Effect<Command, never, Scope.Scope>;
  /**
   * Add the setting tab `build` makes over this plugin. The caller's Scope
   * closing removes it, closing it first when it is open, so its `render`
   * cleanups run while the services they read are still up.
   */
  addSettingTab<T extends PluginSettingTab>(
    build: (plugin: Plugin) => T,
  ): Effect.Effect<T, never, Scope.Scope>;
}

/** The plugin the layer graph runs in. */
export class PluginHost extends Context.Service<PluginHost, PluginHostShape>()(
  "zotlit/obsidian/PluginHost",
) {}

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
    addCommand: Effect.fn("PluginHost.addCommand")(function* (command) {
      // `Plugin.addCommand` prefixes `command.id` in place, and
      // `removeCommand` takes the id without the prefix.
      const id = command.id;
      return yield* Effect.acquireRelease(
        Effect.sync(() => plugin.addCommand(command)),
        () => Effect.sync(() => plugin.removeCommand(id)),
      );
    }),
    addSettingTab: (build) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const tab = build(plugin);
          plugin.addSettingTab(tab);
          return tab;
        }),
        (tab) => Effect.sync(() => plugin.app.setting.removeSettingTab(tab)),
      ),
  };
}

export function layerPluginHost(
  plugin: Plugin & CliHost,
): Layer.Layer<PluginHost> {
  return Layer.succeed(PluginHost, makePluginHost(plugin));
}
