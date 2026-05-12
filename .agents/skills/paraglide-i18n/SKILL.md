---
name: paraglide-i18n
description: "How to define i18n messages using the Inlang Message Format and consume them with Paraglide JS. Use this skill whenever the user needs to write or edit translation JSON files (messages/*.json), add pluralization/gendering/variants, use number/date formatting in messages, set up Paraglide locale management, or reference Paraglide runtime APIs (m.*, getLocale, setLocale, localizeHref, LocalizedString). Also trigger when the user mentions inlang message format, paraglide messages, i18n JSON keys, or translation files in a Paraglide project."
paths: "messages/*.json"
---

# Paraglide JS + Inlang Message Format

This skill covers:
1. **Project setup** — where messages live and the add-key workflow
2. **Inlang Message Format** — how to write translation JSON files
3. **Paraglide JS** — how to consume those messages in code

---

## Part 1: Project setup

Shared configuration at the repo root:

- `project.inlang/settings.json` — inlang project config (`baseLocale`, locales, plugin)
- `messages/{locale}.json` — message strings (the single source of truth for all UI text)

Locales are configured in `project.inlang/settings.json`:

```json
{
  "baseLocale": "en",
  "locales": ["en", "de", "fr"]
}
```

Message file path is set via `plugin.inlang.messageFormat.pathPattern`:

```json
{
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{locale}.json"
  }
}
```

### Workflow: adding or changing a message

1. Add the key to `messages/en.json` using `snake_case` (e.g. `settings_log_heading`). Keys must be valid JS identifiers (no hyphens, no dots).
2. Run `pnpm --filter @zotlit/obsidian build:dev` (or `dev`) so the bundler regenerates `m.*`. Editing `messages/*.json` alone does **not** update the compiled output.
3. Import and call: `import * as m from "@/paraglide/messages"; m.my_new_key()`

### Adding a new locale

Add the code to `locales` in `project.inlang/settings.json`, create `messages/{locale}.json`, recompile.

---

## Part 2: Inlang Message Format (writing translation JSON)

Messages live in `messages/{locale}.json` as key-value pairs.

### Simple messages

```json
{
  "hello_world": "Hello World!",
  "greeting": "Good morning {name}!"
}
```

Variables use `{curlyBraces}`. To include literal braces, escape with backslash: `\{` and `\}`. In JSON, that means double-backslash: `"Use \\{variable\\} syntax"`.

### Nested messages

Supported in plugin v4+ / SDK v2+. Max depth: 5 levels. Access via dot notation in code: `m["navigation.home"]()`.

```json
{
  "navigation": {
    "home": "Home",
    "about": "About"
  }
}
```

### Complex messages (variants, pluralization, formatting)

Wrap in an **array** to distinguish from nested objects:

```json
{
  "item_count": [{
    "declarations": ["input count", "local countPlural = count: plural"],
    "selectors": ["countPlural"],
    "match": {
      "countPlural=one": "There is one item.",
      "countPlural=other": "There are {count} items."
    }
  }]
}
```

The array wrapper is mandatory - without it, the plugin treats the object as nested messages.

### Declaration syntax

Declarations define inputs and local variables for formatters/selectors:

- `"input varName"` - declare an input parameter
- `"local localVar = inputVar: formatter"` - create a derived variable
- `"local localVar = inputVar: formatter opt1=val1 opt2=val2"` - with options
- `"local localVar = inputVar: formatter key=$otherInputVar"` - reference another input with `$`

Read `local countPlural = count: plural` as "create local variable `countPlural` that equals `plural(count)`".

### Built-in formatters

| Formatter  | Backed by              | Purpose                        |
|------------|------------------------|--------------------------------|
| `plural`   | `Intl.PluralRules`     | Pluralization categories       |
| `number`   | `Intl.NumberFormat`     | Locale-aware number formatting |
| `datetime`  | `Intl.DateTimeFormat`  | Locale-aware date/time formatting |

All formatters forward their options to the underlying `Intl` API.

### Pluralization

```json
{
  "cat_count": [{
    "declarations": ["input count", "local countPlural = count: plural"],
    "selectors": ["countPlural"],
    "match": {
      "countPlural=one": "There is one cat.",
      "countPlural=other": "There are {count} cats."
    }
  }]
}
```

### Ordinal pluralization (1st, 2nd, 3rd...)

Pass `type=ordinal` to `plural`:

```json
{
  "place": [{
    "declarations": [
      "input placeNumber",
      "local ord = placeNumber: plural type=ordinal"
    ],
    "selectors": ["ord"],
    "match": {
      "ord=one": "You finished in {placeNumber}st place",
      "ord=two": "You finished in {placeNumber}nd place",
      "ord=few": "You finished in {placeNumber}rd place",
      "ord=*": "You finished in {placeNumber}th place"
    }
  }]
}
```

### Multi-selector matching (gendering, A/B, platform)

Use comma-separated conditions in match keys:

```json
{
  "download_prompt": [{
    "match": {
      "platform=android, userGender=male": "{username} has to download the app on his phone from the Google Play Store.",
      "platform=ios, userGender=female": "{username} has to download the app on her iPhone from the App Store.",
      "platform=*, userGender=*": "The person has to download the app."
    }
  }]
}
```

