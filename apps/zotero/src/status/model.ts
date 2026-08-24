// Pure menu model for the Database Status control.

import type {
  ManualCheckpointOutcome,
  WalCheckpointStatus,
} from "@/notify/freshness";

type VisibleManualOutcome = Exclude<ManualCheckpointOutcome, "unavailable">;

/**
 * How the sidenav icon is tinted. `neutral` covers both a healthy WAL database
 * and one with no write-ahead log: neither asks anything of the user.
 */
export type DatabaseIconState = "neutral" | "off" | "failed";

export interface DatabaseStatusMenuModel {
  stateMessage:
    | "zotlit-database-status-working"
    | "zotlit-database-status-automatic-off"
    | "zotlit-database-status-no-wal"
    | "zotlit-database-status-failed";
  iconState: DatabaseIconState;
  timestampMessage:
    | "zotlit-database-status-never-written"
    | "zotlit-database-status-last-written"
    | "zotlit-database-status-last-attempt";
  timestampArgs: { time: string } | undefined;
  writeEnabled: boolean;
}

function relativeTime(at: Date, now: Date): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  if (absoluteSeconds >= 86_400) {
    value = Math.round(seconds / 86_400);
    unit = "day";
  } else if (absoluteSeconds >= 3_600) {
    value = Math.round(seconds / 3_600);
    unit = "hour";
  } else if (absoluteSeconds >= 60) {
    value = Math.round(seconds / 60);
    unit = "minute";
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(
    value,
    unit,
  );
}

const ICON_STATES = {
  "zotlit-database-status-working": "neutral",
  "zotlit-database-status-no-wal": "neutral",
  "zotlit-database-status-automatic-off": "off",
  "zotlit-database-status-failed": "failed",
} as const satisfies Record<
  DatabaseStatusMenuModel["stateMessage"],
  DatabaseIconState
>;

function stateMessage(
  status: WalCheckpointStatus,
): DatabaseStatusMenuModel["stateMessage"] {
  if (!status.active && status.reason === "not-wal") {
    return "zotlit-database-status-no-wal";
  }
  if (!status.active || status.lastRun?.result === "failed") {
    return "zotlit-database-status-failed";
  }
  if (!status.automaticEnabled) return "zotlit-database-status-automatic-off";
  return "zotlit-database-status-working";
}

/**
 * The icon alone, off the same precedence the menu uses. Separate from
 * {@link databaseStatusMenuModel} because a repaint runs on every checkpoint
 * and has no use for the formatted timestamp.
 */
export function databaseIconState(
  status: WalCheckpointStatus,
): DatabaseIconState {
  return ICON_STATES[stateMessage(status)];
}

export function databaseStatusMenuModel(
  status: WalCheckpointStatus,
  now: Date,
): DatabaseStatusMenuModel {
  const message = stateMessage(status);
  const lastRun = status.lastRun;
  return {
    stateMessage: message,
    iconState: ICON_STATES[message],
    timestampMessage:
      lastRun === null
        ? "zotlit-database-status-never-written"
        : lastRun.result === "done"
          ? "zotlit-database-status-last-written"
          : "zotlit-database-status-last-attempt",
    timestampArgs:
      lastRun === null ? undefined : { time: relativeTime(lastRun.at, now) },
    writeEnabled: status.active,
  };
}

export function manualOutcomeMessages(outcome: VisibleManualOutcome): {
  title:
    | "zotlit-database-write-done-title"
    | "zotlit-database-write-in-use-title"
    | "zotlit-database-write-failed-title";
  message:
    | "zotlit-database-write-done-message"
    | "zotlit-database-write-in-use-message"
    | "zotlit-database-write-failed-message";
} {
  switch (outcome) {
    case "done":
      return {
        title: "zotlit-database-write-done-title",
        message: "zotlit-database-write-done-message",
      };
    case "in-use":
      return {
        title: "zotlit-database-write-in-use-title",
        message: "zotlit-database-write-in-use-message",
      };
    case "failed":
      return {
        title: "zotlit-database-write-failed-title",
        message: "zotlit-database-write-failed-message",
      };
  }
}
