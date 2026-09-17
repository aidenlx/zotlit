// The Annotation View's native pane menu: the Follow Mode switches the toolbar
// button offers, and the rare action the toolbar row no longer carries.
import type { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { AnnotActions } from "./actions";
import { buildFollowModeMenu } from "./menus";
import type { FollowMenuState } from "./presentation";

export interface PaneMenuInput {
  state: FollowMenuState;
  actions: AnnotActions;
}

/**
 * The same entries the mode button offers, plus "Refresh data". Every one is a
 * user gesture; nothing here reacts to a source that stopped answering.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function buildPaneMenu(
  menu: Menu,
  { state, actions }: PaneMenuInput,
): void {
  menu.addSeparator();
  buildFollowModeMenu(menu, { state, actions });

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_refresh_data())
      .setIcon("refresh-ccw")
      .onClick(() => actions.onRefresh()),
  );
}
