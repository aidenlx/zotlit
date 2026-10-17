# Vault properties are answered outside ZotLit Query, and `limit` counts the rows the researcher sees

A Query View property `vault.<name>` is a vault property: the value of the frontmatter key `<name>` on the Item's Literature Note. The Literature Note Property, `vault.literatureNote`, is the first of them. The plugin answers vault properties from the vault; `@zotlit/item-query` never reads them. The Query View leaves every vault property out of the fields, the sort and the filter it sends to ZotLit Query, and its request planner keeps the vault sort keys and the vault conditions apart from the engine request.

`limit` counts the rows the researcher sees. ZotLit Query applies the filter, the sort and the limit itself and hydrates only the rows it returns, so a vault sort or a vault filter is planned before the engine runs: a vault sort runs the request without a limit and truncates after it sorts, and a vault filter becomes an inclusion or exclusion list of Indexed Keys in the engine filter. The plugin never sorts or filters the rows of a limited query after they come back.

Proposed on 2026-10-17 with [#1531](https://github.com/aidenlx/zotlit/issues/1531).

## Considered Options

- **A vault dataset or a vault field inside `@zotlit/item-query`** (rejected): the engine reads the Zotero database in a worker and has no access to the vault's metadata cache; it would need a second data source and a new request shape for one plugin feature.
- **Sort or filter the returned rows after the engine runs** (rejected): the engine has already applied `limit`, so "the first 20 unread" would show fewer than 20 rows, or the wrong 20.

## Consequences

- A vault predicate must be a top-level `and` condition of a view's filters; the planner takes these apart from the filter ZotLit Query runs. A vault predicate that cannot be split from the Zotero part gets a diagnostic instead of a client-side evaluation.
- A vault sort over a large library stops at a fixed cap of engine rows and shows the truncation indicator.
- Later work on `@zotlit/item-query` keeps `vault.` out of its own namespace.
