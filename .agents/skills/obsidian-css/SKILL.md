---
name: obsidian-css
description: "Style Obsidian plugin UI Tailwind-first with native components. Use when writing or reviewing any styled React/JSX or CSS in apps/obsidian/ — picking colors, spacing, typography, borders, radius, shadows, dark-mode tokens, the `zt:` prefix, `.zt-root` preflight setup, component wrapper selection, or deciding between a utility, a native element, and a stylesheet."
---

# Obsidian Plugin CSS & Tailwind Style Guide

Plugin UI should feel like part of Obsidian under whatever theme the user installed. Theme authors get that by **overriding** Obsidian's CSS variables; plugin authors get it by **consuming** them — through Tailwind tokens that are backed by those variables.

## Tailwind-first

Every style is a `zt:`-prefixed utility on the element that needs it; a stylesheet is the narrow exception [`policies/tailwind-first.md`](../../../apps/obsidian/policies/tailwind-first.md) admits.

- **The `zt:` prefix is on every utility** — `zt:flex`, `zt:gap-2`, `zt:bg-background`, `zt:rounded-md` — and variants chain after it: `zt:hover:opacity-100`, `zt:@md:columns-2`. Tailwind v4's `prefix()` scopes the compiled selectors so they never collide with another plugin's output. The `@theme` variables in `src/zt-main.css` keep their authored names (no prefix).
- **No token for an Obsidian variable** → reference it directly with the arbitrary-variable syntax — `zt:bg-(--modal-background)`, `zt:p-(--size-4-3)` — or extend `zt-main.css` following the existing pattern.
- **Merge with `cn()`** from `@/lib/utils` (prefix-aware `twMerge`), and compose Obsidian modifier classes (`mod-cta`, `is-enabled`, `clickable-icon`) with `tv` from `@/lib/tw` rather than `tailwind-variants` directly. The wrappers in `src/components/obsidian/` are the pattern.

## The three rules

1. **Tokens, never literals.** A `#hex`, an `rgb(…)`, or an `8px` looks right in the default theme and breaks in every other one. Semantic tokens also already track light/dark and the user's accent, so manual dark-mode variants are dead weight.

   ```tsx
   <div className="zt:bg-[#2a2a2a] zt:text-[#ddd] zt:p-[8px_12px]" />   // bad
   <div className="zt:bg-white dark:zt:bg-[#1e1e1e]" />                  // bad
   <div className="zt:bg-background zt:text-foreground zt:px-3 zt:py-2" /> // good
   ```

2. **Native elements bare.** Obsidian fully styles `<button>`, `<input>` (every type), `<textarea>`, `<select>`, and the toggle — background, border, padding, radius, height, focus and disabled states. Utilities on them cover layout only (`zt:flex`, `zt:w-full`, `zt:mt-2`); appearance utilities fight Obsidian and drift across releases.

   ```tsx
   <button className="zt:bg-primary zt:rounded-md zt:px-3 zt:py-1">Save</button>  // bad
   <Button variant="cta">Save</Button>                                            // good
   ```

3. **No `!important`; scope custom CSS low.** `!important` blocks user snippets from ever overriding you. Scope under a `zt-`-prefixed class, target your own DOM rather than Obsidian internals (`.workspace-leaf-content[data-type=…] .callout-title` breaks on the next release), and expose knobs as `--zt-…` properties defaulted to an Obsidian variable.

## Quick decision tree

1. **A native component exists** → the React wrapper from `src/components/obsidian/`, or the imperative `obsidian` class in DOM-built UI (see **Native components**).
2. **Color** → a semantic token (`zt:text-muted`, `zt:bg-background`, `zt:text-accent-foreground`), never a raw palette one. For an RGB overlay, pair the `-rgb` variant: `rgba(var(--color-red-rgb), 0.2)`.
3. **Spacing / size** → Tailwind's default scale (`zt:gap-2`, `zt:p-3`). Obsidian's `--size-4-N` are fixed 4px multiples no theme overrides, so they map 1:1.
4. **Radius** → `zt:rounded-sm/md/lg/xl` (`--radius-s/m/l/xl`). **Typography** → `zt:text-xs/sm/base/lg`.
5. **A modal body can outgrow the window** → `mod-scrollable-content` on `modalEl` plus a `.modal-button-container`; read [`modal-layout.md`](modal-layout.md).
6. **A component variable exists** (`--modal-background`, `--button-radius`, `--tab-text-color`) → arbitrary-variable syntax, or extend `zt-main.css`.

`references/foundations.md` is where to look first when you don't know which variable to use.

## Scoped preflight (`.zt-root`)

`src/zt-main.css` applies Tailwind's preflight scoped to plugin UI roots, never globally:

