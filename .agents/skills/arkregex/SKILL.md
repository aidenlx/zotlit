---
name: arkregex
description: |
  Typed regex authoring with arkregex in this repo. Use whenever you write or edit a regular
  expression in TypeScript — especially one with named or positional capture groups, anywhere
  `.exec()` / `.match()` results are read in code, or when reaching for `new RegExp(...)`.
  Also use when migrating existing `RegExp` call sites or escaping dynamic literals into a pattern.
---

# arkregex

`arkregex` is a drop-in replacement for `new RegExp()` that infers literal types for capture groups and match strings — so `.exec()` / `.match()` results are typed instead of `string | undefined` at every index. Zero runtime cost; the value just is a `RegExp`. Best with TS 5.9+.

## What inference buys you

```ts
import { regex } from "arkregex";

const ok = regex("^ok$", "i");
// Regex<"ok" | "oK" | "Ok" | "OK", { flags: "i" }>

const semver = regex("^(\\d*)\\.(\\d*)\\.(\\d*)$");
// captures: [`${number}`, `${number}`, `${number}`]

const email = regex("^(?<name>\\w+)@(?<domain>\\w+\\.\\w+)$");
// names: { name: string; domain: `${string}.${string}` }

const m = email.exec(input);
if (m) m.groups.domain; // typed, no cast
```

Referencing a group that doesn't exist is a **type error**, not a runtime `undefined`.

## When to reach for it

Default to `regex(...)` for any new regex. It's a zero-runtime type-inference wrapper. The payoff shows up whenever match results are consumed: typed named captures eliminate manual `RegExpExecArray` indexing and the cast soup that comes with it.

## House rules

### Prefer the bare `regex("…")` form

```ts
import { regex } from "arkregex";

const ANNOT_KEY = regex(
  `^(?<itemKey>${ITEM_KEY_SOURCE})a${ITEM_KEY_SOURCE}(?:g(?<groupID>\\d+))?$`,
);
// names: { itemKey: string; groupID: string | undefined }
```

The parser handles template literals with interpolated source fragments — see `apps/obsidian/src/services/note-index/parse.ts` for a real example.

Reach for `regex.as<Pattern, { captures: [...] } | { names: {...} }>("…")` **only** when inference genuinely fails or the type errors out with `Type is excessively deep…`. Don't pre-emptively annotate; let inference do the work.

```ts
const complexPattern = regex.as<`pattern-${string}`, { captures: [string] }>(
  "very-long-complex-expression-here",
);
```

Character ranges like `[a-Z]` infer as `string` rather than a literal union — combinatorial expansion would tank the type system. Inferred types are imprecise-but-correct, never wrong.

### Do **not** wrap the pattern in `` String.raw`…` ``

`String.raw` widens to plain `string` and defeats arkregex's literal-type parser — you lose all the capture-group typing.

```ts
// BAD — type becomes Regex<string, { captures: [...] }>, names lost
const r = regex(String.raw`^(?<key>\w+)$`);

// GOOD — normal string literal
const r = regex("^(?<key>\\w+)$");

// GOOD — template literal with interpolated source
const r = regex(`^(?<key>${KEY_SOURCE})$`);
```

If you'd reach for `String.raw` to avoid `\\`, write the normal string literal anyway — the type info is worth the extra backslashes.

### Use native `RegExp.escape` for dynamic literal text

When building a pattern from runtime text (a user-supplied filename, a delimiter string, etc.), use `RegExp.escape(text)` instead of hand-rolled `replace(/[.*+?...]/g, "\\$&")` helpers. It's standard, correct, and the intent reads clearly.

## Library API reference

For the full `regex()` / `regex.as` surface, FAQs (including the `[a-Z]` precision tradeoff and the `Type is excessively deep…` workaround), and supported features, read the library README:

- `node_modules/arkregex/README.md` — present in any workspace that depends on `arkregex` (e.g. `apps/obsidian`). It's short; just open it when you need API details rather than guessing from memory.