`*` is the wildcard/catch-all.

### Number formatting

```json
{
  "balance": [{
    "declarations": [
      "input amount",
      "local fmt = amount: number minimumFractionDigits=2 maximumFractionDigits=2"
    ],
    "match": { "fmt=*": "Balance: {fmt}" }
  }],
  "price": [{
    "declarations": [
      "input amount",
      "input priceCurrency",
      "local fmt = amount: number style=currency currency=$priceCurrency"
    ],
    "match": { "fmt=*": "Price: {fmt}" }
  }]
}
```

### Date/time formatting

```json
{
  "purchase_date": [{
    "declarations": [
      "input date",
      "local fmt = date: datetime day=2-digit month=2-digit year=numeric"
    ],
    "match": { "fmt=*": "Purchase date: {fmt}" }
  }],
  "event_start": [{
    "declarations": [
      "input date",
      "local fmt = date: datetime dateStyle=long timeStyle=short timeZone=UTC"
    ],
    "match": { "fmt=*": "Starts: {fmt}" }
  }]
}
```

Use explicit `timeZone` if output must be stable across environments.

### Markup placeholders (rich text)

For rendering bold, links, icons, etc.:

- Open + close: `{#tag}content{/tag}`
- Standalone: `{#icon/}`
- With literal option: `{#link to=|/docs|}Read docs{/link}`
- With variable option: `{#link rel=$relationship}Read docs{/link}`
- With attribute: `{#cta @track @variant=|hero|}Try now{/cta}`

```json
{
  "welcome": "{#b}Hi {name}{/b}{#icon/}",
  "cta": "{#link to=|/docs| rel=$relationship}Read docs{/link}"
}
```

### Escaping

| In message text | Renders as | In JSON string |
|----------------|------------|----------------|
| `\{`           | `{`        | `\\{`          |
| `\}`           | `}`        | `\\}`          |
| `\\`           | `\`        | `\\\\`         |

Inside quoted literals (`|...|`): escape `|` as `\|`, escape `\` as `\\`.

### Objects and arrays in messages

Store as JSON strings, parse at runtime:

```json
{
  "features": "[\"Fast\", \"Secure\", \"Easy to use\"]"
}
```

```ts
const features: string[] = JSON.parse(m.features());
```

For objects, escape braces: `"\\{\"key\": \"value\"\\}"`.

If items need interpolation, use separate numbered keys instead:

```json
{
  "step_0": "Welcome, {name}!",
  "step_1": "You have {count} items"
}
```

---

## Part 3: Paraglide JS (consuming messages in code)

### Import and use messages

```ts
import { m } from "./paraglide/messages.js";

m.hello_world();                          // "Hello World!"
m.greeting({ name: "Samuel" });           // "Good morning Samuel!"
m["navigation.home"]();                   // Nested key via bracket notation
```

### Locale management

```ts
import { getLocale, setLocale, getTextDirection, localizeHref } from "./paraglide/runtime.js";

getLocale();           // "en"
getTextDirection();    // "ltr" or "rtl"
setLocale("de");       // Changes locale (reloads page by default)
setLocale("de", { reload: false }); // No reload - you handle re-rendering
```

### Force locale for a specific message

```ts
m.greeting({ name: "Samuel" }, { locale: "de" }); // "Hallo Samuel!"
```

Useful for SSR where you render content in multiple languages.

### URL localization

```ts
localizeHref("/blog"); // "/en/blog" or "/de/blog" depending on locale
```

```html
<a href={localizeHref("/blog")}>Blog</a>
```

### Type-safe localized strings

Message functions return `LocalizedString`, not plain `string`:

```ts
import type { LocalizedString } from "./paraglide/runtime.js";

function PageTitle(props: { title: LocalizedString }) {
  return <h1>{props.title}</h1>;
}

<PageTitle title={m.welcome_title()} />  // OK
<PageTitle title="Welcome" />            // Type error
```

### Dynamic message selection (preserves tree-shaking)

```ts
const messages = {
  greeting: m.greeting,
  goodbye: m.goodbye,
};

messages["greeting"]({ name: "World" });
```

### Formatting reactivity

Formatting runs when message functions are called. After locale change, formatted values update on next evaluation:

```ts
setLocale("en");
m.personal_balance({ amount: 1000.57 }); // "Your balance is 1,000.57."

setLocale("de");
m.personal_balance({ amount: 1000.57 }); // "Your balance is 1.000,57."
```

---

## Common mistakes

- **Missing array wrapper**: Complex messages (variants/plural) MUST be wrapped in `[{...}]`, not just `{...}`
- **Wrong formatter names**: Use `plural`, `number`, `datetime` - not `numberFormat` or `dateFormat`
- **Passing pre-formatted strings**: Pass raw values and let Paraglide format per locale
- **Missing timeZone**: Add `timeZone=UTC` in datetime options for stable output across environments
- **Flat vs nested keys**: Flat keys like `user_profile_title` are recommended over nested `user.profile.title`
