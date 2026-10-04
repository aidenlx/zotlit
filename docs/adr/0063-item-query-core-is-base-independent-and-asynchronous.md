# Item query core is Base-independent and asynchronous

The `@zotlit/item-query` core accepts one query over top-level, non-trashed Zotero Items and returns one result set. It exposes related creators, tags, collections, and attachment presence as Item properties, but it does not own Base files, global filters, named views, or filter inheritance. A future Base feature can adapt its document model into query-core calls.

The core interface is asynchronous and supports cancellation and chunked hydration from its first release. SQL lowering selects a sound candidate superset, and the Filter Expression evaluator remains the result authority. This design gives the Obsidian CLI a responsive, agent-friendly query surface without creating a synchronous interface that the next phase must replace.
