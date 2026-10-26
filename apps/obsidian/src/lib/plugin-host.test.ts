import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import type {
  App,
  Command,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  View,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, it as plainIt, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { CliHost } from "@/lib/cli-command";

import { makePluginHost } from "./plugin-host";

/** The command registry a plugin writes to, shaped as Obsidian 1.15.0 keeps it. */
function fakeObsidian(viewRegistry?: App["viewRegistry"]) {
  const commands = new Map<string, Command>();
  const plugin = stubService<Plugin & CliHost>("Plugin", {
    app: stubService<App>("App", { viewRegistry }),
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
    registerMarkdownPostProcessor: vi.fn(),
    registerCliCommand: vi.fn(),
  });
  return { plugin, commands };
}

describe("makePluginHost", () => {
  it.effect("holds a command until its Scope closes", () =>
    Effect.gen(function* () {
      const obsidian = fakeObsidian();
      const host = makePluginHost(obsidian.plugin);
      const scope = yield* Scope.fork(yield* Effect.scope);

      const command = yield* host
        .addCommand({ id: "open-release-note", name: "Open release note" })
        .pipe(Scope.provide(scope));

      expect(command.id).toBe("zotlit:open-release-note");
      expect([...obsidian.commands.keys()]).toEqual([
        "zotlit:open-release-note",
      ]);

      yield* Scope.close(scope, Exit.void);

      expect(obsidian.commands.size).toBe(0);
    }),
  );

  it.effect(
    "hands each made view of the named types to the hook until its Scope closes",
    () =>
      Effect.gen(function* () {
        const made: string[] = [];
        const registry = {
          getViewCreatorByType: (type: string) => (leaf: WorkspaceLeaf) =>
            stubService<View>("View", {
              getViewType: () => type,
              leaf,
            }),
        };
        const obsidian = fakeObsidian(registry);
        const host = makePluginHost(obsidian.plugin);
        const scope = yield* Scope.fork(yield* Effect.scope);
        const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});

        const hooked = yield* host
          .onViewCreated(["graph"], (_leaf, view) =>
            made.push(view.getViewType()),
          )
          .pipe(Scope.provide(scope));
        registry.getViewCreatorByType("graph")(leaf);
        registry.getViewCreatorByType("markdown")(leaf);

        expect(hooked).toBe(true);
        expect(made).toEqual(["graph"]);

        yield* Scope.close(scope, Exit.void);
        registry.getViewCreatorByType("graph")(leaf);

        expect(made).toEqual(["graph"]);
      }),
  );

  it.effect("hooks nothing when the build has no view registry", () =>
    Effect.gen(function* () {
      const host = makePluginHost(fakeObsidian().plugin);

      const hooked = yield* host
        .onViewCreated(["graph"], () => {})
        .pipe(Effect.scoped);

      expect(hooked).toBe(false);
    }),
  );

  it.effect("holds the setting tab until its Scope closes", () =>
    Effect.gen(function* () {
      const tabs: PluginSettingTab[] = [];
      const close = vi.fn<() => void>();
      const plugin = stubService<Plugin & CliHost>("Plugin", {
        app: stubService<App>("App", {
          setting: stubService<App["setting"]>("SettingsModal", {
            close,
            removeSettingTab: (tab) => void tabs.splice(tabs.indexOf(tab), 1),
          }),
        }),
        addSettingTab: (tab) => void tabs.push(tab),
      });
      const host = makePluginHost(plugin);
      const scope = yield* Scope.fork(yield* Effect.scope);
      const tab = stubService<PluginSettingTab>("PluginSettingTab", {});
      const owners: Plugin[] = [];

      const added = yield* host
        .addSettingTab((owner) => {
          owners.push(owner);
          return tab;
        })
        .pipe(Scope.provide(scope));

      expect(added === tab).toBe(true);
      expect(owners[0] === plugin).toBe(true);
      expect(tabs.length === 1 && tabs[0] === tab).toBe(true);

      yield* host.closeSettings;
      expect(close).toHaveBeenCalledOnce();

      yield* Scope.close(scope, Exit.void);
      expect(tabs).toHaveLength(0);
    }),
  );

  plainIt("reads the app and manifest from the plugin", () => {
    const obsidian = fakeObsidian();
    const host = makePluginHost(obsidian.plugin);

    expect(host.app).toBe(obsidian.plugin.app);
    expect(host.manifest.version).toBe("2.0.0");
  });
});
