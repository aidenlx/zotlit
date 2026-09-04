---
name: inlang-i18n
description: "Define ZotLit UI messages in the Inlang Message Format and consume them through the generated JSON Language Pack facade. Use when editing messages/*.json, adding interpolation or variants, changing locale resolution, or working with m.* calls."
---

# Inlang messages + JSON Language Packs

Use `messages/{locale}.json` as the source of truth. The Obsidian build compiles
those sources into a typed message facade and bundled English Language Pack;
the runtime interprets pack data synchronously.

Pair this skill with `/i18n-ui-text` when writing English UI copy.

## Project layout

- `project.inlang/settings.json` — Inlang project configuration, base locale,
  and locale list.
- `messages/{locale}.json` — shared message sources.
- `apps/obsidian/scripts/generate-language-packs.ts` — compiler entry point.
- `apps/obsidian/src/lib/i18n/generated/messages.ts` — generated typed facade.
- `apps/obsidian/src/lib/i18n/generated/en.json` — bundled English pack.
- `apps/obsidian/src/lib/i18n/runtime.ts` — eval-free interpreter.
- `apps/obsidian/src/lib/i18n.ts` — Obsidian Locale Alias resolution and
  startup.

Generated files are gitignored. Run:

```sh
pnpm --filter @zotlit/obsidian generate:language-packs
```

Turbo runs generation before typecheck and tests. Vite regenerates at build
start and watches the message sources, project settings, and generator.

## Adding or changing a message

1. Add or edit the key in `messages/en.json`. Use `snake_case`; keys prefixed
   `docs_` belong only to the docs site and are excluded from plugin artifacts.
   Companion copy (Zotero preferences, menus, Database Status) goes under the
   nested `zotero` object: read `apps/zotero/policies/localization.md` first for
   the attribute shape, Title Case, and the Fluent ID mapping. The plugin carries
   a `zotero.` message only when `apps/obsidian/vite.config.ts` names it in
   `includeMessages`; the docs site carries every one.
2. Regenerate the facade when running package tools directly.
3. Import the facade and keep named-input call shapes:

```ts
import * as m from "@/lib/i18n/generated/messages";

m.welcome_view_name();
m.annot_view_filter_count({ shown: 3, total: 8 });
```

Input-free messages are functions with no arguments. Input-bearing messages
take one object whose required properties come from `input` declarations.

## Inlang Message Format

### Simple messages

```json
{
  "hello_world": "Hello world",
  "greeting": "Good morning {name}!"
}
```

Variables use `{curlyBraces}`. Escape literal braces with `\\{` and `\\}` in
JSON.

### Variants

Wrap structured messages in an array:

```json
{
  "item_count": [
    {
      "declarations": ["input count", "local category = count: plural"],
      "selectors": ["category"],
      "match": {
        "category=one": "There is one item.",
        "category=*": "There are {count} items."
      }
    }
  ]
}
```

Declarations run in source order:

- `input name` declares a facade input.
- `local result = source: formatter` derives a local value.
- Formatter options are `key=value`; `$inputName` references another input.

Matching is evaluated in source order. Use literal matches where needed and
`*` as the catch-all.

### Supported formatters

| Formatter | Runtime |
| --- | --- |
| `plural` | `Intl.PluralRules` |
| `number` | `Intl.NumberFormat` |
| `datetime` | `Intl.DateTimeFormat` |

Examples:

```json
{
  "price": [
    {
      "declarations": [
        "input amount",
        "input currency",
        "local formatted = amount: number style=currency currency=$currency"
      ],
      "match": { "formatted=*": "Price: {formatted}" }
    }
  ],
  "event_date": [
    {
      "declarations": [
        "input date",
        "local formatted = date: datetime dateStyle=long timeZone=UTC"
      ],
      "match": { "formatted=*": "Date: {formatted}" }
    }
  ]
}
```

Use an explicit `timeZone` when output must be stable across environments.

Markup, unknown declarations, unknown expressions, and unknown formatters are
rejected by the compiler.

## Locale behavior

`apps/obsidian/src/lib/i18n.ts` resolves Obsidian language codes through the
Locale Alias table. Canonical locale names follow Inlang (`zh-CN`); unmatched
codes resolve to English. Startup always installs bundled English first.
Downloaded Language Packs are pure JSON data and use the same generated
facade.
