---
name: zotlit-query
description: "Query Zotero works, files, and reading marks through ZotLit in Obsidian. Use for literature reviews, reading plans, missing PDFs, broken linked files, duplicate PDFs, Annotation evidence, counts by paper or year, and complete exports."
metadata:
  cli-contract-version: "3"
---

# ZotLit Query

## Discover, query, verify

1. Select the researcher's vault. Read Obsidian CLI help for vault targeting and use that vault for every call.
2. Read `zotlit:query-guide` and `zotlit:query-schema` before composing the query. Compare the answer's `contractVersion` with this skill's pin. Follow the live guide when they differ, and confirm the vault and Zotero source identities.
3. Follow `zotlit:query-guide topic=schema` to save and inspect the catalog. Reuse it while its URL is unchanged. Check each needed field and capability in the catalog, including custom fields from the live schema answer.
4. Choose the Target Libraries and the shape of the answer from the research task. Use the guide topics below to write the request. Read Collection or Tag names with `zotlit:query-values` before filtering by them.
5. Require a successful envelope, then read its Query Warnings. Read the Diagnostic Report and its recovery action before correcting a failed call. Retry a transient failure once and report a repeated failure.
6. Complete when the source identity, Target Libraries, normalized request, and completeness match the task and you have read the returned evidence. Report useful results with their scope and completeness.

## Plan the research task

Start with what one row should represent. Read `zotlit:query-guide topic=datasets` for the current universes and the paths between them.

| Research task | Starting dataset |
| --- | --- |
| Plan reading, find missing PDFs, or list papers without marks | Items |
| Check file availability or identify broken links and duplicate PDFs | Attachments |
| Read highlights, notes, or other reading evidence | Annotations |

For a question about papers that depends on their files or marks, keep the answer at paper level and use related records as evidence. Read `zotlit:query-guide topic=filter` for Relation List navigation, key selection, and Library scope warnings. Include papers with no related evidence when the question asks what remains unread or unavailable.

For an export, choose the details the researcher needs to read or compare. Read `zotlit:query-guide topic=fields` for record summaries and list projection, and `zotlit:query-guide topic=sort` for the available ordering. Keep record identities in the evidence so results can be traced back to Zotero. Select the first creator with the author role when the researcher asks for a first author; an editor can be first in the creator list.

For counts by paper, year, file type, tag, or Collection, choose the population first. Start from Annotations to count marks, Attachments to count files, or Items to count papers. When a count per paper must include papers with no marks, start from Items and read each paper's mark count. Read `zotlit:query-guide topic=group` for grouping, limits, and result fields. The count is done when every reported number comes from the envelope you read and completeness is verified; describe a bounded sample as a sample.

## Read and deliver evidence

Read `zotlit:query-guide topic=results` before a complete export or format conversion. Read the exported envelope and verify it before converting it locally to the researcher's requested format.

For source files and Excerpt Images, read `zotlit:query-guide topic=fields` for the file and image workflow. Check availability on this machine, and read a file or image before describing its contents.

Read `zotlit:query-guide topic=cancel` before starting a long query. If the task changes, cancel the outstanding query and check its final outcome.
