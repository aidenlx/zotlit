# Zotero integer domains

Zotero stores enum-like domains as raw integers (`itemAttachments.linkMode`, `itemTags.type`, `creators.fieldMode`).

- Define the int-to-name map **module-private** in `src/lib/zt-*.ts` (`ANNOT_TYPE`, `LINK_MODE`, etc.). Export the key type and name type (`LinkMode` / `LinkModeName`).
- Apply the raw key type at the schema boundary: `integer().$type<...>()` in `drizzle/schema.ts`.
- Resolve int→name only through exported `<domain>ToName` converters that return `<Name> | "unknown"` and `logger.warn` on unknown values. Never index the raw map at a call site.
- Query models carry the raw typed integer. Template-facing helpers resolve via the converter.
- Don't add per-query casts — fix the schema column typing or add the missing `zt-*` domain type.
