import { Menu } from "@mock/obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatPath } from "@zotlit/workbench/explorer";
import type { DisplayNode } from "@zotlit/workbench/explorer";

import { createExplorerActions } from "./actions";

const node: DisplayNode = {
  kind: "value",
  path: ["itemType"],
  key: "itemType",
  label: "itemType",
  valueType: "string",
  value: "journalArticle",
  expandable: false,
};

const arrayNode: DisplayNode = {
  kind: "value",
  path: ["tags"],
  key: "tags",
  label: "tags",
  valueType: "array",
  value: ["physics"],
  expandable: true,
};

const event = { nativeEvent: {} } as unknown as React.MouseEvent;

function makeActions(overrides?: {
  annotationKeyAt?: (node: DisplayNode) => string | null;
  onAnchorAnnotation?: (key: string) => void;
  isEtaEnabled?: () => boolean;
  copyTarget?: () => {
    indexedKey: string;
    kind: "item" | "annotation";
  } | null;
  canExport?: () => boolean;
  onExport?: () => void;
}) {
  return createExplorerActions({
    onChooseItem: vi.fn(),
    onToggle: vi.fn(),
    onFilter: vi.fn(),
    annotationKeyAt: overrides?.annotationKeyAt ?? (() => null),
    onAnchorAnnotation: overrides?.onAnchorAnnotation ?? vi.fn(),
    onBackToNoteRoot: vi.fn(),
    onRefresh: vi.fn(),
    isEtaEnabled: overrides?.isEtaEnabled ?? (() => false),
    copyTarget: overrides?.copyTarget ?? (() => null),
    canExport: overrides?.canExport ?? (() => true),
    onExport: overrides?.onExport ?? vi.fn(),
  });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Menu.instances.length = 0;
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onTemplateMenu — copy path", () => {
  it("lists the shared zt copy-path first", () => {
    makeActions().onTemplateMenu(node, event);

    const menu = Menu.instances[0]!;
    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith(formatPath(node.path, "zt"));
  });
});

describe("onTemplateMenu — snippets, Eta disabled", () => {
  it("adds Liquid snippet items inline, no submenu", () => {
    makeActions().onTemplateMenu(node, event);

    const menu = Menu.instances[0]!;
    // copy-path + output + if-present
    expect(menu.items).toHaveLength(3);
    expect(menu.items.every((i) => i.submenu === null)).toBe(true);

    menu.items[1]!.click();
    expect(writeText).toHaveBeenCalledWith("{{ zt.itemType }}");
  });

  it("offers loop and joined inline for an array node", () => {
    makeActions().onTemplateMenu(arrayNode, event);

    const menu = Menu.instances[0]!;
    // copy-path + loop + joined
    expect(menu.items).toHaveLength(3);

    menu.items[1]!.click();
    expect(writeText).toHaveBeenCalledWith(
      "{% for tag in zt.tags %}{{ tag }}{% endfor %}",
    );
  });
});

describe("onTemplateMenu — snippets, Eta enabled", () => {
  it("splits snippets into Liquid and Eta submenus", () => {
    makeActions({ isEtaEnabled: () => true }).onTemplateMenu(node, event);

    const menu = Menu.instances[0]!;
    // copy-path + Liquid submenu + Eta submenu
    expect(menu.items).toHaveLength(3);

    const liquid = menu.items[1]!.submenu;
    const eta = menu.items[2]!.submenu;
    expect(liquid).not.toBeNull();
    expect(eta).not.toBeNull();

    liquid!.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith("{{ zt.itemType }}");

    eta!.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith("<%= zt.itemType %>");
  });
});

describe("onTemplateMenu — annotation anchor", () => {
  it("appends the anchor item after the snippets and invokes onAnchorAnnotation", () => {
    const onAnchorAnnotation = vi.fn();
    makeActions({
      annotationKeyAt: () => "ANNO0001",
      onAnchorAnnotation,
    }).onTemplateMenu(node, event);

    const menu = Menu.instances[0]!;
    // copy-path + output + if-present + anchor
    expect(menu.items).toHaveLength(4);

    menu.items.at(-1)!.click();
    expect(onAnchorAnnotation).toHaveBeenCalledWith("ANNO0001");
  });
});

describe("pane menu — copy key", () => {
  it("offers the object displayed by the current root", () => {
    const menu = new Menu();
    const actions = makeActions({
      copyTarget: () => ({ indexedKey: "ANNO2345g42", kind: "annotation" }),
    });

    expect(actions.addCopyKeyMenuItem(menu as never)).toBe(true);
    expect(menu.items[0]!.title).toBe("Copy annotation key");
    // The pane menu groups by section, alongside Obsidian's own entries.
    expect(menu.items[0]!.section).toBe("zotlit");

    menu.items[0]!.click();
    expect(writeText).toHaveBeenCalledWith("ANNO2345g42");
  });

  it("adds nothing when no object is displayed", () => {
    const menu = new Menu();
    const actions = makeActions({ copyTarget: () => null });

    expect(actions.addCopyKeyMenuItem(menu as never)).toBe(false);
    expect(menu.items).toHaveLength(0);
  });
});

describe("pane menu — export", () => {
  it("adds a zotlit-section export entry that runs the export", () => {
    const onExport = vi.fn();
    const menu = new Menu();

    makeActions({ onExport }).addExportMenuItem(menu as never);

    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]!.section).toBe("zotlit");
    menu.items[0]!.click();
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("adds nothing while no template data is built", () => {
    const menu = new Menu();

    makeActions({ canExport: () => false }).addExportMenuItem(menu as never);

    expect(menu.items).toHaveLength(0);
  });
});
