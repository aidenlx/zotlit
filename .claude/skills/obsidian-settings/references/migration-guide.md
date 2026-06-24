As of Obsidian 1.13.0, plugin settings tabs can be defined declaratively by overriding `getSettingDefinitions()` on PluginSettingTab. Obsidian handles rendering, search indexing, persistence, and validation. You describe the settings, not the DOM.

This guide walks through converting an existing imperative `display()` tab to the new API.

> **Requires Obsidian 1.13.0+**
> The declarative settings API described on this page (`getSettingDefinitions()`) requires Obsidian 1.13.0, which is currently in an insider build. If you need to support older Obsidian versions, see #Path B: dual support.

## What you'll learn

After you've completed this guide, you'll be able to:

- Decide between a clean 1.13-only migration and a dual-support migration.
- Translate common imperative patterns (toggle, dropdown, validated text input) into declarative definitions.
- Keep your existing `display()` implementation alongside the new API for older Obsidian versions.

## Before you start

This guide assumes you have:

- A working plugin with a `PluginSettingTab` subclass that overrides `display()`.
- Familiarity with Settings (defining a settings interface, `loadData()`, `saveData()`).
- A decision on your plugin's `minAppVersion`. See #Choosing a path below.

## The starting point

The following tab has three settings: a toggle, a dropdown with a default, and a text input that rejects values containing spaces. This is the imperative `display()` implementation we'll migrate.

```ts
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface MySettings {
  enabled: boolean;
  mode: 'fast' | 'thorough';
  cacheKey: string;
}

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Enable feature')
      .setDesc('Turns the feature on or off.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Mode')
      .addDropdown(dropdown => dropdown
        .addOption('fast', 'Fast')
        .addOption('thorough', 'Thorough')
        .setValue(this.plugin.settings.mode ?? 'fast')
        .onChange(async (value) => {
          this.plugin.settings.mode = value as 'fast' | 'thorough';
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Cache key')
      .setDesc('Alphanumeric only.')
      .addText(text => text
        .setValue(this.plugin.settings.cacheKey)
        .onChange(async (value) => {
          let trimmed = value.trim();
          if (!/^[a-z0-9]*$/i.test(trimmed)) return;
          this.plugin.settings.cacheKey = trimmed;
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
}
```

## Migrate the tab

There are two ways to migrate, depending on which Obsidian versions you support.

### Choosing a path

| Your plugin's `minAppVersion` | What to do |
| --- | --- |
| `>= 1.13.0` | Path A: implement `getSettingDefinitions()` only. Delete `display()`. |
| `< 1.13.0` and you want to adopt the new API | Path B: keep `display()` and add `getSettingDefinitions()` alongside it. |
| `< 1.13.0` and you don't need the new features | Leave the plugin as-is. The new API is opt-in. |

Prefer Path A whenever you can; it's simpler and avoids maintaining two implementations. Choose Path B only if you have an existing user base on Obsidian < 1.13.0 that you can't drop.

### Path A: clean 1.13-only migration

This path bumps `minAppVersion` to 1.13.0, deletes `display()`, and writes only `getSettingDefinitions()`.

#### Steps

1. Bump `minAppVersion` to `"1.13.0"` in `manifest.json`.
2. Add a `getSettingDefinitions()` method that returns an array of definitions.
3. For each one-key binding, write `{ name, desc, control: { type, key } }`. Each `key` corresponds to a property on `this.plugin.settings`. See Settings#Control types for every available type.
4. Move any value-shape validation (regex, range, format) from a custom `onChange` into a `validate` callback on the control. See Settings#Validating input.
5. Delete the `display()` override and any imports that are no longer used (typically `Setting`).

#### After

```ts
import { App, PluginSettingTab } from 'obsidian';

interface MySettings {
  enabled: boolean;
  mode: 'fast' | 'thorough';
  cacheKey: string;
}

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions() {
    return [
      {
        name: 'Enable feature',
        desc: 'Turns the feature on or off.',
        control: { type: 'toggle', key: 'enabled' },
      },
      {
        name: 'Mode',
        control: {
          type: 'dropdown',
          key: 'mode',
          defaultValue: 'fast',
          options: { fast: 'Fast', thorough: 'Thorough' },
        },
      },
      {
        name: 'Cache key',
        desc: 'Alphanumeric only.',
        control: {
          type: 'text',
          key: 'cacheKey',
          placeholder: 'default',
          validate: (value: string) =>
            /^[a-z0-9]*$/i.test(value.trim()) ? undefined : 'Use letters and digits only.',
        },
      },
    ];
  }
}
```

#### What changed

- `display()` is gone. Obsidian renders from the array.
- All three settings collapse to `control` definitions. Obsidian reads `this.plugin.settings[key]`, writes changes back, and calls `saveData()` for you.
- The validation logic has been moved out of `onChange` and into a `validate` callback. An inline error message now appears when the input doesn't match.
- `Setting` is no longer imported.

### Path B: dual support

Keep your existing `display()` exactly as it is, and add `getSettingDefinitions()` alongside it.

- On Obsidian 1.13.0+, `getSettingDefinitions()` is called and `display()` is skipped.
- On Obsidian < 1.13.0, `display()` runs as it always has.

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';

