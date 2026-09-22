import type {
  App,
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingTab,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { openSettingsTab, revealSetting } from "./open-settings";

const TAB_ID = "zotlit";

const style: SettingDefinition = {
  id: "citation_references_style",
  name: "Citation and references style",
};
const engine: SettingDefinition = {
  id: "citation_engine",
  name: "Pandoc engine",
};
const logLevel: SettingDefinition = {
  id: "log_level",
  name: "Log level",
};
const approvedFolder: SettingDefinition = {
  id: "settings_attachment_approved_folder",
  name: "Approved folder",
};

/**
 * The shape the tab hands out: a group wrapping navigable pages, whose own
 * groups hold the rows. Only a page names a step of the path.
 */
const settingItems: SettingDefinitionItem[] = [
  logLevel,
  {
    type: "group",
    id: "settings_pages",
    items: [
      {
        type: "page",
        id: "settings_page_citations",
        name: "Citations",
        items: [
          {
            type: "group",
            id: "settings_citation_references",
            heading: "References",
            items: [style, engine],
          },
        ],
      },
      {
        type: "page",
        id: "settings_page_attachments",
        name: "Attachments",
        items: [
          {
            type: "page",
            id: "settings_attachment_approved",
            name: "Approved folders",
            items: [approvedFolder],
          },
        ],
      },
    ],
  },
];

/** The settings modal as these links drive it, with every call recorded. */
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

/**
 * How Obsidian resolves a `pagePath` segment: against a page's `id`, with a
 * group stepped through without consuming a segment. A transcription, so the
 * running app stays the ground truth — verify a link there with
 * `/obsidian-debug` before trusting a green run here.
 *
 * @see node_modules/.ob-rev-1.14.2/app.js — `R6` and `F6`
 */
function resolvePage(
  items: SettingDefinitionItem[],
  pagePath: readonly string[],
): SettingDefinitionPage | null {
  const [head, ...rest] = pagePath;
  if (head === undefined) return null;
  for (const item of items) {
    if (!("type" in item)) continue;
    if (item.type === "page") {
      if (item.id !== head) continue;
      if (rest.length === 0) return item;
      return item.items ? resolvePage(item.items, rest) : null;
    }
    const hit =
      "items" in item && item.items && resolvePage(item.items, pagePath);
    if (hit) return hit;
  }
  return null;
}

/** The page path one call handed Obsidian. */
function pagePathOf(
  setting: ReturnType<typeof createSettingsModal>["setting"],
): string[] {
  const [group] = setting.navigateToSearchResult.mock.calls[0]!;
  return group.pagePath;
}

describe("openSettingsTab", () => {
  it("opens the tab and descends the page path", () => {
    const { app, setting, tab } = createSettingsModal();

    openSettingsTab(app, TAB_ID, [
      "settings_page_attachments",
      "settings_attachment_approved",
    ]);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.openTabById).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["settings_page_attachments", "settings_attachment_approved"],
    });
    expect(resolvePage(settingItems, pagePathOf(setting))?.id).toBe(
      "settings_attachment_approved",
    );
  });

  it("opens the tab alone with an empty path", () => {
    const { app, setting } = createSettingsModal();

    openSettingsTab(app, TAB_ID);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
  });

  it("opens the modal alone when the tab id is unknown", () => {
    const { app, setting } = createSettingsModal();

    openSettingsTab(app, "not-installed", ["settings_page_citations"]);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
  });
});

describe("revealSetting", () => {
  it("opens the tab, descends to the row's page, and flashes the row", () => {
    const { app, setting, tab } = createSettingsModal();

    revealSetting(app, TAB_ID, style.id);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.openTabById).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["settings_page_citations"],
    });
    expect(setting.scrollToDefinition).toHaveBeenCalledExactlyOnceWith(
      tab,
      style,
    );
    expect(
      setting.navigateToSearchResult.mock.invocationCallOrder[0]!,
    ).toBeLessThan(setting.scrollToDefinition.mock.invocationCallOrder[0]!);
  });

  it("hands Obsidian a path that resolves to the page holding the row", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, TAB_ID, style.id);

    expect(resolvePage(settingItems, pagePathOf(setting))?.id).toBe(
      "settings_page_citations",
    );
  });

  it("names every page down to a row nested two pages deep", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, TAB_ID, approvedFolder.id);

    expect(pagePathOf(setting)).toStrictEqual([
      "settings_page_attachments",
      "settings_attachment_approved",
    ]);
  });

  it("reveals a row at the tab root with no page to descend", () => {
    const { app, setting, tab } = createSettingsModal();

    revealSetting(app, TAB_ID, logLevel.id);

    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: [],
    });
    expect(setting.scrollToDefinition).toHaveBeenCalledExactlyOnceWith(
      tab,
      logLevel,
    );
  });

  it("leaves the modal on the tab when no row carries the id", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, TAB_ID, "a_row_this_tab_never_renders");

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
    expect(setting.scrollToDefinition).not.toHaveBeenCalled();
  });

  it("opens the modal alone when the tab id is unknown", () => {
    const { app, setting } = createSettingsModal();

    revealSetting(app, "not-installed", style.id);

    expect(setting.open).toHaveBeenCalledOnce();
    expect(setting.navigateToSearchResult).not.toHaveBeenCalled();
    expect(setting.scrollToDefinition).not.toHaveBeenCalled();
  });
});
