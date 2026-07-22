# Editor & Markdown Content

Variables for markdown elements rendered inside notes — headings, links, tables, callouts, code, etc. Use these when your plugin renders markdown-like content (e.g. embedded previews, custom views that mimic note rendering).

## Headings (H1–H6)

Each level has matching `color`, `font`, `letter-spacing`, `line-height`, `size`, `style`, `variant`, and `weight` variables. The pattern: `--h<N>-<property>`.

| Pattern | Example | Notes |
| --- | --- | --- |
| `--h<N>-color` | `--h1-color` | Defaults to `inherit` |
| `--h<N>-font` | `--h2-font` | Defaults to `inherit` |
| `--h<N>-line-height` | `--h3-line-height` | |
| `--h<N>-size` | `--h4-size` | Relative `em` (e.g. `1.618em` for H1) |
| `--h<N>-style` | `--h5-style` | `normal`/`italic` |
| `--h<N>-variant` | `--h6-variant` | `font-variant` |
| `--h<N>-weight` | `--h1-weight` | |

Other:

| Variable | Use |
| --- | --- |
| `--heading-formatting` | Color of the `#`/`##` markdown syntax tokens |
| `--heading-spacing` | Top margin above headings |

## Inline title (note title above the editor)

Inherits from H1 by default.

| Variable | Use |
| --- | --- |
| `--inline-title-color` |  |
| `--inline-title-font` |  |
| `--inline-title-size` |  |
| `--inline-title-line-height` |  |
| `--inline-title-style` |  |
| `--inline-title-variant` |  |
| `--inline-title-weight` |  |

## Links

Three flavors: resolved internal, unresolved internal, external. Override surgically.

### Resolved internal

| Variable | Use |
| --- | --- |
| `--link-color` | Text color |
| `--link-color-hover` | Hover |
| `--link-decoration` | Text decoration (default: `underline`) |
| `--link-decoration-hover` | Hover decoration |
| `--link-decoration-thickness` | Decoration thickness |
| `--link-weight` | Font weight |

### Unresolved internal

| Variable | Use |
| --- | --- |
| `--link-unresolved-color` | Text color |
| `--link-unresolved-opacity` | Opacity |
| `--link-unresolved-filter` | CSS filter (e.g. `hue-rotate`) |
| `--link-unresolved-decoration-style` | Decoration style |
| `--link-unresolved-decoration-color` | Decoration color |

### External

| Variable | Use |
| --- | --- |
| `--link-external-color` | Text color |
| `--link-external-color-hover` | Hover |
| `--link-external-decoration` | Decoration |
| `--link-external-decoration-hover` | Hover decoration |

## Callouts

Container:

| Variable | Use |
| --- | --- |
| `--callout-padding` | Container padding |
| `--callout-radius` | Container corner radius |
| `--callout-border-width` | Border width |
| `--callout-border-opacity` | Border opacity |
| `--callout-blend-mode` | Blend mode (helps nested callouts mix colors) |
| `--callout-title-color` | Title color (default: `inherit`) |
| `--callout-title-padding` | Title padding |
| `--callout-title-size` | Title size |
| `--callout-title-weight` | Title weight |
| `--callout-content-padding` | Content area padding |
| `--callout-content-background` | Content area background |

Type colors (RGB triplets so you can `rgba(var(--callout-info), 0.2)`). Each maps to one or more callout aliases.

| Variable | Aliases |
| --- | --- |
| `--callout-bug` | `bug` |
| `--callout-default` | `default`, `note` |
| `--callout-error` | `error`, `danger` |
| `--callout-example` | `example` |
| `--callout-fail` | `fail`, `failure`, `missing` |
| `--callout-important` | `important` |
| `--callout-info` | `info` |
| `--callout-question` | `question`, `help`, `faq` |
| `--callout-success` | `success`, `check`, `done` |
| `--callout-summary` | `summary`, `abstract`, `tldr` |
| `--callout-tip` | `tip`, `hint` |
| `--callout-todo` | `todo` |
| `--callout-warning` | `warning`, `caution`, `attention` |
| `--callout-quote` | `quote`, `cite` |

## Code

| Variable | Use |
| --- | --- |
| `--code-background` | Background of code blocks and inline code |
| `--code-size` | Font size |
| `--code-white-space` | `white-space` value |

### Syntax highlighting

| Variable | Use |
| --- | --- |
| `--code-normal` | Non-highlighted syntax |
| `--code-comment` | Comments |
| `--code-function` | Functions |
| `--code-important` | Important markers, regex |
| `--code-keyword` | Keywords |
| `--code-operator` | Operators |
| `--code-property` | Properties |
| `--code-punctuation` | Punctuation |
| `--code-string` | Strings |
| `--code-tag` | Tags, symbols, constants |
| `--code-value` | Values |

## Blockquotes