interface MySettings {
  enabled: boolean;
  mode: 'fast' | 'thorough';
  cacheKey: string;
}

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // 1.13.0+: Obsidian calls this and skips display().
  // Controls auto-bind to this.plugin.settings[key].
  getSettingDefinitions() {
    return [
      {
        name: 'Enable feature',
        desc: 'Turns the feature on or off.',
        control: { type: 'toggle', key: 'enabled' },
      },
      {
        name: 'Mode',
        control: {
          type: 'dropdown',
          key: 'mode',
          defaultValue: 'fast',
          options: { fast: 'Fast', thorough: 'Thorough' },
        },
      },
      {
        name: 'Cache key',
        desc: 'Alphanumeric only.',
        control: {
          type: 'text',
          key: 'cacheKey',
          placeholder: 'default',
          validate: (value: string) =>
            /^[a-z0-9]*$/i.test(value.trim()) ? undefined : 'Use letters and digits only.',
        },
      },
    ];
  }

  // < 1.13.0: Obsidian calls this. Keep your original imperative implementation.
  display(): void {
    let { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Enable feature')
      .setDesc('Turns the feature on or off.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    // …mode and cacheKey settings unchanged from Before
  }
}
```

Once your user base on < 1.13.0 is small enough, delete the `display()` method and bump `minAppVersion` to `1.13.0`.

> **The two implementations must stay in sync**
> Every time you add or change a setting, update both `display()` and `getSettingDefinitions()`. Drift between the two means users on different Obsidian versions see different settings. If the maintenance overhead isn't worth it, prefer Path A and bump `minAppVersion`.

## When to use `render` instead

In Path A above, the `cacheKey` validation moved from a hand-rolled `onChange` into `validate`. That works whenever the rejection is purely about the value's shape (regex, range, format). But there are cases where `control` + `validate` isn't enough, and a `render` callback is the right tool:

- **Side effects** on change — call a method, update a status bar, refresh another view.
- **Inverted or derived values** — a toggle that drives a string config, a slider that drives a complex calculation.
- **Custom suggesters** beyond `file`/`folder` — a command picker, a tag picker, anything that uses AbstractInputSuggest.

For these, a `render` callback gives you full control over the `Setting` row. See Settings#Render callback.

For conditional visibility (showing or hiding a setting based on another setting's value), you don't need `render`. Use the `visible` predicate documented in Settings#Conditional visibility and enabling.

## Common pitfalls

- `control`, `render`, and `action` on a definition are mutually exclusive; TypeScript will reject more than one.
- `getSettingDefinitions()` runs on every `update()` AND once when the tab is registered (for search indexing). Keep it cheap: no I/O, no network calls.
- `desc` accepts a `string` or `DocumentFragment`. For rich descriptions with formatting or links, pass a `DocumentFragment` built with `createFragment(...)`.
- A `render` callback does **not** auto-save. Always `await this.plugin.saveData(this.plugin.settings)` after mutating settings.
- When an `action` callback depends on the row's position, use the `index` argument it receives rather than an index captured in the outer `map`. A captured index goes stale once the user reorders or deletes neighboring rows. Closing over the row's stable data (an `id`, say) is fine; only position is order-dependent. (Deleting and reordering rows themselves is handled by `onDelete` and `onReorder`, not `action`.)
- To re-render the tab after data changes (interdependent settings, list mutations), call `this.update()`. On 1.13.0+, calling `display()` won't refresh anything declarative; `display()` is bypassed when `getSettingDefinitions()` returns a non-empty array.
- Page names must be unique among their siblings at the same depth, or path-based navigation will misbehave.
- `validate` doesn't replace the stored value. If your stored settings might already be invalid (loaded from an older plugin version), validate again when reading them.

## Verification

After migrating:

1. Build the plugin (`npm run build` or `npm run dev`).
2. Open the plugin's settings tab in Obsidian and walk top to bottom. Every setting should render, every control should reflect the current value, and every change should persist across a reload.
3. Open the global settings search. Each setting should be findable by name (and `aliases`, if set).
4. For each `validate` callback, enter invalid input and confirm an inline error appears and the value isn't saved.
5. For any `type: 'list'` groups, add, delete, and reorder rows. Confirm `plugin.settings` is updated after each action.
6. For any sub-pages, open and navigate back.
7. If you took Path B, install your plugin on an Obsidian version below 1.13.0 and verify `display()` still renders the settings correctly.

## FAQ

### Why didn't my `render` callback save?

A `render` callback gives you full control of the `Setting` row, but Obsidian doesn't know what you're binding, so it doesn't auto-save. Always `await this.plugin.saveData(this.plugin.settings)` at the end of your `onChange`. `control` definitions are different; Obsidian saves those for you.

### My stored data is invalid. How do I clean it up?

The `validate` callback is a UI gate. It shows an inline error when the user enters invalid input, but it does not modify or replace stored values. If older versions of your plugin saved data that no longer passes validation, validate again when reading settings (for example, in your plugin's `loadSettings()` method) and either repair or discard the bad value before the settings tab renders.
