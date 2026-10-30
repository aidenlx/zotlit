# Window Chrome

Variables for Obsidian's app shell — ribbon, sidebar, status bar, dividers, scrollbars, window frame, vault profile, and the workspace as a whole. Use these when a plugin view needs to integrate with the chrome (e.g. a custom status-bar item or a sidebar pane that should match the host sidebar).

## Ribbon (left-edge button strip)

| Variable | Use |
| --- | --- |
| `--ribbon-background` | Background color |
| `--ribbon-background-collapsed` | Background when sidebar is collapsed |
| `--ribbon-width` | Width |
| `--ribbon-padding` | Padding |

## Sidebar (left & right docks)

| Variable | Use |
| --- | --- |
| `--sidebar-markdown-font-size` | Font size for markdown rendered in sidebars |
| `--sidebar-tab-text-display` | `display` for tab labels in sidebars |

## Status bar (bottom)

| Variable | Use |
| --- | --- |
| `--status-bar-background` | Background |
| `--status-bar-border-color` | Border color |
| `--status-bar-border-width` | Border width |
| `--status-bar-font-size` | Font size |
| `--status-bar-text-color` | Text color |
| `--status-bar-position` | `position` property |
| `--status-bar-radius` | Corner radius |

With the default `--status-bar-position: fixed`, the bar overlays the bottom-right of every pane under it. A scrolling list clears it with end padding and `scroll-padding-bottom` on its own scroll box, so the last item scrolls clear of the bar.

## Dividers / resize handles

Between sidebars, tabs, and split panes.

| Variable | Use |
| --- | --- |
| `--divider-color` | Border color |
| `--divider-color-hover` | Hover color |
| `--divider-width` | Width |
| `--divider-width-hover` | Hover width |
| `--divider-vertical-height` | Vertical divider height |

## Scrollbars (custom — Windows/Linux only)

| Variable | Use |
| --- | --- |
| `--scrollbar-bg` | Track background |
| `--scrollbar-thumb-bg` | Thumb background |
| `--scrollbar-active-thumb-bg` | Active thumb background |

## Scroll containers

- **Overlay scrollbar.** On macOS the scrollbar is the native overlay one (`body.styled-scrollbars` is off), painted as part of the scroll box: a `mask-image` or `opacity` on the box fades the scrollbar with the content. Fade an edge with a sticky child of the scrolled content instead; the scrollbar draws over it.
- **Pane background.** A leaf paints `--background-primary` under `.mod-root` — the main area and every popout window — and `--background-secondary` in a sidebar dock. A strip that blends into the pane picks between the two with a `zt:[.mod-root_&]:` variant.
- **Sticky offset.** A sticky child stops at the inner edge of the scroll box's padding; a negative `top` equal to the padding pins it to the visible edge.

## Window frame & title bar

Visible when **Settings → Appearance → Window frame style** is set to **Obsidian frame**.

| Variable | Use |
| --- | --- |
| `--titlebar-background` | Background |
| `--titlebar-background-focused` | Focused-window background |
| `--titlebar-border-width` | Border width |
| `--titlebar-border-color` | Border color |
| `--titlebar-text-color` | Text color |
| `--titlebar-text-color-focused` | Focused window text color |
| `--titlebar-text-weight` | Font weight |
| `--header-height` | Default height for frame elements (titlebar, file header, etc.) |

## Workspace

| Variable | Use |
| --- | --- |
| `--workspace-background-translucent` | Background for translucent windows |

## Vault profile (bottom of primary sidebar)

| Variable | Use |
| --- | --- |
| `--vault-profile-display` | `display` for the profile widget |
| `--vault-profile-actions-display` | `display` for action buttons |
| `--vault-profile-font-size` | Font size |
| `--vault-profile-font-weight` | Font weight |
| `--vault-profile-color` | Text color |
| `--vault-profile-color-hover` | Hover text color |
