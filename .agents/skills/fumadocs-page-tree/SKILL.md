---
name: fumadocs-page-tree
description: |
  Structure a Fumadocs page tree — content folders, meta.json, slugs, sidebar. Use when adding,
  moving, or reordering doc pages under a content directory, editing a meta.json, creating
  sidebar sections (folder groups, clickable section headers), or controlling sidebar expansion.
---

# Fumadocs page tree

Page URLs and the sidebar both derive from the content directory layout plus per-folder `meta.json`. This file covers the load-bearing rules and the traps; verify anything beyond it against the local checkout `~/repo/fumadocs` — conventions in `apps/docs/content/docs/headless/page-conventions.mdx`, ground truth in `packages/core/src/source/plugins/slugs.ts` (slugs) and `packages/core/src/source/page-tree/builder.ts` (tree). In this repo `fumadocs-ui` is aliased to `@fumadocs/base-ui` (`packages/base-ui` in the checkout); the layout API is identical.

## Slugs

- `dir/page.mdx` → `/docs/dir/page`; `dir/index.mdx` → `/docs/dir`.
- A parenthesized folder `(name)/` is **slug-transparent**: stripped from slugs, so children keep parent-level URLs. Use it for sidebar-only grouping.
- Each URL may appear once in the entire tree — duplicates are an error by design.

## meta.json

Folder fields: `title`, `icon`, `description`, `defaultOpen`, `collapsible`, `root`, `pages`, `pagesIndex`.

`pages` entry syntax:

| Entry           | Meaning                                             |
| --------------- | --------------------------------------------------- |
| `"page"` / `"dir"` | path to a page or folder (relative paths allowed) |
| `"(group)"`     | folder group, referenced by its literal name        |
| `"---Label---"` | separator (icon form: `---[Icon]Label---`)          |
| `"[Text](url)"` | link; `external:[Text](url)` marks it external      |
| `"..."` / `"z...a"` | remaining items, alphabetical / reversed        |
| `"...dir"`      | inline a folder's items into this level             |
| `"!item"`       | exclude from `...`                                  |

- `pages` is **exhaustive**: once present, unlisted items are dropped unless `...` appears. Use an explicit array to pin sidebar order.
- `"root": true` makes a root folder: rendered as layout tabs, and only the active root's items are visible.

## Clickable section header (folder index)

A folder containing an `index` page attaches it as the folder's own link: the header becomes clickable and the index leaves the child list.

- Keep `pages` free of `"index"` — the index auto-resolves. Listing it demotes the folder to a plain label with the index as an ordinary child row (`builder.ts` deletes `node.index` when `pages` claims it).
- `pagesIndex` overrides which page (or `[Text](url)` link) serves as the folder's index.
- Slug-transparent group + index composes into "section header linking to a parent-level URL": `(intro)/index.mdx` gives a clickable **Intro** header → `/docs`, with siblings like `(intro)/install.mdx` → `/docs/install`.

## Sidebar expansion

- `<DocsLayout sidebar={{ defaultOpenLevel: n }}>` — a folder starts open when `defaultOpenLevel >= depth` (top-level folders are depth 1) or when it contains the active page. Default `0`: everything starts collapsed.
- Per-folder overrides in its `meta.json`: `defaultOpen: true` opens one folder; `collapsible: false` pins it open with no toggle.
