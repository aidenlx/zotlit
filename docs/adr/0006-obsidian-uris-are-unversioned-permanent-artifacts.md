# Obsidian `obsidian://zotlit/*` URIs are unversioned, permanent artifacts

An `obsidian://zotlit/*` link is a public artifact users can embed in notes, webpages, and bookmarks, so it must keep working across plugin versions. We removed the `v` version param from the URL transport entirely: the Zotero builders no longer emit it and the Obsidian receiver no longer checks it — a link is honored whenever its query structurally validates, whatever version created it. The HTTP transport is unchanged: it stays strictly matched via the `X-Zotlit-Protocol-Version` header (`426` on mismatch), because those requests are ephemeral and generated in lockstep by the running companion. `PROTOCOL_VERSION` now means "HTTP wire version" and bumps only on HTTP body/header changes.

## Consequences

- **URL wire format is additive-only.** Existing action ids and their required fields are a frozen contract; future changes may only add optional fields with safe defaults (as `scope` already does). A genuine breaking change requires a **new** action id, with the old handler preserved indefinitely. There is no runtime gate to catch a violation — the discipline is the only guardrail.
- **Structural validation is the sole URL gate** (alongside the version-independent `source-id` install check). A link that no longer parses degrades to the existing "invalid link" notice rather than a "please update" one.
- **A new-Zotero + not-yet-updated-Obsidian pairing briefly rejects v-less links** as "missing version" until the plugin updates. This self-heals and already broke on any prior version bump, so it is an accepted transient, not a regression.
