// @vitest-environment happy-dom
import { DropdownComponent, Setting } from "@mock/obsidian";
import { Effect, Stream } from "effect";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingGroup,
} from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { LocalServer } from "@/services/local-server/service";
import { defaults } from "@/services/settings/schema";

import { profileRowServices, testSettingTab } from "./__fixtures__";
import { advancedPageItems, clearExcerptCache } from "./advanced";
import type { SettingsKey, SettingTabContext } from "./context";

function items(overrides: Partial<SettingTabContext> = {}) {
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(profileRowServices()).tab,
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.succeed({ ...defaults, "log.to-file": false }),
    }),
    localServer: stubService<LocalServer["Service"]>("LocalServer", {
      effectivePort: Effect.succeed(null),
      effectivePortChanges: Stream.empty,
    }),
    localBridge: stubService<SettingTabContext["localBridge"]>("LocalBridge", {
      connection: null,
    }),
    ...overrides,
  });
  return advancedPageItems(ctx);
}

it.each(["cancel", "clear", "failure"] as const)(
  "handles the excerpt cache recovery action: %s",
  async (mode) => {
    const confirm = vi.fn(async () => mode !== "cancel");
    const clear = vi.fn(async () => {
      if (mode === "failure") throw new Error("storage blocked");
    });
    expect(await clearExcerptCache({ confirm, clear })).toBe(
      mode === "cancel" ? "cancelled" : mode === "clear" ? "cleared" : "failed",
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledTimes(mode === "cancel" ? 0 : 1);
  },
);

it("offers each editor choice in web-enabled builds", () => {
  const preferenceName = m.template_workbench_preference_name();

  const row = items().find(
    (item): item is SettingDefinitionItem<SettingsKey> =>
      "name" in item && item.name === preferenceName,
  )!;
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(
    setting as unknown as ObsidianSetting,
    stubService<SettingGroup>("SettingGroup", {}),
  );
  const dropdown = setting.components.find(
    (control) => control instanceof DropdownComponent,
  ) as DropdownComponent;
  expect(dropdown.options).toEqual([
    { value: "ask", label: m.template_workbench_preference_ask() },
    { value: "web", label: m.template_workbench_preference_web() },
    { value: "native", label: m.template_workbench_name() },
  ]);
});
