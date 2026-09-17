// @vitest-environment happy-dom
// The colour menu builds its titles with `createFragment`, which needs a DOM.
import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
} from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";

import {
  buildAttachmentMenu,
  buildColorMenu,
  buildFollowModeMenu,
  buildTagMenu,
} from "./menus";
import { followModeMenu } from "./presentation";
import type { FollowMenuState } from "./presentation";

const ON_AN_ITEM: FollowMenuState = {
  followMode: "active-tab",
  pinnable: "ABCD2345",
};

function followMenu(overrides: Partial<FollowMenuState> = {}) {
  const state = { ...ON_AN_ITEM, ...overrides };
  const actions = {
    onSetFollowMode: vi.fn(),
    onPinCurrentItem: vi.fn(),
    onPinItem: vi.fn(),
    onUnpin: vi.fn(),
  };
  const menu = new Menu();
  buildFollowModeMenu(menu as never, { state, actions });
  const item = (title: string) =>
    menu.items.find((entry) => entry.title === title);
  return { actions, menu, item, state };
}

beforeEach(() => {
  Menu.instances.length = 0;
});

describe("the Follow Mode menu", () => {
  it("offers every entry the one table answers, in its order, with its icon", () => {
    const { menu, state } = followMenu();

    expect(menu.items.map((entry) => [entry.title, entry.icon])).toStrictEqual(
      followModeMenu(state).map((entry) => [entry.label, entry.icon]),
    );
  });

  it("switches the mode from the entry", () => {
    const { actions, item } = followMenu();

    item(m.annot_view_mode_zotero_reader())!.click();
    expect(actions.onSetFollowMode).toHaveBeenCalledWith("zotero-reader");
  });

  it("offers Unpin in place of Pin while pinned", () => {
    const { actions, item } = followMenu({ followMode: "pinned" });

    expect(item(m.annot_view_mode_pin_current_item())).toBeUndefined();
    item(m.annot_view_mode_unpin())!.click();
    expect(actions.onUnpin).toHaveBeenCalledTimes(1);
  });

  it("pins the Item on screen from the entry", () => {
    const { actions, item } = followMenu();

    item(m.annot_view_mode_pin_current_item())!.click();
    expect(actions.onPinCurrentItem).toHaveBeenCalledTimes(1);
  });

  it("opens the item picker from the entry", () => {
    const { actions, item } = followMenu();

    item(m.annot_view_pin_choose_item())!.click();
    expect(actions.onPinItem).toHaveBeenCalledTimes(1);
  });
});

describe("the Attachment menu", () => {
  const options = [
    { key: "ATCH2345", label: "first.pdf (3)" },
    { key: "ATCH6789", label: "second.pdf (1)" },
  ];

  function build(selectedKey: string) {
    const onSelect = vi.fn();
    const menu = new Menu();
    buildAttachmentMenu(menu as never, { options, selectedKey, onSelect });
    return { menu, onSelect };
  }

  it("lists every Attachment and checks the one on screen", () => {
    const { menu } = build("ATCH6789");

    expect(menu.items.map((item) => [item.title, item.checked])).toStrictEqual([
      ["first.pdf (3)", false],
      ["second.pdf (1)", true],
    ]);
  });

  it("selects the Attachment the entry names", () => {
    const { menu, onSelect } = build("ATCH2345");

    menu.items[1]!.click();
    expect(onSelect).toHaveBeenCalledWith("ATCH6789");
  });
});

describe("the colour menu", () => {
  function build(color: string | null) {
    const onSelect = vi.fn();
    const menu = new Menu();
    buildColorMenu(menu as never, { color, onSelect });
    return { menu, onSelect };
  }

  it("offers Zotero's eight swatches by name, in Zotero's order", () => {
    const { menu } = build(null);

    expect(menu.items.map((item) => item.title)).toStrictEqual(
      ANNOTATION_COLORS.map((hex) => annotationColorLabel(hex)),
    );
  });

  it("carries the colour itself beside each name", () => {
    const { menu } = build(null);
    const swatch =
      menu.items[0]!.titleFragment?.querySelector<HTMLElement>("[style]");

    expect(swatch?.style.backgroundColor).toBe(ANNOTATION_COLORS[0]);
  });

  it("checks the swatch the Annotation carries, whatever case it was stored in", () => {
    const { menu } = build("#FFD400");

    expect(menu.items.filter((item) => item.checked)).toHaveLength(1);
    expect(menu.items[0]!.checked).toBe(true);
  });

  it("recolours from the entry", () => {
    const { menu, onSelect } = build(null);

    menu.items[2]!.click();
    expect(onSelect).toHaveBeenCalledWith(ANNOTATION_COLORS[2]);
  });
});

describe("the tag menu", () => {
  function build(selectedTags: string[]) {
    const onToggle = vi.fn();
    const menu = new Menu();
    buildTagMenu(menu as never, {
      tags: ["method", "to-read"],
      selectedTags,
      onToggle,
    });
    return { menu, onToggle };
  }

  it("checks the tags the filter already holds", () => {
    const { menu } = build(["to-read"]);

    expect(menu.items.map((item) => [item.title, item.checked])).toStrictEqual([
      ["method", false],
      ["to-read", true],
    ]);
  });

  it("toggles the tag the entry names", () => {
    const { menu, onToggle } = build([]);

    menu.items[0]!.click();
    expect(onToggle).toHaveBeenCalledWith("method");
  });
});
