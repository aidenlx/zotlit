import { Menu } from "@mock/obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExplorerActions } from "./actions";
import { formatPath, type DisplayNode } from "./display-tree";

const node: DisplayNode = {
  kind: "value",
  path: ["itemType"],
  key: "itemType",
  label: "itemType",
  valueType: "string",
  value: "journalArticle",
  expandable: false,
};

const event = { nativeEvent: {} } as unknown as React.MouseEvent;

function makeActions(overrides?: {
  annotationKeyAt?: (node: DisplayNode) => string | null;
  onAnchorAnnotation?: (key: string) => void;
}) {
  return createExplorerActions({
    onChooseItem: vi.fn(),
    onToggle: vi.fn(),
    onFilter: vi.fn(),
    annotationKeyAt: overrides?.annotationKeyAt ?? (() => null),
    onAnchorAnnotation: overrides?.onAnchorAnnotation ?? vi.fn(),
    onBackToNoteRoot: vi.fn(),
    onRefresh: vi.fn(),
  });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onTemplateMenu", () => {
  it("adds a single zt copy-path item shared by both engines", () => {
    const actions = makeActions();
    actions.onTemplateMenu(node, event);

    const menu = Menu.instances.at(-1)!;
    expect(menu.items).toHaveLength(1);

    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith(formatPath(node.path, "zt"));
  });

  it("adds the anchor item and invokes onAnchorAnnotation when annotationKeyAt matches", () => {
    const onAnchorAnnotation = vi.fn();
    const actions = makeActions({
      annotationKeyAt: () => "ANNO0001",
      onAnchorAnnotation,
    });
    actions.onTemplateMenu(node, event);

    const menu = Menu.instances.at(-1)!;
    expect(menu.items).toHaveLength(2);

    menu.items[1]!.click();
    expect(onAnchorAnnotation).toHaveBeenCalledWith("ANNO0001");
  });
});
