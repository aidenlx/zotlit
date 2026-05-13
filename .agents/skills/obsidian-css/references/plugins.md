# Core Plugin Variables

Variables consumed by Obsidian's built-in plugin views. Useful when a plugin renders a similar interface (a custom search/filter pane, a graph-like visualization) and you want to inherit the look.

## File explorer

Currently shares variables with the Vault profile (see `window.md`):

| Variable | Use |
| --- | --- |
| `--vault-profile-display` | |
| `--vault-profile-actions-display` | |
| `--vault-profile-font-size` | |
| `--vault-profile-font-weight` | |
| `--vault-profile-color` | |
| `--vault-profile-color-hover` | |

For the tree itself, see Navigation in `components.md`.

## Search

| Variable | Use |
| --- | --- |
| `--search-clear-button-color` | Clear-search button color |
| `--search-clear-button-size` | Clear-search button size |
| `--search-icon-color` | Magnifying-glass icon color |
| `--search-icon-size` | Icon size |
| `--search-result-background` | Result row background |

## Graph view

| Variable | Use |
| --- | --- |
| `--graph-controls-width` | Controls panel width |
| `--graph-text` | Node label color |
| `--graph-line` | Edge color |
| `--graph-node` | Resolved node color |
| `--graph-node-unresolved` | Unresolved node color |
| `--graph-node-focused` | Focused node color |
| `--graph-node-tag` | Tag node color |
| `--graph-node-attachment` | Attachment node color |

## Canvas

| Variable | Use |
| --- | --- |
| `--canvas-background` | Canvas background |
| `--canvas-card-label-color` | Card label text color |
| `--canvas-dot-pattern` | Dot pattern color |
| `--canvas-color-1` | Card color 1 (RGB) |
| `--canvas-color-2` | Card color 2 (RGB) |
| `--canvas-color-3` | Card color 3 (RGB) |
| `--canvas-color-4` | Card color 4 (RGB) |
| `--canvas-color-5` | Card color 5 (RGB) |
| `--canvas-color-6` | Card color 6 (RGB) |

## Sync

Avatar palette used by Obsidian Sync. Useful if you implement a similar "users" indicator.

| Variable | Use |
| --- | --- |
| `--sync-avatar-color-current-user` | Current user avatar color |
| `--sync-avatar-color-1` … `-8` | Avatar palette |
