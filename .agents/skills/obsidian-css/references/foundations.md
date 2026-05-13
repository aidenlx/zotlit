# Foundations

Abstracted variables for colors, spacing, typography, radius, borders, layers, icons, and cursors. These are the most generally reusable variables — reach for these first.

## Colors

### Base palette

Neutral light↔dark scale. Don't consume directly in plugin styles — use the semantic colors below. (Themes define these to recolor the whole app at once.)

| Variable | Light default | Dark default |
| --- | --- | --- |
| `--color-base-00` | `#ffffff` | `#1e1e1e` |
| `--color-base-05` | `#fcfcfc` | `#212121` |
| `--color-base-10` | `#fafafa` | `#242424` |
| `--color-base-20` | `#f6f6f6` | `#262626` |
| `--color-base-25` | `#e3e3e3` | `#2a2a2a` |
| `--color-base-30` | `#e0e0e0` | `#363636` |
| `--color-base-35` | `#d4d4d4` | `#3f3f3f` |
| `--color-base-40` | `#bdbdbd` | `#555555` |
| `--color-base-50` | `#ababab` | `#666666` |
| `--color-base-60` | `#707070` | `#999999` |
| `--color-base-70` | `#5a5a5a` | `#bababa` |
| `--color-base-100` | `#222222` | `#dadada` |

### Accent color

User-configurable in **Settings → Appearance**. Use `--interactive-accent` / `--text-accent` in styles, not the HSL pieces directly.

| Variable | Notes |
| --- | --- |
| `--accent-h` | Hue |
| `--accent-s` | Saturation |
| `--accent-l` | Lightness |
| `--color-accent` | `hsl(var(--accent-h), var(--accent-s), var(--accent-l))` |
| `--color-accent-1` / `--color-accent-2` | Lighter shades derived from accent |

### Extended colors

For statuses, callouts, syntax highlighting, charts. Each has a `-rgb` companion for `rgba(...)` overlays.

| Variable | RGB companion | Used for |
| --- | --- | --- |
| `--color-red` | `--color-red-rgb` | error, danger |
| `--color-orange` | `--color-orange-rgb` | warning |
| `--color-yellow` | `--color-yellow-rgb` | |
| `--color-green` | `--color-green-rgb` | success |
| `--color-cyan` | `--color-cyan-rgb` | info, tip |
| `--color-blue` | `--color-blue-rgb` | info, link-ish |
| `--color-purple` | `--color-purple-rgb` | |
| `--color-pink` | `--color-pink-rgb` | |

Black/white for masks: `--mono-rgb-0` (paper) and `--mono-rgb-100` (ink). They swap in dark mode, so `rgba(var(--mono-rgb-100), 0.1)` is "ink at 10% in either scheme" — useful for hover veils.

### Semantic surface colors

These are what you almost always want for backgrounds and borders.

| Variable | Use |
| --- | --- |
| `--background-primary` | Default content surface (note body, plugin pane body) |
| `--background-primary-alt` | Layer above primary (raised cards on the main surface) |
| `--background-secondary` | Sidebars, panels, secondary chrome |
| `--background-secondary-alt` | Layer above secondary |
| `--background-modifier-hover` | Background for any hover state on a clickable row/cell/icon |
| `--background-modifier-active-hover` | Hover state when the element is also active/selected |
| `--background-modifier-border` | Default border / divider |
| `--background-modifier-border-hover` | Border on hover |
| `--background-modifier-border-focus` | Border on keyboard focus |
| `--background-modifier-error` | Error surface |
| `--background-modifier-error-rgb` | RGB version for `rgba(...)` |
| `--background-modifier-error-hover` | Error surface hover |
| `--background-modifier-success` | Success surface |
| `--background-modifier-success-rgb` | RGB version |
| `--background-modifier-message` | Inline message surface |
| `--background-modifier-form-field` | Background inside form inputs |

### Interactive (buttons, accents)

| Variable | Use |
| --- | --- |
| `--interactive-normal` | Standard button / control background |
| `--interactive-hover` | Standard button hover |
| `--interactive-accent` | Primary-action button background; uses the user's accent |
| `--interactive-accent-hover` | Primary-action button hover |
| `--interactive-accent-hsl` | HSL pieces of the accent (for `hsla` compositions) |

### Text colors

| Variable | Use |
| --- | --- |
| `--text-normal` | Body text |
| `--text-muted` | Secondary / supportive text |
| `--text-faint` | Tertiary / placeholder-ish text |
| `--text-on-accent` | Text on top of `--interactive-accent` when accent is dark |
| `--text-on-accent-inverted` | Text on top of accent when accent is light |
| `--text-success` | "Success" copy |
| `--text-warning` | "Warning" copy |
| `--text-error` | "Error" copy |
| `--text-accent` | Accent-colored text (link-like) |
| `--text-accent-hover` | Accent text on hover |
| `--text-selection` | Selected-text background |
| `--text-highlight-bg` | `==highlighted==` background |
| `--caret-color` | Text-entry caret |

## Spacing — the 4-pixel grid

Padding, margin, gap, width, and height should use these. They're multiples of 4px (and 2px for the finer ones). The two numbers are the base and the multiplier: `--size-4-3` = 4 × 3 = 12px.

| Variable | Value |
| --- | --- |
| `--size-2-1` | 2px |
| `--size-2-2` | 4px |
| `--size-2-3` | 6px |
| `--size-4-1` | 4px |
| `--size-4-2` | 8px |
| `--size-4-3` | 12px |
| `--size-4-4` | 16px |
| `--size-4-5` | 20px |
| `--size-4-6` | 24px |
| `--size-4-8` | 32px |
| `--size-4-9` | 36px |
| `--size-4-12` | 48px |
| `--size-4-16` | 64px |
| `--size-4-18` | 72px |

