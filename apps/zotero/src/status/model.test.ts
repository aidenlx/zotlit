import { describe, expect, it } from "vitest";

import type { WalCheckpointStatus } from "@/notify/wal-checkpoint";

import { databaseStatusMenuModel, manualOutcomeMessages } from "./model.js";

const NOW = new Date("2026-08-20T08:00:00Z");

function activeStatus(
  lastRun: Extract<WalCheckpointStatus, { active: true }>["lastRun"] = null,
  automaticEnabled = true,
): WalCheckpointStatus {
  return { active: true, automaticEnabled, lastRun };
}

describe("databaseStatusMenuModel", () => {
  it("reports that a wal database is being written for Obsidian", () => {
    expect(databaseStatusMenuModel(activeStatus(), NOW)).toEqual({
      stateMessage: "zotlit-database-status-working",
      timestampMessage: "zotlit-database-status-never-written",
      timestampArgs: undefined,
      writeEnabled: true,
    });
  });

  it("reports that a rollback-journal database has no wal", () => {
    expect(
      databaseStatusMenuModel(
        { active: false, reason: "not-wal", lastRun: null },
        NOW,
      ),
    ).toEqual({
      stateMessage: "zotlit-database-status-no-wal",
      timestampMessage: "zotlit-database-status-never-written",
      timestampArgs: undefined,
      writeEnabled: false,
    });
  });

  it("reports a failed probe as a failed write state", () => {
    expect(
      databaseStatusMenuModel(
        { active: false, reason: "probe-failed", lastRun: null },
        NOW,
      ).stateMessage,
    ).toBe("zotlit-database-status-failed");
  });

  it("reports the last failed checkpoint", () => {
    expect(
      databaseStatusMenuModel(
        activeStatus({
          at: new Date("2026-08-20T07:55:00Z"),
          result: "failed",
        }),
        NOW,
      ),
    ).toEqual({
      stateMessage: "zotlit-database-status-failed",
      timestampMessage: "zotlit-database-status-last-attempt",
      timestampArgs: { time: "5 minutes ago" },
      writeEnabled: true,
    });
  });

  it("reports automatic writes as off while keeping the manual command enabled", () => {
    expect(databaseStatusMenuModel(activeStatus(null, false), NOW)).toEqual({
      stateMessage: "zotlit-database-status-automatic-off",
      timestampMessage: "zotlit-database-status-never-written",
      timestampArgs: undefined,
      writeEnabled: true,
    });
  });
});

describe("manualOutcomeMessages", () => {
  it.each([
    [
      "done",
      {
        title: "zotlit-database-write-done-title",
        message: "zotlit-database-write-done-message",
      },
    ],
    [
      "in-use",
      {
        title: "zotlit-database-write-in-use-title",
        message: "zotlit-database-write-in-use-message",
      },
    ],
    [
      "failed",
      {
        title: "zotlit-database-write-failed-title",
        message: "zotlit-database-write-failed-message",
      },
    ],
  ] as const)("maps %s to its progress-window copy", (outcome, expected) => {
    expect(manualOutcomeMessages(outcome)).toEqual(expected);
  });
});
