---
name: obsidian-settings
description: |
  Write declarative settings tabs for Obsidian plugins using the 1.13.0+ getSettingDefinitions() API.
  Use when creating or editing a PluginSettingTab, adding settings controls (toggle, text, number,
  dropdown, slider, file, folder, color), building settings groups/lists/sub-pages, wiring
  conditional visibility or validation, migrating from the imperative display() approach, or
  touching any file under apps/obsidian/src/services/*/setting-tab/. Also use when the user mentions
  "setting tab", "plugin settings", "getSettingDefinitions", "SettingControl", or "SettingDefinitionItem",
  even if they don't explicitly ask for this skill.
---

# Obsidian Declarative Settings (1.13.0+)

Settings tabs describe their UI as data — an array of definition objects returned from
`getSettingDefinitions()`. Obsidian handles rendering, search indexing, persistence, and validation.

## Type definitions

The canonical source is `packages/obsidian-api/obsidian.d.ts`. Read the relevant types there when
you need precise signatures — the guide below covers usage patterns, not exhaustive type docs.

Quick lookup commands:
- `rg 'SettingControl<' packages/obsidian-api/obsidian.d.ts` — all control types
- `rg 'SettingDefinition' packages/obsidian-api/obsidian.d.ts` — all definition types
- `rg 'class PluginSettingTab' packages/obsidian-api/obsidian.d.ts` — tab class
- `rg 'class SettingPage' packages/obsidian-api/obsidian.d.ts` — imperative sub-page class

## How it works

Override `getSettingDefinitions()` on your `PluginSettingTab` subclass. Each entry in the returned
array is a `SettingDefinitionItem` — one of:

| Shape | What it does |
|---|---|
| `{ name, control: { type, key } }` | Binds one settings key to a UI control. Auto-reads/writes/saves. |
| `{ name, render: (setting, group) => … }` | Full imperative control over one `Setting` row. No auto-save. |
| `{ name, action: (el, index) => … }` | Clickable action row. |
| `{ name }` (no control/render/action) | Static heading or info row. |
| `{ type: 'group', heading, items }` | Visual grouping with a heading. |
| `{ type: 'list', heading, items, onDelete, … }` | User-managed collection (add/delete/reorder). |
| `{ type: 'page', name, items }` or `{ type: 'page', name, page: () => … }` | Navigable sub-page. |

`control`, `render`, and `action` are mutually exclusive on a single definition.

## Control types

Every control reads from and writes to `this.plugin.settings[key]` automatically. Obsidian calls
`saveData()` after each change.

| Type | Stored value | Required fields | Optional fields |
|---|---|---|---|
| `toggle` | `boolean` | `key` | `defaultValue`, `disabled` |
| `text` | `string` | `key` | `placeholder`, `defaultValue`, `validate`, `disabled` |
| `textarea` | `string` | `key` | `placeholder`, `rows`, `defaultValue`, `validate`, `disabled` |
| `number` | `number` | `key` | `min`, `max`, `step`, `placeholder`, `defaultValue`, `validate`, `disabled` |
| `slider` | `number` | `key`, `min`, `max`, `step` | `defaultValue`, `displayFormat`, `disabled` |
| `dropdown` | `string` | `key`, `options` | `defaultValue`, `disabled` |
| `file` | `string` (path) | `key` | `filter`, `placeholder`, `defaultValue`, `validate`, `disabled` |
| `folder` | `string` (path) | `key` | `filter`, `includeRoot`, `placeholder`, `defaultValue`, `validate`, `disabled` |
| `color` | `string` (hex) | `key` | `defaultValue`, `disabled` |

`slider` requires all three of `min`, `max`, `step` (not optional like on `number`).

### Examples

```ts
// Toggle
{ name: 'Enable sync', control: { type: 'toggle', key: 'syncEnabled' } }

// Text with validation
{
  name: 'API key',
  control: {
    type: 'text',
    key: 'apiKey',
    placeholder: 'Enter key…',
    validate: (v) => v.length < 8 ? 'Must be at least 8 characters.' : undefined,
  },
}

// Dropdown with default
{
  name: 'Theme',
  control: {
    type: 'dropdown',
    key: 'theme',
    defaultValue: 'system',
    options: { system: 'System', light: 'Light', dark: 'Dark' },
  },
}

// Number with range
{
  name: 'Max results',
  control: { type: 'number', key: 'maxResults', min: 1, max: 100, defaultValue: 20 },
}

// Slider (min/max/step required)
{
  name: 'Opacity',
  control: { type: 'slider', key: 'opacity', min: 0, max: 100, step: 1 },
}

// Folder picker
{
  name: 'Output folder',
  control: { type: 'folder', key: 'outputDir', includeRoot: true },
}
```

## Conditional visibility and disabling

Two predicates toggle a setting's state without rebuilding the tab:

- `visible` on any definition — hides the row when `false`. Hidden rows are excluded from search.
- `disabled` on a `control` or `action` — disables interaction without hiding.

Both accept `boolean | (() => boolean)`. The function form re-evaluates on every DOM-state refresh.
For `control` definitions, Obsidian refreshes automatically after every change.

```ts
getSettingDefinitions() {
  return [
    { name: 'Advanced mode', control: { type: 'toggle', key: 'advanced' } },
    {
      name: 'Debug level',
      visible: () => this.plugin.settings.advanced,
      control: {
        type: 'dropdown',
        key: 'logLevel',
        defaultValue: 'info',
        options: { info: 'Info', verbose: 'Verbose' },
      },
    },
  ];
}
```

Use `visible` when a setting is irrelevant in the current state. Use `disabled` when it exists but
is locked (prerequisite not met, feature not unlocked).

After mutating state from a `render` callback or other imperative path, call `this.refreshDomState()`
to re-run predicates without a full re-render. For changes that add/remove definitions (not just
toggle visibility), call `this.update()` instead.

## Validation

Every control accepts an optional `validate` callback. Return a non-empty string to reject and show
an inline error. Return `void`/`undefined`/empty string to accept. Async validators work too.

```ts
{
  name: 'Extension',
  control: {
    type: 'text',
    key: 'ext',
    validate: (v) => /\s/.test(v) ? 'No spaces allowed.' : undefined,
  },
}
```

`validate` is a UI gate, not a data invariant. Stored values may already be invalid (from older
plugin versions). Validate again when reading settings in `loadSettings()` if invariants matter.

## Groups

Group related settings under a heading:

```ts
{
  type: 'group',
  heading: 'Appearance',
  items: [
    { name: 'Font size', control: { type: 'number', key: 'fontSize', min: 8, max: 32 } },
    { name: 'Accent color', control: { type: 'color', key: 'accent' } },
  ],
}
```

Groups also accept `search` (renders a filter input in the header — since 1.13.1), `extraButtons`,
`cls`, and `visible`.

Groups cannot nest inside groups. Use sub-pages for deeper hierarchy.

## Lists

For user-managed collections (add/delete/reorder rows), use `type: 'list'`:

```ts
{
  type: 'list',
  heading: 'Watched folders',
  emptyState: 'No folders yet.',
  addItem: {
    name: 'Add folder',
    action: () => this.openAddFolderModal(),
  },
  onReorder: async (oldIndex, newIndex) => {
    let folders = this.plugin.settings.folders;
    let [moved] = folders.splice(oldIndex, 1);
    folders.splice(newIndex, 0, moved);
    await this.plugin.saveData(this.plugin.settings);
  },
  onDelete: async (idx) => {
    this.plugin.settings.folders.splice(idx, 1);
    await this.plugin.saveData(this.plugin.settings);
    this.update();
  },
  items: this.plugin.settings.folders.map((path) => ({
    name: path,
    searchable: false,
  })),
}
```

- `onReorder` adds drag handles. DOM is already reordered — just update your data and save.
- `onDelete` wires both the delete button and the Delete key. Always call `this.update()` after.
- `addItem` renders a `+` button (desktop) / tappable row (mobile). Open a Modal for multi-field input.
- `emptyState` shows when `items` is empty.
- `searchable: false` on items keeps individual rows out of global search.

For action rows inside lists, use `action` and read the live `index` argument (not the outer map index,
which goes stale after reorder):

```ts
items: commands.map((cmd) => ({
  name: cmd.name,
  searchable: false,
  action: (el, index) => this.plugin.doSomething(index),
})),
```

## Sub-pages

Navigable sub-pages for sections with self-contained scope. Use sparingly — only when the parent tab
is too long to scan.

### Declarative (preferred)

```ts
{
  type: 'page',
  name: 'Advanced',
  desc: 'Power-user options.',
  items: [
    { name: 'Debug logging', control: { type: 'toggle', key: 'debug' } },
    { type: 'group', heading: 'Cache', items: [
      { name: 'Size (MB)', control: { type: 'slider', key: 'cacheMb', min: 1, max: 500, step: 1 } },
    ]},
  ],
}
```

### Imperative (when runtime state drives UI)

Subclass `SettingPage` and pass a factory. Controls built in `display()` are invisible to
`getSettingDefinitions()` — no search indexing, no auto-save, no `visible`/`disabled` predicates.

```ts
import { SettingPage, Setting } from 'obsidian';

class StatusPage extends SettingPage {
  constructor(private plugin: MyPlugin) {
    super();
    this.title = 'Status';
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Refresh')
      .addButton((btn) => btn.setButtonText('Refresh').onClick(() => this.display()));
  }

  hide() { /* clean up observers/timers */ }
}

