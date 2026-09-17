// The Annotation View's menus, as Obsidian builds them. One builder per menu:
// each takes the entries a pure module answered plus the gestures they run, and
// fills a native `Menu` its caller shows from the event that opened it.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import type { Menu } from "obsidian";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@/lib/annotation-colors";

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
 * `presentation.ts`.
 *
 * A native MenuItem carries no tooltip, so a blocked entry states its reason in
 * a label beside it rather than in one it cannot show.
 *
 * @see apps/obsidian/policies/tooltips.md
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function buildFollowModeMenu(
  menu: Menu,
  { state, actions }: FollowModeMenuInput,
): void {
  for (const entry of followModeMenu(state)) {
    if (entry.kind === "separator") {
      menu.addSeparator();
      continue;
    }
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
        .onClick(() => runFollowModeAction(actions, entry.action)),
    );
    if (entry.reason !== null) {
      const reason = entry.reason;
      menu.addItem((item) => item.setTitle(reason).setIsLabel(true));
    }
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

export interface ColorMenuInput {
  /** The colour the Annotation carries now, in whatever case it was stored. */
  color: string | null;
  onSelect: (hex: string) => void;
}

/**
 * Zotero's eight swatches. Each title is a fragment, so the colour itself
 * stands beside its name the way the card's own dot does — `setTitle` takes a
 * `DocumentFragment`, so this needs nothing private.
 */
export function buildColorMenu(
  menu: Menu,
  { color, onSelect }: ColorMenuInput,
): void {
  for (const hex of ANNOTATION_COLORS) {
    menu.addItem((item) =>
      item
        .setTitle(swatchTitle(hex))
        .setChecked(isColor(color, hex))
        .onClick(() => onSelect(hex)),
    );
  }
}

function swatchTitle(hex: string): DocumentFragment {
  return createFragment((frag) => {
    const row = frag.createSpan({
      cls: "zt:inline-flex zt:items-center zt:gap-2",
    });
    row.createSpan({
      cls: "zt:size-3 zt:shrink-0 zt:rounded-full zt:ring-1 zt:ring-border",
      attr: { style: `background-color: ${hex}` },
    });
    row.createSpan({ text: annotationColorLabel(hex) });
  });
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
