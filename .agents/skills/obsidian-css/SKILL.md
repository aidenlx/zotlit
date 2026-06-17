---
name: obsidian-css
description: "Style Obsidian plugin UI with Tailwind + native components. Use when writing or reviewing any styled React/JSX in apps/obsidian/ — picking colors, spacing, typography, borders, radius, shadows, dark-mode tokens, or choosing between Tailwind utilities, Obsidian native components, and custom CSS. Also use for .zt-root preflight setup, zt: prefix usage, theme compatibility, component wrapper selection, or any CSS/styling decision in the plugin."
paths:
  - "apps/obsidian/**/*.css"
  - "apps/obsidian/**/*.tsx"
---

# Obsidian Plugin CSS & Tailwind Style Guide

Plugin UI should feel like part of Obsidian — same colors, same spacing, same dark/light handling — without the plugin needing to know which theme the user has installed. Theme authors do this by **overriding** Obsidian's built-in CSS variables; plugin authors do it by **consuming** them through Tailwind utility classes.

The biggest mistake is hardcoding values (`#1e1e1e`, `12px`, `1px solid #ccc`). Hardcoded values look fine in the default theme and break in every other theme. Always use Tailwind tokens, which are backed by Obsidian CSS variables.

## Styling approach

**Tailwind-first with `zt:` prefix.** Default to Tailwind utility classes for all styling. Avoid writing raw CSS stylesheets. The Tailwind theme in `src/zt-main.css` maps Obsidian CSS variables to Tailwind tokens.

**Every utility class uses the `zt:` prefix** — `zt:flex`, `zt:gap-2`, `zt:bg-background`, `zt:text-muted-foreground`, `zt:rounded-md`. Variants chain after the prefix: `zt:hover:opacity-100`, `zt:@md:columns-2`. This is Tailwind v4's `prefix()` feature applied to both `theme.css` and `utilities.css` imports — it scopes compiled selectors so they never collide with other plugins' Tailwind output. Custom `@theme` variables defined in `zt-main.css` (colors, radii, shadows mapped to Obsidian tokens) keep their authored names (no prefix).

When no Tailwind token exists for an Obsidian variable, either extend `zt-main.css` (follow the existing pattern) or use Tailwind's arbitrary CSS variable syntax: `zt:bg-(--obsidian-var)`, `zt:text-(--some-color)`, `zt:p-(--size-4-3)`, etc. These compile to `var(--…)` at build time with full utility support.

Use `cn()` from `@/lib/utils` to merge Tailwind classes with conflict resolution — never raw string concatenation. `cn()` is prefix-aware via `twMerge` from `@/lib/tw`.

For React components with Obsidian modifier classes (`mod-cta`, `is-enabled`, `clickable-icon`), use `tv` from `@/lib/tw` (not directly from `tailwind-variants`) for variant composition — it's pre-configured with the `zt` prefix for correct class merging. See the existing wrappers in `src/components/obsidian/` for the pattern.

## The three rules

1. **Use Tailwind tokens, never hardcode.** Hardcoded `#hex`, `rgb(…)`, and `8px` values look correct in the default theme and break in every other theme. Use mapped tokens (`zt:bg-background`, `zt:text-muted`, `zt:rounded-md`). For spacing, Tailwind's default scale (`zt:gap-2`, `zt:p-3`) is fine — Obsidian's `--size-4-N` variables are just fixed `4px` multiples that no theme overrides. See `references/foundations.md` for available variables.
2. **Prefer native components.** Obsidian fully styles `<button>`, `<input>`, `<select>`, `<textarea>`, and toggle — rebuilding these from Tailwind primitives fights Obsidian's styles and breaks across themes. Use bare elements or the React wrappers from `src/components/obsidian/`.
3. **No `!important`, scope custom CSS.** `!important` blocks user CSS snippets — they can never override your styles. Scope custom CSS under `zt-`-prefixed classes and keep specificity low.

## Quick decision tree

Picking a style goes:

