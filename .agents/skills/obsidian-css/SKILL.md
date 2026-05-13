---
name: obsidian-css
description: |
  How to style plugin components so they look native and stay compatible with every Obsidian
  theme. Use when writing or reviewing CSS / Less / scoped component styles in apps/obsidian/
  (e.g. `zt-main.css`, plugin views, settings UI, modals, embedded React components). Also use
  when adding a custom UI element (button, input, modal, callout, sidebar item, etc.) and you
  need to know which `--var(...)` to reach for, or when a color/spacing/radius hardcode is
  about to be added. If a question mentions "Obsidian theme support", "dark mode", "css
  variable", "obsidian colors", "looks broken in <theme name>", or hardcoded `#hex` / `px`
  values in plugin UI, this skill applies.
---

# Obsidian Plugin CSS Style Guide

Plugin UI should feel like part of Obsidian — same colors, same spacing, same dark/light handling — without the plugin needing to know which theme the user has installed. Theme authors do this by **overriding** Obsidian's built-in CSS variables; plugin authors do it by **consuming** them. This skill is about consuming them correctly.

The single biggest mistake is hardcoding values (`#1e1e1e`, `12px`, `1px solid #ccc`) instead of using `var(--…)`. Hardcoded values look fine in the default theme and break in every other theme. Anything that has a corresponding Obsidian variable should use it.

## The five rules

1. **Use `var(--…)` for any visible value** — color, font size, spacing, radius, border, shadow, z-index, icon size. If Obsidian has a variable for it, use that variable. See `references/foundations.md` and the component reference files.
2. **Never hardcode colors.** No `#hex`, no `rgb(…)`, no named colors in feature CSS. Always go through a variable so the user's theme + light/dark choice flows through.
3. **Use the 4-pixel spacing grid.** Use `--size-4-1` … `--size-4-18` (and `--size-2-*` sparingly) for padding, margin, gap, width, height. Never `8px` directly. Same with radiuses: `--radius-s/m/l/xl`.
4. **Avoid `!important`.** It blocks user snippets from customizing your plugin and is almost always a sign the selector should be simpler. Increase specificity by scoping to your plugin's root class instead.
5. **Keep selectors low-specificity and scoped.** Wrap your component in a single root class (e.g. `.zt-database-status`) and write styles relative to it. Don't target Obsidian's internal class names beyond what's documented — they change between versions.

## Quick decision tree

Picking a variable goes:

1. **Color** → pick a *semantic* variable (`--text-muted`, `--background-secondary`, `--interactive-accent`), not a raw palette one (`--color-base-30`, `--color-blue`). Semantic variables already track light/dark and the user's accent color. See `references/colors.md`.
2. **Spacing / size** → `--size-4-N` (multiples of 4px). See `references/foundations.md`.
3. **Radius** → `--radius-s/m/l/xl`, or the component's own `--*-radius` if it exists (e.g. `--button-radius`, `--input-radius`).
4. **Typography** → relative sizes (`--font-smaller`) inside the editor, fixed sizes (`--font-ui-small`, `--font-ui-medium`) in UI chrome. See `references/foundations.md#typography`.
5. **A component variable exists** (e.g. `--modal-background`, `--button-radius`, `--tab-text-color`) → use it. Component variables compose with semantic ones, so this gives users two levels of override. See `references/components.md`, `references/editor.md`, `references/window.md`, `references/plugins.md`.
6. **Nothing fits** → fall back to the most specific semantic variable that does, and add a local custom property at your component's root so users can override (`.zt-foo { --zt-foo-bg: var(--background-secondary); background: var(--zt-foo-bg); }`).

## Light / dark and theming

Obsidian sets `.theme-light` or `.theme-dark` on `<body>`. Almost always you do **not** need to write `.theme-dark .my-component` rules — semantic variables already swap. Only branch on theme when:

- You're computing your own color (e.g. an SVG fill) and need different values per scheme.
- You're tweaking shadow / blend modes which are scheme-sensitive.

Even then, set a local custom property under `.theme-light .zt-foo { --zt-foo-overlay: rgba(0,0,0,.04); }` and consume it once — don't duplicate whole rule blocks.

For accent-aware colors, use `--interactive-accent` (background) and `--text-accent` (text) rather than `--color-blue`. The accent is user-configurable in **Settings → Appearance** and Obsidian rebuilds it from `--accent-h/s/l`.

For RGB-with-opacity overlays, pair the `-rgb` variant: `background: rgba(var(--color-red-rgb), 0.2)`.

