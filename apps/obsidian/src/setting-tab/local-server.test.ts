// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { ButtonComponent, renderRow } from "@mock/obsidian";
import { Context, Effect, Stream } from "effect";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import { vi } from "vitest";

import { eventually } from "@/lib/__fixtures__/eventually";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { LocalBridge } from "@/services/local-bridge/service";
import type { WorkbenchConnection } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { scopedSettingTab } from "./__fixtures__";
import type { SettingsKey, SettingTabContext } from "./context";
import { localServerItems } from "./local-server";

interface Options {
  settings?: Partial<Settings>;
  connection?: WorkbenchConnection | null;
  disconnect?: () => void;
}

const setup = Effect.fnUntraced(function* ({
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
    tab: (yield* scopedSettingTab(services)).tab,
    webWorkbenchEnabled: true,
  });
  return localServerItems(ctx);
});

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

it.effect(
  "hides everything but the listener toggle while the server is off",
  () =>
    Effect.gen(function* () {
      const items = yield* setup({ settings: { "server.enabled": false } });

      const [listener, ...hosted] = items;
      expect(visible(listener!)).toBe(true);
      expect(hosted.map(visible)).toEqual(hosted.map(() => false));
    }),
);

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: { key: "IANNP5A2", title: "Why research findings are false" },
};

it.effect("ends the connected workbench session", () =>
  Effect.gen(function* () {
    const disconnect = vi.fn();
    const items = yield* setup({
      settings: { "server.enabled": true },
      connection: CONNECTION,
      disconnect,
    });

    const item = row(
      items,
      m.settings_local_server_workbench_connection_name(),
    );
    const button = renderRow(item).components.find(
      (control) => control instanceof ButtonComponent,
    )!;
    expect(button.text).toBe(m.settings_local_server_workbench_disconnect());
    button.click();
    yield* eventually(() => expect(disconnect).toHaveBeenCalledTimes(1));
  }),
);
