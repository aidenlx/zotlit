// The Annotation View's native pane menu: the groups the header block offers,
// and the rare action the header row no longer carries.
import type { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { AnnotActions } from "./actions";
import { buildHeaderMenu } from "./menus";
import { headerMenu } from "./presentation";
import type { HeaderMenuState } from "./presentation";

export interface PaneMenuInput {
  state: HeaderMenuState;
  actions: AnnotActions;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The same groups the header block offers, plus "Refresh data". Every entry is
 * a user gesture; nothing here reacts to a source that stopped answering.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function buildPaneMenu(
  menu: Menu,
  { state, actions, now }: PaneMenuInput,
): void {
  menu.addSeparator();
  buildHeaderMenu(menu, { groups: headerMenu(state, now), actions });

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_refresh_data())
      .setIcon("refresh-ccw")
      .onClick(() => actions.onRefresh()),
  );
}
