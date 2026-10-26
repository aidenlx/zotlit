// @vitest-environment happy-dom
import { ButtonComponent, Setting } from "@mock/obsidian";
import { Context, Effect, Stream } from "effect";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingGroup,
  SettingGroupItem,
} from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { LocalBridge } from "@/services/local-bridge/service";
import type { WorkbenchConnection } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { testSettingTab } from "./__fixtures__";
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
  const services = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(current),
    }),
  ).pipe(
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePort: Effect.succeed(null),
        effectivePortChanges: Stream.empty,
      }),
    ),
    Context.add(
      LocalBridge,
      stubService<LocalBridge["Service"]>("LocalBridge", {
        connection: Effect.succeed(connection),
        disconnect: Effect.sync(disconnect),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(services).tab,
    webWorkbenchEnabled: true,
  });
  return localServerItems(ctx);
}

/** The rendered row, so a test reads the controls the user gets. */
function render(row: SettingDefinitionItem): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(
    setting as unknown as ObsidianSetting,
    stubService<SettingGroup>("SettingGroup", {}),
  );
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

it("ends the connected workbench session", async () => {
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
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
});
