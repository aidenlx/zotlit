// The Annotation View's native pane menu: the Follow Mode switches the toolbar
// button offers, and the rare action the toolbar row no longer carries.
import type { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { AnnotActions } from "./actions";
import { followModeMenu } from "./presentation";
import type { FollowMenuAction, FollowMenuState } from "./presentation";

export interface PaneMenuInput {
  state: FollowMenuState;
  actions: AnnotActions;
}

/**
 * The same entries the mode button offers, plus "Refresh data". Every one is a
 * user gesture; nothing here reacts to a source that stopped answering.
 *
 * A native menu item carries no tooltip, so a blocked entry's reason stands
 * beside it as a label rather than going unsaid — the Base UI menu, which does
 * carry one, puts the same reason in it.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function buildPaneMenu(
  menu: Menu,
  { state, actions }: PaneMenuInput,
): void {
  menu.addSeparator();
  for (const entry of followModeMenu(state)) {
    if (entry.kind === "separator") continue;
    if (entry.kind === "mode") {
      const { select } = entry;
      menu.addItem((item) => {
        item.setTitle(entry.label).setChecked(entry.checked);
        if (select !== null)
          item.onClick(() => actions.onSetFollowMode(select));
      });
      continue;
    }
    menu.addItem((item) =>
      item
        .setTitle(entry.label)
        .setIcon(entry.icon)
        .setDisabled(entry.reason !== null)
        .onClick(() => runAction(actions, entry.action)),
    );
    if (entry.reason !== null) {
      const reason = entry.reason;
      menu.addItem((item) => item.setTitle(reason).setIsLabel(true));
    }
  }

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_refresh_data())
      .setIcon("refresh-ccw")
      .onClick(() => actions.onRefresh()),
  );
}

function runAction(actions: AnnotActions, action: FollowMenuAction): void {
  switch (action) {
    case "pin-current-item":
      actions.onPinCurrentItem();
      return;
    case "unpin":
      actions.onUnpin();
      return;
    case "choose-item":
      actions.onPinItem();
  }
}
