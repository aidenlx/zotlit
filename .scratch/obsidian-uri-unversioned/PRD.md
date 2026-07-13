Status: ready-for-agent

# Obsidian `zotlit://` URIs are unversioned, permanent artifacts

## Problem Statement

A user pastes an `obsidian://zotlit/open?item=…&source-id=…` link into a note, a webpage, or a bookmark — a Public URI Link is a durable, shareable artifact. Today every builder stamps the link with `&v=<PROTOCOL_VERSION>`, and the Obsidian receiver strict-matches that value before doing anything: older, newer, missing, or malformed all reject with a "please update ZotLit" notice. So the moment ZotLit ships a version bump, every embedded link created against the previous version stops working — even when the action it names (`open`, `explore`, …) is completely unchanged. Links rot on a schedule the user never sees coming.

## Solution

Treat a Public URI Link as permanent and unversioned. The Zotero companion stops emitting `&v=` on `obsidian://zotlit/*` links, and the Obsidian receiver stops checking it — a link is honored whenever its query structurally validates, whatever plugin version created it (or hand-wrote it). The Ephemeral HTTP Request transport is untouched: it keeps strict version matching via the `X-Zotlit-Protocol-Version` header (`426` on mismatch), because those requests are generated live and in lockstep by the running companion. `PROTOCOL_VERSION` is redefined to mean "HTTP wire version" and is decoupled from URL evolution.

See ADR `docs/adr/0006-obsidian-uris-are-unversioned-permanent-artifacts.md` and `packages/protocol/CONTEXT.md`.

## User Stories

1. As a user who embedded an `obsidian://zotlit/open` link in a note last year, I want it to still open my Literature Note after a ZotLit update, so that my saved links don't rot on a version bump.
2. As a user who bookmarked an `obsidian://zotlit/explore` link, I want it to keep working across plugin versions, so that the bookmark stays useful.
3. As a user who shared an `obsidian://zotlit/import-note` link with a colleague on a different plugin version, I want it to work on their machine, so that link sharing isn't gated on version parity.
4. As a user hand-writing an `obsidian://zotlit/update` link, I want to omit the `v` param entirely and have it work, so that I don't need to know or track an internal version number.
5. As a user opening a link built by a much older ZotLit (carrying a legacy `&v=…`), I want the stale `v` to be ignored rather than rejected, so that old links and new links behave identically.
6. As a user whose link names an action or field shape that no longer exists, I want a clear "invalid link" notice rather than a misleading "please update" one, so that the message matches the actual failure.
7. As a user whose install fingerprint doesn't match the link's `source-id`, I want the link silently discarded exactly as before, so that unversioning does not weaken install targeting.
8. As a user of the running Zotero companion, I want live HTTP notify/batch requests to keep strict version matching, so that a genuinely mismatched companion↔plugin pair still fails loudly (`426`) instead of misbehaving.
9. As a user who updated the Zotero companion but not yet the Obsidian plugin, I want the brief window where the old plugin rejects new `v`-less links to self-heal once I update the plugin, so that the transient is understandable and temporary.
10. As a maintainer adding a new optional field to a URL action, I want to do so without any version ceremony, so that additive changes are cheap and never break embedded links.
11. As a maintainer needing a genuinely breaking change to a URL action, I want the discipline to introduce a new action id and keep the old handler, so that existing embedded links keep their old semantics forever.
12. As a maintainer changing an HTTP body/header schema, I want `PROTOCOL_VERSION` to bump and gate exactly that transport, so that the version number retains a precise, single meaning.
13. As a maintainer reading the wire-format snapshot test, I want the URL surfaces to show no `v` while the HTTP `version` snapshot remains, so that the guard reflects the two distinct policies.

## Implementation Decisions

### Transport policy split

- **Public URI Link** (`obsidian://zotlit/*`): unversioned and permanent. No version param emitted; no version checked. Structural schema validation plus the version-independent `source-id` install gate are the only checks.
- **Ephemeral HTTP Request** (`POST /notify`, `PUT /literature-notes`, `PUT /zotero-notes`): unchanged. Strict `X-Zotlit-Protocol-Version` header match, `426` on mismatch.

### `@zotlit/protocol`

