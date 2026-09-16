import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { createAnnotActions } from "./actions";

const annotation: AnnotationRecord = {
  key: "ANNT2345g42",
  type: "highlight",
  text: "Selected text",
  comment: null,
  color: "#ffd400",
  parentKey: "ATCH2345g42",
  pageLabel: "4",
  tags: [],
  position: { kind: "pdf-rects", pageIndex: 3, rects: [] },
  version: null,
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
      getDataDir: () => "",
      resolveAnnotationID: () => 1,
      refresh: vi.fn(),
      noteFeature: { renderAnnotationCitation: () => null },
      onDragStart: vi.fn(),
      renderComment: () => () => {},
      onSetFollowMode: vi.fn(),
      onPinCurrentItem: vi.fn(),
      onPinItem: vi.fn(),
      onUnpin: vi.fn(),
      onEnableLiveUpdates: vi.fn(),
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
    expect(writeText).toHaveBeenCalledWith("ANNT2345g42");
  });
});
