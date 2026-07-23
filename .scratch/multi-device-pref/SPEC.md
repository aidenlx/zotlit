# Spec: Per-device Zotero profile & data directory (Device Overrides)

Status: ready-for-agent

## Problem Statement

The Zotero profile directory and data directory are absolute, machine-specific filesystem paths, but ZotLit stores them in synced plugin settings. A user with vault sync who points one machine at a custom Zotero location propagates that path to every other device, where it is wrong: the plugin either fails to find the database or reads a different Zotero install than the one running on that machine. The user's only recourse is to keep re-fixing the setting on whichever device they touched last, with each fix breaking the others.

A second gap follows from making the paths device-scoped: a user who syncs their vault to a new machine arrives with no path configured on that device. If auto-detection fails there (custom Zotero location), nothing tells them — the launch surfaces all key off synced state, which says this vault is already set up, so the database silently stays broken until the user stumbles on the status readout in settings.

## Solution

The Zotero profile directory and data directory become **Device Overrides** (see the Obsidian context glossary): values stored per vault × device that never sync, overriding ZotLit's automatic Zotero detection on that device only. Unset means auto-detect, which is the happy path on every machine with a default Zotero install — a freshly synced vault works everywhere without configuration, and an explicit path set on one device never leaks to another.

There is no migration. Shipping in the 2.0.0 beta (greenfield), any custom path an early tester set on a device is simply re-selected once after updating; the old synced value is ignored, and the fresh-device notice below guides the fix.

For the fresh-device gap: when a launch's database refresh fails because the database file cannot be found, a durable notice says Zotero was not found on this device and its action opens the Welcome View, whose first quick-start step already shows live connection status with a locate action. The notice returns each launch while the connection stays broken.

## User Stories

1. As a multi-device user with a custom Zotero location on one machine, I want that path stored on that device only, so that vault sync stops overwriting my other devices' working configuration.
2. As a multi-device user with default Zotero installs everywhere, I want every device to auto-detect its own install, so that a synced vault works on all my machines with zero configuration.
3. As a user choosing a Zotero profile in settings, I want the choice to apply to the current device only, so that selecting my laptop's profile cannot misconfigure my desktop.
4. As a user setting the advanced data-directory override, I want it scoped to the current device, so that a path that only exists on this machine never travels.
5. As an early tester who configured a custom path before this change, I want a clear prompt to re-select it once after updating, so that the connection is easy to restore even though the old value no longer carries over.
6. As a user reading the profile or data-directory row in settings, I want it to say the value is stored on this device and doesn't sync, so that I'm not surprised when another device shows something different.
7. As a user on an older Obsidian version, I want the compat settings tab to carry the same per-device note and behavior, so that the experience doesn't depend on my Obsidian version.
8. As a user resetting the profile or data-directory setting, I want reset to return this device to auto-detection, so that clearing an override has an obvious, local meaning.
9. As a user syncing my vault to a new machine where Zotero isn't in the default location, I want a notice at launch telling me Zotero wasn't found on this device, so that I learn about the broken connection before a failed import does.
10. As that user, I want the notice's action to open the Welcome View, so that I can fix the connection through the guided step that shows live status and a locate action.
11. As a user who dismisses the notice and gets distracted, I want it to reappear on the next launch while the connection is still broken, so that one dismissal cannot lose the pointer forever.
12. As a user whose database connects fine, I want no notice, so that launches stay quiet when nothing is wrong.
13. As a user on a fresh device where auto-detection succeeds, I want no prompt of any kind, so that the common case needs no attention.
14. As a user fixing the path via the Welcome View's locate action, I want the chosen path saved as this device's override, so that the fix lands where the problem is.
15. As a user with several vaults on one machine, I want each vault's Device Overrides independent, so that pointing one vault at a test profile never affects another vault.
16. As a companion user, I want source validation derived from the paths this device actually resolves, so that pushes and live updates match the Zotero install running here.
17. As a user on a second device that updates after the first device already migrated the synced values away, I want this device to fall back to auto-detection rather than inherit another machine's stale path, so that the worst case is a fresh setup, not a wrong one.
18. As a user of the other Zotero settings (read mode, auto-refresh, citation library), I want them to keep syncing, so that only the machine-specific paths change behavior.
19. As a user who already handled an upgrade prompt on one device, I want release and onboarding state to keep syncing, so that a new device doesn't replay onboarding it shouldn't.
20. As a user inspecting or syncing my vault, I want machine-specific paths out of the synced settings file, so that per-machine differences stop churning sync diffs.

