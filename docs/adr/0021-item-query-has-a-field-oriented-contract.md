# Item Query has a field-oriented contract

`@zotlit/item-query` accepts one full Filter Expression for selection. Projection accepts documented template-style accessors, sorting accepts top-level scalar Item fields, and each result row contains only the selected values plus the Item's Indexed Key. This contract gives human and agent callers predictable data without exposing the database Item structure or introducing computed-column syntax.

The evaluator adopts the proof of concept's ZotLit-owned semantics for field aliases, custom fields, relations, partial dates, Temporal values, null propagation, and functions. Obsidian Bases compatibility is not part of the contract.

Query Rows use ZotLit's template base-data vocabulary. Item Query extends it with collections, attachment presence, and a `custom` object that preserves exact custom-field names without colliding with reserved fields. Its wire adapter serializes Temporal values as ISO strings. This preserves source values such as `date.raw` while allowing precise Projection Paths such as `date.year`.

Filtering, projection, and sorting have explicit capability vocabularies. Filters retain the proof of concept's evaluator values, including string lists for creators, tags, and collections. Projection exposes the richer template base-data structures. Sorting accepts top-level scalar fields only. The query schema states which operations each field or path supports.

Filter requests are validated against that schema before database execution. An unknown field, function, or unsupported capability fails the complete query, while a known field that one Item lacks evaluates as null. Arbitrary custom-field names use `custom["exact source name"]`; identifier-safe, non-colliding custom fields can also retain their bare-name filter form.

Each Query Row has the shape `{ indexedKey, values }`, where `values` is a flat map keyed by the requested Projection Paths. Paths use the template accessor grammar: dotted identifier access, numeric array indexes, and JSON-quoted brackets for arbitrary keys. Array access is exact and does not vectorize implicitly.

Every requested Projection Path is present in `values`. A missing scalar, custom value, or array element is null, while an Item with no values for a requested relation list returns an empty list. A path that the schema does not define is a request error.