// In getSettingDefinitions():
{ type: 'page', name: 'Status', page: () => new StatusPage(this.plugin) }
```

`items` and `page` are mutually exclusive.

Page names must be unique among siblings at the same depth.

Since 1.13.1: `displayValue` shows a value on the page entry, `status: 'warning'` adds an indicator.

## Render callback

Use `render` when a setting needs side effects, derived values, or controls not covered by the
declarative types (moment format, progress bars, custom suggesters, multi-button rows).

```ts
{
  name: 'Date format',
  render: (setting) => {
    setting.addMomentFormat((fmt) => fmt
      .setValue(this.plugin.settings.dateFormat)
      .onChange(async (v) => {
        this.plugin.settings.dateFormat = v;
        await this.plugin.saveData(this.plugin.settings);
      }));
  },
}
```

`render` does not auto-save — always call `saveData()` yourself.

Return a cleanup function from `render` if you create subscriptions that outlive the DOM
(ResizeObserver, setInterval, etc.). Plain DOM listeners attached to elements inside the row are
cleaned up automatically.

## Custom settings storage

By default, `control` definitions read/write `this.plugin.settings[key]` and auto-call `saveData()`.

Override `getControlValue(key)` and `setControlValue(key, value)` to read/write a different store
(Svelte store, reactive proxy, immutable pattern). When overriding `setControlValue`, persist the
value yourself — the automatic `saveData()` call is replaced.

See `references/settings-guide.md` § "Custom settings storage" and § "Advanced: nested settings with
dot-notation keys" for the dot-path recipe.

## Reacting to external changes

If the tab displays state that changes outside the settings UI (vault contents, plugin computation),
call `this.update()` to rebuild from `getSettingDefinitions()`. Wire listeners in the constructor and
register through `plugin.registerEvent()`. Debounce bursty events.

```ts
constructor(app: App, plugin: MyPlugin) {
  super(app, plugin);
  this.plugin = plugin;
  let refresh = debounce(() => this.update(), 200, true);
  plugin.registerEvent(this.app.vault.on('create', refresh));
  plugin.registerEvent(this.app.vault.on('delete', refresh));
}
```

## Style guide

- **Sentence case** for all UI text: "Template folder location", not "Template Folder Location".
- **No top-level heading** — the sidebar tab title already names the plugin.
- **Headings only with multiple sections.** If the tab is one section, use no heading. When there
  are multiple sections and one is "general", leave general items at the top with no heading.
- **Don't repeat "settings"** in headings: "Advanced", not "Advanced settings".
- **Save on change**, not on submit. `control` does this automatically; in `render`, call `saveData()`
  from `onChange`.
- **One control per row.** Multiple controls per row stack vertically on mobile. Collect multi-field
  input in a Modal.
- **Avoid textareas on the main tab.** Push them to the bottom or into a modal.
- **Keep `desc` short** — one sentence. Put warnings in a Modal with explicit confirm.

## ZotLit-specific patterns

In this codebase, settings tabs use the declarative API with control keys that bridge to
`SettingsService`. The imperative dual-support UI lives under `setting-tab/compat/` for
Obsidian < 1.13 (minAppVersion 1.12.7), decoupled for easy removal.

When adding a setting:
1. Add the key to the settings interface in the relevant service.
2. Add the control definition in `getSettingDefinitions()`.
3. If dual-support is needed, add the imperative equivalent in `setting-tab/compat/`.

## Further reading

- `references/settings-guide.md` — full developer docs with all patterns and examples
- `references/migration-guide.md` — migrating from imperative `display()` to declarative
- `packages/obsidian-api/obsidian.d.ts` — canonical type definitions (grep for `SettingDefinition`,
  `SettingControl`, `PluginSettingTab`, `SettingPage`)
