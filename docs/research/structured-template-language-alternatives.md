# Structured template language alternatives for Managed Frontmatter

Research note for [issue #864](https://github.com/aidenlx/zotlit/issues/864).
This note complements
[`managed-frontmatter-engine-evaluation.md`](managed-frontmatter-engine-evaluation.md).
Drafted 2026-08-27 from repository commit
`92ee43825c0bf0759b7e0e11ec4324fcddc9c4bd`.

This note answers one question: can a template language return a native scalar,
array, or mapping without rendering text and parsing that text as YAML?

## Sources and method

The comparison uses first-party language specifications, implementation source,
security advisories, package metadata, and the ZotLit source at the commit above.
The local probes used ZotLit's installed LiquidJS 10.27.1
(`packages/templates/package.json:35`). Package `dist.unpackedSize` values come
from the official npm registry on 2026-08-27. They are install-footprint proxies,
not final bundled byte counts ([npm registry package metadata
format](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md)).

## Verdict

Use **JSON-e** for the new Managed Frontmatter field syntax, as settled in
[ADR 0026](../adr/0026-managed-frontmatter-uses-json-e.md). Its template,
context, and result are data structures, `$eval` returns native data, and its
iteration is bounded
([JSON-e introduction](https://json-e.js.org/introduction.html), [language
reference](https://json-e.js.org/language.html), [operators](https://json-e.js.org/operators.html)).
Put conditional presence in the value template and omit a separate `when`
member. The adapter must render the user value under an envelope key so JSON-e
omission stays distinct from explicit `null`; the details are in
[JSON-e conditional presence](#json-e-conditional-presence).

Keep the Liquid `{% result expression %}` prototype as migration research for
existing fields. It preserves existing Liquid expressions and filters, but it
does not define the preferred new syntax. A field render through this bridge
must execute exactly one `result` tag and may otherwise emit only whitespace
([custom-tag value parsing](https://liquidjs.com/tutorials/parse-parameters.html),
[`Context` registers](https://liquidjs.com/api/classes/Context.html),
`packages/templates/src/frontmatter.ts:109-114`).

Use **JSONata** only when advanced query and transformation power is a product
requirement. JSONata can construct any JSON result and has a first-party browser
runtime, but it is Turing-complete, has sequence-shape rules that can collapse a
one-item result to a scalar, and needs explicit stack, time, sequence, and regular
expression guardrails ([JSONata result construction](https://docs.jsonata.org/construction),
[processing model](https://docs.jsonata.org/processing), [guardrails](https://raw.githubusercontent.com/jsonata-js/jsonata/master/docs/guardrails.md)).

CEL, JMESPath, and Jsonnet each miss a core product constraint. CEL is a strong
safe expression language but is not a template language. JMESPath is a compact
query and reshape language but has limited construction and control flow.
Jsonnet is a strong configuration language but lacks a first-party JavaScript
binding and its official implementation warns against untrusted programs
([CEL overview](https://cel.dev/overview/cel-overview), [JMESPath
specification](https://jmespath.org/specification.html), [Jsonnet language
reference and scope](https://jsonnet.org/ref/language.html), [Jsonnet repository
security note](https://github.com/google/jsonnet)).

## Decision matrix

| Option | Native output | Control and construction | Obsidian TypeScript runtime | Migration | Decision |
| --- | --- | --- | --- | --- | --- |
| Liquid `result` tag | Yes; the tag evaluates a LiquidJS `Value` and stores the JavaScript value in `Context` ([custom-tag value parsing](https://liquidjs.com/tutorials/parse-parameters.html), [`Value` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32), [`Context` registers](https://liquidjs.com/api/classes/Context.html)) | Liquid tags select one result. Liquid expressions cannot directly write general array or object literals ([LiquidJS `Value` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32)). | Existing pure-JavaScript dependency with browser support and TypeScript declarations ([LiquidJS repository](https://github.com/harttle/liquidjs)). | Lowest; existing value expressions and filters stay valid (`packages/templates/src/frontmatter.ts:109-114`). | Migration bridge. |
| Liquid `keepOutputType` | Yes, only when one non-string value is the isolated output ([emitter source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/emitters/keeping-type-emitter.ts#L4-L18)). | Standard Liquid tags work, but extra text or a second output converts the result to text ([emitter source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/emitters/keeping-type-emitter.ts#L7-L17)). | No new dependency. ZotLit's configured `outputEscape` converts each output to a string first (`packages/templates/src/liquid.ts:213-229`, `packages/templates/src/coerce.ts:3-21`). | Low, but it needs a separate engine without ZotLit's Markdown output coercion. | Useful implementation reference; the `result` tag has a cleaner contract. |
| JSON-e | Yes; templates, contexts, and results use JSON values, and `$eval` may return any structure ([language reference](https://json-e.js.org/language.html), [`$eval`](https://json-e.js.org/operators.html)). | `$if`, `$switch`, `$let`, `$map`, `$reduce`, merging, and omission operate on the structure ([operators](https://json-e.js.org/operators.html)). | Official JavaScript and browser implementation with included types ([using JSON-e](https://json-e.js.org/using.html)). | Medium to high; the template becomes a YAML/JSON object and each Liquid expression changes to JSON-e syntax. | **Selected new engine.** |
| JSONata | Yes; `evaluate()` returns a new JavaScript value suitable for JSON serialization ([embedding API](https://docs.jsonata.org/embedding-extending)). | JSON literals, object and array constructors, conditionals, functions, map/filter/reduce, and recursion ([construction](https://docs.jsonata.org/construction), [programming constructs](https://github.com/jsonata-js/jsonata/blob/master/docs/programming.md)). | Official dependency-free JavaScript reference implementation and browser build ([repository](https://github.com/jsonata-js/jsonata), [guardrails](https://raw.githubusercontent.com/jsonata-js/jsonata/master/docs/guardrails.md)). | High; all expressions change language, and authors must learn JSONata sequence rules ([processing model](https://docs.jsonata.org/processing)). | Advanced transformer option. |
| CEL | Yes; CEL has null, booleans, numbers, strings, lists, and maps, with an exact JSON-compatible subset ([CEL language definition](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#values)). | Ternary expressions and bounded list/map macros provide selection and transformation; CEL is expression-oriented ([CEL language definition](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#evaluation)). | Buf's ECMAScript implementation exists but is beta ([CEL-ES repository](https://github.com/bufbuild/cel-es)). | High; syntax and value adapters change, and Liquid text-template concepts have no equivalent. | Good candidate for `when`; weak candidate for `value.template`. |
| JMESPath | Yes; successful evaluation always returns JSON data ([JMESPath specification](https://jmespath.org/specification.html)). | Projections, filters, pipes, literals, and fixed-key multi-select lists/hashes are available; the grammar has no general ternary, variables, or user-defined functions ([JMESPath grammar](https://jmespath.org/specification.html)). | The official JavaScript implementation is fully compliant and dependency-free ([official libraries](https://jmespath.org/libraries.html), [JavaScript implementation](https://github.com/jmespath/jmespath.js)). | High; Liquid expressions change and custom ZotLit filters need host-side preprocessing. | Query sublanguage only. |
| Jsonnet | Yes; any expression can return a scalar, array, or object ([language reference](https://jsonnet.org/ref/language.html)). | Functions, conditionals, comprehensions, locals, imports, and object inheritance form a full configuration language ([language reference](https://jsonnet.org/ref/language.html)). | The official project supplies C++, Go, Python, and C bindings, while its binding list has no JavaScript entry ([bindings](https://jsonnet.org/ref/bindings.html)). The official web demo uses a separate WebAssembly artifact ([repository build notes](https://github.com/google/jsonnet)). | Highest; it adds a separate runtime and a complete language rewrite. | Keep outside the Obsidian runtime. |

## Liquid can return a native value now

### Built-in `keepOutputType`

LiquidJS has a `keepOutputType` engine option. Its `KeepingTypeEmitter` keeps a
non-string value only when that value is isolated. If the emitter sees literal
text or another output, it concatenates both values as strings
([option](https://liquidjs.com/api/interfaces/LiquidOptions.html), [emitter
source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/emitters/keeping-type-emitter.ts#L4-L18)).

A local probe against LiquidJS 10.27.1 produced these results:

| Template | Result |
| --- | --- |
| `{{ value }}` | The original array. |
| `{% if flag %}{{ value }}{% else %}{{ fallback }}{% endif %}` | The original array from the selected branch. |
| ` {{ value }}` | A string. |
| `{{ value }}suffix` | A string. |

This built-in route conflicts with ZotLit's current shared Liquid engine.
`createLiquidEngine()` installs `coerceOutput` as `outputEscape`, and that
function converts ordinary output values with `String(value)`
(`packages/templates/src/liquid.ts:213-229`,
`packages/templates/src/coerce.ts:3-21`). `keepOutputType` therefore receives
text for a normal `{{ value }}` in that engine.

### Custom `result` tag

A custom tag can evaluate a `Value` itself and store the native result in the
render `Context`. LiquidJS documents custom tags that parse value tokens and
evaluate them in the current context, and `Context` exposes `getRegister()` and
`setRegister()` for render-local state ([custom tag guide](https://liquidjs.com/tutorials/parse-parameters.html),
[`Context` API](https://liquidjs.com/api/classes/Context.html)). This route does
not send the result through the text emitter or ZotLit's `outputEscape`.

The core of the trial tag is small:

```ts
class ResultTag extends Tag {
  #value: Value;

  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
    super(token, remain, liquid);
    this.#value = new Value(token.args, liquid);
  }

  *render(context: Context) {
    if (context.getRegister("managed-frontmatter-result-seen", false)) {
      throw new Error("multiple result tags");
    }
    context.setRegister("managed-frontmatter-result-seen", true);
    context.setRegister(
      "managed-frontmatter-result",
      yield this.#value.value(context),
    );
  }
}
```

This is a proof shape, not a production implementation. A production tag needs
the repository's diagnostic type, private register keys that cannot collide
with other tags, and the value-domain validator. The LiquidJS generator form
keeps one implementation compatible with synchronous and asynchronous renders
([custom-tag generator pattern](https://liquidjs.com/tutorials/sync-and-async.html)).

The user-facing shape can be:

```yaml
value:
  template: |-
    {% if zt.tags | has: "name", "Monograph" %}
      {% result zt.tags | map: "name" %}
    {% else %}
      {% result zt.collections | map: "path" | flatten %}
    {% endif %}
```

The evaluator contract should be:

1. Parse the template with a restricted Managed Frontmatter Liquid engine.
2. Run the normal Liquid control-flow tags.
3. Let `result` evaluate one normal Liquid `Value` expression and record its
   native value in the render context.
4. Fail if zero or more than one `result` tag executes.
5. Fail if the template emits non-whitespace text.
6. Validate the result against the shared Managed Frontmatter value domain.

A local proof with LiquidJS 10.27.1 confirmed that `if` selected one native
array, surrounding whitespace stayed separate from the result, and two
executed `result` tags produced a positioned Liquid render error. The proof
used only the documented `Tag`, `Value`, and `Context` APIs
([custom-tag generator pattern](https://liquidjs.com/tutorials/sync-and-async.html),
[`Context` API](https://liquidjs.com/api/classes/Context.html)).

This design supports typed selection and typed filter pipelines. Liquid's
expression grammar still does not provide general array and mapping literals;
`Value` parses one initial expression and its filters
([`Value` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32)).
JSON-e or JSONata is a better fit when authors must construct a new nested
structure directly in the template.

### Liquid safety boundary

Full Liquid templates add a larger language surface than the current `Value`
evaluator. LiquidJS provides parse, render, template-count, and memory limits,
and its defaults leave the main limits unlimited
([Liquid options source](https://github.com/harttle/liquidjs/blob/master/src/liquid-options.ts)).
The Managed Frontmatter engine should set finite limits and allow only the tags
needed for local control flow. File-backed `include`, `render`, and `layout`
should stay outside this field evaluator; LiquidJS resolves those tags through
its file-system abstraction ([Liquid options source](https://github.com/harttle/liquidjs/blob/master/src/liquid-options.ts),
[file-access discussion and fix](https://github.com/harttle/liquidjs/issues/131)).

The installed LiquidJS 10.27.1 is above the 10.26.0 fix for a critical
template-to-code-execution vulnerability, but this advisory is evidence that
the engine is a versioned security boundary rather than a permanent sandbox
guarantee ([LiquidJS advisory](https://github.com/advisories/GHSA-gf2q-c269-pqgc),
`packages/templates/package.json:35`).

## JSON-e: direct structured templates

JSON-e renders a parsed data structure with a data context and returns another
data structure. The input format may be JSON or YAML because rendering starts
after parsing, and the result cannot become syntactically invalid JSON through
interpolation ([introduction](https://json-e.js.org/introduction.html),
[language reference](https://json-e.js.org/language.html)).

A field could use this shape:

```yaml
value:
  json-e:
    $if: '"Monograph" in tagNames'
    then:
      - reference/book
      - reference/book/monograph
    else:
      - reference/book
```

`$eval` returns native values, `$if` can omit a value from its parent when its
selected arm is absent, and `$map` preserves an array or object result according
to its input type ([JSON-e operators](https://json-e.js.org/operators.html)).
JSON-e avoids JavaScript `eval` and unbounded iteration by design
([JSON-e repository](https://github.com/json-e/json-e)).

The host may expose synchronous functions in the context. An untrusted template
can call those functions with arbitrary arguments, so every exposed function
must validate its inputs and avoid authority that a field does not need
([using JSON-e](https://json-e.js.org/using.html)). ZotLit's custom Liquid
filters would become JSON-e context functions or precomputed context fields.

The official npm package was version 4.8.4 with an unpacked size of 108,640
bytes and dependencies on Lodash and a stable-stringify package on 2026-08-27
([npm registry metadata](https://registry.npmjs.org/json-e/4.8.4)). The package
also ships one browser-compatible file with TypeScript definitions
([using JSON-e](https://json-e.js.org/using.html)).

JSON-e gives the cleanest structure-first authoring model. It also changes the
manifest value from a source string to a YAML subtree. That is a product-format
decision, not an internal engine swap.

### JSON-e conditional presence

If every Managed Frontmatter entry uses JSON-e, a separate `when` member is not
needed. Put the applicability condition in a root `$if` and omit the unused
branch:

```yaml
managed-frontmatter:
  - key: editors
    merge: replace
    value:
      $if: 'zt.itemType != "webpage"'
      then:
        $eval: 'zt.editors'
```

JSON-e defines a missing `$if` arm as omission from the parent object or array,
while an explicit `null` is a normal JSON-e value
([`$if` documentation](https://json-e.js.org/operators.html#if---then---else),
[conformance cases for parent omission](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/specification.yml#L141-L181)).
The JavaScript implementation represents omission with an internal delete
marker, filters that marker from parent arrays and objects, and converts the
marker to `null` only when it reaches the public renderer at the top level
([`$if` implementation](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.js#L130-L145),
[parent filtering](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.js#L449-L505),
[top-level conversion](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/js/src/index.js#L574-L592)).
The official conformance suite therefore expects a top-level `$if` with no
selected arm to return `null`
([top-level conformance case](https://github.com/json-e/json-e/blob/9bb89a791309bcd6f39c4b287c958ddd75641f0c/specification.yml#L288-L291)).

A local probe with JSON-e 4.8.4 confirmed both paths. Direct rendering of the
field template returned `null` for a false `$if` with no `else`; rendering the
same template as an object property returned an empty object. Therefore a naive
top-level evaluator needs a separate `when` to represent field absence. The
envelope adapter removes that need and also preserves explicit `null`.

The adapter must not render the user value as the public top-level template.
It should render an engine-owned envelope instead:

```yaml
result: <the user's value template>
```

After rendering, `Object.hasOwn(envelope, "result")` defines the field state:

| Envelope result | Managed Frontmatter state |
| --- | --- |
| Own `result` property with any valid value, including `null` | Generated value. |
| No own `result` property | Conditionally absent. |
| JSON-e parse or render error | Named field diagnostic; produce no partial patch. |

This envelope is an adapter detail. It gives the internal JSON-e delete marker
a host-visible representation without exposing that marker as a Managed
Frontmatter value. JSON-e templates, contexts, and results use the JSON value
domain, so explicit `null` stays a value and functions may appear only in the
context, not in the final result
([JSON-e language reference](https://json-e.js.org/language.html), [context
function contract](https://json-e.js.org/using.html)).

The adapter must convert the missing envelope property to the explicit
Managed Frontmatter absent state. Passing it through as a missing evaluated key
would preserve the current frontmatter value for every merge strategy because
the current merger skips fields that are absent from the evaluated record
(`packages/templates/src/frontmatter-merge.ts:23-32`). The target merge behavior
remains:

| JSON-e result is absent | Create | Update |
| --- | --- | --- |
| `replace` | Omit the key. | Delete the existing managed key. |
| `append` | Omit the key. | Preserve the existing array. |
| `keep` | Omit the key. | Preserve the existing value. |

This follows the static ownership contract: each field still declares its
`key` and merge strategy before evaluation, and the current merger already
defines per-field `replace`, `append`, and `keep` behavior
(`packages/templates/src/constants.ts:23-47`,
`packages/templates/src/frontmatter-merge.ts:23-55`). The merge patch algebra
needs a delete operation for absent `replace`; a missing property alone cannot
express deletion in the current implementation
(`packages/templates/src/frontmatter-merge.ts:28-38`).

#### Why the JSON-e-only target omits `when`

A separate field-level `when` has two benefits: it makes applicability visible
beside `key` and `merge`, and it can short-circuit value evaluation. It also
creates two ways to express the same condition because JSON-e already has
`$if`, `$switch`, and parent omission
([JSON-e operators](https://json-e.js.org/operators.html)). The two routes then
need precedence, error, and combined-condition rules.

| Gate design | Absence and `null` | Contract cost |
| --- | --- | --- |
| Separate `when` | `when: false` is absent; the value may still be explicit `null`. | Adds a second expression and control-flow path. It can serve every value language. |
| Raw root `$if` | A missing arm and explicit `null` both return `null`. | Cannot represent absence safely. |
| Enveloped root `$if` | A missing envelope property is absent; an own property with `null` is explicit `null`. | Needs one documented adapter rule and no second condition language. |

For a JSON-e-only design, use one conditional mechanism:

- `value` is the JSON-e template.
- A root `$if` with a missing selected arm means that the field is absent.
- The envelope preserves absence versus explicit `null`.
- The field's static merge strategy decides the update effect of absence.

This contract keeps condition and value construction in one language and gives
JSON-e omission its documented meaning. A separate `when` would be optional
syntax sugar rather than required capability, so the minimum target format
should omit it.

This conclusion is scoped to a JSON-e-only field format. A multi-language
format may keep `when` as the single common applicability gate. In that design,
the evaluator should report a missing JSON-e envelope property as an error when
`when` passes. Treating it as absence would restore two field-gating paths. The
format should choose one path and give it the explicit absent-state merge
semantics above.

## JSONata: strongest transformation language

JSONata is a JSON query and transformation language. Its evaluator returns a
new JavaScript value suitable for `JSON.stringify()`, and JSON object and array
syntax constructs result structures ([embedding API](https://docs.jsonata.org/embedding-extending),
[construction](https://docs.jsonata.org/construction)). A conditional field
value could be one expression:

```yaml
value:
  jsonata: |-
    $count(zt.tags[name = "Monograph"]) > 0
      ? ["reference/book", "reference/book/monograph"]
      : ["reference/book"]
```

JSONata's sequence model automatically flattens nested result sequences. Zero
matches become no result, one match becomes a scalar, and two or more matches
become an array unless the expression uses an explicit array constructor
([processing model](https://docs.jsonata.org/processing)). Managed Frontmatter
would need authoring rules and result validation that prevent an accidental
array-to-scalar change.

JSONata is Turing-complete. Its JavaScript reference implementation provides
stack, timeout, and maximum-sequence guardrails. The timeout does not cover the
host JavaScript regular-expression engine, so the implementation also exposes a
regular-expression engine hook ([guardrails](https://raw.githubusercontent.com/jsonata-js/jsonata/master/docs/guardrails.md)).
Host functions can be bound or registered with argument signatures
([embedding and extending](https://docs.jsonata.org/embedding-extending)).

JSONata 2.2.1 fixed a critical crafted-expression code-execution vulnerability;
the current 2.2.2 release is above that fix
([JSONata advisory](https://github.com/jsonata-js/jsonata/security/advisories/GHSA-2943-5xfg-gq5f),
[npm registry metadata](https://registry.npmjs.org/jsonata/2.2.2)). The 2.2.2
package had no runtime dependencies and an unpacked size of 853,605 bytes on
2026-08-27 ([npm registry metadata](https://registry.npmjs.org/jsonata/2.2.2)).

JSONata is attractive for expert users who need grouping, aggregation, nested
construction, and higher-order functions. It is too large a semantic change for
the default migration from current Liquid expressions.

## CEL: safe expressions, limited template fit

CEL is non-Turing-complete, mutation-free, and designed for bounded expression
evaluation. It supports typed scalar values, lists, maps, ternary expressions,
and bounded `map` and `filter` macros
([CEL specification overview](https://github.com/cel-expr/cel-spec), [language
definition](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md)).
Its optional type-checking phase can reject expressions before evaluation
([language definition](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#gradual-type-checking)).

These properties make CEL a strong possible language for `when` and for one
typed value expression. They do not provide a template-level control-flow model.
Nested structures must be one CEL list or map expression
([CEL aggregate values](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#aggregate-values)).

Buf supplies a TypeScript/ECMAScript evaluator, but the project marks itself as
beta ([CEL-ES repository](https://github.com/bufbuild/cel-es)). Version 0.6.1
depended on `@bufbuild/cel-spec` and `@bufbuild/re2`; the three npm packages had
a combined unpacked size of about 7.37 MB on 2026-08-27
([CEL package metadata](https://registry.npmjs.org/@bufbuild/cel/0.6.1),
[CEL spec package metadata](https://registry.npmjs.org/@bufbuild/cel-spec/0.6.1),
[RE2 package metadata](https://registry.npmjs.org/@bufbuild/re2/0.6.1)). Final
bundled size requires a real ZotLit build because ESM tree-shaking can remove
unused package files.

CEL has the strongest containment and typing model in this comparison, but it
does not preserve Liquid authoring or solve structure templating better than
JSON-e.

## JMESPath: compact query language

JMESPath takes JSON data and returns JSON data. It provides projections,
filters, flattening, pipes, literals, and fixed-key multi-select lists and
hashes ([specification](https://jmespath.org/specification.html), [tutorial](https://jmespath.org/tutorial.html)).
The official JavaScript implementation exposes a `search` API and is listed as
fully compliant ([JavaScript implementation](https://github.com/jmespath/jmespath.js),
[official library list](https://jmespath.org/libraries.html)).

The language grammar has `and`/`or` expressions but no ternary expression,
variable binding, user-defined function, or dynamic-key object constructor
([JMESPath grammar](https://jmespath.org/specification.html)). The official
JavaScript public API does not document custom function registration
([JavaScript implementation](https://github.com/jmespath/jmespath.js)). These
limits keep the language small, but they make it insufficient for the advanced
conditional and extension cases that motivated `value.template`.

The official JavaScript package was version 0.16.0, dependency-free, and 81,076
unpacked bytes on 2026-08-27
([npm registry metadata](https://registry.npmjs.org/jmespath/0.16.0)). JMESPath
can be a focused query syntax inside another system; it should not be the full
Managed Frontmatter template language.

## Jsonnet: strong language, wrong runtime boundary

Jsonnet is a pure functional configuration language. Any expression may return
a scalar, array, or object, and the language includes conditionals, functions,
locals, comprehensions, assertions, imports, and object inheritance
([language reference](https://jsonnet.org/ref/language.html)). Evaluation is
side-effect-free in the core language, while imports explicitly receive data
from the environment ([language reference](https://jsonnet.org/ref/language.html#independence-from-the-environment-hermeticity),
[specification](https://jsonnet.org/ref/spec.html)).

The official project warns that its C++ implementation is not hardened for
untrusted Jsonnet code, that imports can expose accessible files, and that
untrusted programs can consume unreasonable resources
([official repository](https://github.com/google/jsonnet), [bindings security
guidance](https://jsonnet.org/ref/bindings.html)). The official bindings list
has no JavaScript implementation, although the project website uses a separate
WebAssembly build for its browser demo ([bindings](https://jsonnet.org/ref/bindings.html),
[repository web build notes](https://github.com/google/jsonnet)).

On 2026-08-27 the official `libjsonnet.wasm` asset reported a content length of
8,101,596 bytes before transport compression
([official WebAssembly asset](https://jsonnet.org/js/libjsonnet.wasm),
[repository web build notes](https://github.com/google/jsonnet)). A ZotLit
integration would also need a JavaScript wrapper, import restrictions, resource
limits, and conversion of host data into Jsonnet inputs.

Jsonnet is suitable for trusted, external configuration generation. It is a
poor fit for a small structured-value escape hatch inside an Obsidian plugin.

## Recommended trial sequence

1. Build the JSON-e field adapter around an engine-owned result envelope.
2. Test native scalar, array, mapping, explicit `null`, conditional absence,
   parse failure, render failure, and an invalid output value.
3. Add an explicit absent state to the merge result. Verify deletion for
   `replace` and preservation for `append` and `keep`.
4. Measure the JSON-e implementation against the #641 and #645 examples.
5. Design migration from existing Liquid and JavaScript fields. Use the Liquid
   `result` tag only if a compatibility bridge materially reduces migration
   cost.
6. Keep JSONata as a separate expert-language proposal with explicit security
   and sequence-shape requirements.

JSON-e is the target language for new fields. Migration adapters remain behind
the field-evaluation module instead of expanding the new manifest interface.