## Plugin scoping pattern

```css
/* Root class scopes the whole feature. */
.zt-citation-card {
  background: var(--background-secondary);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3) var(--size-4-4);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}

.zt-citation-card:hover {
  background: var(--background-modifier-hover);
}

.zt-citation-card__title {
  color: var(--text-normal);
  font-weight: var(--font-semibold);
}

.zt-citation-card__meta {
  color: var(--text-muted);
  font-size: var(--font-smaller);
}

.zt-citation-card__action {
  color: var(--text-accent);
}
.zt-citation-card__action:hover {
  color: var(--text-accent-hover);
}
```

A reader who knows Obsidian's variables can predict exactly how this renders in any theme.

## Anti-patterns (and the fix)

**Hardcoded color** → swap for a semantic variable.

```css
/* bad */
.zt-tag { background: #2a2a2a; color: #ddd; }
/* good */
.zt-tag { background: var(--background-secondary); color: var(--text-normal); }
```

**Hardcoded spacing** → use the 4px grid.

```css
/* bad */
.zt-row { padding: 8px 12px; gap: 6px; }
/* good */
.zt-row { padding: var(--size-4-2) var(--size-4-3); gap: var(--size-2-3); }
```

**Manual dark mode** → trust semantic variables.

```css
/* bad */
.zt-toolbar { background: #fff; }
.theme-dark .zt-toolbar { background: #1e1e1e; }
/* good */
.zt-toolbar { background: var(--background-primary); }
```

**Targeting Obsidian internals**:

```css
/* bad — relies on undocumented class, likely to break */
.workspace-leaf-content[data-type="zt-view"] .markdown-preview-view div.callout-title { … }
/* good — scope to your own root */
.zt-view .zt-callout-title { … }
```

**`!important` to win specificity** → restructure the selector instead. Almost every legitimate use is in a snippet, not in plugin code.

## When to inject your own variables

If a value is reused across many rules, or you want to expose it for user snippets, declare a custom property at your component root:

```css
.zt-zotero-pane {
  --zt-pane-padding-x: var(--size-4-4);
  --zt-pane-row-gap: var(--size-4-2);

  padding-inline: var(--zt-pane-padding-x);
}
.zt-zotero-pane__row { gap: var(--zt-pane-row-gap); }
```

Prefix custom properties with the plugin name (`--zt-…`) to avoid colliding with Obsidian's. Default them to an Obsidian variable so the value flows through theme changes.

## Inline styles (React / TS)

The same rules apply. Use string values that reference Obsidian variables:

```ts
<div style={{
  background: "var(--background-secondary)",
  padding: "var(--size-4-3) var(--size-4-4)",
  borderRadius: "var(--radius-s)",
}} />
```

Don't compute hex values in JS — let CSS do it.

## Verifying

Before declaring a component "done":

1. Toggle **Settings → Appearance → Base color scheme** between Light and Dark — your component should look correct in both with no extra CSS.
2. Change the accent color — interactive elements should follow it.
3. Try a popular community theme (Minimal, Things) — your component should still look at home. If something feels off, you're probably hardcoding a value that the theme is overriding.

## Reference files

These are catalogs — read on demand, not all at once. Each file lists the Obsidian variables grouped by topic with one-line descriptions.

- `references/foundations.md` — colors, spacing, typography, radiuses, borders, layers, icons, cursors. Read this first when you don't know which variable to use.
- `references/components.md` — buttons, inputs, dropdowns, checkboxes, toggles, sliders, modals/dialogs, popovers, prompts, tabs, navigation, pills (multi-select), color inputs, indentation guides, dragging.
- `references/editor.md` — markdown content: headings, links, tables, callouts, code, blockquotes, lists, tags, embeds, footnotes, properties, bases, inline title.
- `references/window.md` — workspace chrome: ribbon, sidebar, status bar, dividers, scrollbars, window frame, vault profile, workspace.
- `references/plugins.md` — built-in plugin views: file explorer, search, graph, canvas, sync.

To find a variable when you only have a CSS property in mind:

- "background color of a panel" → `--background-primary` / `--background-secondary` (see `references/foundations.md#colors`).
- "muted secondary text" → `--text-muted`.
- "the user's accent color" → `--interactive-accent` (bg) or `--text-accent` (text).
- "a tab/pane border" → `--background-modifier-border`.
- "icon button hover bg" → `--background-modifier-hover`.
- "modal/popover surface" → `--modal-background` (see `references/components.md#modal`).
