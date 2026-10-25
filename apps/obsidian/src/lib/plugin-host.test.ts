import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import type { App, Command, Plugin, PluginManifest } from "obsidian";
import { describe, expect, it as plainIt, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { CliHost } from "@/lib/cli-command";

import { makePluginHost } from "./plugin-host";

/** The command registry a plugin writes to, shaped as Obsidian 1.15.0 keeps it. */
function fakeObsidian() {
  const commands = new Map<string, Command>();
  const plugin = stubService<Plugin & CliHost>("Plugin", {
    app: stubService<App>("App", {}),
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

  plainIt("reads the app and manifest from the plugin", () => {
    const obsidian = fakeObsidian();
    const host = makePluginHost(obsidian.plugin);

    expect(host.app).toBe(obsidian.plugin.app);
    expect(host.manifest.version).toBe("2.0.0");
  });
});