## Implementation Decisions

- **Device Override is the concept**, defined in the Obsidian context glossary: device-scoped (per vault × device), never syncs, overrides automatic Zotero detection; unset means auto-detect. The two Zotero paths — profile directory and data directory — are the only Device Overrides. The mechanism is not generalized to other keys.
- **Storage** uses Obsidian's vault-scoped localStorage API (the app's load/save local-storage methods — the established per-device precedent in this plugin), holding a single sparse record of the overridden keys. Absent key = auto-detect. A small pure module (`zotero-pref/device-paths`) owns the record's load/save/validation.
- **`ZoteroPrefService` owns the two paths.** They are removed from the settings schema and type entirely — they are not settings. `ZoteroPrefService` (the sole resolver of the Zotero location) loads them from device storage, persists them via setters (`setProfileDir`/`setDataDir`), re-resolves prefs on a profile change, and drops its former `settings` dependency. The setting tabs and the Welcome View locate action read/write through it; the database service and source-id derivation read the resolved paths as before.
- **No migration.** Greenfield 2.0.0 beta: any stale synced value for these keys is ignored (they are no longer schema keys), and an early tester re-selects a custom path once, guided by the fresh-device notice. No settings version bump.
- The **v1 legacy migration is uninvolved** — it never mapped these keys.
- **Fresh-device handling is connection-health-driven and owned by the database layer**: on the first refresh failure of a launch whose cause is the database file not being found, the database service emits a `db-file-missing` signal (at most once per launch); a Welcome-View subscriber renders the durable notice whose action opens the Welcome View. The signal recurs on later launches while the condition holds; no dismissal state is stored; other failure causes (locks, corruption) do not trigger it.
- **The release service is untouched.** Its branch decision stays a pure function of synced version/origin state, and all `release.` state keeps syncing.
- **UI change is one description line** on the profile and data-directory rows — stating the value is stored on this device and doesn't sync — in both the declarative and compat setting tabs, worded per the house UI-text style through the i18n message pipeline.
- Source-id derivation continues to read the resolved profile and data directory, so companion validation is per-device correct with no changes.

## Testing Decisions

- **Device-paths module**: the pure `zotero-pref/device-paths` load/save round-trips through a stubbed vault-scoped localStorage — sparse record, both-set, clear-when-empty, and garbage/non-string rejection. This is the tested seam for the override storage contract, split out so it needs no `ZoteroPrefService` (filesystem-touching) harness.
- **Database service surface**: a refresh failure caused by a missing database file emits `db-file-missing` once; a second same-launch failure does not; a failure with a different cause does not; a healthy refresh emits nothing. Prior art: the database service's existing service-level tests over the mocked `obsidian` module.
- `ZoteroPrefService`'s override getters/setters are not given a service-level test, consistent with the pref service's pre-existing untested (filesystem) resolution chain; the storage contract they delegate to is covered by the device-paths module test.
- Setting-tab rows and Welcome View rendering are not unit-tested, consistent with the repo's pattern of verifying UI against the running app.

## Out of Scope

- Layered semantics (synced base value with a per-device override on top) — rejected; the trade-off is recorded in ADR 0010.
- Generalizing device scoping into a mechanism any settings key can opt into.
- Making other `zotero.` settings (read mode, auto-refresh, citation library) device-scoped.
- True cross-vault per-device storage; overrides are per vault × device by design.
- Backfilling service-level tests for the Zotero pref service's pre-existing untested resolution chain.
- Welcome View changes — it consumes unchanged service surfaces; only the notice pointing at it is new.
- Any migration notice or recovery flow for devices that load already-stripped synced data.

## Further Notes

- Domain vocabulary: **Device Override** is defined in the Obsidian app's context glossary; keep code and UI naming aligned with it.
- ADR 0010 records the device-only-storage decision and the rejected layered alternative.
- The Welcome View spec (`.scratch/welcome-view/`) carries a cross-reference at its connection-status decision pointing here for the fresh-device launch surface.
- Affected-population note: this ships during the 2.0.0 beta, so the only cohort that had a synced custom path (and must re-select it once) is the handful of early testers.
