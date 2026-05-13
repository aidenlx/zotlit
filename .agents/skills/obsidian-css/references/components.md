# Interactive Components

Variables for the building-block UI controls. If you're adding a button, modal, input, etc., these let your component look native. Pair these with the foundation variables from `foundations.md`.

## Button

Buttons reuse the interactive surface colors from foundations — there's only a shape variable here.

| Variable | Use |
| --- | --- |
| `--button-radius` | Corner radius (defaults to `--input-radius`) |

Combine with `--interactive-normal` / `--interactive-hover` for default buttons, and `--interactive-accent` / `--interactive-accent-hover` + `--text-on-accent` for primary buttons.

## Text input

| Variable | Use |
| --- | --- |
| `--input-height` | Default input height |
| `--input-radius` | Corner radius |
| `--input-font-weight` | Font weight inside inputs |
| `--input-border-width` | Border thickness |

Background should be `--background-modifier-form-field`. Border color: `--background-modifier-border` → `-hover` → `-focus` for the three states.

`:root`-level focus styling vars (from theme conventions): `--input-focus-border-color`, `--input-focus-outline`, `--input-unfocused-border-color`, `--input-disabled-border-color`, `--input-hover-border-color`.

## Dropdowns / `<select>`

| Variable | Use |
| --- | --- |
| `--dropdown-background` | Surface |
| `--dropdown-background-hover` | Hover surface |
| `--dropdown-background-blend-mode` | Blend mode for layered SVG arrow |
| `--dropdown-background-position` | Caret/arrow position |
| `--dropdown-background-size` | Caret/arrow size |
| `--dropdown-padding` | Total padding |

## Checkbox

| Variable | Use |
| --- | --- |
| `--checkbox-radius` | Corner radius |
| `--checkbox-size` | Width/height (defaults to `--font-text-size`) |
| `--checkbox-color` | Checked background |
| `--checkbox-color-hover` | Checked hover |
| `--checkbox-marker-color` | Color of the check mark itself |
| `--checkbox-border-color` | Unchecked border |
| `--checkbox-border-color-hover` | Unchecked hover border |
| `--checkbox-margin-inline-start` | Left margin in task lists |
| `--checklist-done-decoration` | Strikethrough on completed task text |
| `--checklist-done-color` | Color of completed task text |

## Toggle

| Variable | Use |
| --- | --- |
| `--toggle-width` | Track width |
| `--toggle-radius` | Track radius |
| `--toggle-border-width` | Track border width |
| `--toggle-thumb-color` | Thumb color |
| `--toggle-thumb-radius` | Thumb radius |
| `--toggle-thumb-height` | Thumb height |
| `--toggle-thumb-width` | Thumb width |
| `--toggle-s-*` | Small-variant counterparts |

## Slider

| Variable | Use |
| --- | --- |
| `--slider-track-background` | Track background |
| `--slider-track-height` | Track height |
| `--slider-thumb-height` | Thumb height |
| `--slider-thumb-width` | Thumb width |
| `--slider-thumb-radius` | Thumb radius |
| `--slider-thumb-y` | Vertical alignment of the thumb |
| `--slider-thumb-border-width` | Thumb border thickness |
| `--slider-thumb-border-color` | Thumb border color |

## Color swatch (color input)

| Variable | Use |
| --- | --- |
| `--swatch-radius` | Swatch corner radius |
| `--swatch-height` | Swatch height |
| `--swatch-width` | Swatch width |
| `--swatch-shadow` | Drop shadow |

## Modal (and the Settings window)

| Variable | Use |
| --- | --- |
| `--modal-background` | Modal surface |
| `--modal-border-color` | Modal border |
| `--modal-border-width` | Modal border thickness |
| `--modal-radius` | Corner radius |
| `--modal-width` | Default width |
| `--modal-height` | Default height |
| `--modal-max-width` | Maximum width |
| `--modal-max-height` | Maximum height |
| `--modal-max-width-narrow` | Maximum width for narrow modals |
| `--modal-community-sidebar-width` | Sidebar width inside the community plugins/themes browser |

## Dialog (smaller confirmation modal)

| Variable | Use |
| --- | --- |
| `--dialog-width` | Default width |
| `--dialog-max-width` | Maximum width |
| `--dialog-max-height` | Maximum height |

## Popover (file previews, link hovers)

| Variable | Use |
| --- | --- |
| `--popover-width` | Default width |
| `--popover-height` | Default height |
| `--popover-max-height` | Max height |
| `--popover-font-size` | Font size inside popovers |
| `--popover-pdf-width` | PDF preview width |
| `--popover-pdf-height` | PDF preview height |

## Prompt (Quick Switcher, Command Palette)

| Variable | Use |
| --- | --- |
| `--prompt-input-height` | Input row height |
| `--prompt-width` | Default width |
| `--prompt-max-width` | Max width on narrow screens |
| `--prompt-max-height` | Max height |
| `--prompt-border-width` | Border thickness |
| `--prompt-border-color` | Border color |

