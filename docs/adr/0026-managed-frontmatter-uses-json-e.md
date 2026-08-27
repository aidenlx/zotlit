# Managed Frontmatter uses JSON-e

Managed Frontmatter needs one language that can return native frontmatter
values, construct nested data, transform arrays and mappings, and control
conditional field presence. The new format uses JSON-e as its full templating
engine. Each ordered field keeps a static `key` and merge strategy and supplies
one JSON-e `value`; JSON-e `$if` expresses conditional absence, so the new
format has no separate `language` or `when` member. The evaluator renders the
value under an engine-owned envelope property, where an omitted property means
absent and an own property containing `null` means explicit null.

## Considered options

- A Liquid `result` tag preserves existing expressions but cannot construct
  general nested data with one value expression.
- Liquid rendered to YAML adds a text round-trip and a second parser boundary.
- JSONata has stronger query features but adds recursion, sequence-shape rules,
  and more runtime guardrails than Managed Frontmatter requires.
- A multi-language new format keeps migration easy but expands the permanent
  interface with language selection and two conditional-presence paths.

## Consequences

- Existing Liquid and JavaScript fields are migration inputs, not languages in
  the new field format.
- The JSON-e adapter owns the omission envelope, output-domain validation, and
  the small set of host functions exposed to templates.
- The merge result needs an explicit absent operation: `replace` deletes an
  existing managed key, while `append` and `keep` preserve it.
