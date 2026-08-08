import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotViewItem } from "@zotlit/db";

import { createAnnotActions } from "./actions";

const annotation: AnnotViewItem = {
  itemID: 1,
  key: "ANNO2345",
  type: 1,
  text: "Selected text",
  comment: null,
  color: "#ffd400",
  pageLabel: "4",
  parentKey: "ATCH2345",
  tags: [],
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Menu.instances.length = 0;
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    clipboard: { writeText },
  });
});

describe("Annotation View menu", () => {
  it("offers the selected annotation's key", () => {
    const actions = createAnnotActions({
      app: {} as never,
      getGroupID: () => 42,
      getDataDir: () => "",
      refresh: vi.fn(),
      noteFeature: { renderAnnotationCitation: () => null },
      onDragStart: vi.fn(),
      renderComment: () => () => {},
      onToggleFollowReader: vi.fn(),
      onLinkItem: vi.fn(),
      onUnlinkItem: vi.fn(),
      onExploreAnnotation: vi.fn(),
    });

    actions.onMoreOptions({ nativeEvent: {} } as never, annotation);

    const menu = Menu.instances[0]!;
    const copyKey = menu.items.find(
      (item) => item.title === "Copy annotation key",
    );
    expect(copyKey).toBeDefined();
    // This menu uses no sections. A sectioned item would be hoisted out of the
    // copy cluster by Obsidian's menu sort.
    expect(menu.items.every((item) => item.section === "")).toBe(true);

    copyKey!.click();
    expect(writeText).toHaveBeenCalledWith("ANNO2345g42");
  });
});
