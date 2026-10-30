# Coding standards

Review-only policy index for packages/db. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [Zotero integer domains](policies/integer-domains.md)
- [Query authoring](policies/query-authoring.md)

## Logging

Import `getLogger` directly from `@logtape/logtape` — libraries must stay app-agnostic.

```ts
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["zotlit", "db", "query"]);
```

Never call `configure()` here — that belongs to the consuming app.
