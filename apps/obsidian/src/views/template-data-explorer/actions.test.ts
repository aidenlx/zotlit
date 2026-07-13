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
  isEtaEnabled?: () => boolean;
  annotationKeyAt?: (node: DisplayNode) => string | null;
  onAnchorAnnotation?: (key: string) => void;
}) {
  return createExplorerActions({
    onChooseItem: vi.fn(),
    onToggle: vi.fn(),
    onFilter: vi.fn(),
    isEtaEnabled: overrides?.isEtaEnabled ?? (() => false),
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

describe("onTemplateMenu — Eta flag gate", () => {
  it("adds only the Liquid copy-path item when Eta is disabled", () => {
    const actions = makeActions({ isEtaEnabled: () => false });
    actions.onTemplateMenu(node, event);

    const menu = Menu.instances.at(-1)!;
    expect(menu.items).toHaveLength(1);

    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith(formatPath(node.path, "zt"));
  });

  it("adds both Liquid and Eta copy-path items when Eta is enabled", () => {
    const actions = makeActions({ isEtaEnabled: () => true });
    actions.onTemplateMenu(node, event);

    const menu = Menu.instances.at(-1)!;
    expect(menu.items).toHaveLength(2);

    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith(formatPath(node.path, "zt"));

    menu.items[1]!.click();
    expect(writeText).toHaveBeenCalledWith(formatPath(node.path, "it"));
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
