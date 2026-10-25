import type { Extension } from "@codemirror/state";
import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import type {
  App,
  Command,
  ObsidianProtocolHandler,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  SettingsModal,
  View,
  ViewCreator,
  Workspace,
} from "obsidian";
import { describe, expect, it as plainIt, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { CliHost } from "@/lib/cli-command";

import { makePluginHost } from "./plugin-host";

/** The registries a plugin writes to, shaped as Obsidian 1.15.0 keeps them. */
function fakeObsidian() {
  const commands = new Map<string, Command>();
  const views = new Map<string, unknown>();
  const protocols = new Map<string, unknown>();
  const extensions = new Set<unknown>();
  const tabs = new Set<unknown>();
  const app = stubService<App>("App", {
    viewRegistry: {
      getViewCreatorByType: () => undefined,
      unregisterView: (type: string) => {
        views.delete(type);
      },
    },
    workspace: stubService<Workspace>("Workspace", {
      protocolHandler: {
        unregister: (action: string, handler?: ObsidianProtocolHandler) => {
          if (!handler || protocols.get(action) === handler)
            protocols.delete(action);
        },
      },
      unregisterEditorExtension: (extension: Extension) =>
        extensions.delete(extension),
    }),
    setting: stubService<SettingsModal>("SettingsModal", {
      removeSettingTab: (tab: PluginSettingTab) => tabs.delete(tab),
    }),
  });
  const plugin = stubService<Plugin & CliHost>("Plugin", {
    app,
    manifest: stubService<PluginManifest>("PluginManifest", {
      id: "zotlit",
      version: "2.0.0",
    }),
    addCommand: (command: Command) => {
      command.id = `zotlit:${command.id}`;
      commands.set(command.id, command);
      return command;
    },
    removeCommand: (id: string) => commands.delete(`zotlit:${id}`),
    registerView: (type: string, creator: ViewCreator) =>
      views.set(type, creator),
    registerObsidianProtocolHandler: (
      action: string,
      handler: ObsidianProtocolHandler,
    ) => protocols.set(action, handler),
    registerEditorExtension: (extension: Extension) =>
      extensions.add(extension),
    addSettingTab: (tab: PluginSettingTab) => tabs.add(tab),
    registerMarkdownPostProcessor: vi.fn(),
    registerCliCommand: vi.fn(),
  });
  return { plugin, commands, views, protocols, extensions, tabs };
}

describe("makePluginHost", () => {
  it.effect("holds each registration until its Scope closes", () =>
    Effect.gen(function* () {
      const obsidian = fakeObsidian();
      const host = makePluginHost(obsidian.plugin);
      const scope = yield* Scope.fork(yield* Effect.scope);
      const extension = [] as const;
      const tab = stubService<PluginSettingTab>("PluginSettingTab", {});

      const command = yield* host
        .addCommand({ id: "open-release-note", name: "Open release note" })
        .pipe(Scope.provide(scope));
      yield* host
        .registerView("zotlit-library", () => stubService<View>("View", {}))
        .pipe(Scope.provide(scope));
      yield* host
        .registerObsidianProtocolHandler("zotlit", () => {})
        .pipe(Scope.provide(scope));
      yield* host.registerEditorExtension(extension).pipe(Scope.provide(scope));
      yield* host.addSettingTab(tab).pipe(Scope.provide(scope));

      expect(command.id).toBe("zotlit:open-release-note");
      expect([...obsidian.commands.keys()]).toEqual([
        "zotlit:open-release-note",
      ]);
      expect(obsidian.views.has("zotlit-library")).toBe(true);
      expect(obsidian.protocols.has("zotlit")).toBe(true);
      expect(obsidian.extensions.has(extension)).toBe(true);
      expect(obsidian.tabs.has(tab)).toBe(true);

      yield* Scope.close(scope, Exit.void);

      expect(obsidian.commands.size).toBe(0);
      expect(obsidian.views.size).toBe(0);
      expect(obsidian.protocols.size).toBe(0);
      expect(obsidian.extensions.size).toBe(0);
      expect(obsidian.tabs.size).toBe(0);
    }),
  );

  it.effect("keeps a protocol handler another registration replaced", () =>
    Effect.gen(function* () {
      const obsidian = fakeObsidian();
      const host = makePluginHost(obsidian.plugin);
      const replacement = () => {};

      yield* Effect.scoped(
        host
          .registerObsidianProtocolHandler("zotlit", () => {})
          .pipe(
            Effect.andThen(
              Effect.sync(() =>
                obsidian.plugin.registerObsidianProtocolHandler(
                  "zotlit",
                  replacement,
                ),
              ),
            ),
          ),
      );

      expect(obsidian.protocols.get("zotlit")).toBe(replacement);
    }),
  );

  plainIt("reads the app and manifest from the plugin", () => {
    const obsidian = fakeObsidian();
    const host = makePluginHost(obsidian.plugin);

    expect(host.app).toBe(obsidian.plugin.app);
    expect(host.manifest.version).toBe("2.0.0");
  });
});
