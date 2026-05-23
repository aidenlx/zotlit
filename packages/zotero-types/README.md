# @zotlit/zotero-types

Generated TypeScript item-field shapes from the pinned Zotero schema submodule.

- Source input: `zotero-schema/schema.json`.
- Generated output: `src/fields.ts`, committed to the repo.
- Regenerate with `pnpm --filter @zotlit/zotero-types generate:fields`.
- Do not add runtime dependencies or imports to `src/generated.ts`; it must stay pure shape-only TypeScript.

## Schema Bump

1. Update `zotero-schema` to the desired upstream commit.
2. Confirm `zotero-schema/schema.json` has the intended `version`.
3. Run `pnpm --filter @zotlit/zotero-types generate`.
4. Run `pnpm --filter @zotlit/zotero-types build`.
