If you want users to be able to configure parts of your plugin themselves, you can expose them as _settings_.

In this guide, you'll learn how you can create a settings page like this 👇


> **Requires Obsidian 1.13.0+**
> The declarative settings API documented on this page (`getSettingDefinitions()`) requires Obsidian 1.13.0, which is currently in an insider build. If you need to support older Obsidian versions, see the dual-support pattern. For the pre-1.13 imperative approach, jump to #Legacy: imperative display() approach.

The main reason to add settings to a plugin is to store configuration that persists even after the user quits Obsidian. The following example demonstrates how to save and load settings from disk:

```ts
import { Plugin } from 'obsidian';
import { ExampleSettingTab } from './settings';

interface ExamplePluginSettings {
  sampleValue: string;
}

const DEFAULT_SETTINGS: Partial<ExamplePluginSettings> = {
  sampleValue: 'Lorem ipsum',
};

export default class ExamplePlugin extends Plugin {
  settings: ExamplePluginSettings;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new ExampleSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

There's a lot going on here 🤯, so let's look closer at each part.

## Create a settings definition

First, you need to define which settings you want the user to be able to configure. Therefore, you create an interface, `ExamplePluginSettings`. While the plugin is enabled, you can access its settings from the `settings` member variable, which in our example is of type `ExamplePluginSettings`.

```ts
interface ExamplePluginSettings {
  sampleValue: string;
}

export default class ExamplePlugin extends Plugin {
  settings: ExamplePluginSettings;

  // ...
}
```

## Save and load the settings object

loadData() and saveData() provide an easy way to store and retrieve data from disk. The example also introduces two helper methods that make it easier to use `loadData()` and `saveData()` from other parts of the plugin.

```ts
export default class ExamplePlugin extends Plugin {

