// @vitest-environment happy-dom
import { DropdownComponent, renderRow } from "@mock/obsidian";
import { Context, Effect, Stream } from "effect";
import type { SettingDefinitionItem } from "obsidian";
import { expect, it } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { LocalBridge } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { profileRowServices, testSettingTab } from "./__fixtures__";
import { advancedPageItems } from "./advanced";
import type { SettingsKey, SettingTabContext } from "./context";

function items(overrides: Partial<SettingTabContext> = {}) {
  const settings = { ...defaults, "log.to-file": false };
  const services = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(settings),
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
        connection: Effect.succeed(null),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(Context.merge(services, profileRowServices())).tab,
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.succeed(settings),
    }),
    ...overrides,
  });
  return advancedPageItems(ctx);
}

it("offers each editor choice in web-enabled builds", () => {
  const preferenceName = m.template_workbench_preference_name();

  const row = items().find(
    (item): item is SettingDefinitionItem<SettingsKey> =>
      "name" in item && item.name === preferenceName,
  )!;
  const dropdown = renderRow(row).components.find(
    (control) => control instanceof DropdownComponent,
  ) as DropdownComponent;
  expect(dropdown.options).toEqual([
    { value: "ask", label: m.template_workbench_preference_ask() },
    { value: "web", label: m.template_workbench_preference_web() },
    { value: "native", label: m.template_workbench_name() },
  ]);
});
