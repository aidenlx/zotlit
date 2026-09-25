# Editing requires a Remembered Authorization; Zotero's Allow leaves ZotLit read-only

Zotero's write dialog offers Allow, Always Allow, and Deny. Allow issues a key that Zotero spends on the first authenticated write, whether or not that write succeeds. ZotLit edits only with a key from Always Allow. When Zotero answers `remember: false`, ZotLit discards the key, the Editing Capability stays at authorization required, and a notice says **To edit annotations, choose Always Allow in Zotero.** with an **Allow editing** button that asks again. While the dialog is open, ZotLit's waiting state already says **In Zotero, choose Always Allow. ZotLit cannot edit with Allow. To decline, choose Deny.**

A single-use key pays for one write request. Supporting it took its own capability state, a manual-save rule for comment drafts, and special cases in the card controls and the creation toolbar. It cannot serve a group action, which sends one request per Annotation and fails from the second. Zotero always shows Allow and gives the client no way to hide it, so ZotLit cannot prevent the choice; it refuses the key and says what to choose instead.

Accepted on 2026-09-25 with [#1243](https://github.com/aidenlx/zotlit/issues/1243), before release, so no stored state needed migration. It amends [ADR 0038](0038-write-authorization-starts-only-from-a-user-gesture.md), [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md), and [ADR 0059](0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md).

## Considered Options

- **Hold Allow's key and spend it on the next write** (previous choice): one change without a lasting grant, at the cost of the separate state and save rules above, and no group actions.
- **Ask Zotero again at once after Allow** (rejected): opens Zotero's dialog with no action in Obsidian, against ADR 0038, and Zotero allows five prompts a minute.
- **Spend the refused key with a write built to fail** (rejected): removes the key from Zotero's store, but depends on the order of Zotero's internal checks.
- **Refuse Allow's key and say to choose Always Allow** (chosen).

## Consequences

- Allow's key stays in Zotero's key store. An unused single-use key has no expiry, and the Local API has no revoke; Zotero's **Clear** removes it. The key permits only writes to a database every local process can already read, the reasoning of [ADR 0037](0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md).
- When the key from Always Allow cannot be saved to SecretStorage, ZotLit discards it too and says **ZotLit could not save the permission on this device.** Zotero keeps that remembered key until it is cleared.
- Every **Allow editing** entry reports the answer the same way: a grant, an Allow, or a failed save each show their notice. A Deny stays silent; the capability returns to **Allow editing**.
- Comment drafts always save automatically. A held draft still waits for an explicit **Save comment** (ADR 0048).
- Closing Zotero's dialog reports Always Allow, so only a press of the Allow button reaches this path.
