// Pure branch decision for the once-per-launch release check.

import gt from "semver/functions/gt";
import gte from "semver/functions/gte";
import lt from "semver/functions/lt";
import valid from "semver/functions/valid";

import type { HydrationOrigin } from "@/services/settings/classify";

import { V1_TEMPLATE_FOLDER } from "./constants";

const ZOTERO_10_COMPANION_RELEASE = "2.1.0";

export type ReleaseBranch =
  | "companion-notice"
  | "welcome-upgraded"
  | "welcome-fresh"
  | "update-notice"
  | "none";

export interface ReleaseCheckInput {
  /** Bucketed origin of the completed settings load. */
  origin: HydrationOrigin;
  /** `release.previous-version`: last recorded launch version, or null. */
  recordedVersion: string | null;
  /** The plugin's current version (from the manifest). */
  currentVersion: string;
  /** `release.migration-pending`: Migration Prompt awaiting acknowledgment. */
  migrationPending: boolean;
  /** `release.notices-enabled`: whether update notices may surface. */
  noticesEnabled: boolean;
  /**
   * Ejected v1 templates, found by probing one of two folders depending on
   * what triggered the check. When `origin` is `absent`, this probes v1's
   * default template folder — it marks a v1 user who customized templates but
   * wrote no settings file, so the absent origin alone can't tell them from a
   * fresh install. When `migrationPending` is set, this probes the user's
   * *configured* `template.folder` instead, driving the auto-clear below.
   */
  legacyTemplatesPresent: boolean;
}

export interface ReleaseDecision {
  branch: ReleaseBranch;
  /** Version to record as previously-seen; always the current version. */
  recordVersion: string;
  /**
   * Set the migration-pending flag when present. Armed (`true`) by Legacy
   * Data or templates-only v1 detection; auto-cleared (`false`) when a
   * pending launch's configured-folder probe finds no ejected templates left.
   * Manual acknowledgment still clears the flag through the service, never
   * here.
   */
  setMigrationPending?: boolean;
  /**
   * Reconstruct `template.folder` when present. A templates-only v1 upgrade
   * sets it to v1's default folder so the user's renamed templates are found in
   * place; the service performs the write.
   */
  setTemplateFolder?: string;
}

/**
 * Map a completed load's state to exactly one launch branch plus the state to
 * record. Side-effect-free: the release service performs the writes and UI.
 */
export function decideRelease(input: ReleaseCheckInput): ReleaseDecision {
  const {
    origin,
    recordedVersion,
    currentVersion,
    migrationPending,
    noticesEnabled,
    legacyTemplatesPresent,
  } = input;
  const recordVersion = currentVersion;

  // Legacy Data detected this launch: open the upgraded Welcome View once and
  // arm the Migration Prompt. Later launches never re-open it at startup —
  // the pending flag only drives settings reminders and manual reopens.
  if (origin === "legacy") {
    return {
      branch: "welcome-upgraded",
      recordVersion,
      setMigrationPending: true,
    };
  }

  // A v1 user who only ejected templates wrote no settings file, so the absent
  // origin looks like a fresh install — but their ejected templates mark them
  // as an upgrader. Treat exactly like Legacy Data. Scoped to absent: a
  // malformed file stays on the first-install fallback below.
  if (origin === "absent" && legacyTemplatesPresent) {
    return {
      branch: "welcome-upgraded",
      recordVersion,
      setMigrationPending: true,
      setTemplateFolder: V1_TEMPLATE_FOLDER,
    };
  }

  // No usable settings on disk: a genuine first install gets onboarding.
  if (origin === "absent" || origin === "malformed") {
    return { branch: "welcome-fresh", recordVersion };
  }

  // origin "current": the pending flag never drives the branch here — it only
  // auto-clears when the user's configured template folder no longer holds
  // ejected templates. Composes with whatever branch the version comparison
  // below produces.
  const setMigrationPending =
    migrationPending && !legacyTemplatesPresent ? false : undefined;

  // Existing data from before version tracking (or a corrupt marker): record
  // silently. The prior version is unknown, so an upgrade can't be told from a
  // reinstall — never notify.
  if (recordedVersion === null || valid(recordedVersion) === null) {
    return { branch: "none", recordVersion, setMigrationPending };
  }

  if (
    lt(recordedVersion, ZOTERO_10_COMPANION_RELEASE) &&
    gte(currentVersion, ZOTERO_10_COMPANION_RELEASE)
  ) {
    return {
      branch: "companion-notice",
      recordVersion,
      setMigrationPending,
    };
  }

  // A strict semver increase over the recorded version is the only update
  // trigger; equal versions, downgrades, and reinstalls stay silent.
  if (gt(currentVersion, recordedVersion) && noticesEnabled) {
    return { branch: "update-notice", recordVersion, setMigrationPending };
  }

  return { branch: "none", recordVersion, setMigrationPending };
}
