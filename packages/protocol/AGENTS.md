# @zotlit/protocol

Wire format for the ZotLit ↔ Zotero handoff URL (`obsidian://zotero/{action}?...`) and the HTTP-notify event payloads (`POST {notify-url}/notify`).

Consumed by both `apps/zotero` (encoder) and `apps/obsidian` (decoder). Both ship together; there is no installed-base compat constraint to preserve.

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"`. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import type { ItemQuery } from "./types";

// wrong
import type { ItemQuery } from "./types.ts";
```
