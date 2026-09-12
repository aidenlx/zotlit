// @vitest-environment happy-dom
import { ButtonComponent, Setting } from "@mock/obsidian";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingGroupItem,
} from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { WorkbenchConnection } from "@/services/local-bridge/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import type { SettingsKey, SettingTabContext } from "./context";
import { localServerItems } from "./local-server";

interface Options {
  webWorkbenchEnabled?: boolean;
  effectivePort?: number | null;
  settings?: Partial<Settings>;
  connection?: WorkbenchConnection | null;
  disconnect?: () => void;
}

function setup({
  webWorkbenchEnabled = true,
  effectivePort = null,
  settings = {},
  connection = null,
  disconnect = () => {},
}: Options = {}) {
  const current: Settings = { ...defaults, ...settings };
  const ctx = {
    webWorkbenchEnabled,
    settings: { current },
    localServer: { effectivePort, on: () => () => {} },
    localBridge: { connection, disconnect, on: () => () => {} },
  } as unknown as SettingTabContext;
  return localServerItems(ctx);
}

/** The rendered row, so a test reads the controls the user gets. */
function render(row: SettingDefinitionItem): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
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

  for (const [name] of TOGGLES) {
    row(items, name);
  }
});

it("keeps Local Server and Live Update controls while hiding bridge controls", () => {
  const items = setup({
    webWorkbenchEnabled: false,
    settings: { "server.enabled": true, "server.workbench": true },
    connection: CONNECTION,
  });

  row(items, m.settings_local_server_enabled_name());
  row(items, m.settings_live_updates_enabled_name());
  expect(
    items.some(
      (item) =>
        "name" in item &&
        (item.name === m.settings_local_server_workbench_name() ||
          item.name === m.settings_local_server_workbench_connection_name()),
    ),
  ).toBe(false);
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

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: { key: "IANNP5A2", title: "Why research findings are false" },
};

it("carries no connection row while nothing is connected", () => {
  const items = setup({ settings: { "server.enabled": true } });

  expect(
    items.some(
      (item) =>
        "name" in item &&
        item.name === m.settings_local_server_workbench_connection_name(),
    ),
  ).toBe(false);
});

it("names the connected website and template, and ends the session", () => {
  const disconnect = vi.fn();
  const items = setup({
    settings: { "server.enabled": true },
    connection: CONNECTION,
    disconnect,
  });

  const item = row(items, m.settings_local_server_workbench_connection_name());
  expect(item).toHaveProperty(
    "desc",
    m.settings_local_server_workbench_connection_desc({
      website: "zotlit.aidenlx.site",
      profile: "Books",
    }),
  );
  const button = render(item).components.find(
    (control) => control instanceof ButtonComponent,
  )!;
  expect(button.text).toBe(m.settings_local_server_workbench_disconnect());
  button.click();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