1. **A native component exists** → use the React wrapper from `src/components/obsidian/` (or the imperative `obsidian` API class). Don't restyle it with Tailwind — Obsidian's preflight handles appearance.
2. **Color** → pick a semantic token (`zt:text-muted`, `zt:bg-background`, `zt:text-accent-foreground`), not a raw palette one. Semantic tokens already track light/dark and the user's accent color. See `references/foundations.md`.
3. **Spacing / size** → use Tailwind's default spacing scale (`zt:gap-2`, `zt:p-3`, `zt:mt-4`). Obsidian's `--size-4-N` variables are just fixed multiples of 4px (never overridden by themes) and map 1:1 to Tailwind's scale, so there's no reason to use them directly.
4. **Radius** → `zt:rounded-sm/md/lg/xl` (mapped to `--radius-s/m/l/xl`).
5. **Typography** → `zt:text-xs/sm/base/lg` (mapped to Obsidian UI font sizes). See `references/foundations.md#typography`.
6. **A component CSS variable exists** (e.g. `--modal-background`, `--button-radius`, `--tab-text-color`) → use the arbitrary variable syntax (`zt:bg-(--modal-background)`) or extend `zt-main.css`. See `references/components.md`, `references/editor.md`, `references/window.md`, `references/plugins.md`.
7. **Nothing fits** → use the arbitrary variable syntax (`zt:bg-(--obsidian-var)`) to reference the Obsidian variable directly. If you want to expose it for user snippets, add a local custom property at your component root (`.zt-foo { --zt-foo-bg: var(--background-secondary); }`) and consume it via `zt:bg-(--zt-foo-bg)`.

## Obsidian element preflights

Obsidian fully styles `<button>`, `<input>` (all types), `<textarea>`, and `<select>` via its global stylesheet — see `references/preflights.md` for the full table. **Lean into this — don't fight it with Tailwind resets.**

### What this means for you

- **Don't add Tailwind background/border/padding/radius classes to these elements** — you'll be fighting Obsidian's styles. Use the elements bare and they look correct.
- **Tailwind layout classes are safe** — `zt:flex`, `zt:gap-2`, `zt:w-full`, `zt:mt-2` etc. don't conflict because Obsidian's preflight doesn't set layout on these elements.
- **Prefer native components** — bare `<input type="checkbox">`, `<input type="radio">`, and other preflighted elements need no wrapper. See next section for which elements have React wrappers and which don't.
- **The flip side** — non-form semantic elements (`blockquote`, `p`, headings, lists, `hr`, …) that Obsidian doesn't reset get cleaned up by a **scoped preflight** applied to plugin roots. See **Scoped preflight (`.zt-root`)** below.

## Scoped preflight (`.zt-root`)

`src/zt-main.css` applies Tailwind's preflight **scoped to plugin UI roots**, never globally:

```css
@layer theme, base, components, utilities;          /* explicit order: utilities > base */
@import "tailwindcss/theme.css" layer(theme) prefix(zt);
/* …@theme tokens… */
@import "tailwindcss/utilities.css" layer(utilities) prefix(zt);

@layer base {
  .zt-root { @import "tailwindcss/preflight.css"; } /* Tailwind inlines + scopes this at build */
}
```

**Add `zt-root` to the container the view owns** — `ItemView.contentEl`, a modal's `contentEl`, a settings pane — not inside the React tree. Then write normal **semantic HTML** — `<blockquote>`, `<p>`, `<ul>`/`<li>`, `<h2>`, `<hr>` — plus Tailwind border utilities; they render clean because preflight zeroes the UA margins/padding and sets `border-style: solid`. No `div role` workaround, no `border-solid`.

```tsx
// Set the scope on the container the view owns — not in the React tree:
class AnnotationView extends ItemView {
  async onOpen() {
    this.contentEl.classList.add("zt-root");
    createRoot(this.contentEl).render(<AnnotView />);
  }
}

// Inside, semantic HTML + border utilities just work — no div+role, no border-solid:
<blockquote className="zt:border-l-2 zt:pl-2" style={{ borderLeftColor: color }}>{text}</blockquote>
<p className="zt:select-text">{text}</p>
```

### Why it's safe

