# @zotlit/shared

Shared utilities consumed by multiple packages — app-agnostic.

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"` and the package is bundled by tsdown. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import { createNanoEvents } from "./nanoevents";

// wrong — bundler resolution, not Node ESM
import { createNanoEvents } from "./nanoevents.ts";
```

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "shared", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "shared", "nanoevents"]);
```

Never call `configure()` here — that belongs to the consuming app.
