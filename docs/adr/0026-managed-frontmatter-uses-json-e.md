# Managed Frontmatter uses JSON-e

Managed Frontmatter needs native frontmatter values, nested construction, and
conditional field presence, while existing Liquid and JavaScript expressions
keep working unchanged. Each ordered field entry keeps a static `key` and a
merge strategy (default `replace`) and declares exactly one value member, and
the member name declares the language: `expr` holds one Liquid value
expression for basic usage, `value` holds one JSON-e template for advanced
usage, and `js` holds one JavaScript expression as the escape hatch behind the
per-device JavaScript Templates gate. The format has no `language` or `when`
member.

JSON-e is the sole engine for structural construction and conditional absence.
The evaluator renders each JSON-e value under an engine-owned envelope
property, where an omitted property means absent and an own property
containing `null` means explicit null. A Liquid or JavaScript member that
returns `undefined` leaves the existing value untouched, preserving legacy
field behavior verbatim. The JSON-e context exposes `zt` and three audited
host functions — `has`, `uniq`, `basename` — for what the operator language
cannot reasonably express; plucking, flattening, and branching use JSON-e
operators.

## Considered options

- A JSON-e-only field format (this record's first edition) makes every legacy
  Liquid and JavaScript expression a migration input needing a rewrite; the
  three-tier format converts by structure and never rewrites an expression.
- A `language` member beside a polymorphic value carries the same information
  the member name already does, with more boilerplate.
- An optional `when` member on Liquid and JavaScript entries restores two
  conditional-presence paths; absence stays a JSON-e capability.
- A Liquid control-flow escape hatch (render-then-parse YAML, or a custom
  `result` tag) adds a text round-trip and a fourth dialect; control flow is
  the JSON-e tier's job.
- Five host functions (adding `map` and `flatten`) mirror the Liquid filter
  pipeline, but the `$map` and `$flatten` operators already cover both.

## Consequences

- The merge result needs an explicit absent operation: `replace` deletes an
  existing managed key, while `append` and `keep` preserve it. Only a JSON-e
  value can produce the absent state.
- Legacy settings fields convert structurally — key, merge, order, and
  expression strings verbatim; `language: liquid` becomes `expr` and
  `language: javascript` becomes `js` — so conversion never refuses a field.
- `js` entries stay inert while the JavaScript Templates gate is off; the
  operation is refused with the inert keys named, never partially applied.
- The JSON-e adapter owns the omission envelope, the shared output-domain
  validation (a depth-capped walk that doubles as the cycle check), the
  pinned `now`, and the three host functions.
