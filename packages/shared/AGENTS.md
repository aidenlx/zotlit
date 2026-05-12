# @zotlit/shared

## Module resolution

`tsconfig.lib.json` uses `"moduleResolution": "bundler"` and the package is bundled by tsdown. Relative imports do **not** need a `.ts` extension:

```ts
// correct
import { Temporal } from "./temporal";

// wrong — bundler resolution, not Node ESM
import { Temporal } from "./temporal.ts";
```
