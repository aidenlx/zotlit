// @vitest-environment happy-dom
import type { App, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { installGraphBookmarks } from "./bookmarks";

vi.mock("@/lib/log", () => ({
  getLogger: () => ({ warn: vi.fn(), debug: vi.fn() }),
}));

describe("graph bookmarks", () => {
  it("delegates global bookmarks to Obsidian when graph citations are off", async () => {
    const native = vi.fn();
    const bookmarks = { openBookmarkInLeaf: native, addItem: vi.fn() };
    const app = {
      internalPlugins: { getEnabledPluginById: () => bookmarks },
      workspace: { on: () => ({ e: { offref() {} } }) },
    } as unknown as App;
    using _installed = installGraphBookmarks(app, () => false);
    const setViewState = vi.fn();
    const leaf = { setViewState } as unknown as WorkspaceLeaf;
    const bookmark = { type: "graph", options: { showTags: true } };
    await bookmarks.openBookmarkInLeaf(bookmark, leaf);
    expect(native).toHaveBeenCalledWith(bookmark, leaf, undefined);
    expect(setViewState).not.toHaveBeenCalled();
  });

  it.each(["graph", "localgraph"])(
    "restores %s options without changing global defaults",
    async (type) => {
      const shared = { showTags: true };
      const native = vi.fn();
      const bookmarks = { openBookmarkInLeaf: native, addItem: vi.fn() };
      const app = {
        internalPlugins: {
          getEnabledPluginById: (id: string) =>
            id === "bookmarks" ? bookmarks : { options: shared },
        },
        workspace: { on: () => ({ e: { offref() {} } }) },
      } as unknown as App;
      const setViewState = vi.fn(async () => {});
      const leaf = { setViewState } as unknown as WorkspaceLeaf;
      const options = {
        "zotlit-color-citation-links": true,
        "zotlit-citation-popover": false,
        ...(type === "localgraph" ? { "zotlit-local-file": "Draft.md" } : {}),
      };
      using _installed = installGraphBookmarks(app, () => true);
      await bookmarks.openBookmarkInLeaf({ type: "graph", options }, leaf);
      expect(setViewState).toHaveBeenCalledWith({
        type,
        state: {
          options,
          ...(type === "localgraph" ? { file: "Draft.md" } : {}),
        },
      });
      expect(shared).toEqual({ showTags: true });
      expect(native).not.toHaveBeenCalled();
    },
  );
});
