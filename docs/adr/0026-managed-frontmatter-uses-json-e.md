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

An entry may instead omit `key` — a spread entry: its `value` or `js` member
evaluates to a string-keyed mapping, and every produced key becomes a field
at the entry's position under the entry's single merge strategy. `expr` stays
single-value, so a keyless `expr` entry is a validation error. Inside a
spread mapping, JSON-e's native object semantics carry conditional presence
(a false `$if` omits the key) and dynamic key names (`${}` interpolation),
and a top-level `$let` shares one computation across every produced field.
An omitted key is left untouched; deleting a field stays a static-key
capability. Entries apply as a fold in list order — each entry's merge
strategy combines with the note's value overlaid by the pending patch, so a
later entry wins the value while the first producing entry sets a new note's
key position. A produced key that is reserved or empty refuses the whole
patch; duplicate static keys stay a document-validation error. Diagnostics
name a spread entry by its 1-based list position.

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
- A whole-mapping slot beside the field list carries the list's ordering and
  merge vocabulary into a second subsystem; a keyless entry in the one list
  subsumes it, and a single spread entry as the whole list is that slot.
- Refusing every evaluation-time duplicate key forces a spread template to
  hand-exclude each overridden key; the ordered fold keeps the all-or-nothing
  patch and lets spread defaults compose with targeted static overrides.
- Dynamic-key deletion — a delete sentinel in the mapping, or tracked
  ownership of previously written keys — adds state and rules without a
  motivating case; a static-key JSON-e entry already deletes on absence.

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
  pinned `now`, and the three host functions. A spread entry renders under
  the same envelope: a missing envelope property makes the whole entry an
  empty patch, and a present non-mapping result refuses the operation.
- A `js` spread entry with the JavaScript Templates gate off refuses by entry
  position, since its keys are unknowable while inert.
- Conversion is untouched: legacy settings fields convert to static-key
  entries only, and the built-in default document ships static `expr`
  entries.