  // ...

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

Finally, make sure to load the settings when the plugin loads:

```ts
async onload() {
  await this.loadSettings();

  // ...
}
```

## Provide default values

When the user enables the plugin for the first time, none of the settings have been configured yet. The preceding example provides default values for any missing settings.

To understand how this works, have a look at the following code:

```ts
Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
```

`Object.assign()` is a JavaScript function that copies all properties from one object to another. Any properties that are returned by `loadData()` override the properties in `DEFAULT_SETTINGS`.

```ts
const DEFAULT_SETTINGS: Partial<ExamplePluginSettings> = {
  sampleValue: 'Lorem ipsum',
};
```

> ****> `Partial<Type>` is a TypeScript utility that returns a type with all properties of `Type` set to optional. It enables type checking while letting you only define the properties you want to provide defaults for.

## Register a settings tab

The plugin can now save and load plugin configuration, but the user doesn't yet have any way of changing any of the settings. By adding a settings tab you can provide an easy-to-use interface for the user to update their plugin settings:

```ts
this.addSettingTab(new ExampleSettingTab(this.app, this));
```

Here, `ExampleSettingTab` is a class that extends PluginSettingTab and overrides `getSettingDefinitions()` to describe the settings declaratively:

```ts
import ExamplePlugin from './main';
import { App, PluginSettingTab } from 'obsidian';

export class ExampleSettingTab extends PluginSettingTab {
  plugin: ExamplePlugin;

  constructor(app: App, plugin: ExamplePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions() {
    return [
      {
        name: 'Default value',
        control: {
          type: 'text',
          key: 'sampleValue',
          placeholder: 'Lorem ipsum',
        },
      },
    ];
  }
}
```

Each `control` definition's `key` names a property on `this.plugin.settings`. Obsidian reads the current value, writes changes back, and calls `saveData()` automatically. No `onChange` plumbing required. If your plugin stores settings somewhere other than `this.plugin.settings` (a Svelte store, an immutable update pattern, etc.), see #Custom settings storage.

To move an existing tab that uses `display()`, see Migrate to declarative settings.

## Definition shapes

Each entry returned by `getSettingDefinitions()` is one of the following:

- A setting with a `control` — declarative binding to one settings key. Preferred for simple settings. See #Control types.
- A setting with a `render` callback — full control over the `Setting` row. Use for side effects, derived values, or custom UI. See #Render callback.
- A setting with an `action` callback — a clickable row that runs your function. Common inside lists. The callback receives the row's current index (`action: (index: number) => void`); see #Lists.
- A setting with none of the above — a name/desc-only row, useful for headings or static informational rows.
- A `SettingDefinitionGroup` (`type: 'group'`) — a heading and a nested list of definitions. See #Groups.
- A `SettingDefinitionList` (`type: 'list'`) — a group with add, delete, and reorder affordances for user-managed entries. See #Lists.
- A `SettingDefinitionPage` (`type: 'page'`) — a navigable sub-page. See #Sub-pages.

> **Mutual exclusion**
> `control`, `render`, and `action` on a single definition are mutually exclusive. TypeScript will reject more than one.

> **Keep `getSettingDefinitions()` cheap**
> `getSettingDefinitions()` is called every time the tab updates AND once when the tab is registered (to index settings for global search). Don't perform file reads, network calls, or expensive computation here. Move heavy work into `render` callbacks, which run only when the row is drawn.

## Control types

A `control` definition reads and writes one key on your settings object. Obsidian handles `saveData()` for you.

| Type | Stored value | Notes |
| --- | --- | --- |
| `toggle` | `boolean` | |
| `text` | `string` | Optional `placeholder`. |
| `textarea` | `string` | Optional `placeholder`, `rows`. |
| `number` | `number` | Optional `min`, `max`, `step`, `placeholder`. Commits on blur or Enter. Out-of-range and unparseable input shows an inline error and rejects the change. |
| `slider` | `number` | `min`, `max`, `step` all required. |
| `dropdown` | `string` | `options: { value: 'Display', … }`. |
| `file` | `string` (path) | Optional `filter: (file: TFile) => boolean`, `placeholder`. |
| `folder` | `string` (path) | Optional `filter: (folder: TFolder) => boolean`, `includeRoot` (default `false`), `placeholder`. |
| `color` | `string` (hex) | |

Every control also accepts an optional `defaultValue` (the fallback when the stored value is `undefined` or `null`) and an optional `validate` callback (see #Validating input).

### Toggle

```ts
{ name: 'Open in foreground', control: { type: 'toggle', key: 'openInForeground' } }
```

### Text

```ts
{
  name: 'Folder name',
  control: { type: 'text', key: 'folder', placeholder: '/' },
}
```

### Textarea

```ts
{
  name: 'Notes',
  control: { type: 'textarea', key: 'notes', rows: 4 },
}
```

### Number

```ts
{
  name: 'Cache size (MB)',
  control: { type: 'number', key: 'cacheMb', min: 1, max: 500, defaultValue: 50 },
}
```

### Slider

```ts
{
  name: 'Volume',
  control: { type: 'slider', key: 'volume', min: 0, max: 100, step: 1 },
}
```

### Dropdown

```ts
{
  name: 'Default mode',
  control: {
    type: 'dropdown',
    key: 'mode',
    defaultValue: 'edit',
    options: { edit: 'Editing', read: 'Reading' },
  },
}
```

### File

```ts
{
  name: 'Template file',
  control: {
    type: 'file',
    key: 'template',
    filter: (file) => file.extension === 'md',
  },
}
```

### Folder

```ts
{
  name: 'Output folder',
  control: { type: 'folder', key: 'outputDir', includeRoot: true },
}
```

### Color picker

```ts
{ name: 'Accent color', control: { type: 'color', key: 'accent' } }
```

### What's not yet a first-class control

Some patterns from the imperative API don't have a dedicated declarative control type:

- **Moment-format inputs** — use a `render` callback with `addMomentFormat()`.
- **Progress bars** — use a `render` callback with `addProgressBar()`.
- **Custom suggesters** beyond file and folder — use a `render` callback with `addSearch()` and your own AbstractInputSuggest subclass.
- **Multi-button rows** — use a `render` callback and chain multiple `addButton()` calls.
- **Standalone buttons** — use a definition with `action` for a clickable row, or a `render` callback when you need a button inside a setting row.

Each of these can also be implemented with the imperative API documented in #Legacy: imperative display() approach.

## Validating input

Every `control` accepts an optional `validate` callback. Return a non-empty string to reject the change and surface it as an inline error below the input. Return `void`, `undefined`, or an empty string to accept the value.

```ts
{
  name: 'File extension',
  control: {
    type: 'text',
    key: 'extension',
    validate: (value) =>
      /\s/.test(value) ? 'Extension cannot contain spaces.' : undefined,
  },
}
```

Async validators work too: return a `Promise<string | void>`.

> **`validate` is a UI gate, not a data invariant**
> The stored value may already be invalid when the setting is rendered (for example, data saved by an older version of your plugin). `validate` runs once on mount and shows the message if the seeded value fails, but it does not modify or replace the stored value. If your plugin needs to enforce invariants on stored data, validate again when reading your settings. Don't rely on `validate` alone.



`validate` is most useful on text-bearing controls (`text`, `textarea`, `number`, `file`, `folder`).

## Conditional visibility and enabling

Two predicates let you toggle a setting's state without rebuilding the tab:

- `visible` on any definition — hides the row when it returns `false`. A hidden row is also excluded from global settings search for that render.
- `disabled` on a `control` (or on an `action` row) — disables interaction without hiding the row.

Both accept a `boolean` or `() => boolean`. The function form is re-evaluated on every DOM-state refresh. For `control` definitions, Obsidian refreshes automatically after every change, so the example below works without any extra wiring. After mutating dependent state from a `render` callback or any other imperative path, call `this.refreshDomState()` to re-run the predicates without a full re-render.

```ts
getSettingDefinitions() {
  return [
    {
      name: 'Enable advanced mode',
      control: { type: 'toggle', key: 'advanced' },
    },
    {
      name: 'Debug log level',
      desc: 'Only relevant when advanced mode is on.',
      visible: () => this.plugin.settings.advanced,
      control: {
        type: 'dropdown',
        key: 'logLevel',
        defaultValue: 'info',
        options: { info: 'Info', verbose: 'Verbose' },
      },
    },
    {
      name: 'Cache size (MB)',
      control: {
        type: 'number',
        key: 'cacheMb',
        min: 1,
        disabled: () => !this.plugin.settings.advanced,
      },
    },
  ];
}
```

For changes that add or remove definitions (not just toggle visibility), call `this.update()` instead. `refreshDomState` only re-evaluates predicates on already-rendered items.

> **When to use which**
> Use `visible` when a setting is irrelevant in the current configuration, with nothing meaningful for the user to read or change. Use `disabled` when the setting is meaningful but currently locked (a prerequisite isn't met, a paid feature isn't unlocked); keep it visible so the user understands the option exists.

## Custom settings storage

By default, `control` definitions read and write `this.plugin.settings` directly: `key: 'sampleValue'` corresponds to `this.plugin.settings.sampleValue`. `this.plugin.saveData()` is called for you on every change.

If your plugin keeps settings somewhere other than the conventional `this.plugin.settings` field (a Svelte store, a reactive proxy, an immutable update mechanism), override `getControlValue` and `setControlValue` on your settings tab:

```ts
class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  getControlValue(key: string): unknown {
    // Read from wherever your plugin keeps settings.
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Update wherever your plugin keeps settings, then persist it yourself.
    await this.plugin.saveData(/* your settings */);
  }

  getSettingDefinitions() { /* … */ }
}
```

Overriding `setControlValue` replaces the default write path, including the automatic `saveData()` call. Persist the value yourself, and return the promise (or make the method `async`) so Obsidian can await the write before re-rendering.

For the common case where you just store settings in `this.plugin.settings`, you don't need to override anything; the defaults handle reading, writing, and saving.

### Advanced: nested settings with dot-notation keys

> **Keep your settings simple**
> Flat JSON is usually better. If you're starting a new plugin, flatten the shape (`editorFontSize` rather than `editor.fontSize`) and skip this recipe. Out of the box, `control` keys only reach top-level properties.

If your plugin already ships nested settings JSON and can't reshape the file without a migration, the same two overrides let you treat a `control` `key` as a dot-notation path (`editor.fontSize`) and walk the nested shape:

```ts
interface MySettings {
  editor: { fontSize: number; tabSize: number };
  sync: { enabled: boolean; interval: number };
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = obj;
  for (let part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  let parts = path.split('.');
  let last = parts.pop()!;
  let cursor: Record<string, unknown> = obj;
  for (let part of parts) {
    let next = cursor[part];
    if (next === null || typeof next !== 'object') {
      next = {};
      cursor[part] = next;
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[last] = value;
}

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    return getPath(this.plugin.settings, key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    setPath(this.plugin.settings, key, value);
    await this.plugin.saveData(this.plugin.settings);
  }

  getSettingDefinitions() {
    return [
      {
        type: 'group',
        heading: 'Editor',
        items: [
          { name: 'Font size', control: { type: 'number', key: 'editor.fontSize', min: 8, max: 32 } },
          { name: 'Tab size', control: { type: 'number', key: 'editor.tabSize', min: 1, max: 8 } },
        ],
      },
      {
        type: 'group',
        heading: 'Sync',
        items: [
          { name: 'Enable sync', control: { type: 'toggle', key: 'sync.enabled' } },
          {
            name: 'Interval (seconds)',
            visible: () => this.plugin.settings.sync.enabled,
            control: { type: 'number', key: 'sync.interval', min: 5 },
          },
        ],
      },
    ];
  }
}
```

The `key` literal is now a path, not a property name: `editor.fontSize` is two property lookups. `setPath` creates intermediate objects as it walks, so a user upgrading from a partial settings JSON doesn't crash on a missing parent object. Predicates like `visible` read through the nested shape directly; they don't go through `getControlValue`.

You give up compile-time `key` checking. Dot-notation strings aren't statically verifiable against a nested type, so `key: 'editor.fontSiz'` (typo) compiles. If you need it, generate a literal-union type for your paths and pass it as the `K` parameter to `SettingDefinitionItem<K>` / `SettingControl<K>`.

## Reacting to changes outside the settings tab

If what your tab displays depends on state that changes elsewhere (vault contents, the list of enabled plugins, a value your plugin computes in the background), the tab can go stale while the user has it open. Call `this.update()` to re-run `getSettingDefinitions()` and rebuild.

Wire the listeners up from the settings tab constructor, since that's where the tab knows what state it depends on. Register them through plugin.registerEvent() so they're cleaned up when the plugin is disabled or removed.

```ts
import { App, debounce, PluginSettingTab } from 'obsidian';

export class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    let refresh = debounce(() => this.update(), 200, true);
    plugin.registerEvent(this.app.vault.on('create', refresh));
    plugin.registerEvent(this.app.vault.on('delete', refresh));
    plugin.registerEvent(this.app.vault.on('rename', refresh));
  }
}
```

`update()` is safe to call when the settings modal is closed. It just refreshes the tab's stored definitions and the search index, and the next time the user opens the tab they see fresh content. Debounce bursty events so a folder-wide rename doesn't trigger one re-render per file.

> **Use `visible` instead when possible**
> Don't reach for external events just to hide a row based on another setting's value; that's what the `visible` predicate is for. External events are for state your plugin doesn't itself own.

## Groups

A `SettingDefinitionGroup` (`type: 'group'`) gives a heading and shared layout to related settings.

```ts
{
  type: 'group',
  heading: 'Advanced',
  items: [
    { name: 'Debug logging', control: { type: 'toggle', key: 'debug' } },
    { name: 'Cache size (MB)', control: { type: 'number', key: 'cacheMb', min: 1 } },
  ],
}
```

Groups also accept a `search` callback (renders a search input in the header), an `extraButtons` array (header-level action buttons), a `cls` (extra CSS class on the group element), and a `visible` predicate to hide the group entirely.

For collections where the user can add, remove, or reorder entries, use `type: 'list'` instead. See #Lists.

## Lists

For settings where the user adds, removes, or reorders rows of the same kind (watched folders, tag aliases, blocked patterns), use `type: 'list'` instead of `'group'`. A list is rendered with a denser visual style and supports `onDelete` (always), `onReorder` (when order matters), `emptyState`, and `addItem` (a platform-appropriate add affordance).

```ts
{
  type: 'list',
  heading: 'Watched folders',
  emptyState: 'No folders being watched yet.',
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



Why each piece:

- `type: 'list'` applies the visual treatment (drag handle column, delete affordance, denser rows) and unlocks `emptyState`, `onReorder`, `onDelete`, and `addItem`.
- `emptyState` is shown when `items` is empty. Plain string or `DocumentFragment`.
- `addItem` renders a platform-appropriate add affordance: a `+` button in the list header on desktop (with `name` as the tooltip), and a tappable `+ {name}` row appended below the list on mobile. The mobile row is not part of `items`: it doesn't appear in search and doesn't shift `onDelete`/`onReorder` indices.
- `onReorder` callbacks receive `(oldIndex, newIndex)`. The DOM is already reordered; just update your data and save.
- `onDelete` wires both the delete button and the Delete/Backspace key. Always call `this.update()` after, since removing an entry changes the items array.
- `searchable: false` on each item keeps individual rows out of the global settings search.

For rows where each entry is a "click to do something" action (a list of registered commands the user can pin, for example), use the `action` field instead of `control`:

```ts
items: availableCommands.map((cmd) => ({
  name: cmd.name,
  searchable: false,
  action: () => {
    this.plugin.settings.pinned.push(cmd.id);
    void this.plugin.saveData(this.plugin.settings);
    this.update();
  },
})),
```

If your action depends on the row's position in the list, use the `index` it receives, read at click time (`action: (index: number) => void`). In a reorderable list, the user can move rows after the definitions are authored, so a position captured from the outer `map` would point at the wrong row:

```ts
{
  type: 'list',
  onReorder: async (oldIndex, newIndex) => { /* ... */ },
  items: this.plugin.settings.items.map((item) => ({
    name: item.label,
    searchable: false,
    action: (index) => this.plugin.doSomething(index),
  })),
}
```

The `index` matches the row's live position, so the action stays correct even after the user reorders the list.

### Lists with a form modal

When new entries need a multi-field input or validation beyond a single inline text field, open a Modal from `addItem.action`. The same affordance covers both platforms: `addItem` already renders a desktop button and a mobile row from one definition.

```ts
let values: string[] = this.plugin.settings.entries ?? [];

let openAddForm = () => {
  new AddEntryModal(this.app, values, (entry) => {
    values.push(entry);
    this.plugin.settings.entries = values;
    void this.plugin.saveData(this.plugin.settings);
    this.update();
  }).open();
};

return [
  {
    type: 'list',
    emptyState: 'No entries yet.',
    addItem: {
      name: 'Add entry',
      action: openAddForm,
    },
    onDelete: (idx) => {
      values.splice(idx, 1);
      void this.plugin.saveData(this.plugin.settings);
      this.update();
    },
    items: values.map((value) => ({
      name: value,
      searchable: false,
    })),
  },
];
```

## Sub-pages

A `SettingDefinitionPage` is a navigable entry on the parent tab; clicking it slides in a sub-page with a back button. Use sub-pages sparingly: only when the parent tab is too long to scan, or the section has a self-contained scope (a dictionary, a font picker, an ignore list). If a section is just two or three settings, leave them on the parent tab.

Pages can nest. Page names must be unique among their siblings at the same depth, otherwise path-based navigation breaks. Obsidian logs a console error when duplicates are detected.

### Declarative pages

The page content is a list of definitions. Obsidian renders the page automatically.

```ts
{
  type: 'page',
  name: 'Advanced',
  desc: 'Power-user options.',
  items: [
    { name: 'Debug logging', control: { type: 'toggle', key: 'debug' } },
    { name: 'Verbose errors', control: { type: 'toggle', key: 'verbose' } },
    {
      type: 'group',
      heading: 'Cache',
      items: [
        { name: 'Cache size (MB)', control: { type: 'slider', key: 'cacheMb', min: 1, max: 500, step: 1 } },
        { name: 'Clear cache', action: () => this.plugin.clearCache() },
      ],
    },
  ],
}
```

Always start with the declarative form. Reach for the imperative form only when this can't express what you need.

### Imperative pages

When the page's UI is computed from runtime state or interleaves rendered content with imperative DOM, subclass `SettingPage` and pass a factory:

> **You opt out of the declarative system inside `display()`**
> Controls you build by hand in `display()` are invisible to `getSettingDefinitions()`. They aren't indexed for global settings search, and the declarative features that key off definitions (`visible`/`disabled` predicates, automatic read/write and save) don't apply. You own all of that yourself. Use an imperative page only for the parts that genuinely need it, and keep the rest declarative.

```ts
import { SettingPage, Setting } from 'obsidian';

class StatusPage extends SettingPage {
  constructor(private plugin: MyPlugin) {
    super();
    this.title = 'Status';
  }

  display() {
    this.containerEl.empty();

    let stats = this.plugin.computeStats();
    this.containerEl.createEl('h3', { text: `${stats.totalEntries} entries` });
    this.containerEl.createEl('p', { text: `Last sync: ${stats.lastSync}` });

    new Setting(this.containerEl)
      .setName('Refresh now')
      .addButton((btn) => btn
        .setButtonText('Refresh')
        .onClick(async () => {
          await this.plugin.sync();
          this.display();
        }));
  }
}

// In getSettingDefinitions():
{
  type: 'page',
  name: 'Status',
  page: () => new StatusPage(this.plugin),
}
```

The factory runs each time the page is opened. `display()` runs whenever the page needs to redraw; call `this.display()` from inside the page itself to refresh after state changes.

Override `hide()` to clean up anything that outlives the DOM (observers, timers, registered events). It runs when the user navigates away, the containing tab is switched, or the settings modal is closed. It is not guaranteed to run if the host window is destroyed without going through a normal close.

```ts
class StatusPage extends SettingPage {
  private timer: number;

  display() {
    this.containerEl.empty();
    this.containerEl.createEl('p', { text: `Last refresh: ${new Date().toLocaleTimeString()}` });
    this.timer = window.setInterval(() => this.display(), 1000);
  }

  hide() {
    window.clearInterval(this.timer);
  }
}
```

`items` and `page` are mutually exclusive. Provide one or the other.



## Render callback

Use a `render` callback when the setting needs anything beyond a simple bind: side effects, custom UI, or suggesters not covered by `file` and `folder`. For showing or hiding rows based on another setting, use the `visible` predicate instead.

```ts
{
  name: 'Enable feature X',
  render: (setting) => {
    setting.addToggle((toggle) => toggle
      .setValue(this.plugin.settings.featureX)
      .onChange(async (value) => {
        this.plugin.settings.featureX = value;
        this.plugin.applyFeatureX();
        await this.plugin.saveData(this.plugin.settings);
      }));
  },
}
```

> **`render` does not auto-save**
> Obsidian only saves automatically for `control` bindings. Inside a `render` callback, always `await this.plugin.saveData(this.plugin.settings)` after mutating settings.

For settings that hide or show others based on another value, prefer the `visible` predicate documented in #Conditional visibility and enabling. Use `this.update()` when the *set* of definitions changes (rows added or removed). Don't call `this.display()` to refresh declarative content: on Obsidian 1.13.0+, `display()` is bypassed whenever `getSettingDefinitions()` returns a non-empty array.

### Cleanup

If your `render` callback subscribes to something that outlives the DOM (a `ResizeObserver`, a `MutationObserver`, a `setInterval`, or anything that wouldn't otherwise be garbage-collected when the row is removed), return a cleanup function. Obsidian invokes it before the row is torn down (re-render, page navigation, tab switch, or modal close).

```ts
{
  name: 'Live preview',
  render: (setting) => {
    let previewEl = setting.controlEl.createDiv('preview');
    let observer = new ResizeObserver(() => {
      previewEl.setText(`${previewEl.clientWidth}px`);
    });
    observer.observe(previewEl);
    return () => observer.disconnect();
  },
}
```

You don't need to clean up plain DOM event listeners attached to elements inside the `Setting` row; they go with the DOM. The return value is only for things the DOM teardown can't reach. For workspace or vault events that should outlive the settings UI, register them on your plugin instead. See #Reacting to changes outside the settings tab.

> ****> Cleanup is not guaranteed to run if the host window is destroyed (for example, the OS kills the renderer). For state that *must* be released, register it on the plugin instead. See #Reacting to changes outside the settings tab.

## Style guide

### Sentence case for all UI text

Use sentence case for names, descriptions, headings, button labels, placeholders, and anything else the user reads in your tab. Only the first word and proper nouns are capitalized.

- ✅ "Template folder location" — ❌ "Template Folder Location"
- ✅ "Create new note" — ❌ "Create New Note"

### No top-level heading

Don't add a "General", "Settings", or plugin-name heading at the top of the tab. The tab title in the sidebar already names the plugin.

```ts
// ❌ Don't
return [
  { type: 'group', heading: 'My Plugin', items: [/* … */] },
];

// ✅ Do
return [
  { name: 'Foo', control: { type: 'toggle', key: 'foo' } },
  { name: 'Bar', control: { type: 'toggle', key: 'bar' } },
];
```

### Headings only when there are multiple sections

If the whole tab is one section, don't add any group heading. Add headings only once you have two or more distinct sections.

When there are multiple sections and one is "general", leave the general settings at the top with no heading and start headings at the second section. This mirrors what Obsidian's core tabs do.

```ts
return [
  // General — no heading
  { name: 'Default folder', control: { type: 'folder', key: 'folder' } },
  { name: 'Open on launch', control: { type: 'toggle', key: 'openOnLaunch' } },

  // Subsequent sections get headings
  { type: 'group', heading: 'Appearance', items: [/* … */] },
  { type: 'group', heading: 'Advanced', items: [/* … */] },
];
```

### Don't repeat "settings" in headings

Everything under the tab is settings; saying so in every heading is redundant.

- ✅ "Advanced" — ❌ "Advanced settings"
- ✅ "Templates" — ❌ "Settings for templates"

### Save on change, not on submit

A setting in your tab should persist the moment the user changes it. `control` definitions do this automatically; in `render` callbacks, call `await this.plugin.saveData(this.plugin.settings)` from inside `onChange`. The user navigating away should never be a save action.

If a setting is too complex to commit on every keystroke (multiple required fields, cross-field validation, an entry that's only meaningful when fully constructed), that's a signal it doesn't belong directly in the tab. Surface it through a Modal with explicit "Save" / "Cancel" buttons, and let the tab store the resulting value or list. Settings tabs and sub-pages aren't designed to act as forms.

### One control per setting row

Each row should have a single mutable control. Avoid putting two text inputs, or a text input next to a dropdown, side by side in one `Setting`.

- ✅ One row → one toggle, one dropdown, one text input.
- ❌ A row with two text inputs the user fills in together.

Multiple controls per row stack vertically on mobile, which breaks readability and disrupts the visual rhythm of the tab. When you genuinely need to capture multiple values together (a name and a path, a start and end pair), collect them in a Modal using the #Lists with a form modal pattern: the tab shows a list of completed entries, and an "Add" button opens the modal that builds one.

### Avoid textareas in the main tab

A `textarea` is much taller than every other control and disrupts the regular row rhythm of the tab. If you need to collect multi-line text, move it into a form modal (see the #Lists with a form modal pattern). When the textarea has to live on the tab, push it to the bottom so it doesn't break the flow of the settings above it.

### Keep descriptions short

`desc` is for a single sentence explaining what the setting does, not for warnings or paragraphs of context. Long descriptions push the next row off-screen, disrupt scanning, and aren't guaranteed to be read.

If the user needs to acknowledge a warning before a setting takes effect (a destructive action, an irreversible migration, a feature with non-obvious consequences), put the warning in a Modal with an explicit confirm step. If the user needs background context to understand the setting, link to a docs page from `desc` rather than inlining it.

## Settings inside a modal

The declarative settings API is for `PluginSettingTab` only. If your plugin opens a Modal that needs setting rows, construct Setting and SettingGroup directly against the modal's `contentEl`; modals build their UI imperatively.

## Legacy: imperative display() approach

> ****> If your plugin's `minAppVersion` is below 1.13.0, you must use this approach or the dual-support pattern documented in Migrate to declarative settings#Path B: dual support. The imperative API remains supported indefinitely as a fallback on 1.13+, but the declarative API is preferred for new code.

Before 1.13.0, settings tabs were built by overriding `display()` and constructing `Setting` rows directly:

```ts
import ExamplePlugin from './main';
import { App, PluginSettingTab, Setting } from 'obsidian';

export class ExampleSettingTab extends PluginSettingTab {
  plugin: ExamplePlugin;

  constructor(app: App, plugin: ExamplePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Default value')
      .addText((text) =>
        text
          .setPlaceholder('Lorem ipsum')
          .setValue(this.plugin.settings.sampleValue)
          .onChange(async (value) => {
            this.plugin.settings.sampleValue = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

`display()` is where you build the content for the settings tab. For more information about container elements, refer to HTML elements.

`new Setting(containerEl)` appends a setting to the container element. The Setting class provides methods like `setName` and `setDesc` to label the setting, plus a family of `add…` methods for each control type.

### Available components

The imperative API exposes additional components that don't have first-class declarative equivalents yet. You can still use them on Obsidian 1.13.0+ from inside a #Render callback.

#### Headings

```ts
new Setting(containerEl).setName('Defaults').setHeading();
```

#### Search with suggestions

To provide users with a searchable list of available items, implement the AbstractInputSuggest class and hook it up to a search. (It also works with regular text inputs.)


```ts
new Setting(containerEl)
  .setName('Search')
  .addSearch((search) => {
    search.setValue(this.plugin.settings.icon)
      .setPlaceholder('Search for an icon')
      .onChange(async (value) => {
        this.plugin.settings.icon = value;
        await this.plugin.saveSettings();
      });
    new IconSuggest(this.plugin.app, search.inputEl);
  });
```

#### Moment format

Obsidian uses the [moment.js](https://momentjs.com/) library for formatting dates. The library supports custom tokens to customize the look of the resulting string. The MomentFormatComponent can render an example of the currently configured format.

```ts
let dateSampleEl: HTMLElement;
const dateDesc = createFragment((frag) => {
  frag.appendText('For a list of all available tokens, see the ');
  frag.createEl('a', {
    text: 'format reference',
    attr: { href: 'https://momentjs.com/docs/#/displaying/format/', target: '_blank' },
  });
  frag.createEl('br');
  frag.appendText('Your current syntax looks like this: ');
  dateSampleEl = frag.createEl('b', 'u-pop');
});

new Setting(containerEl)
  .setName('Date format')
  .setDesc(dateDesc)
  .addMomentFormat((momentFormat) => momentFormat
    .setValue(this.plugin.settings.dateFormat)
    .setSampleEl(dateSampleEl)
    .setDefaultFormat('MMMM dd, yyyy')
    .onChange(async (value) => {
      this.plugin.settings.dateFormat = value;
      await this.plugin.saveSettings();
    }));
```

#### Buttons

```ts
new Setting(containerEl)
  .setName('Button')
  .addButton((button) => button
    .setButtonText('Click me!')
    .onClick(() => {
      new Notice('This is a notice!');
    }));
```

You can also add multiple buttons to the same setting for performing different actions.

#### Extra button

An extra button is a compact, icon-only button that sits alongside a setting's main control. Use it for secondary actions on the row: opening a help dialog, revealing a related file, copying a value, resetting to default, or any other ancillary affordance that shouldn't take up the space of a full button.

```ts
new Setting(containerEl)
  .setName('API endpoint')
  .addText((text) => text.setValue(this.plugin.settings.endpoint))
  .addExtraButton((button) => button
    .setIcon('lucide-rotate-ccw')
    .setTooltip('Reset to default')
    .onClick(() => {
      // ...
    }));
```

#### Progress bar

While a slider allows for numeric input, a progress bar can show the progress of a task running in the background. It can also be used to show a quota; for example, disk space used.

```ts
new Setting(containerEl)
  .setName('Progress bar')
  .setDesc('It\'s 50% done')
  .addProgressBar((bar) => bar.setValue(50));
```

To move an existing imperative tab to the declarative API, see Migrate to declarative settings.
