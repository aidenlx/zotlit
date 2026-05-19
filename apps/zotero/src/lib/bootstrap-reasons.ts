/**
 * Reason integers Zotero's plugin loader passes as the second argument of
 * every bootstrap lifecycle hook (`install`, `uninstall`, `startup`,
 * `shutdown`, `onMainWindowLoad`, `onMainWindowUnload`). Mirrors the
 * `REASONS` constant in upstream `plugins.js`
 * @see https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L53-L64.
 */
export const BOOTSTRAP_REASONS = {
  /** `init()` → `startup` for every active addon at Zotero start. */
  1: "APP_STARTUP",
  /** Registered shutdown listener → `shutdown` for every active addon at Zotero stop. */
  2: "APP_SHUTDOWN",
  3: "ADDON_ENABLE",
  4: "ADDON_DISABLE",
  /**
   * Fresh install: `onInstalled` → `install` then (if active) `startup`.
   * Also reused by `onOperationCancelled` when a pending uninstall is reverted.
   */
  5: "ADDON_INSTALL",
  /** `onUninstalling` → `shutdown` (if active) then `uninstall`. */
  6: "ADDON_UNINSTALL",
  /**
   * `getVersionChangeReason` picks UPGRADE when the new version is newer.
   * Drives both `onInstalling` (`shutdown` + `uninstall` of old) and
   * `onInstalled` (`install` + `startup` of new).
   */
  7: "ADDON_UPGRADE",
  /** Same flow as ADDON_UPGRADE, chosen when the new version is older. */
  8: "ADDON_DOWNGRADE",
  9: "MAIN_WINDOW_LOAD",
  /**
   * Declared for symmetry, but current Zotero source actually passes
   * `MAIN_WINDOW_LOAD` (== 9) to `onMainWindowUnload`. Treat either value
   * as "window unloading" until the upstream bug is fixed.
   */
  10: "MAIN_WINDOW_UNLOAD",
} as const;

/** Numeric reason code passed to bootstrap hooks. */
export type BootstrapReason = keyof typeof BOOTSTRAP_REASONS;

export type BootstrapReasonName = (typeof BOOTSTRAP_REASONS)[BootstrapReason];
