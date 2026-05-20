---
name: obsidian-css
description: Style Obsidian plugin UI with Tailwind + native components. Use when authoring UI in apps/obsidian/, picking style tokens, or choosing between Tailwind/native/custom approaches.
paths:
  - "apps/obsidian/**/*.css"
  - "apps/obsidian/**/*.tsx"
---

# Obsidian Plugin CSS & Tailwind Style Guide

Plugin UI should feel like part of Obsidian — same colors, same spacing, same dark/light handling — without the plugin needing to know which theme the user has installed. Theme authors do this by **overriding** Obsidian's built-in CSS variables; plugin authors do it by **consuming** them through Tailwind utility classes.

The biggest mistake is hardcoding values (`#1e1e1e`, `12px`, `1px solid #ccc`). Hardcoded values look fine in the default theme and break in every other theme. Always use Tailwind tokens, which are backed by Obsidian CSS variables.

## Styling approach

**Tailwind-first.** Default to Tailwind utility classes for all styling. Avoid writing raw CSS stylesheets. The Tailwind theme in `src/zt-main.css` maps Obsidian CSS variables to Tailwind tokens, so classes like `bg-background`, `text-foreground`, `rounded-md` resolve to the right Obsidian variables at runtime.

When no Tailwind token exists for an Obsidian variable, either extend `zt-main.css` (follow the existing pattern) or use Tailwind's arbitrary CSS variable syntax: `bg-(--obsidian-var)`, `text-(--some-color)`, `p-(--size-4-3)`, etc. These compile to `var(--…)` at build time with full utility support.

Use `cn()` from `@/lib/utils` to merge Tailwind classes with conflict resolution — never raw string concatenation.

For React components with Obsidian modifier classes (`mod-cta`, `is-enabled`, `clickable-icon`), use `tailwind-variants` (`tv`) for variant composition — see the existing wrappers in `src/components/obsidian/` for the pattern.

## The three rules

1. **Use Tailwind tokens, never hardcode.** No `#hex`, no `rgb(…)`, no `8px` in feature code. Use the mapped tokens (`bg-background`, `text-muted`, `text-sm`, `rounded-md`, `shadow-md`). For spacing, Tailwind's default scale (`gap-2`, `p-3`, `mt-4`) is fine — Obsidian's `--size-4-N` variables are just fixed `4px` multiples that no theme overrides. If a *color/radius/shadow* value has no token, extend `zt-main.css` or use `var(--…)` inline. See `references/foundations.md` and the component reference files for available Obsidian variables.
2. **Prefer native components over custom elements.** Obsidian fully styles `<button>`, `<input>`, `<select>`, `<textarea>`, and toggle (`.checkbox-container`) via its own preflight. Use the React wrappers in `src/components/obsidian/` or the imperative `obsidian` API classes (`ButtonComponent`, `ToggleComponent`, etc.) instead of rebuilding these from scratch. See the **Obsidian element preflights** section below.
3. **No `!important`, keep custom CSS scoped.** `!important` blocks user snippets. If you need custom CSS beyond Tailwind utilities (e.g. exposing custom properties for user snippets, targeting child elements), scope it under a root class prefixed `zt-` and keep specificity low. Don't target Obsidian's internal class names beyond what's documented.

## Quick decision tree

Picking a style goes:

1. **A native component exists** → use the React wrapper from `src/components/obsidian/` (or the imperative `obsidian` API class). Don't restyle it with Tailwind — Obsidian's preflight handles appearance.
2. **Color** → pick a semantic token (`text-muted`, `bg-background`, `text-accent-foreground`), not a raw palette one. Semantic tokens already track light/dark and the user's accent color. See `references/colors.md`.
3. **Spacing / size** → use Tailwind's default spacing scale (`gap-2`, `p-3`, `mt-4`). Obsidian's `--size-4-N` variables are just fixed multiples of 4px (never overridden by themes) and map 1:1 to Tailwind's scale, so there's no reason to use them directly.
4. **Radius** → `rounded-sm/md/lg/xl` (mapped to `--radius-s/m/l/xl`).
5. **Typography** → `text-xs/sm/base/lg` (mapped to Obsidian UI font sizes). See `references/foundations.md#typography`.
6. **A component CSS variable exists** (e.g. `--modal-background`, `--button-radius`, `--tab-text-color`) → use the arbitrary variable syntax (`bg-(--modal-background)`) or extend `zt-main.css`. See `references/components.md`, `references/editor.md`, `references/window.md`, `references/plugins.md`.
7. **Nothing fits** → use the arbitrary variable syntax (`bg-(--obsidian-var)`) to reference the Obsidian variable directly. If you want to expose it for user snippets, add a local custom property at your component root (`.zt-foo { --zt-foo-bg: var(--background-secondary); }`) and consume it via `bg-(--zt-foo-bg)`.

