// What the Annotation View shows, decided as data rather than in a component.
//
// One table of Follow Modes and one set of rules, read by two renderers: the
// toolbar's Base UI menu and the native pane menu. The body, the condition
// lines and the attachment slot are answers a test asserts without mounting
// anything.
//
// @see apps/obsidian/policies/ui-seams.md
import type { IconName } from "obsidian";

import type { AnnotViewAttachment } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";

import { selectActiveAttachment } from "./store";
import type { AnnotState, FollowMode } from "./store";

/** The label and icon each Follow Mode is named by, everywhere it is named. */
const FOLLOW_MODES = {
  "active-tab": {
    icon: "app-window",
    label: () => m.annot_view_mode_active_tab(),
  },
  "zotero-reader": {
    icon: "book-open",
    label: () => m.annot_view_mode_zotero_reader(),
  },
  pinned: { icon: "pin", label: () => m.annot_view_mode_pinned() },
} as const satisfies Record<
  FollowMode,
  { icon: IconName; label: () => string }
>;

export function followModeLabel(mode: FollowMode): string {
  return FOLLOW_MODES[mode].label();
}

export function followModeIcon(mode: FollowMode): IconName {
  return FOLLOW_MODES[mode].icon;
}

/** What the Follow Mode menu and the pin controls read. */
export type FollowMenuState = Pick<AnnotState, "followMode" | "pinnable">;

/** The gesture a Follow Mode menu entry runs. */
export type FollowMenuAction =
  | Exclude<FollowMode, "pinned">
  | "pin-current-item"
  | "unpin"
  | "choose-item";

/** One entry of the Follow Mode menu, in the shape both renderers read. */
export interface FollowMenuEntry {
  action: FollowMenuAction;
  label: string;
  icon: IconName;
}

/**
 * Every gesture the mode button and the pane menu offer, in order. Each entry
 * is an action the user can run now: the toolbar button names the mode in
 * force, so the menu itself reports no state.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function followModeMenu(state: FollowMenuState): FollowMenuEntry[] {
  const switchTo = (mode: Exclude<FollowMode, "pinned">): FollowMenuEntry => ({
    action: mode,
    label: followModeLabel(mode),
    icon: followModeIcon(mode),
  });
  return [
    switchTo("active-tab"),
    switchTo("zotero-reader"),
    ...pinEntry(state),
    {
      action: "choose-item",
      label: m.annot_view_pin_choose_item(),
      icon: "search",
    },
  ];
}

/**
 * The pin gesture the state allows: release the pin in force, or take the Item
 * on screen. Pinned is an Item plus a remembered attachment choice, so with no
 * Item to pin the menu offers the item picker alone.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1141
 */
function pinEntry(state: FollowMenuState): FollowMenuEntry[] {
  if (state.followMode === "pinned") {
    return [
      { action: "unpin", label: m.annot_view_mode_unpin(), icon: "pin-off" },
    ];
  }
  if (state.pinnable === null) return [];
  return [
    {
      action: "pin-current-item",
      label: m.annot_view_mode_pin_current_item(),
      icon: "pin",
    },
  ];
}

/** What the attachment slot under the toolbar shows. */
export type AttachmentLine =
  /** Nothing: there is no choice, or the open PDF already names it. */
  | { kind: "hidden" }
  /** The name, with the choice held elsewhere, and the reason it is held. */
  | { kind: "locked"; label: string; reason: string }
  /** A live picker over every Attachment of the Item on screen. */
  | {
      kind: "picker";
      selectedKey: string;
      options: { key: string; label: string }[];
    };

/** The Attachment's own name, as the picker and the locked line show it. */
export function attachmentLabel(attachment: AnnotViewAttachment): string {
  const path = attachment.path?.replace(/^storage:/, "");
  return m.annot_view_attachment_label({
    name: path && path.length > 0 ? path : m.annot_view_attachment_unnamed(),
    count: attachment.annotCount,
  });
}

/** What the attachment slot reads. */
export type AttachmentLineState = Pick<
  AnnotState,
  "attachments" | "selectedAttachmentKey" | "attachmentLock"
>;

