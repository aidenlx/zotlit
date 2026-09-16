import type { Command } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { addFollowModeCommands } from "./register";
import type { FollowModeCommandTarget } from "./register";
import type { FollowMode } from "./store";

function view(
  snapshot: Partial<FollowModeCommandTarget["snapshot"]> = {},
  gestures: Partial<NonNullable<FollowModeCommandTarget["gestures"]>> = {},
) {
  return {
    snapshot: {
      followMode: "active-tab" as FollowMode,
      pinnable: "ABCD2345",
      ...snapshot,
    },
    gestures: {
      onSetFollowMode: vi.fn(),
      onPinCurrentItem: vi.fn(),
      onPinItem: vi.fn(),
      onUnpin: vi.fn(),
      ...gestures,
    },
  };
}

function register(target: FollowModeCommandTarget | null) {
  const commands: Command[] = [];
  addFollowModeCommands(
    { addCommand: (command) => (commands.push(command), command) },
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

  it("keeps the item picker offered in every mode", () => {
    for (const mode of ["active-tab", "zotero-reader", "pinned"] as const) {
      const target = view({ followMode: mode });
      const { byName } = register(target);
      byName(m.command_annot_view_pin_item_name()).run();
      expect(target.gestures.onPinItem).toHaveBeenCalledTimes(1);
    }
  });
});
