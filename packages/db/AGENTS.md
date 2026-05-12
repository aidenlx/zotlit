# @zotlit/db

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "db", ...]`. Do **not** depend on the obsidian app's `@/lib/log` wrapper — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
