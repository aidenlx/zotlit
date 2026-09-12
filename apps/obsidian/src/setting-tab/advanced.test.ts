// @vitest-environment happy-dom
import { DropdownComponent, Setting } from "@mock/obsidian";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
} from "obsidian";
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { advancedPageItems } from "./advanced";
import type { SettingsKey, SettingTabContext } from "./context";

function items(webWorkbenchEnabled: boolean) {
  return advancedPageItems({
    webWorkbenchEnabled,
    app: { loadLocalStorage: () => null, saveLocalStorage: () => {} },
    settings: { current: { "log.to-file": false } },
    template: { loaded: false },
    localServer: { effectivePort: null },
    localBridge: { connection: null },
  } as unknown as SettingTabContext);
}

it("includes the editor-choice preference only in web-enabled builds", () => {
  const preferenceName = m.template_workbench_preference_name();

  const row = items(true).find(
    (item): item is SettingDefinitionItem<SettingsKey> =>
      "name" in item && item.name === preferenceName,
  )!;
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  const dropdown = setting.components.find(
    (control) => control instanceof DropdownComponent,
  ) as DropdownComponent;
  expect(dropdown.options).toEqual([
    { value: "ask", label: m.template_workbench_preference_ask() },
    { value: "web", label: m.template_workbench_preference_web() },
    { value: "native", label: m.template_workbench_name() },
  ]);

  expect(items(false)).not.toContainEqual(
    expect.objectContaining({ name: preferenceName }),
  );
});
