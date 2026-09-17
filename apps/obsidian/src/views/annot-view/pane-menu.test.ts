import { Menu } from "@mock/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { AnnotActions } from "./actions";
import { buildPaneMenu } from "./pane-menu";
import { followModeMenu } from "./presentation";
import type { FollowMenuState } from "./presentation";

const ON_AN_ITEM: FollowMenuState = {
  followMode: "active-tab",
  pinnable: "ABCD2345",
};

function spies() {
  return {
    onSetFollowMode: vi.fn(),
    onPinCurrentItem: vi.fn(),
    onPinItem: vi.fn(),
    onUnpin: vi.fn(),
    onRefresh: vi.fn(),
  };
}

function build(overrides: Partial<FollowMenuState> = {}) {
  const state = { ...ON_AN_ITEM, ...overrides };
  const actions = spies();
  const menu = new Menu();
  buildPaneMenu(menu as never, {
    state,
    actions: actions as unknown as AnnotActions,
  });
  const item = (title: string) =>
    menu.items.find((entry) => entry.title === title);
  return { actions, menu, item, state };
}

beforeEach(() => {
  Menu.instances.length = 0;
});

describe("the Annotation View's pane menu", () => {
  it("offers every entry the mode button offers, and Refresh data after", () => {
    const { menu, state } = build();

    // The two surfaces read one table, so the pane menu never drifts from the
    // toolbar's menu; only "Refresh data" is the pane menu's own.
    expect(menu.items.map((entry) => entry.title)).toStrictEqual([
      ...followModeMenu(state).map((entry) => entry.label),
      m.annot_view_refresh_data(),
    ]);
  });

  it("switches the mode from the menu", () => {
    const { actions, item } = build();

    item(m.annot_view_mode_zotero_reader())!.click();
    expect(actions.onSetFollowMode).toHaveBeenCalledWith("zotero-reader");
  });

  it("offers Unpin in place of Pin while pinned", () => {
    const { actions, item } = build({ followMode: "pinned" });

    expect(item(m.annot_view_mode_pin_current_item())).toBeUndefined();
    item(m.annot_view_mode_unpin())!.click();
    expect(actions.onUnpin).toHaveBeenCalledTimes(1);
  });

  it("reaches the item picker", () => {
    const { actions, item } = build();

    item(m.annot_view_pin_choose_item())!.click();
    expect(actions.onPinItem).toHaveBeenCalledTimes(1);
  });

  it("leaves out the pin while no Item stands to be pinned", () => {
    const { item } = build({ pinnable: null });

    expect(item(m.annot_view_mode_pin_current_item())).toBeUndefined();
  });

  it("moves Refresh data off the toolbar row and into this menu", () => {
    const { actions, item } = build();

    item(m.annot_view_refresh_data())!.click();
    expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  });
});
