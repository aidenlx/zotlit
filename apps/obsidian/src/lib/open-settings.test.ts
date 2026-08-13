import type {
  App,
  SettingDefinition,
  SettingDefinitionItem,
  SettingTab,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { revealSetting } from "./open-settings";

const TAB_ID = "zotlit";

const style: SettingDefinition = { name: "Citation and references style" };
const engine: SettingDefinition = { name: "Pandoc engine" };
const logLevel: SettingDefinition = { name: "Log level" };

/**
 * The shape the tab hands out: a group wrapping a navigable page, whose own
 * group holds the rows. Only the page names a step of the path.
 */
const settingItems: SettingDefinitionItem[] = [
  logLevel,
  {
    type: "group",
    items: [
      {
        type: "page",
        name: "Citations",
        items: [
          { type: "group", heading: "References", items: [style, engine] },
        ],
      },
    ],
  },
];

/** The settings modal as `revealSetting` drives it, with every call recorded. */
function createSettingsModal(items = settingItems) {
  const tab = { id: TAB_ID, settingItems: items } as unknown as SettingTab;
  const setting = {
    open: vi.fn(),
    openTabById: vi.fn((id: string) => (id === TAB_ID ? tab : null)),
    navigateToSearchResult: vi.fn(),
    scrollToDefinition: vi.fn(),
  };
  return { app: { setting } as unknown as App, setting, tab };
}

describe("revealSetting", () => {
  it("opens the tab, descends to the row's page, and flashes the row", () => {
    const { app, setting, tab } = createSettingsModal();

    revealSetting(app, TAB_ID, style.name);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.openTabById).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["Citations"],
    });
    expect(setting.scrollToDefinition).toHaveBeenCalledExactlyOnceWith(
      tab,
      style,
    );
  });

  it("opens the sub-page before scrolling, which reaches the rendered page alone", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, TAB_ID, style.name);

    expect(
      setting.navigateToSearchResult.mock.invocationCallOrder[0]!,
    ).toBeLessThan(setting.scrollToDefinition.mock.invocationCallOrder[0]!);
  });

  it("reveals a row at the tab root with no page to descend", () => {
    const { app, setting, tab } = createSettingsModal();

    revealSetting(app, TAB_ID, logLevel.name);

    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: [],
    });
    expect(setting.scrollToDefinition).toHaveBeenCalledExactlyOnceWith(
      tab,
      logLevel,
    );
  });

  it("leaves the modal on the tab when no row carries the name", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, TAB_ID, "A row this tab never renders");

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
    expect(setting.scrollToDefinition).not.toHaveBeenCalled();
  });

  it("opens the modal alone when the tab id is unknown", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, "not-installed", style.name);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
    expect(setting.scrollToDefinition).not.toHaveBeenCalled();
  });
});
