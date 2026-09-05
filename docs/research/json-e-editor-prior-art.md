# JSON-e editor prior art

Research date: 2026-09-05. Scope: JSON-e-specific editor, grammar, completion,
and parser reuse. This is a research result, not an implementation decision.

## Result

The inspected JSON-e projects provide established rendering implementations and
language tests. I did not find a verified JSON-e editor language service or
recovering editor grammar in this search. This is a bounded search result,
not proof that none exists. The official playground itself uses plain
textareas, ordinary YAML highlighting for code blocks, and the renderer.
See [playground source](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/docs/jsone.js).

Reuse the installed renderer for semantics and validation. For editing, prefer
an established parser framework with recovery over extending the runtime
parser with custom recovery. A small JSON-e expression grammar would still
be new work; Lezer supplies parsing machinery, not JSON-e-specific rules.

## Search boundary

Primary sources inspected:

- Official JSON-e repository, current `main` resolved through GitHub API to
  `9bb89a791309bcd6f39c4b287c958ddd75641f0c`: repository tree, playground,
  JavaScript package/source, Rust public surface and parser.
- Installed `json-e@4.8.4`, resolved from `packages/templates`: public type
  declaration, parser, tokenizer, interpreter, and renderer entry point.
- Official JSON-e language/operator documentation and the linked .NET
  implementation's public API.
- Lezer's own guide and CodeMirror's language-package example.

Web queries included quoted `json-e` with `syntax highlighting`,
`language server`, and `editor playground`. GitHub repository searches for
quoted `json-e` with `codemirror`, `grammar`, or `language` returned no relevant
candidate; a VS Code search returned unrelated JSON viewers. Repository search
does not cover every implementation hidden within a larger repository.

## Concrete prior art

| Source | Proven capability | Limit for this task |
| --- | --- | --- |
| Official JSON-e playground | Parses YAML with js-yaml, renders with JSON-e, reports errors | Inputs are textareas; no JSON-e token completion or hover implementation in this source |
| JSON-e JavaScript implementation | Runtime tokenizer, AST, expression parser, evaluator, operator implementation | Public package API exposes rendering; parser has no recovery output for incomplete editing |
| JSON-e Rust implementation | Runtime parser with `parse_all` and `parse_partial` | Parser is crate-private; partial means return an unconsumed suffix, not editor error recovery |
| JsonE.Net | `Evaluate(JsonNode template, JsonNode context)` | Inspected public class documents evaluation, not an editor service |
| rjsone | CLI wrapper around JSON-e | Its author describes ordinary YAML/JSON editor highlighting; no JSON-e-specific editor claim |