## Tabs

Workspace tab strip. Lots of state-aware variables — only override the ones you actually need.

| Variable | Use |
| --- | --- |
| `--tab-background-active` | Active tab background |
| `--tab-container-background` | Tab strip background |
| `--tab-divider-color` | Divider between tabs |
| `--tab-outline-color` | Outline color |
| `--tab-outline-width` | Outline width |
| `--tab-text-color` | Default text color |
| `--tab-text-color-active` | Active tab text (non-focused window) |
| `--tab-text-color-focused` | Focused-window default |
| `--tab-text-color-focused-active` | Focused window, active tab |
| `--tab-text-color-focused-highlighted` | Focused window, highlighted tab |
| `--tab-text-color-focused-active-current` | Focused window, current tab |
| `--tab-font-size` | Tab font size |
| `--tab-font-weight` | Tab font weight |
| `--tab-curve` | Inside-corner curvature |
| `--tab-radius` | Outer corner radius |
| `--tab-radius-active` | Outer radius for active tab |
| `--tab-width` | Default tab width |
| `--tab-max-width` | Maximum tab width |

### Stacked tabs

| Variable | Use |
| --- | --- |
| `--tab-stacked-pane-width` | Stacked pane width |
| `--tab-stacked-header-width` | Stacked header width |
| `--tab-stacked-font-size` | Stacked tab font size |
| `--tab-stacked-font-weight` | Stacked tab font weight |
| `--tab-stacked-text-align` | Text alignment |
| `--tab-stacked-text-transform` | Text transform |
| `--tab-stacked-text-writing-mode` | Writing mode (vertical text) |
| `--tab-stacked-shadow` | Drop shadow |

## Navigation items (file explorer, outline, etc.)

| Variable | Use |
| --- | --- |
| `--nav-item-size` | Font size |
| `--nav-item-color` | Default text color |
| `--nav-item-color-hover` | Hover |
| `--nav-item-color-active` | Active |
| `--nav-item-color-selected` | Selected |
| `--nav-item-color-highlighted` | Highlighted (search match) |
| `--nav-item-background-hover` | Hover background |
| `--nav-item-background-active` | Active background |
| `--nav-item-background-selected` | Selected background |
| `--nav-item-padding` | Padding |
| `--nav-item-parent-padding` | Padding for parent (folder) rows |
| `--nav-item-children-padding-start` | Indent for child rows |
| `--nav-item-children-margin-start` | Margin for child rows |
| `--nav-item-weight` | Font weight |
| `--nav-item-weight-hover` | Hover font weight |
| `--nav-item-weight-active` | Active font weight |
| `--nav-item-white-space` | `white-space` value |
| `--nav-indentation-guide-width` | Indentation guide border thickness |
| `--nav-indentation-guide-color` | Indentation guide color |
| `--nav-collapse-icon-color` | Collapse chevron |
| `--nav-collapse-icon-color-collapsed` | Collapse chevron when collapsed |

### Navigation headings (collapsible section labels)

| Variable | Use |
| --- | --- |
| `--nav-heading-color` | Section label |
| `--nav-heading-color-hover` | Hover |
| `--nav-heading-color-collapsed` | Collapsed |
| `--nav-heading-color-colapsed-hover` | Collapsed hover (sic — Obsidian variable name) |
| `--nav-heading-weight` | Font weight |
| `--nav-heading-weight-hover` | Hover font weight |

## Pills (multi-select chips)

For list properties and similar.

| Variable | Use |
| --- | --- |
| `--pill-color` | Text color |
| `--pill-color-hover` | Hover text |
| `--pill-color-remove` | Remove-state text |
| `--pill-color-remove-hover` | Remove-state hover text |
| `--pill-decoration` | Text decoration |
| `--pill-decoration-hover` | Hover text decoration |
| `--pill-background` | Background |
| `--pill-background-hover` | Hover background |
| `--pill-border-color` | Border |
| `--pill-border-color-hover` | Hover border |
| `--pill-border-width` | Border thickness |
| `--pill-padding-x` | Horizontal padding |
| `--pill-padding-y` | Vertical padding |
| `--pill-radius` | Corner radius |
| `--pill-weight` | Font weight |

## Indentation guides (nested lists)

| Variable | Use |
| --- | --- |
| `--indentation-guide-width` | Guide thickness |
| `--indentation-guide-width-active` | Active guide thickness |
| `--indentation-guide-color` | Guide color |
| `--indentation-guide-color-active` | Active guide color |
| `--indentation-guide-editing-indent` | Indent in Live Preview |
| `--indentation-guide-reading-indent` | Indent in Reading view |
| `--indentation-guide-source-indent` | Indent in Source mode |

## Dragging affordances

| Variable | Use |
| --- | --- |
| `--drag-ghost-background` | Ghost background while dragging |
| `--drag-ghost-text-color` | Ghost text color |
