// The page path `openSettingsTab` hands Obsidian differs by build: 1.14 reads
// a page's `id` where earlier builds read its `name`. Each case loads the
// module afresh so `requireApiVersion` answers for the build under test.

import type { App, SettingDefinitionItem, SettingTab } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

const TAB_ID = "zotlit";

/** A group-wrapping-page tree, as the tab hands it out. */
const settingItems: SettingDefinitionItem[] = [
  {
    type: "page",
    id: "settings_page_attachments",
    name: "Attachments",
    items: [
      {
        type: "page",
        id: "settings_attachment_approved",
        name: "Approved folders",
        items: [],
      },
    ],
  },
];

function createSettingsModal() {
  const tab = { id: TAB_ID, settingItems } as unknown as SettingTab;
  const setting = {
    open: vi.fn(),
    openTabById: vi.fn((id: string) => (id === TAB_ID ? tab : null)),
    navigateToSearchResult: vi.fn(),
  };
  return { app: { setting } as unknown as App, setting, tab };
}

/** Loads `open-settings` with `requireApiVersion` deciding for one threshold. */
async function loadOpenSettings(matches: boolean) {
  vi.resetModules();
  vi.doMock("obsidian", async () => {
    const actual = await vi.importActual<object>("obsidian");
    return { ...actual, requireApiVersion: () => matches };
  });
  return import("./open-settings");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("obsidian");
});

describe("openSettingsTab page paths", () => {
  it("hands ids to a build that matches pages by id", async () => {
    const { openSettingsTab } = await loadOpenSettings(true);
    const { app, setting, tab } = createSettingsModal();

    openSettingsTab(app, TAB_ID, [
      "settings_page_attachments",
      "settings_attachment_approved",
    ]);

    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["settings_page_attachments", "settings_attachment_approved"],
    });
  });

  it("resolves ids to page names on a build that matches by name alone", async () => {
    const { openSettingsTab } = await loadOpenSettings(false);
    const { app, setting, tab } = createSettingsModal();

    openSettingsTab(app, TAB_ID, [
      "settings_page_attachments",
      "settings_attachment_approved",
    ]);

    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["Attachments", "Approved folders"],
    });
  });

  it("stops the name path at the first id the tree does not hold", async () => {
    const { openSettingsTab } = await loadOpenSettings(false);
    const { app, setting, tab } = createSettingsModal();

    openSettingsTab(app, TAB_ID, [
      "settings_page_attachments",
      "settings_page_missing",
    ]);

    expect(setting.navigateToSearchResult).toHaveBeenCalledExactlyOnceWith({
      tab,
      pagePath: ["Attachments"],
    });
  });
});
