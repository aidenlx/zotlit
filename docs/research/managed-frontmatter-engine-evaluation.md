# Managed Frontmatter on engine evaluation

Research note for [issue #864](https://github.com/aidenlx/zotlit/issues/864).
Part of the wayfinder map [#835](https://github.com/aidenlx/zotlit/issues/835).
Drafted 2026-08-27 from repository commit
`92ee43825c0bf0759b7e0e11ec4324fcddc9c4bd`.

This note is briefing material for the format-spec grilling. The JSON-e engine
choice is settled in [ADR 0026](../adr/0026-managed-frontmatter-uses-json-e.md).
The remaining manifest and migration details are still design material.

## Selected new engine: JSON-e

The follow-up comparison in
[`structured-template-language-alternatives.md`](structured-template-language-alternatives.md)
supersedes the Liquid-first proposal below. Use JSON-e for new Managed
Frontmatter fields. Keep the static `key` and `merge` members, and make `value`
one JSON-e template. Put conditional presence in that template with `$if`; the
new syntax has no separate `language` or `when` member.

```yaml
managed-frontmatter:
  - key: collections
    merge: replace
    value:
      $flatten:
        $eval: 'map(zt.collections, "path")'

  - key: editors
    merge: replace
    value:
      $if: 'zt.itemType != "webpage"'
      then:
        $eval: 'zt.editors'

  - key: tags
    merge: replace
    value:
      $if: 'has(zt.tags, "name", "Monograph")'
      then:
        - reference/book
        - reference/book/monograph
      else:
        - reference/book
```

The field-evaluation adapter renders `{ result: field.value }`. A missing
`result` property is conditional absence; an own `result` property with `null`
is an explicit null value. This envelope is necessary because JSON-e converts
a missing branch at the public render root to `null`, while it omits a missing
branch from a parent object. The merge result must carry absence explicitly:
`replace` deletes an existing managed key, while `append` and `keep` preserve
it.

Liquid and JavaScript fields are migration inputs. Keep their adapters behind
the field-evaluation module instead of adding their language choices to the new
manifest interface. The older Liquid/YAML design below remains as comparison
material.

## Sources and method

The product requirements come from [discussion
#641](https://github.com/aidenlx/zotlit/discussions/641), [discussion
#645](https://github.com/aidenlx/zotlit/discussions/645), the current Profile
and document spec in [issue #865](https://github.com/aidenlx/zotlit/issues/865),
and the note-identity decision in [issue
#841](https://github.com/aidenlx/zotlit/issues/841#issuecomment-5435470936).
The local ADR 0025 at this checkout is an earlier edition; #841 and #865 name
the overwritten edition as the current design.

The engine facts come from `packages/templates/src/{constants,frontmatter,
frontmatter-merge,liquid}.ts` at the commit above, LiquidJS 10.27.1 source and
documentation, the YAML 1.2.2 specification, the `yaml` parser documentation,
and the ECMAScript specification. All external sources are first-party.

## Earlier verdict: YAML fallback

Use an **ordered list of statically named fields** in the document manifest.
Each field keeps the existing `key`, `merge`, and `language`, replaces `expr`
with an explicit typed `value.expression`, and may add a `when` expression.
For Liquid only, add `value.template` as a bounded escape hatch: render that
one field, parse the result as exactly one YAML value, then apply the field's
ordinary merge strategy. Add a `frontmatter_json` Liquid filter that validates
the Managed Frontmatter value domain and emits JSON, which is valid YAML 1.2,
for safe interpolation inside that escape hatch. Do not add a whole-mapping
`extra` slot.

This shape keeps the four properties that the current system already has:

1. Liquid and JavaScript expressions return native values, so arrays remain
   arrays (`packages/templates/src/frontmatter.ts:34-48`).
2. The field list owns one key at a time and assigns `replace`, `append`, or
   `keep` to that key (`packages/templates/src/constants.ts:23-47`).
3. JavaScript fields stay inert until the per-device JavaScript Templates gate
   is on; the compiler does not compile them while the gate is off
   (`packages/templates/src/frontmatter.ts:40-44`, `:60-80`).
4. System identity remains outside the user field list. The new format also
   keeps the Profile stamp as a forced system field ([#865, Implementation
   Decisions](https://github.com/aidenlx/zotlit/issues/865)).

It also solves both reported cases. A typed `flatten` filter produces the real
one-dimensional list requested by #641, and `when` plus the per-key Liquid
template escape hatch provides conditional presence and standard Liquid
control flow for #645. LiquidJS already implements `if`, `elsif`, `else`,
`case`, and `when` as engine tags; ZotLit does not need a YAML control-flow
language ([LiquidJS tag
overview](https://liquidjs.com/tags/overview.html), [LiquidJS `if`
documentation](https://liquidjs.com/tags/if.html)).

## Proposed manifest shape

Use a YAML sequence because field order affects new-note write order, while a
YAML mapping is an unordered association whose keys must be unique
(`apps/obsidian/CONTEXT.md:21-22`, [YAML 1.2.2 representation
model](https://yaml.org/spec/1.2.2/#3211-nodes)).

```yaml
managed-frontmatter:
  - key: collections
    language: liquid
    value:
      expression: 'zt.collections | map: "path" | flatten'
    merge: replace

  - key: editors
    language: liquid
    when: 'zt.itemType != "webpage"'
    value:
      expression: zt.editors
    merge: replace

  - key: tags
    language: liquid
    value:
      template: |-
        - reference/book
        {% if zt.tags | has: "name", "Monograph" %}
        - reference/book/monograph
        {% endif %}
    merge: replace
```

One field has this contract:

| Member | Contract |
| --- | --- |
| `key` | Required, static, non-empty, unique in the list, and not a system-reserved key. Current validation already requires a non-empty key and one of the three merge strategies (`packages/templates/src/constants.ts:23-47`). |
| `language` | Required: `liquid` or `javascript`. Current fields declare their language and the gate never reinterprets it (`packages/templates/src/constants.ts:32-40`). |
| `when` | Optional expression in the declared language. Missing means present. A false result means conditionally absent; it is not the same state as an undefined value. |
| `value.expression` | The normal form. Exactly one engine value is returned without text rendering. LiquidJS `Value.value()` returns the evaluated initial expression after its filters, and `evalValueSync()` returns that result (`packages/templates/src/frontmatter.ts:109-114`, [LiquidJS `Value` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32), [LiquidJS `evalValueSync` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/liquid.ts#L89-L99)). |
| `value.template` | Liquid-only escape hatch. Render one Liquid source string and parse its output as one YAML value. Empty output, multiple YAML documents, parser errors, aliases, custom tags, and non-JSON-compatible values are validation failures. The `yaml` library exposes a single-document parser, typed scalar/sequence/mapping output, and positioned parser errors ([`yaml` parse API](https://eemeli.org/yaml/#parse-stringify), [`yaml` document API](https://eemeli.org/yaml/#documents), [`yaml` errors](https://eemeli.org/yaml/#errors)). |
| `merge` | Required: `replace`, `append`, or `keep`, with the existing meanings (`packages/templates/src/frontmatter-merge.ts:23-55`). |

`value.expression` and `value.template` are mutually exclusive. A JavaScript
field uses `value.expression`; a JavaScript expression already has native
arrays, objects, conditional operators, and function expressions, so a second
render-and-parse route does not add required power. The current evaluator also
returns JavaScript results verbatim (`packages/templates/src/frontmatter.ts:34-39`,
`:83-103`).

Both value forms have one output domain: `null`, booleans, finite numbers,
strings, recursive arrays, and plain mappings with string keys. Reject
`bigint`, functions, symbols, non-finite numbers, cycles, sparse arrays, and
class instances with a diagnostic that names the static field. `undefined`
remains the separate untouched state described below; it is not an output
value. This shared boundary prevents an expression from writing a value that
the YAML form cannot represent with the same meaning. YAML's native model is
made from scalars, sequences, and mappings, and its mappings require unique
keys ([YAML 1.2.2 representation
model](https://yaml.org/spec/1.2.2/#3211-nodes)).

For a Liquid `value.template`, JSON text is the safe interpolation form because
JSON flow syntax is valid YAML 1.2, and the parser can construct mappings,
sequences, strings, numbers, booleans, and null from it ([YAML 1.2.2 language
overview](https://yaml.org/spec/1.2.2/#chapter-2-language-overview), [`yaml`
parse API](https://eemeli.org/yaml/#parse-stringify)). Add and document a
`frontmatter_json` filter that first enforces the shared domain and then calls
JSON serialization. LiquidJS 10.27.1 does include `json` and `jsonify`, but
both call `JSON.stringify` directly without this domain check ([LiquidJS
10.27.1 miscellaneous filters](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/filters/misc.ts#L12-L14),
[filter exports](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/filters/misc.ts#L37-L43)).
Use `frontmatter_json` instead of ZotLit's Markdown output coercion, which
converts arbitrary values with `String(value)`
(`packages/templates/src/coerce.ts:3-21`).

## Evaluation states

The evaluator must keep three distinct states:

| State | Meaning | Merge input |
| --- | --- | --- |
| `when` is false | The field does not apply to this item. | An explicit absent/tombstone state. |
| Value is `undefined` | The expression did not produce a value. | Untouched, matching current behavior (`packages/templates/src/frontmatter.ts:139-158`). |
| Value is `null` | The expression explicitly produced YAML null. | A real generated value, matching current behavior (`packages/templates/src/frontmatter.ts:151-154`). |

The explicit absent state is necessary. The current merger skips any key that
is missing from the evaluated record (`packages/templates/src/frontmatter-merge.ts:30-32`).
If `when: false` reused that path, a field written on an earlier update would
remain after an item type or Zotero tag changed, which would fail #645's
conditional-presence requirement ([discussion
#645](https://github.com/aidenlx/zotlit/discussions/645)).

### `when: false` by merge strategy

| Strategy | Create | Update |
| --- | --- | --- |
| `replace` | Omit the key. | Delete the existing managed key. `replace` already gives ZotLit full ownership of the generated value (`packages/templates/src/frontmatter-merge.ts:35-38`). |
| `append` | Omit the key. | Preserve the existing array. The current strategy preserves manual entries and only appends generated values that are not already present (`packages/templates/src/frontmatter-merge.ts:39-47`, `:57-74`). ZotLit has no provenance record that can separate old generated entries from manual entries. |
| `keep` | Omit the key. | Preserve the existing value. `keep` already writes only when the existing value is blank (`packages/templates/src/frontmatter-merge.ts:48-50`, `:76-86`). |

The editor and validator should state that conditional deletion requires
`replace`. This rule keeps the ownership promise of `append` and `keep` and
still supplies #645's requested omission path.

Evaluate the full field set before producing a patch. A compile error, a
runtime error, an invalid rendered YAML value, or an inert JavaScript field
must return a diagnostic that names the field and its recovery action. It must
not produce substitute data. This follows #865's diagnostic rule and the
current gate invariant, which refuses consumption of an incomplete compiled
field set (`apps/obsidian/src/services/template/errors.ts:3-25`, [#865,
Diagnostics](https://github.com/aidenlx/zotlit/issues/865)).

## Typed flattening for #641

Add a generic Liquid `flatten` filter. It must accept an array and return a new
array flattened by one level by default. An optional non-negative integer depth
may request more levels. This matches JavaScript `Array.prototype.flat`, whose
specified default depth is one ([ECMAScript `Array.prototype.flat`](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.flat)).

The #641 expression then stays typed:

```liquid
zt.collections | map: "path" | flatten
```

LiquidJS `map` returns an array of the named property values, so mapping
`path` produces the nested path arrays before `flatten` runs ([LiquidJS `map`
documentation](https://liquidjs.com/filters/map.html), [LiquidJS 10.27.1
`map` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/filters/array.ts#L46-L54)).
The current ZotLit `collection_paths` filter instead joins each path with a
separator and returns one string per collection
(`packages/templates/src/liquid.ts:241-249`). The discussion's join/split
workaround crosses through a string and depends on a delimiter not appearing
in a collection name ([discussion #641 and workaround](https://github.com/aidenlx/zotlit/discussions/641)).

The JavaScript equivalent is direct and remains typed:

```js
zt.collections.map((collection) => collection.path).flat()
```

Reject non-array input with a named field diagnostic, as ZotLit's existing
array filters do (`packages/templates/src/liquid.ts:251-260`). Preserve
duplicates and order by default; authors can apply LiquidJS `uniq` explicitly,
which returns the first occurrence of each array value ([LiquidJS 10.27.1
`uniq` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/filters/array.ts#L247-L251)).

## Why the YAML escape hatch is per key

A typed Liquid value expression is the correct default because it keeps
arrays, numbers, objects, and null as engine values. Liquid's control-flow
tags are template tags, so a value expression alone cannot express an
`if`/`elsif`/`else` rendering branch; the `Value` evaluator only evaluates an
initial expression and its filter pipeline ([LiquidJS `Value`
source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32),
[LiquidJS `if` documentation](https://liquidjs.com/tags/if.html)).

Rendering and parsing one field gives Liquid authors standard Liquid control
flow and standard YAML values. YAML represents native data with scalars,
sequences, and mappings, so one parsed node is sufficient for every current
frontmatter value shape ([YAML 1.2.2 representation
model](https://yaml.org/spec/1.2.2/#3211-nodes)). The static field record still
names the owner and merge strategy before rendering.

Do not render a whole `extra` mapping. This is a design inference from the
current merge contract and the YAML model:

- A dynamic key has no statically assigned merge strategy, while the merger
  requires one strategy for each field (`packages/templates/src/frontmatter-merge.ts:3-6`,
  `:23-51`).
- A dynamic key can collide with a static field or a system field after
  rendering, while YAML requires mapping keys to be unique ([YAML 1.2.2
  representation model](https://yaml.org/spec/1.2.2/#3211-nodes)).
- When a later render stops producing a dynamic key, ZotLit cannot know whether
  to delete it, preserve it, or treat it as unmanaged. The current system
  defines ownership from the configured field list
  (`packages/templates/src/frontmatter-merge.ts:23-32`).
- A whole-mapping parse failure cannot name the field that caused it. A per-key
  parse can report the static key, which follows #865's diagnostic requirement
  ([#865, Diagnostics](https://github.com/aidenlx/zotlit/issues/865)).

The bounded escape hatch therefore adds engine power without weakening
structural key ownership.

## JavaScript gate

Keep `language` on each field for migration and for the existing device gate.
When any JavaScript field is required and the gate is off, refuse the entire
frontmatter-consuming operation and name all inert keys. Do not compile the
JavaScript source and do not evaluate only the Liquid subset. This is the
current hard invariant (`packages/templates/src/frontmatter.ts:40-44`,
`:60-80`; `apps/obsidian/src/services/template/service.ts:263-280`).

Liquid `when` uses LiquidJS truthiness; JavaScript `when` uses JavaScript
truthiness. LiquidJS treats only `false`, `null`, and `undefined` as false by
default, so an empty string, zero, and an empty array are true ([LiquidJS
truthiness](https://liquidjs.com/tutorials/truthy-and-falsy.html)). The
Workbench guide and generated examples should prefer boolean-producing
operators and filters, such as `==` and `has`, rather than depend on an empty
collection's truthiness ([LiquidJS operators](https://liquidjs.com/tutorials/operators.html),
[LiquidJS 10.27.1 `has` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/filters/array.ts#L217-L224)).

## Migration of `note.frontmatter-fields`

Migrate the current ordered setting list into the default Profile document's
manifest, one entry at a time:

```text
{ key, expr, merge, language }
  ->
{ key, value: { expression: expr }, merge, language }
```

This is a structural move, not an expression rewrite. Reusing the same Liquid
`Value` compiler and JavaScript `new Function` evaluator preserves typed output
and language behavior (`packages/templates/src/frontmatter.ts:54-80`,
`:83-119`). Preserve list order because the existing ordered list is the write
order on new notes (`apps/obsidian/CONTEXT.md:21-22`). Do not place
`zotero-key` or the Profile stamp in the list; #865 keeps both as forced system
fields ([#865, Implementation
Decisions](https://github.com/aidenlx/zotlit/issues/865)).

The converter must preserve each expression string, language, merge strategy,
key, and list position exactly. It should compile the converted list and run
one in-memory evaluation and effective-patch dry run against the selected
preview item before it writes the document. It must not evaluate old and new
JavaScript expressions to compare them: an expression may read time, random
state, or mutable external state, so two runs need not be equal even when the
source is unchanged (`packages/templates/src/frontmatter.ts:83-91`). Package
tests must prove the structural mapping and patch
behavior for deterministic fixtures, every merge strategy, every conditional
state, and every allowed output kind. This applies #865's in-memory-before-write
rule without claiming runtime proof for arbitrary user JavaScript ([#865,
Migration and Testing
Decisions](https://github.com/aidenlx/zotlit/issues/865)).

## Alternatives declined

| Alternative | Verdict | Reason |
| --- | --- | --- |
| Keep only `value` expressions and add `when` | Decline as the complete design. It solves typed values and conditional presence, but Liquid value evaluation has no tag-level `if`/`case` branch ([LiquidJS `Value` source](https://github.com/harttle/liquidjs/blob/ed489865b64ce8f7cae2f14875e1a05742e043b3/src/template/value.ts#L9-L32), [LiquidJS tag overview](https://liquidjs.com/tags/overview.html)). |
| Render the whole managed-frontmatter mapping, then parse it | Decline. Dynamic keys remove stable per-key ownership, merge choice, and diagnostics; see the `extra` analysis above. |
| Add private YAML keys such as `if`, `then`, `else`, or `for-each` | Decline. LiquidJS already owns control-flow parsing and evaluation ([LiquidJS tag overview](https://liquidjs.com/tags/overview.html)); a second grammar would need its own validation and migration contract. |
| Keep the join/split workaround for nested arrays | Decline. It produces an intermediate string, while the existing evaluator and the requested output are typed arrays (`packages/templates/src/frontmatter.ts:46-48`, [discussion #641](https://github.com/aidenlx/zotlit/discussions/641)). |

## Items for ratification

The primary-source evidence does not settle these naming and packaging choices:

1. The manifest key may be `managed-frontmatter` or a nested field under the
   final manifest namespace. This note specifies its value shape only.
2. #865 says one rendering language per document, while current Managed
   Frontmatter fields declare languages independently and may be mixed
   (`packages/templates/src/constants.ts:32-47`). Keeping per-field language is
   the lossless migration choice. Removing it needs an explicit conversion rule
   and parity proof.
3. The implementation must choose and pin a YAML parser and schema. The
   recommended boundary is YAML 1.2, one document, JSON-compatible native
   values, no aliases or custom tags. The `yaml` package exposes the required
   single-document and error APIs, but it is not a direct dependency of
   `@zotlit/templates` at this checkout ([`yaml` API](https://eemeli.org/yaml/),
   `packages/templates/package.json:29-38`).
4. The UI must decide whether `when` with `append` or `keep` gets a warning or
   is an advanced-only combination. The semantic table above remains the safe
   runtime rule because it preserves the existing ownership promises.
