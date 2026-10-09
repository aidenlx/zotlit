---
name: zotlit-item-query
description: "Query Zotero Items through ZotLit in Obsidian. Use to find works by metadata, tags, collections, creators, or dates; inspect available fields; count matches; or export selected Item data."
metadata:
  cli-contract-version: "2"
---

# ZotLit Item Query

This skill targets the Item Query CLI Contract version pinned in its metadata. Compare it with `contractVersion` in the first response. If they differ, read the live guide again and follow that guide over this skill.

## Discover → query → verify

1. Select the intended Obsidian vault. Read `obsidian vaults` when the vault is unknown, then keep `vault=<name-or-id>` as the first argument on every call. Read `obsidian vault=<vault> zotlit:item-query-guide` once for the installed contract; use `help zotlit:item-query` when you need parameter details.
2. Save the response of `obsidian vault=<vault> zotlit:item-query-schema` and confirm `identity.vault` and `identity.source`. It gives a version-pinned download at `schema.url`, a local name at `schema.fileName`, and live `customFields` and `defaults`. Read guide topic `schema` to select needed catalog entries with `jq`: released builds download once; unpublished .dev builds use the matching checkout's generated catalog. Keep the full catalog in a file and load only relevant entries into context. Reuse the file while its URL is unchanged; refresh the live response after a source or custom-field change.
3. Translate the request into Library scope, filter, returned fields, sort, and completeness. Read relevant guide topics before using unfamiliar syntax. Sample only when you need to check an uncertain expression or data shape. Reuse a successful result when its scope, fields, and order meet the request and it is complete; otherwise run the query with the needed limit.
4. Read `diagnostic.report` first on failure. Read `warnings` before you report an empty result. Check the response body: a successful shell exit alone does not prove success. For JSON failures, follow `diagnostic.hint` and correct the named argument or expression. Treat a plain-text error as a failed call. Retry a transient failure once; report a repeated failure with its recovery action.
5. Complete when the successful response's `identity`, `libraries`, and `request` match the intended query and its rows or export have been read. Report the selected Libraries, useful Item details, and whether the result is complete. For an export, give the file path and returned count.

Resolve date meaning before filtering: publication date, date added, and date modified answer different questions. Ask for the date basis or time range when the request leaves a material choice open. For a first-author result, project `creators` and select the first entry whose `role` is `author`; `creators[0]` can have another role.

## Library scope and Item identity

Use the default Library scope for the vault's configured search. Use `libraries=all` when the user requests every Library, or explicit selectors for named Libraries. To discover group names and IDs, run a small query with `libraries=all`, `fields='[]'`, and `limit=1`; read its `libraries` metadata. Confirm an ambiguous Library name with the user.

Keep each row's `indexedKey` when joining results or passing an Item to another ZotLit command. A Zotero `key` is unique only inside its Library. Compare source identity across calls before joining their results.

## Completeness and exports

For a sample or top-N request, set the requested limit and sort. State that it is a sample when `truncated` is true. For every match or an exact count, use `limit=all` and require `truncated: false`. For a count alone, `fields='[]'` returns only identities; `returnedCount` is the exact count only for the complete result.

Read `zotlit:item-query-guide topic=results` before exporting or handling `result-too-large`. Use `output=<absolute-path>` with a new filename in an existing directory. Read the returned `file.path` to obtain the full envelope and verify its count and completeness. Choose another filename if the destination exists.

For a potentially long query, read `zotlit:item-query-guide topic=cancel` and assign a unique `id`. To stop it, send `zotlit:item-query-cancel id=<id>` to the same vault from a second call. Check the original call's outcome; the cancel response alone does not establish whether a result was returned.

## Read the relevant guide topic

Run `obsidian vault=<vault> zotlit:item-query-guide topic=<topic>` for the branch in use:

- `filter`: text matching, tags, Collection paths, creators, dates, custom fields, and missing values.
- `schema`: version-pinned downloads, local `jq` inspection, and schema access in a source checkout.
- `fields`: Projection Paths and returned value shapes. Filter and projection representations can differ; use the schema's capability for each operation.
- `sort`: supported sort fields, tie order, dates, and limits.
- `results`: JSON envelopes, diagnostics, and file exports.
- `cancel`: named runs and cancellation outcomes.

Keep JSON arrays and Filter Expressions inside one shell argument, using proper shell quoting. Follow live help and schema for parameter names, capabilities, and defaults.

Item Query searches top-level Items outside the trash. Its results support answers about stored metadata; questions about paper contents need the relevant text. Questions about which vault notes cite a work belong to the citations commands.
