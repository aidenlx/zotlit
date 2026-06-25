# @zotlit/protocol

Wire format for ZotLit ↔ Zotero communication: JSON bodies over HTTP.

## Wire format

- **HTTP-notify events** (`src/notify.ts`) — what Zotero actively pushes to `POST {host}/notify`. Implemented as valibot schemas (`notifyEventSchema` + inferred `NotifyEvent`); the obsidian `LiveUpdateService` validates request bodies against the schema directly via `@hono/valibot-validator`. 
- **Obsidian URL protocol** (`src/url.ts`) — `obsidian://zotlit/{open,update}?item=<itemID>&source-id=<hash>` links Zotero opens via `Zotero.launchURL`, one handler per action following Obsidian URI convention. An `update` link may carry `&scope=metadata` (an `UpdateScope`; absent means full) to refresh managed frontmatter only. `buildProtocolUrl(action, itemID, { sourceId, scope })` encodes (Zotero side); `parseProtocolQuery(data)` validates the decoded `ObsidianProtocolData`; `protocolSourceMatches(query, expected)` filters mismatched installs (Obsidian side). Single-item, literature only; batch variants are future work.

Consumed by both `apps/zotero` (encoder) and `apps/obsidian` (decoder). Both ship together; there is no installed-base compat constraint to preserve.

### Extending the wire format

When you add/remove/rename a field, transport, action, or header in `notify.ts` / `url.ts` / `source-id.ts`:

- Bump `PROTOCOL_VERSION` in `src/version.ts` (its compat check gates every request).
- Update the inline snapshot in `src/wire-format.test.ts` — it's the canonical guard for the wire surface, with one `*WireSurface()` helper per transport. Add a helper for a new transport so it's covered too. Regenerate with `pnpm --filter @zotlit/protocol exec vitest run src/wire-format.test.ts -u`, then review the diff (don't blind-accept).

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"`. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import type { ItemQuery } from "./types";

// wrong
import type { ItemQuery } from "./types.ts";
```
