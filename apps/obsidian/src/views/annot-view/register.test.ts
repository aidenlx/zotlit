import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { Command } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { makeAnnotViewModel } from "./model";
import { addFollowModeCommands } from "./register";
import type { FollowModeCommandTarget } from "./register";
import type { FollowMode } from "./store";
import { DEFAULT_FOLLOW_MODE } from "./view-state";

function view(
  state: { followMode?: FollowMode; pinnable?: string | null } = {},
  gestures: Partial<NonNullable<FollowModeCommandTarget["gestures"]>> = {},
) {
  const { followMode = "active-tab", pinnable = "ABCD2345" } = state;
  return {
    model: makeAnnotViewModel({
      followMode,
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: followMode === "pinned" ? "ABCD2345" : null,
    }),
    snapshot: { pinnable },
    gestures: {
      onSetFollowMode: vi.fn(),
      onPinCurrentItem: vi.fn(),
      onPinItem: vi.fn(),
      onUnpin: vi.fn(),
      ...gestures,
    },
  };
}

function register(
  target: FollowModeCommandTarget | null,
  registry = AtomRegistry.make(),
) {
  const commands: Command[] = [];
  addFollowModeCommands(
    { addCommand: (command) => (commands.push(command), command) },
    registry,
    () => target,
  );
  const byName = (name: string) => {
    const command = commands.find((entry) => entry.name === name)!;
    return {
      /** Whether the palette offers it. */
      get offered() {
        return command.checkCallback!(true) === true;
      },
      run() {
        command.checkCallback!(false);
      },
    };
  };
  return { commands, byName };
}

describe("the five Follow Mode commands", () => {
  it("gives each command an id and a name of its own", () => {
    const { commands } = register(view());

    // Obsidian keys a command by its id, so a repeat would silently replace
    // the one before it, and a repeated name would be unreadable in the
    // palette.
    expect(new Set(commands.map((command) => command.id)).size).toBe(
      commands.length,
    );
    expect(new Set(commands.map((command) => command.name)).size).toBe(
      commands.length,
    );
  });

  it("offers none of them while no Annotation View is open", () => {
    const { commands } = register(null);

    expect(
      commands.every((command) => command.checkCallback!(true) === false),
    ).toBe(true);
  });

  it("switches the mode the palette offers", () => {
    const target = view();
    const { byName } = register(target);

    expect(byName(m.command_annot_view_follow_active_tab_name()).offered).toBe(
      false,
    );
    byName(m.command_annot_view_follow_zotero_reader_name()).run();
    expect(target.gestures.onSetFollowMode).toHaveBeenCalledWith(
      "zotero-reader",
    );
  });

  it("drops Pin current item when the source names no Item", () => {
    const blocked = view({ pinnable: null });
    const { byName } = register(blocked);

    expect(byName(m.command_annot_view_pin_current_item_name()).offered).toBe(
      false,
    );
    byName(m.command_annot_view_pin_current_item_name()).run();
    expect(blocked.gestures.onPinCurrentItem).not.toHaveBeenCalled();
  });

  it("swaps Pin current item for Unpin while pinned", () => {
    const pinned = view({ followMode: "pinned" });
    const { byName } = register(pinned);

    expect(byName(m.command_annot_view_pin_current_item_name()).offered).toBe(
      false,
    );
    expect(byName(m.command_annot_view_unpin_name()).offered).toBe(true);
    byName(m.command_annot_view_unpin_name()).run();
    expect(pinned.gestures.onUnpin).toHaveBeenCalledTimes(1);
  });

  it("reads the Follow Mode the registry holds for the view", () => {
    const target = view();
    const registry = AtomRegistry.make();
    const release = registry.mount(target.model.state);
    const { byName } = register(target, registry);
    const followActiveTab = byName(
      m.command_annot_view_follow_active_tab_name(),
    );
    expect(followActiveTab.offered).toBe(false);

    registry.set(target.model.state, {
      followMode: "zotero-reader",
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: null,
    });

    expect(followActiveTab.offered).toBe(true);
    release();
    registry.dispose();
  });

  it("keeps the item picker offered in every mode", () => {
    for (const mode of ["active-tab", "zotero-reader", "pinned"] as const) {
      const target = view({ followMode: mode });
      const { byName } = register(target);
      byName(m.command_annot_view_pin_item_name()).run();
      expect(target.gestures.onPinItem).toHaveBeenCalledTimes(1);
    }
  });
});
