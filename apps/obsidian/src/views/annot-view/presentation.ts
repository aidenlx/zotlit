// What the Annotation View shows, decided as data rather than in a component.
//
// One table of Follow Modes and one set of rules, read by two renderers: the
// header's native menu and the native pane menu. The body, the header's shape
// and the rows of its menu are answers a test asserts without mounting
// anything.
//
// @see apps/obsidian/policies/ui-seams.md
import type { IconName } from "obsidian";

import type { AnnotViewAttachment } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { ItemSummary } from "@/lib/item-summary";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";

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

/**
 * The Follow Mode as the status bar states it: a phrase, since the bar has
 * no title to carry the mode's glyph and says in words what the pane waits
 * for. The menu keeps the short name.
 */
const FOLLOW_MODE_STATUS: Record<FollowMode, () => string> = {
  "active-tab": () => m.annot_view_header_following_active_tab(),
  "zotero-reader": () => m.annot_view_header_following_zotero_reader(),
  pinned: () => m.annot_view_header_pinned_item(),
};

export function followModeStatus(mode: FollowMode): string {
  return FOLLOW_MODE_STATUS[mode]();
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

/**
 * The Item on screen, where the header is the one thing naming it — so never
 * while the view follows the active tab, where the note or the PDF in front of
 * the user already says which Item it is.
 */
function headerIdentity(
  state: Pick<AnnotState, "followMode" | "itemDisplay">,
): ItemSummary | null {
  return state.followMode === "active-tab" ? null : state.itemDisplay;
}

/** What the header block reads: its shape, its indicators, and its menu. */
export type HeaderState = Pick<
  AnnotState,
  | "attachmentLock"
  | "attachments"
  | "capability"
  | "followMode"
  | "itemDisplay"
  | "selectedAttachmentKey"
  | "zoteroReaderClosed"
>;

/**
 * The header block: one press target, in the two shapes the Follow Mode leaves
 * it. The masthead spends its width on the Item and names the mode by its glyph
 * alone; the status bar has no title to carry one, so it says the mode in full.
 *
 * `label` is the accessible name either way, and it names the mode in words in
 * both — the glyph is an economy for the eye, never for a screen reader.
 */
export type HeaderShape =
  | {
      kind: "masthead";
      modeIcon: IconName;
      /** The Item's own title. */
      title: string;
      /** The creators, then every indicator in force. */
      byline: string[];
      label: string;
    }
  | {
      kind: "status-bar";
      modeIcon: IconName;
      /** The Follow Mode, in full. */
      modeLabel: string;
      /** Every indicator in force, after the mode phrase. */
      indicators: string[];
      label: string;
    };

export function headerShape(state: HeaderState): HeaderShape {
  const modeIcon = followModeIcon(state.followMode);
  const indicators = headerIndicators(state);
  const item = headerIdentity(state);
  if (item === null) {
    const modeLabel = followModeStatus(state.followMode);
    return {
      kind: "status-bar",
      modeIcon,
      modeLabel,
      indicators,
      label: headerLabel([modeLabel, ...indicators]),
    };
  }
  return {
    kind: "masthead",
    modeIcon,
    title: item.title,
    // A separator can never begin a wrapped line, so the renderer draws one
    // after each segment but the last — which takes a filtered array, not a
    // list with an empty creators slot in it.
    byline: [item.subtitle, ...indicators].filter((part) => part.length > 0),
    // The masthead carries the mode by its glyph, and its short name is what a
    // reader hovering the glyph is told, so the accessible name says that name.
    label: headerLabel([
      item.title,
      followModeLabel(state.followMode),
      ...indicators,
    ]),
  };
}

/**
 * What the header reports and cannot act on: inert text inside the one press
 * target. Each is there only while it applies, in the order the header draws
 * them.
 */
export function headerIndicators(state: HeaderState): string[] {
  const indicators: string[] = [];
  const count = attachmentChoiceCount(state);
  if (count !== null) {
    indicators.push(m.annot_view_header_attachments({ count }));
  }
  if (readingOnly(state.capability)) {
    indicators.push(m.annot_view_header_reading_only());
  }
  if (readerClosed(state)) {
    indicators.push(m.annot_view_header_reader_closed());
  }
  return indicators;
}

/**
 * The button's accessible name: one sentence per thing the header names, in the
 * order the header draws them. Each segment is the same message the eye reads,
 * so the name never says the mode or an indicator in other words than the ones
 * on screen (WCAG 2.5.3); the sentence's own punctuation is the one thing the
 * locale adds. That pressing the block opens a menu is absent, because
 * `aria-haspopup="menu"` already says it.
 */
function headerLabel(segments: readonly string[]): string {
  return segments
    .map((text) => m.annot_view_header_aria_sentence({ text }))
    .join(" ");
}

/** How many Attachments the user may choose between, or `null` for no choice. */
function attachmentChoiceCount(state: HeaderState): number | null {
  const line = attachmentLine(state);
  return line.kind === "picker" ? line.options.length : null;
}

/**
 * Whether the cards cannot write. A probe is not a state to report: nothing is
 * wrong yet, and reading stays quiet while it runs.
 */
function readingOnly(capability: EditingCapability): boolean {
  if (capability.kind === "writable") return false;
  return !(capability.kind === "read-only" && capability.reason === "probing");
}

/**
 * Whether the Zotero Reader closed on the Attachment still on screen — which
 * only the mode following that reader has anything to say about.
 */
function readerClosed(
  state: Pick<AnnotState, "attachments" | "followMode" | "zoteroReaderClosed">,
): boolean {
  return (
    state.followMode === "zotero-reader" &&
    state.zoteroReaderClosed &&
    state.attachments !== null
  );
}

/** The gesture one header menu row runs; a row reporting a state runs none. */
export type HeaderMenuAction =
  | { kind: "follow"; follow: FollowMenuAction }
  | { kind: "choose-attachment" }
  | { kind: "open-pdf" }
  | { kind: "allow-editing" };

/** One row of the header menu, in the shape both renderers read. */
export interface HeaderMenuEntry {
  label: string;
  icon?: IconName;
  /**
   * A row there to be read rather than chosen: `setIsLabel`, which the arrow
   * keys step over.
   */
  report?: true;
  /** Named, and not choosable: the state in force, held elsewhere. */
  disabled?: true;
  /** The one in force carries the check. */
  checked?: true;
  action?: HeaderMenuAction;
}

/** What the header menu reads. */
export type HeaderMenuState = HeaderState & FollowMenuState;

/**
 * Everything the pane can do that is not filtering, grouped: the Follow Mode,
 * the pin, the Attachment, and what stands in the way of editing. A group with
 * nothing to say is absent, and takes its separator with it.
 *
 * A menu holds a label and an action; it cannot hold prose, so a capability's
 * `detail` sentence never reaches a row here.
 *
 * @param state what the view is showing right now.
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function headerMenu(
  state: HeaderMenuState,
  now: Temporal.Instant,
): HeaderMenuEntry[][] {
  return [
    ...followGroups(state),
    attachmentGroup(state),
    readerClosed(state) ? [report(m.annot_view_reader_closed())] : [],
    capabilityGroup(state.capability, now),
  ].filter((group) => group.length > 0);
}

/** A row the user reads and the arrow keys pass over. */
function report(label: string): HeaderMenuEntry {
  return { label, report: true };
}

/**
 * The Follow Mode in force and the gestures that change it, from the one table
 * every surface names a mode by: the modes under their own heading, then the
 * pin and the item picker.
 *
 * Pinned appears only as the mode in force. A pin is taken by pinning an Item,
 * so there is no mode row to switch to it with.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
function followGroups(state: HeaderMenuState): HeaderMenuEntry[][] {
  const entries = Map.groupBy(followModeMenu(state), (entry) =>
    entry.action === "active-tab" || entry.action === "zotero-reader"
      ? "mode"
      : "pin",
  );
  const follow = (entry: FollowMenuEntry): HeaderMenuEntry => ({
    label: entry.label,
    icon: entry.icon,
    ...(state.followMode === entry.action && { checked: true as const }),
    action: { kind: "follow", follow: entry.action },
  });
  const modes = [
    report(m.annot_view_header_menu_label()),
    ...(entries.get("mode") ?? []).map(follow),
  ];
  if (state.followMode === "pinned") {
    modes.push({
      label: followModeLabel("pinned"),
      icon: followModeIcon("pinned"),
      checked: true,
    });
  }
  return [modes, (entries.get("pin") ?? []).map(follow)];
}

/**
 * The Attachment choice, where there is one to make or one to report: the
 * suggester while the choice is the user's, and the name plus the reason while
 * a reader holds it. Then the Attachment on screen opens in Obsidian's own PDF
 * view, except where an Obsidian PDF view already shows it. Nothing where the
 * pane has nothing to say.
 */
function attachmentGroup(state: HeaderState): HeaderMenuEntry[] {
  const rows = attachmentChoiceRows(state);
  if (
    selectActiveAttachment(state) !== null &&
    state.attachmentLock !== "obsidian-pdf"
  ) {
    rows.push({
      label: m.command_open_pdf_name(),
      icon: "file-text",
      action: { kind: "open-pdf" },
    });
  }
  return rows;
}

function attachmentChoiceRows(state: HeaderState): HeaderMenuEntry[] {
  const line = attachmentLine(state);
  switch (line.kind) {
    case "hidden":
      return [];
    case "locked":
      return [
        { label: line.label, icon: "lock", disabled: true },
        report(line.reason),
      ];
    case "picker":
      return [
        {
          label: m.annot_view_attachment_choose(),
          icon: "paperclip",
          action: { kind: "choose-attachment" },
        },
      ];
  }
}

/**
 * What stands in the way of editing, and the one gesture that clears it where
 * one exists: Zotero's own approval dialog. A state that clears itself — a
 * probe, an approval already asked for, a cooldown — is reported and left
 * alone.
 *
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
function capabilityGroup(
  capability: EditingCapability,
  now: Temporal.Instant,
): HeaderMenuEntry[] {
  if (!readingOnly(capability)) return [];
  const rows = [report(editingCapabilityCopy(capability, now).label)];
  if (capability.kind === "authorization-required") {
    rows.push({
      label: m.capability_enable_editing(),
      icon: "pencil",
      action: { kind: "allow-editing" },
    });
  }
  return rows;
}