Preflight sits in `@layer base` — your `zt:` utilities (`@layer utilities`) outrank it, and Obsidian's unlayered stylesheet outranks *all* layers. So preflight only overrides **browser UA defaults** (the leaks you want gone: `<blockquote>` `margin:1em 40px`, `<p>` `margin:1em 0`, `<ul>`/`<ol>` 40px indent, etc.), while your spacing/border utilities and Obsidian's native control styles both work normally inside `.zt-root`.

### Caveats

- **It does NOT reset Obsidian's own *unlayered* bare-element rules** (unlayered beats `@layer base`). Per `references/app.css`, exactly **three** structural tags have them: `<hr>` (`border-top: var(--hr-thickness)` + `margin: 2rem 0`), `<h1>`–`<h6>` (per-level themed typography — size/weight/color/font/line-height — + `var(--p-spacing)` margin), and `<ol>` (`list-style-type: var(--list-numbered-style)` → **numbering survives**). Everything else (`<p>`, `<blockquote>`, `<ul>`, `<table>`, `<fieldset>`, …) has *no* bare Obsidian rule — those are pure Chrome UA, so preflight clears them (note the asymmetry: a bare `<ul>` loses its markers + 40px indent, but `<ol>` keeps its numbers). Neutralize the three with a utility/inline or a plain `<div>` if you don't want them.
- **`.zt-root` is for your own custom DOM.** Markdown rendered via `MarkdownRenderer` inside it still looks right (Obsidian's `.markdown-rendered` rules are unlayered → they win), but don't lean on preflight to style markdown.

### Borders

Inside `.zt-root` a width utility is all you need: `zt:border` / `zt:border-l-2` render **solid** (preflight supplies the style) and `zt:divide-y zt:divide-border` gives clean section rules — no `zt:border-solid` / `zt:divide-solid`. For a data-driven color (e.g. an annotation highlight) keep the width in the utility and set `style={{ borderLeftColor: color }}`.

### No `.zt-root`? (fallback)

Outside a scoped root there is no preflight, so a width utility sets only width — `border-style` stays `none` (so `zt:border` alone is invisible) and unset sides fall back to UA `medium`, making `zt:border-l-2 zt:border-solid` a full **box**. There, add `zt:border-solid` / set the border inline, or render a `<div>` with the matching ARIA role (`role="blockquote"`, `role="paragraph"`, `role="list"` + child `role="listitem"`, `role="heading"` + `aria-level`, `role="separator"`). Prefer adding `zt-root` — simpler, and keeps real semantics.

## Native components

Prefer Obsidian's native components over building custom equivalents from Tailwind primitives. They get automatic theme compatibility, accessibility, and consistent behavior across Obsidian versions.

**In React**, use the wrappers in `src/components/obsidian/` for components that need modifier-class logic or non-trivial behavior:

- `Button`, `IconButton`, `Toggle`, `Dropdown` (+ `DropdownItem`, `DropdownGroup`), `Slider`, `Color`, `Icon`, `SearchInput`

**`<input type="text/search/email/password/number/date/datetime-local">`, `<input type="checkbox">`, `<input type="radio">` and `<textarea>` need no wrapper.** Obsidian's preflight fully styles these elements — use them directly in JSX. Don't create thin React wrappers around them; the native elements already look correct.
- Use `AutosizeTextarea` from `react-textarea-autosize` when the textarea should expand with content (e.g. template editors, note fields). 

```tsx
// Correct — bare elements, Obsidian styles them
<input type="text" value={text} onChange={(e) => setText(e.currentTarget.value)} />
<textarea value={body} onChange={(e) => setBody(e.currentTarget.value)} rows={4} />
<input type="checkbox" checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
<input type="radio" name="group" value="a" checked={val === "a"} onChange={() => setVal("a")} />

// For auto-growing textareas, use the wrapper
<AutosizeTextarea value={body} onChange={setBody} minRows={2} maxRows={8} />
```

**In imperative DOM** (settings tabs, modals built with the Obsidian API), use the `obsidian` module classes directly:

- `ButtonComponent`, `ToggleComponent`, `TextComponent`, `TextAreaComponent`, `DropdownComponent`, `ColorComponent`, `SliderComponent`

Read the wrapper source files for the full API. Each wrapper's JSDoc links to `tooltipAttrs` for tooltip usage.

## Tooltips

Obsidian renders `aria-label` as a hover tooltip via global `pointerover` delegation. No extra library needed.

**React** — use `tooltipAttrs()` from `@/lib/utils` and spread onto the element:

```tsx
import { tooltipAttrs } from "@/lib/utils";

<Button variant="cta" {...tooltipAttrs("Saves the current file")}>
  Save
</Button>

<IconButton icon="settings" {...tooltipAttrs("Settings", { placement: "top" })} />
```

**Imperative DOM** — use `setTooltip` from the `obsidian` module:

```ts
import { setTooltip } from "obsidian";

setTooltip(buttonEl, "Saves the current file");
setTooltip(iconEl, "Settings", { placement: "top" });
```

## Light / dark and theming

Obsidian sets `.theme-light` or `.theme-dark` on `<body>`. Almost always you do **not** need to write theme-specific rules — Tailwind tokens resolve to semantic Obsidian variables that already swap. Only branch on theme when:

- You're computing your own color (e.g. an SVG fill) and need different values per scheme.
- You're tweaking shadow / blend modes which are scheme-sensitive.

For accent-aware colors, use `text-accent-foreground` / `bg-primary` rather than `text-blue-500`. The accent is user-configurable in **Settings → Appearance** and Obsidian rebuilds it from `--accent-h/s/l`.

For RGB-with-opacity overlays, pair the `-rgb` variant: `background: rgba(var(--color-red-rgb), 0.2)`.

## Scoping custom CSS

Tailwind utilities are inherently element-scoped — they don't leak. You rarely need a BEM-style root class.

Use a scoped root class only when:

- You need CSS rules that target child elements (e.g. styling children of a container).
- You want to expose custom properties for user snippets.
- You're writing a `@layer` rule that needs a specificity anchor.

When you do scope, prefix with `zt-`:

```css
.zt-zotero-pane {
  --zt-pane-padding-x: var(--size-4-4);
  --zt-pane-row-gap: var(--size-4-2);
  padding-inline: var(--zt-pane-padding-x);
}
.zt-zotero-pane__row { gap: var(--zt-pane-row-gap); }
```

Prefix custom properties with `--zt-…` to avoid colliding with Obsidian's. Default them to an Obsidian variable so the value flows through theme changes.

## Anti-patterns (and the fix)

**Hardcoded values** — break in non-default themes because themes override Obsidian's base variables, not your literals.

```tsx
// bad — color/spacing literals
<div className="zt:bg-[#2a2a2a] zt:text-[#ddd] zt:p-[8px_12px]" />
// good — semantic tokens + Tailwind scale
<div className="zt:bg-background zt:text-foreground zt:px-3 zt:py-2" />

// bad — manual dark mode (semantic tokens already swap)
<div className="zt:bg-white dark:zt:bg-[#1e1e1e]" />
// good
<div className="zt:bg-background" />
```

**Restyling a native element** — Obsidian's preflight already handles appearance; adding Tailwind bg/border/padding fights it and drifts across Obsidian versions.

```tsx
// bad
<button className="zt:bg-primary zt:text-primary-foreground zt:rounded-md zt:px-3 zt:py-1">Save</button>
// good — bare button is already styled; use mod-cta for primary variant
<Button variant="cta">Save</Button>
```

**Targeting Obsidian internals** — undocumented class names change between Obsidian releases.

```css
/* bad */
.workspace-leaf-content[data-type="zt-view"] .markdown-preview-view div.callout-title { … }
/* good — scope to your own root */
.zt-view .zt-callout-title { … }
```

**`!important` to win specificity** → restructure the selector instead. `!important` blocks user CSS snippets from ever overriding the value.

## Verifying

### Inspect the running UI with the `obsidian-cli` CLI

The dev test vault (`apps/obsidian/tests/zt-vault`) hot-reloads the plugin from a dev build, and the `obsidian-cli` command (wrapping the Obsidian.app binary at `/Applications/Obsidian.app/Contents/MacOS/obsidian` on macOS) drives the running app — so you can verify styling against the *real* rendered DOM instead of guessing. The loop:

1. **Build** → `pnpm --filter @zotlit/obsidian build:dev` (copies the bundle into the vault's `.obsidian/plugins/zotlit`).
2. **Reload** → `obsidian-cli plugin:reload id=zotlit`.
3. **Open the view** → `obsidian-cli command id=zotlit:<command-id>` (list them with `obsidian-cli commands filter=zotlit`), or `obsidian-cli eval code='…'` to mount it in a specific split.
4. **Measure — the DOM is the source of truth.** `obsidian-cli eval code='…'` runs JS in the app and returns the value. Use `getComputedStyle(el)` / `el.getBoundingClientRect()` to assert what actually rendered: confirm a token resolved (`getComputedStyle(el).backgroundColor`), catch a leaked UA style (a bare `<blockquote>` outside a `.zt-root` reporting `marginLeft: "40px"` — see **Scoped preflight** above), or compare left-edge offsets and element heights across components. A computed-style assertion is worth more than eyeballing a screenshot.
5. **Screenshot** → `obsidian-cli dev:screenshot path=<absolute-path>` (path must be absolute; save inside the workspace, never `/tmp`, and delete the throwaways when done — see the no-`/tmp` rule).
6. **Errors / logs** → `obsidian-cli dev:errors`, `obsidian-cli dev:console` (mock/`console.log` handlers show up here).

Two traps, learned the hard way:

- **Screenshots can be stale/transitional frames.** A capture taken immediately after a reload or `revealLeaf` may show the *old* DOM while the change is already live. Always cross-check a screenshot against an `eval` computed-style/DOM query; if they disagree, the DOM query wins — re-shoot. (A DevTools window open over Obsidian can also steal the capture — close it first.)
- **`obsidian-cli eval` has no `await`.** The code runs in a non-async wrapper, so a top-level `await` is a syntax error. Fire the promise and verify in a *follow-up* `eval` call, or grab references synchronously — e.g. hold the leaf returned by `getLeaf(...)` and `revealLeaf(it)` in the same call, rather than re-querying `getLeavesOfType(...)` right after an async `setViewState`, which races and returns an empty list.

### Cross-theme checklist

Then confirm it holds up across themes:

1. Toggle **Settings → Appearance → Base color scheme** between Light and Dark — your component should look correct in both with no extra CSS. Confirm which is active with `obsidian-cli eval code='document.body.className'` (expect `theme-light` / `theme-dark`).
2. Change the accent color — interactive elements should follow it.
3. Try a popular community theme (Minimal, Things) — your component should still look at home. If something feels off, you're probably hardcoding a value that the theme is overriding.

## Reference files

These are catalogs — read on demand, not all at once. Each file lists the Obsidian variables grouped by topic with one-line descriptions.

- `references/preflights.md` — which bare HTML elements Obsidian fully styles (button, input, textarea, select, checkbox, radio, toggle).
- `references/foundations.md` — colors (semantic + accent palette), spacing, typography, radiuses, borders, layers, icons, cursors. Read this first when you don't know which variable to use.
- `references/components.md` — buttons, inputs, dropdowns, checkboxes, toggles, sliders, modals/dialogs, popovers, prompts, tabs, navigation, pills (multi-select), color inputs, indentation guides, dragging.
- `references/editor.md` — markdown content: headings, links, tables, callouts, code, blockquotes, lists, tags, embeds, footnotes, properties, bases, inline title.
- `references/window.md` — workspace chrome: ribbon, sidebar, status bar, dividers, scrollbars, window frame, vault profile, workspace.
- `references/plugins.md` — built-in plugin views: file explorer, search, graph, canvas, sync.
- `references/app.css` — the full Obsidian v1.12.7 stylesheet. Consult when you need to understand exactly what Obsidian applies to a bare element or class.

To find a variable when you only have a CSS property in mind:

- "background color of a panel" → `zt:bg-background` / `zt:bg-card` (see `references/foundations.md`).
- "muted secondary text" → `zt:text-muted-foreground`.
- "the user's accent color" → `zt:bg-primary` (bg) or `zt:text-accent-foreground` (text).
- "a tab/pane border" → `zt:border-border`.
- "icon button hover bg" → `zt:bg-muted`.
- "modal/popover surface" → `zt:bg-popover` (see `references/components.md`).

