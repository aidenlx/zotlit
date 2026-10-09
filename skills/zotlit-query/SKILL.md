---
name: zotlit-query
description: "Query Zotero Items and Annotations through ZotLit in Obsidian. Use to find works by metadata, find a paper's highlights or notes, combine Annotation and parent Item filters, inspect source positions, open source documents, retrieve Excerpt Images, count matches, or export query data."
metadata:
  cli-contract-version: "3"
---

# ZotLit Query

This skill targets the Query CLI Contract version in its metadata. Compare it with `contractVersion` in the first response. If they differ, read the live guide again and follow it.

Item Query searches top-level Items outside the trash. Annotation Query searches their Annotations through non-trashed Attachments. One command reads Zotero data and uses the same result envelope, Library scope, Indexed Keys, limits, exports, query IDs, and cancel command.

## Discover, query, verify

1. Select the Obsidian vault. Run `obsidian vaults` when the vault is unknown. Keep `vault=<name-or-id>` as the first argument on every call.
2. Run `zotlit:query-guide`. Choose `from=items` for stored Item metadata or `from=annotations` for reading marks and notes. Read the live guide once, then use `help <command>` and guide topics for details.
3. Run `zotlit:query-schema`. Save the response and confirm `identity.vault` and `identity.source`. The response identifies a version-pinned catalog and live defaults. Follow guide topic `schema`. The single catalog has `datasets.items` and `datasets.annotations`; shared language definitions are at the top level. Use `from=` on the schema command to narrow its live defaults and field listing. Reuse a catalog while its URL is unchanged.
4. Translate the request into Library scope, selection, returned fields, sort, and completeness. Use a small sample to check uncertain syntax or shape. Run the complete query after the expression succeeds.
5. Read `diagnostic.report` first on failure. Read `warnings` before you report an empty result. Check the response body: a successful shell exit alone does not prove success. Use the report to choose the correction before retrying. Treat a plain-text error as a failed call. Retry a transient failure once; report a repeated failure with its recovery action.
6. Complete when `identity`, `libraries`, `request`, and `truncated` match the task and you have read the rows or exported envelope. Report the Target Libraries, useful results, and whether the result is complete.

## Commands

| Purpose | Command |
| --- | --- |
| Query items | `zotlit:query [from=items]` |
| Query annotations | `zotlit:query from=annotations` |
| Schema | `zotlit:query-schema [from=items|annotations]` |
| Guide | `zotlit:query-guide [topic=<name>]` |
| Cancel | `zotlit:query-cancel id=<id>` |

Use `zotlit:annotation-image key=<annotation-indexed-key>` to retrieve one applicable Annotation's Excerpt Image.

Use comma lists such as `fields=title,date.year` and `sort=-date,title`. JSON arrays remain accepted. `fields=[]` returns row identities only.

## Libraries and identities

Use the vault's Library scope by default. Use `library=all` for every Library or name Libraries with `library=personal`, `library=group:<groupID>`, or `library=personal,group:<groupID>`. A JSON array is also accepted. Discover group names and IDs from a small `library=all` result. Confirm an ambiguous Library name with the user.

Keep every `indexedKey`. A bare Zotero key is unique only inside its Library; a group Indexed Key ends in `g<groupID>`. Compare source identity before joining separate calls.

Read `zotlit:query-guide topic=filter` before selecting Annotations by Item or Attachment. Select the parent Item with Item Query first when the user names a work without its key.

## Item Query

Use Item Query for metadata, creators, tags, Collections, custom fields, dates, and Attachment presence. Resolve which date the user means before filtering when publication date, date added, or date modified would materially change the result.

For a first author, project `creators` and choose the first entry whose `role` is `author`; `creators[0]` can hold another role. Questions about paper contents need Annotation Query or the source document. Questions about vault notes that cite a work use ZotLit's citation commands.

Read the relevant guide topic:

- `filter`: text, tags, Collection paths, creators, dates, custom fields, and missing values.
- `schema`: the catalog download and local catalog inspection.
- `fields`: Projection Paths and returned shapes.
- `sort`: Sortable Fields, tie order, dates, and limits.
- `results`: envelopes, diagnostics, and exports.
- `cancel`: query IDs and cancellation.

Use `from=attachments` to find files of a paper or broken linked files. Attachment Query reads non-trashed Attachments of top-level, non-trashed Items; `item.` reaches the parent Item. For broken linked files, use `filter='linkMode == "linked_file" && !exists'`; for one paper, use `filter='item.citationKey == "<key>"' fields=title,contentType,path`. Read `zotlit:query-schema from=attachments` for its fields and defaults.

## Annotation Query

Use Annotation Query for highlights, underlines, notes, image regions, ink, and text boxes. Its Filter Expression reads Annotation fields directly and parent Item fields with the `item.` prefix. For example:

```text
type == "highlight" && tags.contains("method") && item.title.contains("Review")
```

Read the live `fields` guide before choosing Projection Paths. Select the values needed for the research task.

Read the relevant guide topic:

- `datasets`: dataset universes, parent paths, and defaults.
- `filter`: Annotation predicates and `item.` fields.
- `fields`: Projection Paths, source files, position shapes, and Excerpt Images.
- `sort`: Sortable Fields, reading order, and limits.
- `results`: envelopes, diagnostics, and exports.
- `cancel`: the shared query ID namespace.

### Source document and position

Read `zotlit:query-guide topic=fields` before opening a source document or interpreting a position. Follow its file availability rules and position conventions. Confirm `attachment.exists` before reporting local availability; read the file before reporting its contents. Request source geometry when the task needs it.

### Excerpt Images

Read `zotlit:query-guide topic=fields` before retrieving an Excerpt Image. When `hasExcerptImage` is true, pass the Annotation Row's `indexedKey` to `zotlit:annotation-image` and read the file at the returned path.

## Completeness, exports, and cancellation

For a sample or top-N request, set the requested limit and sort. Say it is a sample when `truncated` is true. For every match or an exact count, use `limit=all` and require `truncated: false`. For a count alone, `fields='[]'` minimizes the result; `returnedCount` is exact for a complete result.

Read the query results guide before exporting or handling `result-too-large`. Use `output=<absolute-path>` with a new filename in an existing directory. Read the returned `file.path`, verify the full envelope, and report its count and completeness.

For a long query, assign a unique `id`. From a second call to the same vault, run `zotlit:query-cancel id=<id>`. Check the original query's outcome because the cancel response reports only whether it found a running query.

Keep lists and Filter Expressions inside one shell argument with correct shell quoting. Follow live help and schemas for the current parameter names, capabilities, and defaults.
