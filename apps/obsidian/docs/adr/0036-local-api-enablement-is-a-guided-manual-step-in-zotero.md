# Local API enablement is a guided manual step in Zotero; the Companion stays out of Zotero's own preferences

Zotero ships its HTTP server on but the `httpServer.localAPI.enabled` preference off, and every Zotero Local API request — the unkeyed Capability Probe included — checks that preference live, so a flip in Zotero Settings → Advanced takes effect with no restart. ZotLit Companion runs inside Zotero and could set that preference, but we keep it out of Zotero's own preference branch: ZotLit for Obsidian explains the manual step, and the Capability Probe alone decides whether the local API is on. The preference, once on, opens unauthenticated *reads* of the whole library to every local process, so it is the user's security boundary, and a boundary the user did not move is not one an add-on should move for them.

## Considered Options

- **Companion enables the preference at install** (rejected): silently widens what every local process can read, and the Companion's preference facade is a closed union over `extensions.zotlit.*` for exactly this reason.
- **Companion offers a control in its ZotLit pane that mirrors Zotero's preference** (deferred): the user consents inside Zotero, but one setting gains two UIs and the Companion facade widens past its own branch. Reconsider if support load shows the manual step is a problem.
- **Guided manual step, Capability Probe as authority** (chosen): the Pandoc export path already ships this guidance, and the probe's distinct `403 Local API is not enabled` body is always current where the once-at-init read of `prefs.js` is not.

## Consequences

- `prefs.js` supplies the Zotero HTTP port only; it is not a signal for the local API state.
- ZotLit leaves the "local API disabled" reading only through a fresh Capability Probe: an edit gesture, the settings action, a Freshness Signal, or a resolved-paths change, as issue 824 set out.
- The Companion has no inbound channel from Obsidian and gains none here.
