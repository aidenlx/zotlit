// @vitest-environment happy-dom
import { Setting } from "@mock/obsidian";
import type { DropdownComponent, TextComponent } from "@mock/obsidian";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingGroup,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { highlightEmoji } from "@/lib/highlight-mapping";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import type { SettingTabContext } from "./context";
import { noteImportPageItems } from "./note-import";

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
  const ctx = {
    settings: {
      get current() {
        return current;
      },
      update,
    },
    requestUpdate: vi.fn(),
  } as unknown as SettingTabContext;
  const page = noteImportPageItems(ctx).find(
    (item) => "type" in item && item.type === "page",
  );
  if (!page || !("items" in page) || !page.items)
    throw new Error("Mapping page missing");
  const rows = page.items;
  const row = (name: string) => {
    const item = rows.find((entry) => "name" in entry && entry.name === name);
    if (!item) throw new Error(`Mapping row missing: ${name}`);
    return item;
  };
  return { ctx, page, row, update };
}

function render(item: SettingDefinitionItem) {
  if (!("render" in item) || !item.render)
    throw new Error("Custom renderer missing");
  const setting = new Setting(document.createElement("div"));
  item.render(setting as unknown as ObsidianSetting, {} as SettingGroup);
  return setting;
}

function visible(item: SettingDefinitionItem) {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

describe("highlight mapping page", () => {
  it("follows the toggle and retains the selected output", () => {
    const { ctx, page, row, update } = setup();
    expect(visible(page)).toBe(false);
    update({ "note.import-colored-highlights": true });
    expect(visible(page)).toBe(true);

    const dropdown = render(row("Blue")).components[0] as DropdownComponent;
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
    update({ "note.import-colored-highlights": false });
    expect(visible(page)).toBe(false);
    update({ "note.import-colored-highlights": true });
    expect(
      (render(row("Blue")).components[0] as DropdownComponent).getValue(),
    ).toBe("mark");
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
  });

  it("shows custom input, validates it, and preserves it across output changes", () => {
    const { ctx, row } = setup();
    const dropdown = render(row("Blue")).components[0] as DropdownComponent;
    const inputRow = row("Blue custom emoji");
    expect(visible(inputRow)).toBe(false);
    dropdown.choose("custom");
    expect(visible(inputRow)).toBe(true);

    const setting = render(inputRow);
    const input = setting.components[0] as TextComponent;
    const emoji = () =>
      highlightEmoji(
        "blue",
        ctx.settings.current!["note.import-highlight-mappings"],
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
    expect((render(inputRow).components[0] as TextComponent).getValue()).toBe(
      "👩‍🔬",
    );
    expect(emoji()).toBe("👩‍🔬");
  });
});