Sources: [official playground](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/docs/jsone.js),
[JavaScript entry](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.js),
[Rust parser](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/rs/src/interpreter/parser.rs),
[Rust visibility](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/rs/src/interpreter/mod.rs),
[JsonE.Net API](https://docs.json-everything.net/api/JsonE.Net/JsonE/),
[rjsone author documentation](https://wryun.github.io/rjsone/).

The official repository links JsonE.Net as another implementation and lists
Taskcluster as a consumer. These are leads for rendering behavior, not evidence
of editor services. [Official README](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/README.md)

## Upstream JavaScript parser: what can be reused

The installed package exports its renderer through `src/index.js`, with a
browser bundle at `dist/index.js`. Its type declaration describes that one
function. `src/parser.js` exports a CommonJS `Parser` class, but this is a deep
internal module rather than a documented package-level parse API. The configured
tokenizer and `parse`/`parseUntilTerminator` wrappers remain private in the
renderer module. Deep-importing `Parser` therefore still requires supplying
token configuration and taking responsibility for an internal interface.
See [package metadata](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/package.json),
[public types](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.d.ts),
[parser](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/parser.js), and
[private tokenizer setup](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.js).

The tokenizer produces token start/end offsets, and AST nodes retain tokens.
These are useful source facts. The parser is recursive descent and expects
valid complete constructs; it does not emit a recoverable error tree. It also
operates on decoded expression strings, so it cannot supply original YAML or
JSON source offsets by itself.
[Tokenizer](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/tokenizer.js),
[AST](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/AST.js),
[parser](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/parser.js).

A read-only Node probe called the installed renderer with `{$eval: expression}`
and `{zt: {title: 'Paper'}}`:

| Expression | Observed result in installed 4.8.4 |
| --- | --- |
| `zt.title` | `Paper` |
| `zt.` | `SyntaxError: Unexpected end of input` |
| `zt[` | `TypeError: Cannot read properties of null (reading 'kind')` |
| `len(` | Same `TypeError` |
| `zt.title +` | Same `TypeError` |

These probes establish that swallowing parser exceptions would lose the exact
states completion needs. They do not establish every malformed-input behavior.
The authoritative local source was
`node_modules/.pnpm/json-e@4.8.4/node_modules/json-e/src/`.

## Reuse recommendation

1. Keep JSON-e as the rendering and semantic-validation authority. Use its
   committed [cross-implementation specification](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/specification.yml)
   as a compatibility oracle when deciding expression syntax.
2. Reuse the existing YAML/JSON language support for the outer document. Its
   syntax tree can identify candidate scalar/key regions; a JSON-e layer still
   needs operator-sensitive region classification and decoded/source mapping.
3. If no suitable JSON-e grammar is found in further leads, define only the
   expression grammar on Lezer. It provides incremental trees, token positions,
   error nodes, and built-in recovery. This avoids implementing those mechanisms
   locally. It does not infer JSON-e scopes or field types.
   [Lezer guide](https://lezer.codemirror.net/docs/guide/),
   [CodeMirror language-package guide](https://codemirror.net/examples/lang-package/).
4. Keep JSON-e scope inference and contract traversal independent of the host
   popup. The same resolver can supply web and Obsidian completion and hover.
   This is ZotLit-specific integration rather than a capability proven in the
   inspected prior art.

I recommend against adopting the internal runtime parser as the editor's only
parser, or writing an ad hoc recovering parser around it. Its best reuse is
authoritative syntax, evaluation, and tests. A Lezer grammar remains a proposal
to assess against the final required feature scope, not a claim that an existing
JSON-e Lezer package has been found.

## Local upstream definition checked

The user supplied `/Users/aidenlx/repo/json-e`. Its verified HEAD is
`9bb89a791309bcd6f39c4b287c958ddd75641f0c`, the same commit cited above.
`CLAUDE.md` points to `CONTRIBUTING.md`; both were read. The contribution guide
explicitly names `specification.yml` as the language's single source of truth
and requires all implementations to satisfy the same cases.
[Local guide](/Users/aidenlx/repo/json-e/CONTRIBUTING.md:66).

A read-only YAML parse counted **1,175 cases in 36 sections**, including
**467 cases with an error expectation**. This is a multi-document behavioral
corpus, not a declarative grammar or JSON Schema. Each case supplies a title,
context, template, and result or error. The JS loader groups sections, freezes
time, compares results, and distinguishes `error: true` from a specific error
string. [Spec contract](/Users/aidenlx/repo/json-e/specification.yml:1),
[test loader](/Users/aidenlx/repo/json-e/js/test/specification_test.js:13).

Reusable metadata is limited: `js/src/builtins.js` defines argument types,
minimum counts, variadic behavior, and context requirements through a local
`define` helper, but exports wrapped functions rather than those descriptors.
Operator property rules live inside renderer handlers. The language documents
and these implementation tables can seed a reviewed editor catalog; there is
no inspected exported catalog to import directly.
[Builtin definitions](/Users/aidenlx/repo/json-e/js/src/builtins.js:21),
[operator handlers](/Users/aidenlx/repo/json-e/js/src/index.js:85).

Concrete grammar and mapping cases to retain:

- JSON-e strings have **no escaping**, including backslash and doubled-quote
  escaping. YAML/JSON decoding remains a separate layer. Decimal numbers are
  valid; hexadecimal literals fail.
  [Cases](/Users/aidenlx/repo/json-e/specification.yml:2649),
  [language definition](/Users/aidenlx/repo/json-e/docs/src/expressions.md:18).
- `${…}` may contain an object literal and braces inside a quoted expression
  string. A first-closing-brace scanner is insufficient. Repeated dollar signs
  also have specified escaping behavior, rather than a general parity rule.
  [Nested object interpolation](/Users/aidenlx/repo/json-e/specification.yml:61),
  [escape and brace cases](/Users/aidenlx/repo/json-e/specification.yml:80).
- Exponentiation is right-associative; membership has specified precedence
  relative to Boolean operators. Keep these rules if type inference inspects
  expression structure.
  [Exponentiation](/Users/aidenlx/repo/json-e/specification.yml:2992),
  [membership](/Users/aidenlx/repo/json-e/specification.yml:5298).
- String indexing/slicing counts Unicode code points. Editor offsets can remain
  UTF-16, but sample value lookup must implement runtime index semantics.
  [Index case](/Users/aidenlx/repo/json-e/specification.yml:4526),
  [slice case](/Users/aidenlx/repo/json-e/specification.yml:5022).
- `__proto__` is a valid own-property name in literal objects and interpolated
  keys. Contract lookup must preserve own keys without treating inherited
  JavaScript properties as fields.
  [Literal cases](/Users/aidenlx/repo/json-e/specification.yml:6007).

Test reuse proposal: pin the upstream revision and keep selected original case
titles when importing fixtures. Use successful expression cases as grammar
acceptance examples; add hand-derived editor ranges and candidates separately.
Classify error cases first: evaluation/type errors are often valid syntax and
must not be treated as parser rejections. Use the full corpus when changing
runtime semantics; its render assertions alone do not validate highlighting,
completion, or hover. Add dedicated incomplete-source and YAML/JSON offset
fixtures because those editor behaviors are outside the behavioral corpus.
Keep any fixture copy or test dependency inside this workspace; tests must not
depend on the developer's absolute external checkout path.

## KISS constraint

The user's latest constraint favors a small implementation. Start with
`@codemirror/lang-json` for a JSON outer editor and the existing shared contract
and completion core. Keep the existing YAML language where the surface permits
YAML. A full schema language service is not the default. Add only the JSON-e
region and expression handling required by the selected scope. The Lezer
grammar discussed above is a conditional option when those requirements prove
it useful, not a requirement to build full-language tooling before shipping.

The user permits `codemirror-json-schema`. It can be considered for outer JSON
operator keys and structural validation if that is the selected scope. It does
not establish that upstream supplies a JSON-e schema. A tracked-tree search at
the verified upstream commit found `specification.yml` and expression docs,
but no file named for a schema or grammar. The inspected JS loader executes
the behavioral cases; it does not generate JSON Schema. A schema for this editor
would therefore be locally maintained or generated by new tooling, not an
existing upstream artifact established by this research.

For minimal expression support, take identifier rules, quoted strings,
property/bracket access, interpolation boundaries, and builtin names from the
language docs and tested cases. Keep the upstream renderer responsible for
evaluation. Decide which expression positions and incomplete edits must work
before choosing between bounded context recognition and a grammar; operator
key completion alone does not justify a complete expression parser.