| Variable | Use |
| --- | --- |
| `--blockquote-background-color` | Background |
| `--blockquote-border-thickness` | Left border thickness |
| `--blockquote-border-color` | Left border color |
| `--blockquote-color` | Text color |
| `--blockquote-font-style` | Font style |

## Lists

| Variable | Use |
| --- | --- |
| `--list-indent` | Indent for nested items |
| `--list-indent-editing` | Indent in Live Preview |
| `--list-indent-source` | Indent in Source mode |
| `--list-spacing` | Vertical spacing between items |
| `--list-marker-color` | Bullet/marker color |
| `--list-marker-color-hover` | Hover |
| `--list-marker-color-collapsed` | Collapsed-item marker |
| `--list-bullet-border` | Bullet border |
| `--list-bullet-end-padding` | Padding after the bullet |
| `--list-bullet-radius` | Bullet radius |
| `--list-bullet-size` | Bullet width/height |
| `--list-bullet-transform` | `transform` on the bullet |
| `--list-numbered-style` | `list-style-type` for numbered lists |

## Tables

| Variable | Use |
| --- | --- |
| `--table-background` | Cell background |
| `--table-border-width` | Border width |
| `--table-border-color` | Border color |
| `--table-cell-vertical-alignment` | Cell `vertical-align` |
| `--table-white-space` | `white-space` |
| `--table-line-height` | Line height in cells |
| `--table-text-size` | Cell font size |
| `--table-text-color` | Cell text color |
| `--table-header-background` | Header background |
| `--table-header-background-hover` | Header hover |
| `--table-header-border-width` | Header border width |
| `--table-header-border-color` | Header border color |
| `--table-header-font` | Header font family |
| `--table-header-size` | Header font size |
| `--table-header-weight` | Header weight |
| `--table-header-color` | Header text color |
| `--table-column-max-width` | Max column width |
| `--table-column-alt-background` | Alternating column background |
| `--table-column-first-border-width` | First column left border |
| `--table-column-last-border-width` | Last column right border |
| `--table-row-background-hover` | Row hover |
| `--table-row-alt-background` | Alternating row background |
| `--table-row-alt-background-hover` | Alternating row hover |
| `--table-row-last-border-width` | Last row bottom border |
| `--table-selection` | Selection background |
| `--table-selection-blend-mode` | Selection blend mode |
| `--table-selection-border-color` | Selection border |
| `--table-selection-border-width` | Selection border width |
| `--table-selection-border-radius` | Selection radius |
| `--table-drag-handle-background` | Drag handle background |
| `--table-drag-handle-background-active` | Drag handle active background |
| `--table-drag-handle-color` | Drag handle icon |
| `--table-drag-handle-color-active` | Drag handle icon active |
| `--table-add-button-background` | "Add" button background |
| `--table-add-button-border-width` | "Add" button border width |
| `--table-add-button-border-color` | "Add" button border color |

## Tags

| Variable | Use |
| --- | --- |
| `--tag-size` | Font size |
| `--tag-color` | Text color |
| `--tag-color-hover` | Hover |
| `--tag-decoration` | Text decoration |
| `--tag-decoration-hover` | Hover decoration |
| `--tag-background` | Background |
| `--tag-background-hover` | Hover background |
| `--tag-border-color` | Border |
| `--tag-border-color-hover` | Hover border |
| `--tag-border-width` | Border width |
| `--tag-padding-x` | Horizontal padding |
| `--tag-padding-y` | Vertical padding |
| `--tag-radius` | Corner radius |
| `--tag-weight` | Font weight |

To render a content-tag pill, compose the variables above with `zt:` Tailwind
utilities on a plain `<span>` — don't borrow Obsidian's own `.tag` class. `.tag` is
unlayered (so any `zt:` override needs `!important`) and its selector is `a.tag` (so
it only styles `<a>`, and a bare `<a>` also inherits Obsidian's unlayered link
color). A `<span>` styled with `zt:` utilities stays in the utilities layer, so
accent state utilities override the resting look cleanly. When more than one surface
renders the same chip (or the states get complex — resting / selected / disabled,
density, truncation), centralize the variants in one `tailwind-variants` recipe with
the repo's prefix-aware `tv` from `@/lib/tw`, rather than duplicating the token
string per call site:

```ts
import { tv } from "@/lib/tw";

export const tagChipVariants = tv({
  base: "zt:rounded-(--tag-radius) zt:border-(length:--tag-border-width) zt:font-(--tag-weight) zt:leading-none",
  variants: {
    state: {
      resting: "zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:text-(color:--tag-color) zt:hover:bg-(--tag-background-hover)",
      selected: "zt:border-primary zt:bg-primary zt:text-primary-foreground",
    },
  },
});
// <span className={tagChipVariants({ state: sel ? "selected" : "resting" })} aria-pressed={sel} />
```

Note the type hints: `text-(color:…)` for the color vs. `text-(length:…)` for the
font size, and `border-(length:…)` for the border width vs. `border-(…)` for its color.

