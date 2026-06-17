# @zotlit/protocol

Wire format for ZotLit ↔ Zotero communication: JSON bodies over HTTP.

- **HTTP-notify events** (`src/notify.ts`) — what Zotero actively pushes to `POST {host}/notify`. Implemented as valibot schemas (`notifyEventSchema` + inferred `NotifyEvent`); the obsidian `ServerService` validates request bodies against the schema directly via `@hono/valibot-validator`. 

Consumed by both `apps/zotero` (encoder) and `apps/obsidian` (decoder). Both ship together; there is no installed-base compat constraint to preserve.

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"`. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import type { ItemQuery } from "./types";

// wrong
import type { ItemQuery } from "./types.ts";
```
