import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";

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

/** The repository's write path, with every command observable. */
function writes() {
  return {
    patchColor: vi.fn(() => Promise.resolve(IDLE)),
    patchComment: vi.fn(() => Promise.resolve(IDLE)),
    deleteAnnotation: vi.fn(() => Promise.resolve(IDLE)),
    retryWrite: vi.fn(() => Promise.resolve(IDLE)),
    discardConflict: vi.fn(),
    retryCreate: vi.fn(() =>
      Promise.resolve({ kind: "created", annotationKey: "MADE2345" } as const),
    ),
    discardCreate: vi.fn(),
  };
}

function setup(
  overrides: Partial<Parameters<typeof createAnnotActions>[0]> = {},
) {
  const annotations = writes();
  const actions = createAnnotActions({
    app: {} as never,
    getDataDir: () => "",
    annotations,
    deleteControl: () => ({ disabled: false, tooltip: "Delete annotation" }),
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
    onSelectAnnotation: vi.fn(),
    onExploreAnnotation: vi.fn(),
    ...overrides,
  });
  return { actions, annotations };
}

/**
 * A click on the card's overflow control. The menu anchors under the control,
 * so the gesture carries the element and the box layout measured for it; where
 * the menu lands is `lib/menu.test.ts`'s subject, not this file's.
 */
function fromOverflowControl() {
  return {
    type: "click",
    currentTarget: {
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, bottom: 0 }),
      // No menu of its own stands open, so the press opens one.
      hasClass: () => false,
    },
  } as never;
}

describe("Annotation View menu", () => {
  it("offers the selected annotation's key", () => {
    const { actions } = setup();

    actions.onMoreOptions(fromOverflowControl(), annotation);

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

  it("deletes through the repository, by key alone", () => {
    const { actions, annotations } = setup();

    actions.onMoreOptions(fromOverflowControl(), annotation);
    const menu = Menu.instances[0]!;
    const remove = menu.items.find(
      (item) => item.title === "Delete annotation",
    );

    expect(remove?.disabled).toBe(false);
    remove!.click();
    expect(annotations.deleteAnnotation).toHaveBeenCalledWith("ANNT2345g42");
  });

  it("disables the delete in place and says why beside it", () => {
    const reason = "You do not have write access to this library.";
    const { actions, annotations } = setup({
      deleteControl: () => ({ disabled: true, tooltip: reason }),
    });

    actions.onMoreOptions(fromOverflowControl(), annotation);
    const menu = Menu.instances[0]!;
    const remove = menu.items.find(
      (item) => item.title === "Delete annotation",
    );

    expect(remove?.disabled).toBe(true);
    // A native MenuItem shows no tooltip, so the reason stands as a label row.
    // @see apps/obsidian/policies/tooltips.md
    expect(
      menu.items.some((item) => item.isLabel && item.title === reason),
    ).toBe(true);
    remove!.click();
    expect(annotations.deleteAnnotation).not.toHaveBeenCalled();
  });

  it("opens a right-click's menu at the pointer, not under the card", () => {
    const { actions } = setup();
    const nativeEvent = { type: "contextmenu" } as MouseEvent;

    actions.onCardContextMenu({ nativeEvent } as never, annotation);

    const menu = Menu.instances[0]!;
    expect(menu.mouseEvent).toBe(nativeEvent);
    // The control path leaves these unset; the pointer path takes neither.
    expect(menu.position).toBeNull();
    expect(menu.parentEl).toBeNull();
  });
});
