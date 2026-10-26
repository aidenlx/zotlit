// @vitest-environment happy-dom
import { ButtonComponent, Setting } from "@mock/obsidian";
import { Effect } from "effect";
import type { Setting as ObsidianSetting, SettingGroup } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import { openWelcomeView } from "@/views/welcome/register";

import { testSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { resourcesGroup } from "./resources";

vi.mock("@/views/welcome/register", () => ({
  openWelcomeView: vi.fn(async () => {}),
}));

function renderResources(ctx: SettingTabContext): Setting[] {
  const container = document.createElement("div");
  return resourcesGroup(ctx).items!.flatMap((item) => {
    if (!("render" in item) || !item.render) return [];
    const setting = new Setting(container);
    setting.setName(item.name ?? "");
    setting.setDesc(
      typeof item.desc === "string"
        ? item.desc
        : (item.desc?.textContent ?? ""),
    );
    item.render(
      setting as unknown as ObsidianSetting,
      stubService<SettingGroup>("SettingGroup", {}),
    );
    return [setting];
  });
}

function reviewButton(settings: Setting[]): ButtonComponent | undefined {
  return settings
    .flatMap(({ components }) => components)
    .find(
      (component): component is ButtonComponent =>
        component instanceof ButtonComponent &&
        component.text === m.settings_template_conversion_reminder_action(),
    );
}

it("opens conversion review from the pending reminder and removes it after acceptance", () => {
  let current = { ...defaults, "note.template-conversion-pending": true };
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab().tab,
    app: stubService<SettingTabContext["app"]>("App", {}),
    languagePack: stubService<SettingTabContext["languagePack"]>(
      "LanguagePack",
      {
        getSituation: () => ({
          kind: "active" as const,
          pack: { fileName: "en.json", origin: "https://example.com" },
        }),
        endonym: "English",
      },
    ),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "2.3.0",
    }),
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.sync(() => current),
    }),
  });
  const rendered = renderResources(ctx);
  expect(
    rendered.find(({ name }) => name === m.welcome_template_conversion_title())
      ?.desc,
  ).toBe(m.settings_template_conversion_reminder_desc());
  const review = reviewButton(rendered);
  expect(review).toBeDefined();
  review!.click();
  expect(openWelcomeView).toHaveBeenCalledWith(ctx.app, ctx.settings, {
    runSync: expect.any(Function),
  });

  current = {
    ...defaults,
    "note.template-conversion-pending": false,
  };
  expect(reviewButton(renderResources(ctx))).toBeUndefined();
});
