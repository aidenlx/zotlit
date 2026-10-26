// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { ButtonComponent, Setting } from "@mock/obsidian";
import { Context, Effect, Layer, Stream } from "effect";
import type {
  Setting as ObsidianSetting,
  SettingDefinition,
  SettingGroup,
} from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import {
  eventually,
  fakeDevice,
  startOn,
} from "@/services/language-pack/__fixtures__";
import { LanguagePack } from "@/services/language-pack/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { testSettingTab } from "./__fixtures__";
import type { SettingsKey, SettingTabContext } from "./context";
import { resourcesGroup } from "./resources";

/** The Language Pack row of the resources group, when it stands. */
const languagePackRow = (ctx: SettingTabContext) =>
  resourcesGroup(ctx).items?.find(
    (item): item is SettingDefinition<SettingsKey> =>
      "id" in item && item.id === "settings_language_pack",
  );

it.effect(
  "installs from the setting row behind the toast, and the row then names the restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language: "zh" });
        const notifier = testNotifier();
        const services = (yield* Layer.build(notifier.layer)).pipe(
          Context.add(LanguagePack, pack),
          Context.add(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: Effect.succeed(defaults),
            }),
          ),
        );
        const ctx = stubService<SettingTabContext>("SettingTabContext", {
          tab: testSettingTab(services).tab,
          manifest: stubService<SettingTabContext["manifest"]>(
            "PluginManifest",
            { version: "2.0.0" },
          ),
        });

        const row = languagePackRow(ctx);
        if (!row || !("render" in row) || !row.render)
          throw new Error("Expected the Language Pack row to offer an install");
        const setting = new Setting(document.createElement("div"));
        row.render(
          setting as unknown as ObsidianSetting,
          stubService<SettingGroup>("SettingGroup", {}),
        );
        const install = setting.components.find(
          (control) => control instanceof ButtonComponent,
        );
        if (!(install instanceof ButtonComponent))
          throw new Error("No install button");
        install.click();

        yield* pack.changes.pipe(
          Stream.filter((situation) => situation.kind === "restart-pending"),
          Stream.runHead,
        );
        yield* eventually(() => expect(notifier.notices).toHaveLength(1));
        expect(notifier.notices[0]?.messages).toEqual([
          m.notice_language_pack_restart(),
        ]);
        expect(languagePackRow(ctx)?.desc).toBe(
          m.notice_language_pack_restart(),
        );
      }),
    ),
);
