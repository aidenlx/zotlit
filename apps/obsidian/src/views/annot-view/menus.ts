// The Annotation View's menus, as Obsidian builds them. One builder per menu:
// each takes the entries a pure module answered plus the gestures they run, and
// fills a native `Menu` its caller shows from the event that opened it.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import type { Menu } from "obsidian";

import type { AnnotActions } from "./actions";
import { followModeMenu } from "./presentation";
import type {
  AttachmentLine,
  FollowMenuAction,
  FollowMenuState,
} from "./presentation";

/** The gestures a Follow Mode entry runs; the view supplies every one. */
export type FollowModeGestures = Pick<
  AnnotActions,
  "onPinCurrentItem" | "onPinItem" | "onSetFollowMode" | "onUnpin"
>;

export interface FollowModeMenuInput {
  state: FollowMenuState;
  actions: FollowModeGestures;
}

/**
 * Every Follow Mode switch, the pin, and the item picker — the entries the
 * toolbar's mode button and the pane menu both show, from the one table in
 * `presentation.ts`. Each is an action with its own icon.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function buildFollowModeMenu(
  menu: Menu,
  { state, actions }: FollowModeMenuInput,
): void {
  for (const entry of followModeMenu(state)) {
    menu.addItem((item) =>
      item
        .setTitle(entry.label)
        .setIcon(entry.icon)
        .onClick(() => runFollowModeAction(actions, entry.action)),
    );
  }
}

function runFollowModeAction(
  actions: FollowModeGestures,
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

export interface AttachmentMenuInput {
  options: Extract<AttachmentLine, { kind: "picker" }>["options"];
  selectedKey: string;
  onSelect: (key: string) => void;
}

/** Every Attachment of the Item on screen, with the one showing checked. */
export function buildAttachmentMenu(
  menu: Menu,
  { options, selectedKey, onSelect }: AttachmentMenuInput,
): void {
  for (const option of options) {
    menu.addItem((item) =>
      item
        .setTitle(option.label)
        .setChecked(option.key === selectedKey)
        .onClick(() => onSelect(option.key)),
    );
  }
}

export interface TagMenuInput {
  tags: readonly string[];
  /** The tags the filter holds; a tag in it shows checked. */
  selectedTags: readonly string[];
  onToggle: (tag: string) => void;
}

/**
 * The Annotation's own tags. Selecting one filters the list by it, which is
 * what the card's tag chips did.
 */
export function buildTagMenu(
  menu: Menu,
  { tags, selectedTags, onToggle }: TagMenuInput,
): void {
  for (const tag of tags) {
    menu.addItem((item) =>
      item
        .setTitle(tag)
        .setChecked(selectedTags.includes(tag))
        .onClick(() => onToggle(tag)),
    );
  }
}
