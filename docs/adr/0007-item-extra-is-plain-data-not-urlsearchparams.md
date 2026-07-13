# `ItemExtra` is plain data, not a `URLSearchParams`-like object

Zotero's `extra` field is parsed into `ItemExtra` — a plain object of `{ raw, fields, lines }` (records, arrays, and primitives, plus a non-enumerable `toString` that returns `raw`) — rather than a class exposing `get()` / `getAll()` / `has()` methods. We kept the `URLSearchParams` *semantics* (first-wins lookup via `fields[key]`, duplicates preserved in `lines`) but dropped the *method surface* because the two consumers of `zt.extra` cannot use methods: Liquid templates read properties only (no method calls), and the Template Data Explorer renders any non-`Object.prototype` value as an opaque, non-expandable string and every method as a noise "helper" row. Plain data stays directly indexable in Liquid, Eta, and JS, and expandable in the explorer.

## Consequences

- Bare `{{ zt.extra }}` / `<%= zt.extra %>` still print the raw field text, because the non-enumerable `toString` returns `raw` — so changing the `zt.extra` contract from `string` to an object is print-compatible, and the explorer shows a collapsed one-line raw preview.
- "Get all values for a repeated key" is not a method; consumers scan `lines`. This was accepted as the rare case in exchange for a friction-free common-case lookup (`fields[key]`).
