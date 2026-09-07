# JSON-e property editor

Design interview for JSON-e property highlighting, completion, and property
hover. The user confirmed all design decisions below. The interview is complete;
implementation is recorded below.

## Confirmed direction

Use JSON as the authoring syntax in the JSON-e property editor. This limits
the outer syntax that expression highlighting, completion, and hover must
handle. JSON-e remains the evaluation language.

Prefer established libraries and prior implementations. Research reusable
JSON and JSON-e language tooling before choosing new parsing or editor logic.

Keep implementation small. Use CodeMirror's JSON language support and the
existing shared completion and hover interfaces as the starting point. Add
only JSON-e-specific handling required by the agreed editor behavior. The
full JSON language service is excluded. `codemirror-json-schema` is an allowed
integration option; use its focused APIs where they fit the existing popup
boundary. Dependency and abstraction costs must be justified by a concrete
requirement.

Use JSON-e's `specification.yml` and language-construct documentation as the
language definition. The local checkout at `/Users/aidenlx/repo/json-e` was
inspected at commit `9bb89a791309bcd6f39c4b287c958ddd75641f0c`.
The specification is a shared behavioral test corpus, rather than a JSON
Schema or editor grammar. Derive any editor metadata from those sources and
verify it against relevant upstream cases; editor-specific incomplete-input
and cursor tests supplement the language cases.

Retain the shared semantic core and host-owned popup presentation established
in the [template language design](./issue-947-template-language-design.md).
The web property hover uses shadcn/Base UI and a 500 ms opening delay.

## Confirmed source representation

Store each rule as JSON directly under `value` in the YAML Profile manifest.
The property editor edits that source region, preserving the shared document
and undo history. Incomplete drafts remain in the same source buffer.
This updates [ADR 0032](../adr/0032-web-workbench-edits-one-source-document.md).

Update the fixtures and starter rules to JSON during implementation. The user
confirmed that this beta never shipped, so migration of existing YAML rules
is outside scope.

## Confirmed editor behavior

Provide highlighting, completion, and hover in both the property editor and
Advanced, including Spread Entries. Cover every JSON-e expression location:
`$eval`, interpolation, conditions, and operator-specific expressions.
Ordinary JSON strings retain normal JSON highlighting.

Offer JSON-e operators and their keys, built-in functions, ZotLit helpers,
fields, and local variables. Use schema support for JSON structure and shared
resolution for expression contents. Hover shows documentation and types for
fields, operators, and functions, with field samples where available.

Resolve locals introduced by `$let`, `$map`, `$reduce`, `$find`, and `$sort`
according to upstream scope and shadowing rules. Infer members when the type
is statically clear, such as an author mapped from `zt.authors`. Unknown
values still receive variable-name completion. Each rule has an independent
local scope, isolated from other rules and note templates.

Field acceptance replaces only the current path segment and preserves JSON
quotes, escapes, and the remaining expression. An object or array can be
accepted as a complete value; typing a dot requests applicable members.
Editor bracket handling supplies closing delimiters. Each acceptance is one
undoable edit.

## Library research

The [JSON library comparison](./json-editor-library-options.md) recommends
CodeMirror's JSON language support for the outer syntax. Evaluate
`codemirror-json-schema` for structural suggestions and validation, with the
existing shared candidates for JSON-e expression fields. The user's KISS
constraint excludes Microsoft's JSON language service from this design.

The [JSON-e prior-art review](./json-e-editor-prior-art.md) found no verified
ready-made expression editor service in its bounded search. The official
playground uses textareas, and the runtime parser does not recover incomplete
expressions. If expression parsing is required, prefer an established parser
framework such as Lezer for recovery and incremental parsing. A JSON-e grammar
and ZotLit scope integration would still be new work. These are recommendations,
not settled implementation choices.

## Implementation

Use `@codemirror/lang-json` and `jsonc-parser`. The shared JSON-e resolver owns
expression regions, JSON escape mapping, local scopes, field facts, and exact
completion edits. A small declarative catalog supplies operator and function
documentation from the upstream specification and docs. JSON-e runtime rendering
remains the semantic-validation authority, with strict JSON syntax checked by
the document controller.

A minified ESM probe of `codemirror-json-schema@0.8.1`, with CodeMirror and Lezer
external, produced about 730 KiB across its entry and eagerly loaded Markdown/
Shiki chunks. The parser-only probe was about 12 KiB. The probe is a dependency
comparison, not the final app chunk size. The local reference checkout
`/Users/aidenlx/repo/codemirror-json-schema` at
`806504f922f9582da0c51f4759aa1a1bdfa2cac0` confirms the eager initialization.
The implementation uses the smaller parser/catalog approach under the agreed
KISS constraint.

Property-value and filename editors have an 80 px minimum content height.
Filename values retain the single-line input constraint. The standalone default
Profile has three Liquid properties and one JSON-e property (`citekey`) for
browser verification. Fixture rules and starter rules use JSON directly.