## Embeds

| Variable | Use |
| --- | --- |
| `--embed-max-height` | Max height |
| `--embed-canvas-max-height` | Max height for Canvas embeds |
| `--embed-background` | Background |
| `--embed-border-start` | Inline-start border (shorthand) |
| `--embed-border-end` | Inline-end border (shorthand) |
| `--embed-border-top` | Top border |
| `--embed-border-bottom` | Bottom border |
| `--embed-padding` | Padding |
| `--embed-font-style` | Font style |
| `--embed-block-shadow-hover` | Hover shadow for rendered embed blocks (Live Preview) |

## File layout

| Variable | Use |
| --- | --- |
| `--file-line-width` | "Readable line width" target |
| `--file-folding-offset` | Width offset for fold indicators |
| `--file-margins` | File margins (shorthand) |
| `--file-header-font-size` | File header font size |
| `--file-header-font-weight` | File header font weight |
| `--file-header-border` | File header `border-bottom` |
| `--file-header-justify` | File header text alignment |

## Footnotes

| Variable | Use |
| --- | --- |
| `--footnote-size` | Font size |

## Horizontal rule

| Variable | Use |
| --- | --- |
| `--hr-color` | Border color |
| `--hr-thickness` | Border thickness |

## Properties (YAML frontmatter editor)

### Container

| Variable | Use |
| --- | --- |
| `--metadata-background` | Container background |
| `--metadata-display-editing` | `display` in editing mode |
| `--metadata-display-reading` | `display` in reading mode |
| `--metadata-max-width` | Max width |
| `--metadata-padding` | Padding |
| `--metadata-border-color` | Border color |
| `--metadata-border-radius` | Corner radius |
| `--metadata-border-width` | Border width |
| `--metadata-gap` | Gap between properties |

### Individual property

| Variable | Use |
| --- | --- |
| `--metadata-divider-color` | Divider between properties |
| `--metadata-divider-color-hover` | Hover |
| `--metadata-divider-color-focus` | Focus |
| `--metadata-divider-width` | Divider width |
| `--metadata-property-padding` | Property padding |
| `--metadata-property-radius` | Corner radius |
| `--metadata-property-radius-hover` | Hover radius |
| `--metadata-property-radius-focus` | Focus radius |
| `--metadata-property-background` | Background |
| `--metadata-property-background-hover` | Hover background |
| `--metadata-property-background-active` | Active background |
| `--metadata-label-background-hover` | Label hover background |
| `--metadata-label-background-active` | Label active background |
| `--metadata-label-font-size` | Label font size |
| `--metadata-label-font-weight` | Label font weight |
| `--metadata-sidebar-label-font-size` | Label font size (sidebar) |
| `--metadata-label-text-color` | Label text color |
| `--metadata-label-text-color-hover` | Label hover color |
| `--metadata-label-width` | Label width |
| `--metadata-input-height` | Input height |
| `--metadata-input-text-color` | Input text color |
| `--metadata-input-font-size` | Input font size |
| `--metadata-sidebar-input-font-size` | Input font size (sidebar) |
| `--metadata-input-background` | Input background |
| `--metadata-input-background-hover` | Input hover background |
| `--metadata-input-background-active` | Input active background |

## Bases

Container and view-specific vars. Combine with Properties, Checkbox, Text input, Multi-select.

### Container

| Variable | Use |
| --- | --- |
| `--bases-header-border-width` | Header border width |
| `--bases-header-height` | Header height (toolbar) |
| `--bases-header-padding-start` | Start padding |
| `--bases-header-padding-end` | End padding |
| `--bases-toolbar-label-display` | Toolbar label display |
| `--bases-toolbar-badge-display` | Toolbar badge display |
| `--bases-embed-border-width` | Embedded view border width |
| `--bases-embed-border-color` | Embedded view border color |
| `--bases-embed-border-radius` | Embedded view radius |
| `--bases-filter-menu-width` | Filter menu width |

### Table view

`--bases-table-container-border-width`, `--bases-table-container-border-radius`, `--bases-table-header-weight/color`, `--bases-table-header-icon-display`, `--bases-table-header-background/-hover`, `--bases-table-header-sort-mask`, `--bases-table-border-color`, `--bases-table-column-border-width`, `--bases-table-row-border-width`, `--bases-table-row-background-hover`, `--bases-table-row-height`, `--bases-table-text-size`, `--bases-table-column-max-width`, `--bases-table-column-min-width`, `--bases-table-cell-radius-active`, `--bases-table-cell-shadow-active`, `--bases-table-cell-background-active`, `--bases-table-cell-background-disabled`.

### Cards view

`--bases-cards-container-background`, `--bases-cards-background`, `--bases-cards-cover-background`, `--bases-cards-scale`, `--bases-cards-group-padding`, `--bases-cards-line-height`, `--bases-cards-border-width`, `--bases-cards-shadow`, `--bases-cards-shadow-hover`.
