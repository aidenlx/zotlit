// @vitest-environment happy-dom
import { it as effectIt } from "@effect/vitest";
import { renderRow } from "@mock/obsidian";
import type { DropdownComponent, TextComponent } from "@mock/obsidian";
import { Context, Effect } from "effect";
import type { SettingDefinitionItem } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { eventually } from "@/lib/__fixtures__/eventually";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { highlightEmoji } from "@/lib/highlight-mapping";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import {
  PluginSettings,
  SettingsMutationError,
} from "@/services/settings/service";

import { scopedSettingTab, testSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { highlightMappingItems } from "./note-import";

function setup() {
  let current: Settings = { ...defaults };
  const update = (
    patch: Partial<Settings> | ((settings: Settings) => Partial<Settings>),
  ) => {
    current = {
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    };
  };
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(() => current),
    update: (patch) =>
      Effect.sync(() => {
        const next = typeof patch === "function" ? patch(current) : patch;
        return Object.assign(current, next);
      }),
  });
  const rebuild = vi.fn<() => void>();
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(Context.make(PluginSettings, settings), {
      update: rebuild,
    }).tab,
  });
  const rows = highlightMappingItems(ctx);
  const row = (name: string) => {
    const item = rows.find((entry) => "name" in entry && entry.name === name);
    if (!item) throw new Error(`Mapping row missing: ${name}`);
    return item;
  };
  return { ctx, row, update, settings, rebuild };
}

function visible(item: SettingDefinitionItem) {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

describe("highlight mapping page", () => {
  it("retains the selected output when the default Profile toggle changes", () => {
    const { row, update, rebuild } = setup();
    const setEnabled = (enabled: boolean) =>
      update({
        "note.default-profile": {
          bindings: {
            ...defaults["note.default-profile"].bindings,
            "note.import-colored-highlights": enabled,
          },
        },
      });
    setEnabled(true);

    const dropdown = renderRow(row(m.annot_view_color_blue()))
      .components[0] as DropdownComponent;
    expect(dropdown.getValue()).toBe("🔵");
    expect(dropdown.options.map(({ value }) => value)).toEqual([
      "mark",
      "🔴",
      "🟠",
      "🟡",
      "🟢",
      "🔵",
      "🟣",
      "custom",
    ]);
    dropdown.choose("mark");
    setEnabled(false);
    setEnabled(true);
    expect(
      (
        renderRow(row(m.annot_view_color_blue()))
          .components[0] as DropdownComponent
      ).getValue(),
    ).toBe("mark");
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("shows custom input, validates it, and preserves it across output changes", () => {
    const { ctx, row, settings } = setup();
    const dropdown = renderRow(row(m.annot_view_color_blue()))
      .components[0] as DropdownComponent;
    const inputRow = row(
      m.settings_note_import_custom_emoji_name({
        color: m.annot_view_color_blue(),
      }),
    );
    expect(visible(inputRow)).toBe(false);
    dropdown.choose("custom");
    expect(visible(inputRow)).toBe(true);

    const setting = renderRow(inputRow);
    const input = setting.components[0] as TextComponent;
    const emoji = () =>
      highlightEmoji(
        "blue",
        ctx.tab.sync(settings.current)["note.import-highlight-mappings"],
      );
    expect(setting.errorMessage).toBeTruthy();
    expect(emoji()).toBeNull();
    input.type("👩‍🔬");
    expect(setting.errorMessage).toBeNull();
    expect(emoji()).toBe("👩‍🔬");
    input.type("🔴🔵");
    expect(setting.errorMessage).toBeTruthy();
    expect(emoji()).toBeNull();
    input.type("👩‍🔬");
    dropdown.choose("🟠");
    expect(visible(inputRow)).toBe(false);
    expect(emoji()).toBe("🟠");
    dropdown.choose("custom");
    expect(
      (renderRow(inputRow).components[0] as TextComponent).getValue(),
    ).toBe("👩‍🔬");
    expect(emoji()).toBe("👩‍🔬");
  });
});

effectIt.effect("shows a failed mapping save in a notice", () =>
  Effect.gen(function* () {
    const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(defaults),
      update: () =>
        Effect.fail(
          new SettingsMutationError({
            message: "Settings are read-only",
            cause: null,
          }),
        ),
    });
    const rebuild = vi.fn<() => void>();
    const { tab, notices } = yield* scopedSettingTab(
      Context.make(PluginSettings, settings),
      { update: rebuild },
    );
    const ctx = stubService<SettingTabContext>("SettingTabContext", { tab });
    const blue = highlightMappingItems(ctx).find(
      (entry) => "name" in entry && entry.name === m.annot_view_color_blue(),
    )!;
    const dropdown = renderRow(blue).components[0] as DropdownComponent;

    dropdown.choose("mark");
    yield* eventually(() =>
      expect(notices.map(({ messages }) => messages[0])).toEqual([
        `${m.settings_failed_save()}: Settings are read-only`,
      ]),
    );
    expect(rebuild).not.toHaveBeenCalled();
  }),
);
