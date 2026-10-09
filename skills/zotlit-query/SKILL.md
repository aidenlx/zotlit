---
name: zotlit-query
description: "Query Zotero works, files, and reading marks through ZotLit in Obsidian. Use for literature reviews, reading plans, missing PDFs, broken linked files, duplicate PDFs, Annotation evidence, counts by paper or year, and complete exports."
metadata:
  cli-contract-version: "3"
---

# ZotLit Query

## Choose what the answer lists

Use `zotlit:query` with the Query Dataset that gives one row per thing the researcher wants:

| Research task | Start from | Reach related records |
| --- | --- | --- |
| List works, including works without files or marks | `from=items` (default) | `attachments`, `annotations` |
| List files, check availability, repair links | `from=attachments` | `item`, `annotations` |
| Read highlights, notes, or other marks | `from=annotations` | `item`, `attachment` |

Items are top-level records outside the trash. Attachments belong to those Items; Annotations belong to those Attachments. Each level excludes trashed records. Standalone Attachments and their marks are outside all three Query Datasets.

## Discover, query, verify

1. Select the vault; use `obsidian vaults` if needed. Put `vault=<name-or-id>` before every Obsidian command.
2. Read `zotlit:query-guide` and `zotlit:query-schema`. These live commands are the source of truth. Check `contractVersion` against this skill and follow the live guide if it differs. Confirm `identity.vault` and `identity.source`.
3. Follow guide topic `schema` to save the version-pinned catalog. It contains `datasets.items`, `datasets.attachments`, `datasets.annotations`, and shared language definitions. The live answer adds custom fields and defaults; `from=` narrows it. Reuse the catalog while its URL is unchanged. Inspect relevant entries locally before guessing a field or capability.
4. Set Target Libraries, the filter, returned fields, order, and completeness for the research task. Read the relevant guide topic: `datasets`, `filter`, `fields`, `sort`, `group`, `results`, `schema`, or `cancel`.
5. On failure, read `diagnostic.report`, its marked location, and its recovery action before retrying. A shell exit of zero does not prove success: require `ok: true`. Read Query Warnings before treating an empty result as evidence. Correct a type mismatch or an out-of-scope key, then verify the new answer. Retry a transient failure once and report a repeated failure.
6. Complete when `identity`, `libraries`, `request`, and `truncated` match the task and you have read the rows or exported envelope. Report the useful results, Target Libraries, and completeness.

## Cross from works to files and marks, or back

An Item's `attachments` and `annotations`, and an Attachment's `annotations`, are Relation Lists of records. In a filter, list methods bind `value` to each record. Parents are single records reached with dotted paths. Start from the desired answer, then follow these paths in either direction.

Works → files: list papers with no usable PDF on this machine, including papers with no files:

```sh
obsidian vault=Research zotlit:query from=items 'filter=attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()' 'fields=title,attachments[].path' limit=all
```

Marks → works: read highlights tagged method on papers by Rougier:

```sh
obsidian vault=Research zotlit:query from=annotations 'filter=type == "highlight" && tags.contains("method") && item.creators.contains("Nicolas P. Rougier")' fields=text,comment,item.title,attachment.path limit=all
```

The same rule supports `annotations.filter(value.type == "highlight").isEmpty()` on Items and `item.citationKey == "rougierTenSimpleRules2014"` on Attachments. An empty Relation List is falsy: `!attachments` means no Attachment. Nest list methods to navigate further.

## Select and project

Choose Libraries with `library=personal`, `library=group:<groupID>`, a comma list, or `library=all`. Omission uses Library Scope. Keep each `indexedKey`; project `library` when the answer needs Library identity.

Select by filter equality: `indexedKey == "ART2FULL"`, `item.indexedKey == "ART2FULLg118"`, or `attachment.indexedKey == "QANPDF22g118"`. Use `["ART2FULL","ART2FULLg118"].contains(indexedKey)` for several records. Combine selection with other conditions using `&&`. An Indexed Key without a suffix names My Library; `key == "ART2FULL"` matches that bare key in every Target Library. A key never widens scope: include its Library in `library` and check warnings.

Use comma lists: `fields=title,date.year` and `sort=-date,title`. JSON arrays also work; `fields=[]` returns identities only. Quote each shell argument that contains spaces or brackets.

Use explicit `[]` to cross a list in projection: `attachments[].path` or `attachments[].annotations[].text`. Positions stay aligned and missing values stay null. `attachments.path` does not cross a list. Request specific paths for details. Whole records have fixed summaries:

- Item: `indexedKey`, `title`, `citationKey`.
- Attachment: `indexedKey`, `title`, `contentType`, `linkMode`, `path`, `exists`.
- Annotation: `indexedKey`, `type`, `text`, `comment`, `pageLabel`, `pageIndex`.

For a first author, project `creators` and select the first entry with `role: "author"`; the first creator can be an editor. Use the schema's Sortable Fields. Relation-derived values such as `annotations.length` can be projected but cannot sort a result.

## Counts, files, and complete results

Use `group=date.year` for papers by year, `from=attachments group=contentType` for files by type, and `from=annotations group=item.indexedKey` for marks per paper. Grouping uses a scalar Projection Path and returns `groups: [{ value, count, rows }]`, ordered by value with null last. `limit` applies within each group; `count` and `totalCount` describe matches before that limit. To include papers with zero marks, start from Items and project `annotations.length`.

For all matches, use `limit=all` and verify `truncated: false`. For a sample, set a limit and state that it is a sample. For an ungrouped exact count, use `fields=[] limit=all` and read `returnedCount`.

Read guide topic `results` before export. Use `output=<absolute-path>` with a new filename in an existing directory, then read the complete envelope at `file.path`. JSON is the query output; convert a verified export locally if the researcher needs another format.

For source files, request `path` and `exists` on Attachments, or `attachment.path` and `attachment.exists` on Annotations. A web link can have no local file. Read guide topic `fields` before interpreting Annotation positions or opening files. Read the file before describing its contents. For an Excerpt Image, verify `hasExcerptImage`, call `zotlit:annotation-image key=<annotation-indexed-key>`, and read the returned file.

For a long query, supply a unique `id`. Cancel from another call to the same vault with `zotlit:query-cancel id=<id>` and check the original query's outcome.
