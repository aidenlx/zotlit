import type { App, PluginManifest } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { UnloadAwarePlugin } from "./plugin-lifecycle";

const manifest: PluginManifest = {
  id: "zotlit",
  name: "ZotLit",
  version: "0.0.0",
  minAppVersion: "1.14.0",
  description: "",
  author: "",
};

function loadedPlugin(): UnloadAwarePlugin {
  const plugin = new UnloadAwarePlugin(stubService<App>("App", {}), manifest);
  plugin.load();
  return plugin;
}

describe("UnloadAwarePlugin", () => {
  it("keeps a registration's cleanup until the plugin unloads", () => {
    const plugin = loadedPlugin();
    const cleanup = vi.fn();
    plugin.register(cleanup);
    expect(cleanup).not.toHaveBeenCalled();
    plugin.unload();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  // An onload that a disable interrupts registers after the unload; Obsidian
  // never runs those cleanups, and the next enable finds the names taken.
  it("runs the cleanup of a registration after the unload at once (#1786)", () => {
    const plugin = loadedPlugin();
    plugin.unload();
    const cleanup = vi.fn();
    plugin.register(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
