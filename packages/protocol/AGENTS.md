# @zotlit/protocol

Wire contracts for ZotLit ↔ Zotero HTTP requests and Obsidian Public URI Links.

## Wire format

- **HTTP-notify events** (`src/notify.ts`) — what Zotero actively pushes to `POST {host}/notify`. Implemented as valibot schemas (`notifyEventSchema` + inferred `NotifyEvent`); the obsidian `LiveUpdateService` validates request bodies against the schema directly via `@hono/valibot-validator`. 
- **Public URI Links** (`src/url.ts`) — permanent `obsidian://zotlit/*` links opened through `Zotero.launchURL`. Read the action ids, builders, parsers, and schemas in `src/url.ts`; `src/wire-format.test.ts` is the canonical inventory of their emitted wire surface.

Consumed by both `apps/zotero` (encoder) and `apps/obsidian` (decoder). See `CONTEXT.md` for the compatibility vocabulary and transport boundaries.

### Extending the wire format

The two transports evolve under two different policies (see `CONTEXT.md`).

**Public URI Link** (`obsidian://zotlit/*`, `url.ts`) — unversioned and permanent, so **additive-only**:

- Existing action ids and their required query fields are a frozen contract; an embedded link must keep working across plugin versions.
- Only add **optional** fields with a safe default (as `scope` does). Never bump `PROTOCOL_VERSION` for a URL-only change — the receiver does not version-check URLs.
- A genuine breaking change requires a **new** action id, with the old handler preserved indefinitely. There is no runtime gate; the discipline is the only guardrail.

**Ephemeral HTTP Request** (`POST /notify`, `PUT …`, `notify.ts` + the `*RequestSchema` bodies) — strictly version-matched:

- Bump `PROTOCOL_VERSION` in `src/version.ts` on any HTTP body/header schema change. Its compat check gates every HTTP request (`426` on mismatch).

For either transport, update the inline snapshot in `src/wire-format.test.ts` — the canonical guard for the wire surface, with one `*WireSurface()` helper per transport. Add a helper for a new transport so it's covered too. Regenerate with `pnpm --filter @zotlit/protocol exec vitest run src/wire-format.test.ts -u`, then review the diff (don't blind-accept).

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"`. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import type { ItemQuery } from "./types";

// wrong
import type { ItemQuery } from "./types.ts";
```
