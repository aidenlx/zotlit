// What one Annotation View instance remembers in its workspace state.
import { isIndexedKey } from "@zotlit/db";

import type { FollowMode } from "./store";

/** The Follow Mode a fresh view starts in. */
export const DEFAULT_FOLLOW_MODE: FollowMode = "active-tab";

/** The mode, the mode a pin interrupted, and the Item the pin names. */
export interface AnnotViewState {
  followMode: FollowMode;
  /** Where Unpin returns to; never `pinned`. */
  previousMode: FollowMode;
  /** The pinned Item's Indexed Key; `null` when nothing is pinned. */
  pinnedItemKey: string | null;
}

const MODES: readonly FollowMode[] = ["active-tab", "zotero-reader", "pinned"];

/**
 * The names this state carried before ADR 0041 renamed the modes. `linked`
 * pinned an Item and stored its Indexed Key under `linkedIndexedKey`, which is
 * the same meaning `pinnedItemKey` carries now.
 */
const RENAMED: Readonly<Record<string, FollowMode>> = {
  note: "active-tab",
  reader: "zotero-reader",
  linked: "pinned",
};

/**
 * Reads what Obsidian restored for this view.
 *
 * An unreadable value takes the default rather than the last-used mode: the
 * state is the only record of the choice, so a value this build cannot name is
 * a choice it cannot honour, and Active Tab is the mode that always has a
 * source. A `pinned` mode with no usable Indexed Key falls back the same way,
 * because Pinned without an Item has nothing to show.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function parseAnnotViewState(raw: unknown): AnnotViewState {
  const stored =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pinnedItemKey = readIndexedKey(
    stored.pinnedItemKey ?? stored.linkedIndexedKey,
  );
  const followMode = readMode(stored.followMode);
  const previousMode = readMode(stored.previousMode);
  if (followMode === "pinned" && pinnedItemKey === null) {
    return {
      followMode: unpinnedMode(previousMode),
      previousMode: DEFAULT_FOLLOW_MODE,
      pinnedItemKey: null,
    };
  }
  return {
    followMode,
    previousMode: unpinnedMode(previousMode),
    pinnedItemKey,
  };
}

/** What {@link parseAnnotViewState} reads back, with nothing else in it. */
export function serializeAnnotViewState(
  state: AnnotViewState,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    followMode: state.followMode,
    previousMode: state.previousMode,
  };
  if (state.pinnedItemKey !== null) stored.pinnedItemKey = state.pinnedItemKey;
  return stored;
}

/** Where Unpin returns to: the mode the pin interrupted, never another pin. */
export function unpinnedMode(previousMode: FollowMode): FollowMode {
  return previousMode === "pinned" ? DEFAULT_FOLLOW_MODE : previousMode;
}

function readMode(value: unknown): FollowMode {
  if (typeof value !== "string") return DEFAULT_FOLLOW_MODE;
  if (MODES.includes(value as FollowMode)) return value as FollowMode;
  return RENAMED[value] ?? DEFAULT_FOLLOW_MODE;
}

function readIndexedKey(value: unknown): string | null {
  return typeof value === "string" && isIndexedKey(value) ? value : null;
}
