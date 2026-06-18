# @zotlit/protocol

Wire format for ZotLit ↔ Zotero communication: JSON bodies over HTTP.

- **HTTP-notify events** (`src/notify.ts`) — what Zotero actively pushes to `POST {host}/notify`. Implemented as valibot schemas (`notifyEventSchema` + inferred `NotifyEvent`); the obsidian `LiveUpdateService` validates request bodies against the schema directly via `@hono/valibot-validator`. 
- **Obsidian URL protocol** (`src/url.ts`) — `obsidian://zotlit/{open,update}?item=<itemID>&source-id=<hash>` links Zotero opens via `Zotero.launchURL`, one handler per action following Obsidian URI convention. `buildProtocolUrl(action, itemID, sourceId)` encodes (Zotero side); `parseProtocolQuery(data)` validates the decoded `ObsidianProtocolData`; `protocolSourceMatches(query, expected)` filters mismatched installs (Obsidian side). Single-item, literature only; batch variants are future work.

Consumed by both `apps/zotero` (encoder) and `apps/obsidian` (decoder). Both ship together; there is no installed-base compat constraint to preserve.

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"`. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import type { ItemQuery } from "./types";

// wrong
import type { ItemQuery } from "./types.ts";
```
