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
  settings?: Partial<Settings>;
  connection?: WorkbenchConnection | null;
  disconnect?: () => void;
}

function setup({
  settings = {},
  connection = null,
  disconnect = () => {},
}: Options = {}) {
  const current: Settings = { ...defaults, ...settings };
  const ctx = {
    webWorkbenchEnabled: true,
    settings: { current },
    localServer: { effectivePort: null, on: () => () => {} },
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

it("hides everything but the listener toggle while the server is off", () => {
  const items = setup({ settings: { "server.enabled": false } });

  const [listener, ...hosted] = items;
  expect(visible(listener!)).toBe(true);
  expect(hosted.map(visible)).toEqual(hosted.map(() => false));
});

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: { key: "IANNP5A2", title: "Why research findings are false" },
};

it("ends the connected workbench session", () => {
  const disconnect = vi.fn();
  const items = setup({
    settings: { "server.enabled": true },
    connection: CONNECTION,
    disconnect,
  });

  const item = row(items, m.settings_local_server_workbench_connection_name());
  const button = render(item).components.find(
    (control) => control instanceof ButtonComponent,
  )!;
  expect(button.text).toBe(m.settings_local_server_workbench_disconnect());
  button.click();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
