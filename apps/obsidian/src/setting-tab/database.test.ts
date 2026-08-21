import type { Setting, SettingGroup } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION, DOCS_SITE_URL } from "@/lib/constants";

import type { SettingTabContext } from "./context";
import { databasePageItems } from "./database";

afterEach(() => vi.unstubAllGlobals());

describe("Zotero database settings", () => {
  it("starts with required Companion setup and symptom-based help", () => {
    const items = databasePageItems({} as SettingTabContext);

    expect(items.slice(0, 2)).toMatchObject([
      {
        name: "ZotLit Companion, the Zotero add-on",
        desc: "The Companion keeps recent Zotero changes available to ZotLit.",
      },
      {
        name: "Zotero changes not appearing?",
        desc: "Follow the troubleshooting guide to make recent changes available to ZotLit.",
      },
    ]);
  });

  it.each([
    [0, DOCS_COMPANION],
    [1, `${DOCS_SITE_URL}/docs/how-to/fix-stale-data`],
  ])("opens guide %i at its documented URL", (index, expectedUrl) => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    buttonAction(index)();

    expect(open).toHaveBeenCalledWith(expectedUrl);
  });
});

function buttonAction(index: number): () => void {
  let action: (() => void) | undefined;
  const button = {
    setButtonText: () => button,
    onClick: (onClick: () => void) => {
      action = onClick;
      return button;
    },
  };
  const setting = {
    addButton: (configure: (component: typeof button) => void) => {
      configure(button);
      return setting;
    },
  };
  const item = databasePageItems({} as SettingTabContext)[index];
  if (!item || !("render" in item) || !item.render) {
    throw new Error(`Database setting ${index} has no custom renderer`);
  }
  item.render(setting as unknown as Setting, {} as SettingGroup);
  if (!action) throw new Error(`Database setting ${index} has no button`);
  return action;
}
