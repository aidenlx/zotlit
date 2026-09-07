// @vitest-environment happy-dom
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import type { SettingsKey, SettingTabContext } from "./context";
import { localServerItems } from "./local-server";

interface Options {
  effectivePort?: number | null;
  settings?: Partial<Settings>;
}

function setup({ effectivePort = null, settings = {} }: Options = {}) {
  const current: Settings = { ...defaults, ...settings };
  const ctx = {
    settings: { current },
    localServer: { effectivePort, on: () => () => {} },
  } as unknown as SettingTabContext;
  return localServerItems(ctx);
}

function visible(item: SettingDefinitionItem): boolean {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

function row(items: SettingGroupItem<SettingsKey>[], name: string) {
  const item = items.find((entry) => "name" in entry && entry.name === name);
  if (!item) throw new Error(`Local server row missing: ${name}`);
  return item;
}

/** The toggle key each of the group's three switches binds, keyed by its label. */
const TOGGLES = [
  [m.settings_local_server_enabled_name(), "server.enabled"],
  [m.settings_live_updates_enabled_name(), "server.live-update"],
  [m.settings_local_server_workbench_name(), "server.workbench"],
] as const;

it("offers one toggle per hosted service beside the listener's own", () => {
  const items = setup({ settings: { "server.enabled": true } });

  for (const [name, key] of TOGGLES) {
    expect(row(items, name)).toHaveProperty(
      "control",
      expect.objectContaining({ type: "toggle", key }),
    );
  }
  // The listener is off out of the box; each service it hosts is on, so
  // turning the listener on needs no second switch.
  expect(defaults["server.enabled"]).toBe(false);
  expect(defaults["server.live-update"]).toBe(true);
  expect(defaults["server.workbench"]).toBe(true);
});

it("hides everything but the listener toggle while the server is off", () => {
  const items = setup({ settings: { "server.enabled": false } });

  const [listener, ...hosted] = items;
  expect(visible(listener!)).toBe(true);
  expect(hosted.map(visible)).toEqual(hosted.map(() => false));
});

it("names the port the listener actually bound", () => {
  const items = setup({
    effectivePort: 9095,
    settings: { "server.enabled": true, "server.port": 9091 },
  });

  expect(row(items, m.settings_local_server_active_port_name())).toHaveProperty(
    "desc",
    m.settings_local_server_active_port_desc({ port: 9095 }),
  );
});

it("says so while nothing is bound", () => {
  const items = setup({ settings: { "server.enabled": true } });

  expect(row(items, m.settings_local_server_active_port_name())).toHaveProperty(
    "desc",
    m.settings_local_server_active_port_none(),
  );
});