Use `--size-4-*` by default. Drop to `--size-2-*` only when the 4px step is too coarse (e.g. tight icon-row spacing).

## Radius

| Variable | Default |
| --- | --- |
| `--radius-s` | 4px (rows, cells, tags) |
| `--radius-m` | 8px (cards, popovers) |
| `--radius-l` | 12px (modals) |
| `--radius-xl` | 16px (very large surfaces) |

Many components also ship their own radius (e.g. `--button-radius`, `--input-radius`, `--modal-radius`, `--tab-radius`) which default to one of these. Prefer the component variable if it exists so users can tune that component specifically.

## Borders

| Variable | Default |
| --- | --- |
| `--border-width` | 1px |

Pair with `--background-modifier-border` for the color: `border: var(--border-width) solid var(--background-modifier-border);`

## Typography

### Fonts

| Variable | Use |
| --- | --- |
| `--font-interface-theme` | UI chrome (settings, toolbars, modals) |
| `--font-text-theme` | Editor / note body |
| `--font-monospace-theme` | Code blocks, inline code |

Use `var(--font-interface-theme)` only when you really need to override `font-family` — usually inheriting is fine.

### Font size

Relative sizes (`em`) in the editor; fixed sizes (`px`) in UI chrome.

| Variable | Default | Use |
| --- | --- | --- |
| `--font-text-size` | 16px | Editor body (user-controlled in Appearance) |
| `--font-smallest` | 0.8em | |
| `--font-smaller` | 0.875em | |
| `--font-small` | 0.933em | |
| `--font-ui-smaller` | 12px | UI captions, helper text |
| `--font-ui-small` | 13px | Default UI text |
| `--font-ui-medium` | 15px | Slightly emphasized UI text |
| `--font-ui-large` | 20px | Section headers in UI |

### Font weight

| Variable | Default |
| --- | --- |
| `--font-thin` | 100 |
| `--font-extralight` | 200 |
| `--font-light` | 300 |
| `--font-normal` | 400 |
| `--font-medium` | 500 |
| `--font-semibold` | 600 |
| `--font-bold` | 700 |
| `--font-extrabold` | 800 |
| `--font-black` | 900 |

`--font-weight` is the default body weight (resolves to `--font-normal`). `--bold-modifier` adds extra weight on top of that for `**bold**` text; recommended `100–300`.

### Line height & paragraph spacing

| Variable | Default | Use |
| --- | --- | --- |
| `--line-height-normal` | 1.5 | Body text |
| `--line-height-tight` | 1.3 | Search results, tree items, tooltips |
| `--heading-spacing` | derived from `--p-spacing` | Top margin above headings |
| `--p-spacing` | | Between paragraphs |

## Layers (z-index)

Use these instead of magic numbers so plugin overlays don't fight with Obsidian's chrome.

| Variable | Default |
| --- | --- |
| `--layer-cover` | 5 |
| `--layer-sidedock` | 10 |
| `--layer-status-bar` | 15 |
| `--layer-popover` | 30 |
| `--layer-slides` | 45 |
| `--layer-modal` | 50 |
| `--layer-notice` | 60 |
| `--layer-menu` | 65 |
| `--layer-tooltip` | 70 |
| `--layer-dragged-item` | 80 |

## Icons

Obsidian uses Lucide. These control the `<svg>` rendering.

| Variable | Use |
| --- | --- |
| `--icon-size` | Width/height shorthand (defaults to `--icon-m`) |
| `--icon-stroke` | Stroke width shorthand |
| `--icon-color` | Icon color |
| `--icon-color-hover` | Hover |
| `--icon-color-active` | Active |
| `--icon-color-focused` | Focused |
| `--icon-opacity` / `-hover` / `-active` | Opacity states |
| `--clickable-icon-radius` | Background radius for clickable icon buttons |

Sizes:

| Variable | Default | Stroke variable | Stroke default |
| --- | --- | --- | --- |
| `--icon-xs` | 14px | `--icon-xs-stroke-width` | 2px |
| `--icon-s` | 16px | `--icon-s-stroke-width` | 2px |
| `--icon-m` | 18px | `--icon-m-stroke-width` | 1.75px |
| `--icon-l` | 18px | `--icon-l-stroke-width` | 1.75px |
| `--icon-xl` | 32px | `--icon-xl-stroke-width` | 1.25px |

## Cursor

| Variable | Default | Use |
| --- | --- | --- |
| `--cursor` | `default` | Interactive elements (Obsidian follows OS convention: arrow, not pointer) |
| `--cursor-link` | `pointer` | Links specifically |

## Animations (informal)

Not documented as foundations but defined on `body`:

| Variable | Default |
| --- | --- |
| `--anim-duration-none` | 0 |
| `--anim-duration-superfast` | 70ms |
| `--anim-duration-fast` | 140ms |
| `--anim-duration-moderate` | 300ms |
| `--anim-duration-slow` | 560ms |
| `--anim-motion-smooth` | cubic-bezier(0.45, 0.05, 0.55, 0.95) |
| `--anim-motion-delay` | cubic-bezier(0.65, 0.05, 0.36, 1) |
| `--anim-motion-jumpy` | cubic-bezier(0.68, -0.55, 0.27, 1.55) |
| `--anim-motion-swing` | cubic-bezier(0, 0.55, 0.45, 1) |

## Shadows

Defined on `.theme-light` / `.theme-dark` so they swap per scheme:

| Variable | Use |
| --- | --- |
| `--shadow-xs` | Very subtle elevation |
| `--shadow-s` | Default raised surface (cards, dropdown) |
| `--shadow-l` | Popovers, modals |
| `--input-shadow` | Default state for form inputs |
| `--input-shadow-hover` | Hover/focus state |
