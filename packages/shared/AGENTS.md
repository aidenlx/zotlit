# @zotlit/shared

Shared utilities consumed by multiple packages — app-agnostic.

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"` and the package is bundled by tsdown. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import { Temporal } from "./temporal";

// wrong — bundler resolution, not Node ESM
import { Temporal } from "./temporal.ts";
```

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "shared", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "shared", "temporal"]);
```

Never call `configure()` here — that belongs to the consuming app.
