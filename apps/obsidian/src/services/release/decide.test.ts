import { describe, expect, it } from "vitest";

import { V1_TEMPLATE_FOLDER } from "./constants";
import { decideRelease } from "./decide";
import type { ReleaseCheckInput } from "./decide";

const CURRENT = "2.0.0-alpha.6";

function input(overrides: Partial<ReleaseCheckInput> = {}): ReleaseCheckInput {
  return {
    origin: "current",
    recordedVersion: CURRENT,
    currentVersion: CURRENT,
    migrationPending: false,
    noticesEnabled: true,
    legacyTemplatesPresent: false,
    ...overrides,
  };
}

describe("decideRelease", () => {
  it("records the current version on every branch", () => {
    for (const origin of [
      "legacy",
      "absent",
      "malformed",
      "current",
    ] as const) {
      expect(decideRelease(input({ origin })).recordVersion).toBe(CURRENT);
    }
  });

  it("first launch ever (absent, no recorded version) → fresh Welcome View", () => {
    const decision = decideRelease(
      input({ origin: "absent", recordedVersion: null }),
    );
    expect(decision.branch).toBe("welcome-fresh");
    expect(decision.setMigrationPending).toBeUndefined();
  });

  it("malformed origin → fresh Welcome View", () => {
    const decision = decideRelease(
      input({ origin: "malformed", recordedVersion: null }),
    );
    expect(decision.branch).toBe("welcome-fresh");
  });

  it("absent + ejected v1 templates → upgraded, arms the prompt, reconstructs the folder", () => {
    const decision = decideRelease(
      input({
        origin: "absent",
        recordedVersion: null,
        legacyTemplatesPresent: true,
      }),
    );
    expect(decision.branch).toBe("welcome-upgraded");
    expect(decision.setMigrationPending).toBe(true);
    expect(decision.setTemplateFolder).toBe(V1_TEMPLATE_FOLDER);
  });

  it("legacy origin wins over ejected templates → no folder reconstruction", () => {
    const decision = decideRelease(
      input({
        origin: "legacy",
        recordedVersion: null,
        legacyTemplatesPresent: true,
      }),
    );
    expect(decision.branch).toBe("welcome-upgraded");
    expect(decision.setMigrationPending).toBe(true);
    expect(decision.setTemplateFolder).toBeUndefined();
  });

  it("absent + pending + ejected templates → still the templates-only detection result (origin-driven, not flag-driven)", () => {
    const decision = decideRelease(
      input({
        origin: "absent",
        recordedVersion: null,
        migrationPending: true,
        legacyTemplatesPresent: true,
      }),
    );
    expect(decision.branch).toBe("welcome-upgraded");
    expect(decision.setMigrationPending).toBe(true);
    expect(decision.setTemplateFolder).toBe(V1_TEMPLATE_FOLDER);
  });

  it("absent + no ejected templates → fresh Welcome View", () => {
    const decision = decideRelease(
      input({
        origin: "absent",
        recordedVersion: null,
        legacyTemplatesPresent: false,
      }),
    );
    expect(decision.branch).toBe("welcome-fresh");
    expect(decision.setMigrationPending).toBeUndefined();
    expect(decision.setTemplateFolder).toBeUndefined();
  });

  it("malformed + ejected templates → fresh (detection is scoped to absent)", () => {
    const decision = decideRelease(
      input({
        origin: "malformed",
        recordedVersion: null,
        legacyTemplatesPresent: true,
      }),
    );
    expect(decision.branch).toBe("welcome-fresh");
    expect(decision.setMigrationPending).toBeUndefined();
  });

  it("legacy origin → upgraded Welcome View and arms the Migration Prompt", () => {
    const decision = decideRelease(
      input({ origin: "legacy", recordedVersion: null }),
    );
    expect(decision.branch).toBe("welcome-upgraded");
    expect(decision.setMigrationPending).toBe(true);
  });

  it("pending relaunch with configured templates remaining → nothing opens, flag untouched", () => {
    const decision = decideRelease(
      input({
        origin: "current",
        migrationPending: true,
        legacyTemplatesPresent: true,
      }),
    );
    expect(decision.branch).toBe("none");
    expect(decision.setMigrationPending).toBeUndefined();
  });

  it("pending relaunch with no configured templates left → nothing opens, flag auto-clears", () => {
    const decision = decideRelease(
      input({
        origin: "current",
        migrationPending: true,
        legacyTemplatesPresent: false,
      }),
    );
    expect(decision.branch).toBe("none");
    expect(decision.setMigrationPending).toBe(false);
  });

  it("pending relaunch with no templates left + strict version increase (notices on) → update notice, flag still auto-clears", () => {
    const decision = decideRelease(
      input({
        origin: "current",
        migrationPending: true,
        legacyTemplatesPresent: false,
        recordedVersion: "2.0.0-alpha.5",
        noticesEnabled: true,
      }),
    );
    expect(decision.branch).toBe("update");
    expect(decision.setMigrationPending).toBe(false);
  });

  it("acknowledged relaunch (flag cleared, same version) → nothing", () => {
    const decision = decideRelease(
      input({ migrationPending: false, recordedVersion: CURRENT }),
    );
    expect(decision.branch).toBe("none");
  });

  it("strict version increase with notices on → update notice", () => {
    const decision = decideRelease(
      input({ recordedVersion: "2.0.0-alpha.5", noticesEnabled: true }),
    );
    expect(decision.branch).toBe("update");
  });

  it("strict version increase with notices off → nothing (still records)", () => {
    const decision = decideRelease(
      input({ recordedVersion: "2.0.0-alpha.5", noticesEnabled: false }),
    );
    expect(decision.branch).toBe("none");
    expect(decision.recordVersion).toBe(CURRENT);
  });

  it.each(["2.1.0", "2.1.1"])(
    "crossing the 2.1 boundary to %s → Companion notice even when update notices are off",
    (currentVersion) => {
      const decision = decideRelease(
        input({
          recordedVersion: "2.0.1",
          currentVersion,
          noticesEnabled: false,
        }),
      );
      expect(decision.branch).toBe("companion-notice");
    },
  );

  it("an update after the 2.1 boundary → ordinary update notice", () => {
    const decision = decideRelease(
      input({ recordedVersion: "2.1.0", currentVersion: "2.1.1" }),
    );
    expect(decision.branch).toBe("update");
  });

  it("pre-release increase → update notice", () => {
    const decision = decideRelease(
      input({
        recordedVersion: "2.0.0-alpha.5",
        currentVersion: "2.0.0-alpha.6",
      }),
    );
    expect(decision.branch).toBe("update");
  });

  it("equal version → nothing", () => {
    expect(decideRelease(input({ recordedVersion: CURRENT })).branch).toBe(
      "none",
    );
  });

  it("downgrade → nothing", () => {
    const decision = decideRelease(
      input({ recordedVersion: "2.0.0", currentVersion: "1.9.0" }),
    );
    expect(decision.branch).toBe("none");
  });

  it("existing data with no recorded version → nothing (unknown prior version)", () => {
    const decision = decideRelease(
      input({ origin: "current", recordedVersion: null }),
    );
    expect(decision.branch).toBe("none");
  });

  it("corrupt recorded version → nothing rather than throwing", () => {
    const decision = decideRelease(
      input({ origin: "current", recordedVersion: "not-a-semver" }),
    );
    expect(decision.branch).toBe("none");
  });

  describe("the pending update the banner announces", () => {
    it("an upgrade with notices on marks the update pending", () => {
      const decision = decideRelease(
        input({ recordedVersion: "2.1.0", currentVersion: "2.1.1" }),
      );
      expect(decision.branch).toBe("update");
      expect(decision.setUpdatePending).toBe(true);
    });

    it.each<[string, Partial<ReleaseCheckInput>]>([
      ["a fresh install", { origin: "absent", recordedVersion: null }],
      ["an upgrade from v1", { origin: "legacy", recordedVersion: null }],
      [
        "a downgrade",
        {
          recordedVersion: "2.1.1",
          currentVersion: "2.1.0",
        },
      ],
      [
        "an upgrade with notices off",
        {
          recordedVersion: "2.1.0",
          currentVersion: "2.1.1",
          noticesEnabled: false,
        },
      ],
      [
        "an upgrade the Companion notice announces",
        {
          recordedVersion: "2.0.1",
          currentVersion: "2.1.0",
        },
      ],
      ["data with no recorded version", { recordedVersion: null }],
    ])("%s marks no update pending", (_, state) => {
      const decision = decideRelease(input(state));
      expect(decision.branch).not.toBe("update");
      expect(decision.setUpdatePending ?? false).toBe(false);
    });

    it("a relaunch on the same version keeps an update not yet seen", () => {
      const decision = decideRelease(input({ recordedVersion: CURRENT }));
      expect(decision.branch).toBe("none");
      expect(decision.setUpdatePending).toBeUndefined();
    });
  });
});