/**
 * An Obsidian PDF view is already in front of the user, so its lock shows
 * nothing here; the Zotero Reader is not, so its lock shows the name and says
 * who holds it. With neither holding the choice, one Attachment is no choice.
 */
export function attachmentLine(state: AttachmentLineState): AttachmentLine {
  const active = selectActiveAttachment(state);
  if (!active || state.attachmentLock === "obsidian-pdf") {
    return { kind: "hidden" };
  }
  if (state.attachmentLock === "zotero-reader") {
    return {
      kind: "locked",
      label: attachmentLabel(active),
      reason: m.annot_view_attachment_locked_reader(),
    };
  }
  const attachments = state.attachments ?? [];
  if (attachments.length <= 1) return { kind: "hidden" };
  return {
    kind: "picker",
    selectedKey: active.indexedKey,
    options: attachments.map((attachment) => ({
      key: attachment.indexedKey,
      label: attachmentLabel(attachment),
    })),
  };
}

/** The one action an empty state offers, beside its message. */
export type EmptyStateAction = "enable-live-updates" | "choose-item";

/** What stands where the card list would. */
export type AnnotViewBody =
  | { kind: "list" }
  | { kind: "loading" }
  /** An Item with no Attachments at all. */
  | { kind: "no-attachments"; message: string }
  /**
   * Nothing resolved. The mode is the user's and stands, so this is where a
   * source that cannot answer says why.
   */
  | {
      kind: "empty";
      message: string;
      action: { label: string; action: EmptyStateAction } | null;
    };

/** What the body reads. */
export type AnnotViewBodyState = Pick<
  AnnotState,
  | "attachments"
  | "annotations"
  | "followMode"
  | "liveUpdatesOn"
  | "pinnedItemKey"
>;

export function annotViewBody(state: AnnotViewBodyState): AnnotViewBody {
  if (state.attachments === null) return emptyState(state);
  if (state.attachments.length === 0) {
    return { kind: "no-attachments", message: m.annot_view_no_attachments() };
  }
  if (state.annotations === null) return { kind: "loading" };
  return { kind: "list" };
}

function emptyState(state: AnnotViewBodyState): AnnotViewBody {
  const chooseItem = {
    label: m.annot_view_pin_choose_item(),
    action: "choose-item" as const,
  };
  switch (state.followMode) {
    case "zotero-reader":
      return state.liveUpdatesOn
        ? {
            kind: "empty",
            message: m.annot_view_empty_zotero_reader(),
            action: null,
          }
        : {
            kind: "empty",
            message: m.annot_view_empty_live_updates_off(),
            action: {
              label: m.annot_view_enable_live_updates(),
              action: "enable-live-updates",
            },
          };
    case "pinned":
      // A pin that stands but cannot be read is not the same state as no pin
      // at all, and telling the user to pin something would deny the pin the
      // view is still holding.
      return state.pinnedItemKey === null
        ? {
            kind: "empty",
            message: m.annot_view_empty_pinned(),
            action: chooseItem,
          }
        : {
            kind: "empty",
            message: m.annot_view_empty_pinned_unresolved(),
            action: chooseItem,
          };
    case "active-tab":
      return {
        kind: "empty",
        message: m.annot_view_empty_active_tab(),
        action: null,
      };
  }
}

/** What the condition lines read. */
export type ConditionLineState = Pick<
  AnnotState,
  "attachments" | "followMode" | "zoteroReaderClosed"
>;

/** What the list on screen cannot say for itself: why the reader is silent. */
export function conditionLines(state: ConditionLineState): string[] {
  const lines: string[] = [];
  if (
    state.followMode === "zotero-reader" &&
    state.zoteroReaderClosed &&
    state.attachments !== null
  ) {
    lines.push(m.annot_view_reader_closed());
  }
  return lines;
}

/**
 * The Item's title and creators, shown only where nothing else on screen names
 * the Item — so never while the view follows the active tab.
 */
export function identityLabel(
  state: Pick<AnnotState, "followMode" | "itemDisplayLabel">,
): string | null {
  return state.followMode === "active-tab" ? null : state.itemDisplayLabel;
}
