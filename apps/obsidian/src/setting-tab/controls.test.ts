// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Context, Effect } from "effect";
import type { Plugin } from "obsidian";
import { expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { settingsRuntimeOf } from "@/services/settings/__fixtures__";
import { PluginSettings } from "@/services/settings/service";

import { scopedSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { ZotLitSettingTab } from "./index";

it.effect(
  "control writes are readable once written and persist through the settings service",
  () =>
    Effect.gen(function* () {
      let disk: unknown;
      const { settings } = yield* settingsRuntimeOf({
        plugin: {
          loadData: async () => null,
          saveData: async (value) => {
            disk = value;
          },
        },
      });
      yield* settings.loaded;
      const { tab } = yield* scopedSettingTab(
        Context.make(PluginSettings, settings),
      );
      const settingTab = new ZotLitSettingTab(
        stubService<Plugin>("Plugin", {
          app: stubService("App", {}),
          manifest: stubService("PluginManifest", {}),
        }),
        stubService<Omit<SettingTabContext, "app" | "manifest">>(
          "SettingTabContext",
          { tab },
        ),
      );
      // Obsidian awaits each write before it refreshes the DOM state.
      const write = (key: string, value: unknown) =>
        Effect.promise(() => settingTab.setControlValue(key, value));

      yield* write("citation.at-trigger", true);
      expect(settingTab.getControlValue("citation.at-trigger")).toBe(true);
      yield* write("template.auto-trim-leading", "keep");
      expect(settingTab.getControlValue("template.auto-trim-leading")).toBe(
        "keep",
      );
      yield* write("log.level", "off");
      expect(settingTab.getControlValue("log.level")).toBe("off");
      yield* write("note-profile:default:folder", "Research");
      expect(settingTab.getControlValue("note-profile:default:folder")).toBe(
        "Research",
      );
      yield* settings.flush;
      expect(disk).toMatchObject({
        __VERSION__: 11,
        "citation.at-trigger": true,
        "template.auto-trim-leading": false,
        "log.level": null,
        "note.default-profile": {
          bindings: { "note.literature-folder": "Research" },
        },
      });
    }),
);
