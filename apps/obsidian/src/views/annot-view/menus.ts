// The Annotation View's menus, as Obsidian builds them. One builder per menu:
// each takes the entries a pure module answered plus the gestures they run, and
// fills a native `Menu` its caller shows from the event that opened it.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import type { Menu } from "obsidian";

import type { AnnotActions } from "./actions";
import type {
  FollowMenuAction,
  HeaderMenuAction,
  HeaderMenuEntry,
} from "./presentation";

/** The gestures a header menu row runs; the view supplies every one. */
export type HeaderMenuGestures = Pick<
  AnnotActions,
  | "onAllowEditing"
  | "onChooseAttachment"
  | "onOpenPdf"
  | "onPinCurrentItem"
  | "onPinItem"
  | "onSetFollowMode"
  | "onUnpin"
>;

export interface HeaderMenuInput {
  /** The groups `headerMenu` answered, in the order they are shown. */
  groups: HeaderMenuEntry[][];
  actions: HeaderMenuGestures;
}

/**
 * The header block's one menu: the groups a pure module decided, each divided
 * from the next by a separator. A row carrying no gesture is a reporting row —
 * `setIsLabel` leaves it readable and lets the arrow keys step over it.
 */
export function buildHeaderMenu(
  menu: Menu,
  { groups, actions }: HeaderMenuInput,
): void {
  groups.forEach((group, index) => {
    if (index > 0) menu.addSeparator();
    for (const entry of group) {
      menu.addItem((item) => {
        item.setTitle(entry.label);
        if (entry.icon !== undefined) item.setIcon(entry.icon);
        if (entry.report) item.setIsLabel(true);
        if (entry.disabled) item.setDisabled(true);
        if (entry.checked) item.setChecked(true);
        const { action } = entry;
        if (action !== undefined) {
          item.onClick(() => runHeaderAction(actions, action));
        }
      });
    }
  });
}

function runHeaderAction(
  actions: HeaderMenuGestures,
  action: HeaderMenuAction,
): void {
  switch (action.kind) {
    case "follow":
      runFollowModeAction(actions, action.follow);
      return;
    case "choose-attachment":
      actions.onChooseAttachment();
      return;
    case "open-pdf":
      actions.onOpenPdf();
      return;
    case "allow-editing":
      actions.onAllowEditing();
  }
}

function runFollowModeAction(
  actions: HeaderMenuGestures,
  action: FollowMenuAction,
): void {
  switch (action) {
    case "pin-current-item":
      actions.onPinCurrentItem();
      return;
    case "unpin":
      actions.onUnpin();
      return;
    case "choose-item":
      actions.onPinItem();
      return;
    default:
      actions.onSetFollowMode(action);
  }
}
