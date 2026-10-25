// The plugin as a service the Effect layers register their commands on.
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import { around } from "monkey-around";
import type { Command, Plugin, View, WorkspaceLeaf } from "obsidian";

import type { CliHost } from "@/lib/cli-command";

/**
 * What a layer registers on: Obsidian commands, post-processors, editor
 * extensions, hover link sources, view creation hooks, zotlit:* commands,
 * and the manifest.
 *
 * Obsidian removes every registration when the plugin unloads. `addCommand`
 * also removes its command when the caller's Scope closes, so a startup that
 * fails after it leaves no command on a disposed runtime.
 */
export interface PluginHostShape
  extends
    Pick<
      Plugin,
      | "app"
      | "manifest"
      | "registerMarkdownPostProcessor"
      | "registerEditorExtension"
      | "registerHoverLinkSource"
    >,
    CliHost {
  /** Add a command. Obsidian prefixes its id with the plugin id, as `Plugin.addCommand` does. */
  addCommand(command: Command): Effect.Effect<Command, never, Scope.Scope>;
  /**
   * Run `created` with each view Obsidian's view registry makes for one of
   * `viewTypes`, for the life of the caller's Scope. `created` runs
   * synchronously inside Obsidian's view factory, after the view is made and
   * before Obsidian loads it. The hook wraps the undocumented
   * `app.viewRegistry.getViewCreatorByType` (Obsidian 1.14.1). It answers
   * `false`, and hooks nothing, when the build has no such member.
   */
  onViewCreated(
    viewTypes: readonly string[],
    created: (leaf: WorkspaceLeaf, view: View) => void,
  ): Effect.Effect<boolean, never, Scope.Scope>;
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
    registerEditorExtension: (extension) =>
      plugin.registerEditorExtension(extension),
    registerHoverLinkSource: (id, info) =>
      plugin.registerHoverLinkSource(id, info),
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
    onViewCreated: Effect.fn("PluginHost.onViewCreated")(
      function* (viewTypes, created) {
        const registry = plugin.app.viewRegistry;
        if (typeof registry?.getViewCreatorByType !== "function") return false;
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            around(registry, {
              getViewCreatorByType: (getCreator) => (type) => {
                const creator = getCreator.call(registry, type);
                if (!creator || !viewTypes.includes(type)) return creator;
                return (leaf) => {
                  const view = creator(leaf);
                  created(leaf, view);
                  return view;
                };
              },
            }),
          ),
          (uninstall) => Effect.sync(() => uninstall()),
        );
        return true;
      },
    ),
  };
}

export function layerPluginHost(
  plugin: Plugin & CliHost,
): Layer.Layer<PluginHost> {
  return Layer.succeed(PluginHost, makePluginHost(plugin));
}
