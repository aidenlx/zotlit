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
| `--status-bar-scroll-padding` | Scroll padding |

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
