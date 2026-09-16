# Write Authorization starts only from a user gesture; no dialog opens by itself and no write waits in an outbox

Zotero grants Write Authorization through its own modal dialog — Allow, Always Allow, Deny, with Deny the default — rate-limited to five prompts a minute. ZotLit sends `POST /api/local/authorize` only when a user acts: an edit gesture in the reader while unauthorized, or "Enable editing" in the settings row. The gesture is the intent, so it counts as the explicit action, and it continues after Allow; one in-flight authorization serves both entry points. A `401`, a denial, a dismissed dialog, or a lost connection rolls the pending mutation back and returns to "authorization required" without reopening the dialog. Nothing survives past the gesture: there is no background write queue.

## Considered Options

- **Authorize at startup or on the Capability Probe** (rejected): a Zotero dialog would appear with no visible cause in Obsidian, and a `401` from a revoked key would re-prompt on its own.
- **Only an explicit "Enable editing" action, edit controls inert until then** (rejected): a second click for something the gesture already said.
- **An outbox that holds refused writes for later** (rejected): needs visible pending items, cancellation, reconciliation, and conflict rules that no ticket in this map defines.
- **Gesture-started, gesture-scoped** (chosen).

## Consequences

- A One-time Authorization (Allow) is consumed by the first authenticated attempt even when the write then fails; ZotLit holds it in memory for that attempt only, and the next gesture may open the dialog again. The `429` cooldown with `Retry-After` absorbs the worst case.
- The transport is `nodeFetch` with an `AbortSignal`: the Capability Probe is time-bounded, the authorize request is unbounded until the user abandons the gesture. Abandoning aborts the request while Zotero's dialog stays open; an Always Allow clicked afterwards leaves an orphaned key in Zotero, which costs the user one extra dialog and is cleared by Zotero's own button.
- A `403 Write access denied` marks that one library read-only in memory for the session, cleared by the next Capability Probe; no key is requested again for it.
- The Client Name shown in Zotero's dialog is `ZotLit for Obsidian`, one string for every vault.
- The settings row "Zotero editing" under Zotero → Connection is the lifecycle surface: status, "Enable editing", "Forget authorization". In-reader presentation of every degraded state belongs to issue 830.