## Obsidian element preflights

Obsidian fully styles `<button>`, `<input>` (all types), `<textarea>`, and `<select>` via its global stylesheet — see `references/preflights.md` for the full table. **Lean into this — don't fight it with Tailwind resets.**

### What this means for you

- **Don't add Tailwind background/border/padding/radius classes to these elements** — you'll be fighting Obsidian's styles. Use the elements bare and they look correct.
- **Tailwind layout classes are safe** — `flex`, `gap-2`, `w-full`, `mt-2` etc. don't conflict because Obsidian's preflight doesn't set layout on these elements.
- **Prefer native components** — bare `<input type="checkbox">`, `<input type="radio">`, and other preflighted elements need no wrapper. See next section for which elements have React wrappers and which don't.

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

**Hardcoded color** → use a Tailwind token.

```tsx
// bad
<div className="bg-[#2a2a2a] text-[#ddd]" />
// good
<div className="bg-background text-foreground" />
```

**Hardcoded spacing** → use Tailwind spacing.

```tsx
// bad
<div className="p-[8px_12px] gap-[6px]" />
// good
<div className="px-3 py-2 gap-1.5" />
```

**Manual dark mode** → trust semantic tokens.

```tsx
// bad
<div className="bg-white dark:bg-[#1e1e1e]" />
// good
<div className="bg-background" />
```

**Restyling a native element** → let Obsidian's preflight work.

```tsx
// bad — fighting Obsidian's button styles
<button className="bg-primary text-primary-foreground rounded-md px-3 py-1">Save</button>
// good — bare button is already styled; use mod-cta for primary variant
<Button variant="cta">Save</Button>
```

**Targeting Obsidian internals**:

```css
/* bad — relies on undocumented class, likely to break */
.workspace-leaf-content[data-type="zt-view"] .markdown-preview-view div.callout-title { … }
/* good — scope to your own root */
.zt-view .zt-callout-title { … }
```

`**!important` to win specificity** → restructure the selector. Almost every legitimate use is in a snippet, not in plugin code.

## When to inject your own CSS variables

If a value is reused across many rules, or you want to expose it for user snippets, declare a custom property at your component root:

```css
.zt-zotero-pane {
  --zt-pane-padding-x: var(--size-4-4);
  padding-inline: var(--zt-pane-padding-x);
}
```

Prefix with `--zt-…` and default to an Obsidian variable.

## Verifying

Before declaring a component "done":

1. Toggle **Settings → Appearance → Base color scheme** between Light and Dark — your component should look correct in both with no extra CSS.
2. Change the accent color — interactive elements should follow it.
3. Try a popular community theme (Minimal, Things) — your component should still look at home. If something feels off, you're probably hardcoding a value that the theme is overriding.

## Reference files

These are catalogs — read on demand, not all at once. Each file lists the Obsidian variables grouped by topic with one-line descriptions.

- `references/preflights.md` — which bare HTML elements Obsidian fully styles (button, input, textarea, select, checkbox, radio, toggle).
- `references/foundations.md` — colors, spacing, typography, radiuses, borders, layers, icons, cursors. Read this first when you don't know which variable to use.
- `references/colors.md` — semantic color variables, light/dark, accent palette.
- `references/components.md` — buttons, inputs, dropdowns, checkboxes, toggles, sliders, modals/dialogs, popovers, prompts, tabs, navigation, pills (multi-select), color inputs, indentation guides, dragging.
- `references/editor.md` — markdown content: headings, links, tables, callouts, code, blockquotes, lists, tags, embeds, footnotes, properties, bases, inline title.
- `references/window.md` — workspace chrome: ribbon, sidebar, status bar, dividers, scrollbars, window frame, vault profile, workspace.
- `references/plugins.md` — built-in plugin views: file explorer, search, graph, canvas, sync.
- `references/app.css` — the full Obsidian v1.12.7 stylesheet. Consult when you need to understand exactly what Obsidian applies to a bare element or class.

To find a variable when you only have a CSS property in mind:

- "background color of a panel" → `bg-background` / `bg-card` (see `references/foundations.md#colors`).
- "muted secondary text" → `text-muted-foreground`.
- "the user's accent color" → `bg-primary` (bg) or `text-accent-foreground` (text).
- "a tab/pane border" → `border-border`.
- "icon button hover bg" → `bg-muted`.
- "modal/popover surface" → `bg-popover` (see `references/components.md#modal`).