```css
@layer theme, base, components, utilities;          /* explicit order: utilities > base */
@import "tailwindcss/theme.css" layer(theme) prefix(zt);
@import "tailwindcss/utilities.css" layer(utilities) prefix(zt);

@layer base {
  .zt-root { @import "tailwindcss/preflight.css"; }  /* Tailwind inlines + scopes this at build */
}
```

**Mark the container the view owns** — `ItemView.contentEl`, a modal's `contentEl`, a settings pane — rather than a node inside the React tree:

```tsx
class AnnotationView extends ItemView {
  async onOpen() {
    this.contentEl.classList.add("zt-root");
    createRoot(this.contentEl).render(<AnnotView />);
  }
}
```

Inside it, write semantic HTML — `<blockquote>`, `<p>`, `<ul>`/`<li>`, `<h2>`, `<hr>` — and a width utility is a full border (`zt:border-l-2`, `zt:divide-y zt:divide-border`) because preflight supplies `border-style: solid`. For a data-driven color keep the width in the utility and set `style={{ borderLeftColor: color }}`.

It is safe because preflight sits in `@layer base`: your `zt:` utilities (`@layer utilities`) outrank it, and Obsidian's unlayered stylesheet outranks every layer. So preflight only clears browser UA defaults — `<blockquote>`'s `margin: 1em 40px`, `<p>`'s `margin: 1em 0`, the 40px list indent.

That same cascade means Obsidian's own unlayered bare-element rules survive inside `.zt-root`, and the set is wider than it looks (`<hr>`, headings, `<ol>`, `a`, `kbd`, `button`, `:focus { outline: none }`, …). `references/preflights.md` has the full list, plus what to do outside a scoped root. Markdown rendered by `MarkdownRenderer` inside `.zt-root` still looks right for the same reason — `.markdown-rendered` rules are unlayered and win.

## Native components

- **React** — wrappers in `src/components/obsidian/` for anything needing modifier-class logic: `Button`, `IconButton`, `Toggle`, `Dropdown` (+ `DropdownItem`, `DropdownGroup`), `Slider`, `Color`, `Icon`, `SearchInput`. Read the source for each API.
- **Bare in JSX** — `<input type="text/search/email/password/number/date/datetime-local">`, `<input type="checkbox">`, `<input type="radio">`, `<textarea>`. Obsidian's preflight styles these fully, so they take no wrapper. Reach for `AutosizeTextarea` from `react-textarea-autosize` when a textarea should grow with its content.
- **Imperative DOM** (setting tabs, API-built modals) — `ButtonComponent`, `ToggleComponent`, `TextComponent`, `TextAreaComponent`, `DropdownComponent`, `ColorComponent`, `SliderComponent` from the `obsidian` module.
- **Tooltips** are `aria-label`, spread through `tooltipAttrs` — [`policies/tooltips.md`](../../../apps/obsidian/policies/tooltips.md) is the rule.

## Verifying

Run `/obsidian-debug` for the build → reload → eval → screenshot loop. The probes worth running in it:

- `getComputedStyle(el)` to confirm a token resolved, and to catch a leaked UA style (a bare `<blockquote>` outside `.zt-root` reporting `marginLeft: "40px"`).
- `getBoundingClientRect()` to compare left edges and heights across components.
- `document.body.className` to confirm which scheme is live, then toggle **Settings → Appearance → Base color scheme** and change the accent — both should need no extra CSS. A popular community theme (Minimal, Things) is the last check; anything that looks off is usually a hardcoded value the theme is overriding.

## Reference files

Catalogs of Obsidian variables — read on demand, one topic at a time.

- `references/foundations.md` — colors (semantic + accent palette), spacing, typography, radiuses, borders, layers, icons, cursors. **Start here.**
- `references/preflights.md` — which bare elements Obsidian styles, which unlayered rules survive `.zt-root`, and the no-preflight fallback.
- `references/components.md` — buttons, inputs, dropdowns, checkboxes, toggles, sliders, modals, popovers, prompts, tabs, navigation, pills, color inputs, indentation guides, dragging.
- `references/editor.md` — markdown content: headings, links, tables, callouts, code, blockquotes, lists, tags, embeds, footnotes, properties, bases, inline title.
- `references/window.md` — workspace chrome: ribbon, sidebar, status bar, dividers, scrollbars, window frame, vault profile.
- `references/plugins.md` — built-in plugin views: file explorer, search, graph, canvas, sync.

When a catalog leaves a question open — exactly what Obsidian applies to an element, whether a rule is layered — read Obsidian's own stylesheet: `/obsidian-asar-extract` writes `app.css` next to `app.js` in `node_modules/.ob-rev-<version>/`, and `rg` over it answers against the exact version you build for.
