// @vitest-environment happy-dom
import { ButtonComponent, Setting, ToggleComponent } from "@mock/obsidian";
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
  effectivePort?: number | null;
  settings?: Partial<Settings>;
  connection?: WorkbenchConnection | null;
  disconnect?: () => void;
  /** The vault-scoped device store the launch-sheet flag lives in. */
  device?: Map<string, unknown>;
}

function setup({
  effectivePort = null,
  settings = {},
  connection = null,
  disconnect = () => {},
  device = new Map<string, unknown>(),
}: Options = {}) {
  const current: Settings = { ...defaults, ...settings };
  const ctx = {
    app: {
      loadLocalStorage: (key: string) => device.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => {
        if (value === null) device.delete(key);
        else device.set(key, value);
      },
    },
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

it("offers the launch sheet's own switch, on until the sheet is dismissed for good", () => {
  const device = new Map<string, unknown>();
  const items = setup({ settings: { "server.enabled": true }, device });

  const item = row(items, m.settings_local_server_workbench_confirm_name());
  expect(visible(item)).toBe(true);
  const toggle = render(item).components.find(
    (control) => control instanceof ToggleComponent,
  )!;
  expect(toggle.getValue()).toBe(true);

  toggle.toggle(false);
  expect(device.get("zotlit-workbench-launch-approved")).toBe("1");

  // A device that already skipped the sheet gets the switch back off, and
  // turning it on clears the skip.
  const back = setup({ settings: { "server.enabled": true }, device });
  const backToggle = render(
    row(back, m.settings_local_server_workbench_confirm_name()),
  ).components.find((control) => control instanceof ToggleComponent)!;
  expect(backToggle.getValue()).toBe(false);
  backToggle.toggle(true);
  expect(device.has("zotlit-workbench-launch-approved")).toBe(false);
});

it("withholds the launch sheet's switch while the Workbench is off", () => {
  const items = setup({
    settings: { "server.enabled": true, "server.workbench": false },
  });

  expect(
    visible(row(items, m.settings_local_server_workbench_confirm_name())),
  ).toBe(false);
});
