import type { App, Command, Plugin, PluginSettingTab } from "obsidian";
import { describe, expect, it as plainIt, vi } from "vitest";

import type { CliHost } from "@/lib/cli-command";
import { Effect, Exit, Scope } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { makePluginHost } from "./plugin-host";

/** The registries a plugin writes to, shaped as Obsidian 1.15.0 keeps them. */
function fakeObsidian() {
  const commands = new Map<string, Command>();
  const views = new Map<string, unknown>();
  const protocols = new Map<string, unknown>();
  const extensions = new Set<unknown>();
  const tabs = new Set<unknown>();
  const app = {
    viewRegistry: { unregisterView: (type: string) => views.delete(type) },
    workspace: {
      protocolHandler: {
        unregister: (action: string, handler?: unknown) => {
          if (!handler || protocols.get(action) === handler)
            protocols.delete(action);
        },
      },
      unregisterEditorExtension: (extension: unknown) =>
        extensions.delete(extension),
    },
    setting: { removeSettingTab: (tab: unknown) => tabs.delete(tab) },
  } as unknown as App;
  const plugin = {
    app,
    manifest: { id: "zotlit", version: "2.0.0" },
    addCommand: (command: Command) => {
      command.id = `zotlit:${command.id}`;
      commands.set(command.id, command);
      return command;
    },
    removeCommand: (id: string) => commands.delete(`zotlit:${id}`),
    registerView: (type: string, creator: unknown) => views.set(type, creator),
    registerObsidianProtocolHandler: (action: string, handler: unknown) =>
      protocols.set(action, handler),
    registerEditorExtension: (extension: unknown) => extensions.add(extension),
    addSettingTab: (tab: unknown) => tabs.add(tab),
    registerMarkdownPostProcessor: vi.fn(),
    registerCliCommand: vi.fn(),
  } as unknown as Plugin & CliHost;
  return { plugin, commands, views, protocols, extensions, tabs };
}

describe("makePluginHost", () => {
  it.effect("holds each registration until its Scope closes", () =>
    Effect.gen(function* () {
      const obsidian = fakeObsidian();
      const host = makePluginHost(obsidian.plugin);
      const scope = yield* Scope.make();
      const extension = [] as const;
      const tab = {} as PluginSettingTab;

      const command = yield* host
        .addCommand({ id: "open-release-note", name: "Open release note" })
        .pipe(Scope.provide(scope));
      yield* host
        .registerView("zotlit-library", () => ({}) as never)
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