- Remove the URL version param constant (`PROTOCOL_VERSION_PARAM`). Retain `PROTOCOL_VERSION`, `PROTOCOL_VERSION_HEADER`, `checkProtocolVersion`, `parseProtocolVersion`, and `ProtocolVersionCheck` — all now HTTP-only.
- The shared URL-params builder stops appending the version trailer. Every builder (`buildProtocolUrl`, `buildBatchProtocolUrl`, `buildImportProtocolUrl`, `buildImportManyProtocolUrl`, `buildExploreProtocolUrl`) consequently emits no `v`.
- Remove `getProtocolUrlVersion` and its export from the package index.
- The URL query schemas are unchanged and already forward-compatible: valibot `object()` silently ignores unknown keys, so a legacy link carrying `v=…` (or any future added param an older plugin doesn't know) parses without error.
- Redefine `PROTOCOL_VERSION` as the HTTP wire version. It bumps only on HTTP body/header schema changes (`notify.ts`, `batchUpdateRequestSchema`, `importNotesRequestSchema`), never on a URL-only additive change.

### URL evolution contract (additive-only)

- Existing action ids and their required query fields are a frozen contract.
- Future URL changes may only add optional fields with safe defaults (as `scope` already does).
- A genuine breaking change to an action is expressed as a new action id, with the old handler preserved indefinitely. There is no runtime gate to enforce this — the discipline is the guardrail, documented in the ADR, `CONTEXT.md`, and `AGENTS.md`.

### `apps/obsidian` protocol handler

- The shared URL-parse path (`parseProtocolData`) no longer version-checks. It parses the query against its schema, then applies the `source-id` match, then delegates. A parse failure surfaces the existing invalid-link notice; a `source-id` mismatch is discarded as today.
- The version-reject helper (`rejectIncompatibleProtocol`) survives as the HTTP path's gate only; its "please update" notices remain wired to the HTTP transport.

### `apps/zotero`

- No behavioral change. Builders emit `v`-less URLs by virtue of the protocol-package change; the HTTP PUT/POST paths keep sending `PROTOCOL_VERSION_HEADER` and keep handling `426`.

### Documentation (authored alongside the change)

- ADR `0006-obsidian-uris-are-unversioned-permanent-artifacts.md` — the decision, the URL-vs-HTTP split, the additive-only consequence, and the new-Zotero/old-plugin transient.
- `packages/protocol/CONTEXT.md` — glossary: Public URI Link, Ephemeral HTTP Request, Protocol Version, Action, Source Id. Registered in `CONTEXT-MAP.md`.
- `packages/protocol/AGENTS.md` — rewrite "Extending the wire format" to state the two policies.

## Testing Decisions

Good tests here assert external wire behavior — the bytes a builder emits and the object a parser returns — never internal control flow. The protocol package is pure and already has the ideal seam, so no new seam is introduced.

- **`packages/protocol/src/url.test.ts`** (primary seam, existing). The build→decode→parse round-trip is the highest point that exercises encoder and decoder together. Update/extend so that:
  - Every builder emits a URL with **no** `v` param (existing round-trip assertions drop `&v=${PROTOCOL_VERSION}`).
  - A decoded record **carrying a legacy `v`** still parses to the same query (embedded old-link compatibility).
  - A decoded record **without any `v`** parses (the new default form).
  - The `source-id` mismatch / match behavior is unchanged.
  - Prior art: the file's own `it.each(protocolActions)` round-trip block and its `decode()` helper.
- **`packages/protocol/src/wire-format.test.ts`** (secondary seam, existing). Regenerate the inline snapshots: URL surfaces lose `v`; the HTTP `version` snapshot is retained. Review the diff rather than blind-accepting (per `AGENTS.md`).

The `apps/obsidian` `register.ts` guard removal is a mechanical deletion covered by typecheck; its user-visible behavior (a `v`-less or legacy-`v` link reaching the note-feature flow) is already covered at the protocol parse seam, so no Obsidian-side harness test is added.

## Out of Scope

- Any change to the Ephemeral HTTP Request transport's version gating.
- Per-action or capability-negotiation versioning schemes.
- Retaining `v` as an inert or diagnostic trailer — it is removed outright.
- Backfilling or rewriting links already embedded in vaults — old links simply keep working via structural validation.
- New URL actions or fields — this spec only removes versioning; it adds no wire surface.

## Further Notes

- The one accepted transient: a new-Zotero + not-yet-updated-Obsidian pairing rejects new `v`-less links as "missing version" until the plugin updates. This self-heals and already broke on any prior version bump, so it is not a regression.
- The `source-id` gate is orthogonal to versioning and is deliberately unchanged; it remains the sole targeting mechanism for both transports.
