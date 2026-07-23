# Zotero paths are Device Overrides, not synced settings

The Zotero profile directory and data directory are absolute machine-specific paths, yet they lived in the synced plugin settings, so vault sync propagated one machine's paths onto every other device. We store them exclusively per device — per vault × device via Obsidian's vault-scoped localStorage — where an unset value means auto-detect and a set value is a **Device Override** of automatic Zotero detection. `ZoteroPrefService` (the sole resolver of the Zotero location) owns these two values: it loads, persists, and re-resolves from them, and exposes getters/setters that the setting tabs and the Welcome View locate action call directly. The two keys are removed from the settings schema entirely — they are not settings.

## Considered Options

- **Layered override** (synced base value, per-device override wins): rejected. It adds a third per-device state ("inherit" vs "explicitly auto-detect" vs explicit path), a two-layer settings UI, and keeps one machine's paths in synced data where they are stale on every other machine — while auto-detection already serves as the shared default a base layer would provide.
- **Keep the keys in the settings schema, route their persistence to device storage** (rejected): the settings service would carry a synced/device partition, a snapshot merge, and a move-and-strip migration that adopts any stale synced value into local storage — real complexity added to the settings service for two values that are not settings. Consumers stay unmodified, but the two paths' true owner (`ZoteroPrefService`) still had to read them back out of settings.
- **Standalone per-device store owned by `ZoteroPrefService`, no migration** (chosen): the paths leave the settings schema; `ZoteroPrefService` owns their storage and drops its settings dependency. Shipping in the 2.0.0 beta (greenfield), there is no production data to migrate, so no migration is written.

## Consequences

- The settings service stays purely about synced settings — no device partition, no `app`/localStorage dependency.
- `ZoteroPrefService` gains the vault-scoped `app` (localStorage) dependency and drops its `settings` dependency, which it only ever used to read these two keys.
- A beta tester who had set a custom Zotero path before this change re-selects it once after updating (its old synced value is ignored). The fresh-device notice guides that: when the resolved database file is absent, the database layer emits a `db-file-missing` signal that a Welcome-View subscriber renders as a notice whose action opens the Welcome View's locate step.
- Reversing to synced storage would require reintroducing the two keys to the schema; the per-device values do not sync.
- Zotero connection health is a per-device condition, so the fresh-device condition is detected and signalled by the database layer — not the synced-state-driven release service — while a Welcome-View subscriber renders the notice.
