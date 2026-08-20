# Zotero 9 / 10 API shapes

Both majors are supported, so code that touches an API they shape differently tests for the **presence of the Zotero 10 name** and falls through to the Zotero 9 one.

- Test for the Zotero 10 name, not the Zotero 9 one — reading a name Zotero 10 removed can throw rather than return `undefined`, as `collectionTreeRow` does.
- `src/menus/collection-scope.ts` holds the pattern; `zotero10_dev.md` on the `research/zotero10-wal-stale-reads` branch records the full 9 → 10 diff.
- Type gaps that `zotero-types` has yet to cover go in `src/types/zotero.d.ts`.
