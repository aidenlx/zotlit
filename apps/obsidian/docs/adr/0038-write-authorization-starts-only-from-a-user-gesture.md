# Write Authorization starts from Allow editing

Zotero grants Write Authorization through its own modal dialog: Allow, Always Allow, and Deny, with Deny the default. ZotLit requests it through the explicit **Allow editing** action in the Annotation View or settings, when the Zotero Local API is available and authorization is needed. Editing controls stay disabled until authorization is available. This separates approval from changing an Annotation, so selecting an editing tool has a predictable result.

One authorization request belongs to the plugin and survives navigation between views. The Annotation View and settings show **Waiting for approval in Zotero** and prevent duplicate requests. The user completes or declines the request in Zotero. A denial or connection failure ends that attempt; another request requires Allow editing. A write that reports expired authorization also returns to this explicit action. Approval makes editing available; a subsequent editing action submits a change.

Accepted on 2026-09-20. This replaces the earlier choice to authorize from an edit gesture. The decision is a target contract; implementation must be checked against it. Amended by [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md): only Always Allow enables editing.

## Considered Options

- **Authorize at startup or on the Capability Probe** (rejected): a Zotero dialog would appear with no visible cause in Obsidian, and a `401` from a revoked key would re-prompt on its own.
- **Explicit Allow editing, editing controls disabled until approval** (chosen): adds a separate approval action and lets the researcher decide when Zotero opens its dialog.
- **An outbox that holds refused writes for later** (rejected): needs visible pending items, cancellation, reconciliation, and conflict rules that no ticket in this map defines.
- **Authorization from an edit gesture** (previous choice): reduced the number of actions, but selecting an editing tool could unexpectedly open Zotero's dialog.

## Consequences

- Only Always Allow enables editing. Zotero's Allow issues a single-use key that ZotLit discards, leaving editing unavailable, as defined in [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md).
- The authorization request waits for Zotero's response across view closure. The initial interface directs the user to Zotero's Always Allow or Deny buttons. Client cancellation cannot promise to close Zotero's dialog; native dialog dismissal is not classified as denial without a verified result. Zotero limits prompts to five per minute, and a `429` keeps the action disabled for `Retry-After`.
- A `403 Write access denied` marks that one library read-only in memory for the session, cleared by the next Capability Probe; no key is requested again for it.
- The Client Name shown in Zotero's dialog is `ZotLit for Obsidian`, one string for every vault.
- The settings row **Zotero editing** leads with the current editing outcome and the relevant next step. Connection availability and a saved authorization remain separate facts. **Ready to edit** replaces the authorization action when editing is available. **Forget authorization** is a secondary management action. A failed connection says **Cannot connect to Zotero**; Local API setup guidance requires evidence that the API is disabled.

The [Zotero Local API documentation](https://www.zotero.org/support/dev/web_api/v3/local_api#authorizing_writes) defines approval and key consumption. Local source inspection confirms that authentication consumes a one-time key before later write checks. A successful read establishes connection availability, not the validity of a remembered write grant; [ADR 0037](0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md) governs that distinction.
