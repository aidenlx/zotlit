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

Log through Effect in files that import it, with `withLogCategory` from `src/logging.ts`; use `logLibrary` from that module only in Effect-free files. Categories start at `["zotlit", "shared", ...]`. The consuming app installs the log sink and configures the sinks.

```ts
import { Effect } from "effect";

import { withLogCategory } from "./logging";

Effect.logDebug("Event emitted").pipe(
  withLogCategory("zotlit", "shared", "nanoevents"),
);
```

Never call `configure()` here — that belongs to the consuming app.
