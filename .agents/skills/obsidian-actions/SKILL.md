---
name: obsidian-actions
description: |
  Commands and menus in the Obsidian plugin: registering a command, adding an entry to
  Obsidian's file menu or a view's "More options" menu, building a menu of ZotLit's own, and
  the `zotlit:*-menu` events other plugins render into. Use when adding or changing a command
  or menu entry, choosing a menu section or icon, or exposing a menu to listeners.
---

# Commands and menus

Every feature owns its commands and menu entries, colocated in `services/<domain>/` or `views/<view>/`, and `zt-main.ts` wires them in `onload()` after `buildServices`.

## Commands

A feature exports `add<Feature>Actions(plugin, deps)`, with `plugin` narrowed to the members it uses (`Pick<Plugin, "addCommand">`). `services/database/actions.ts` is the reference shape:

```ts
export function addDatabaseActions(
  plugin: Pick<Plugin, "addCommand">,
  services: { db: ZoteroReadsService },
): void {
  plugin.addCommand({
    id: "refresh-zotero-data", // bare: Obsidian prefixes the plugin id
    name: m.command_refresh_db_name(), // i18n, Obsidian wording (/i18n-ui-text)
    callback: async () => {
      await services.db.ready;
      await toast.promise(services.db.refresh(), { … });
    },
  });
}
```

- A command for one kind of file uses `checkCallback` (or `editorCheckCallback`): `checking` answers visibility, the second call runs it.
- A command and a menu entry for the same operation share one handler function; each surface resolves its own target and calls it.

## The section rule

Obsidian's `Menu.sort()` shows a menu's entries grouped by section, in the order the menu registered its sections with `addSections`, a separator between groups. A section the menu never registered sorts **after every registered one — below "Delete"**. So every entry names a section its menu registered:

| Menu | Registered sections (Obsidian 1.14.4) |
|---|---|
| File explorer file menu | `title` `open` `action-primary` `action` `info` `info.copy` `view` `system` `""` `danger` |
| A view's More options | `close` `pane` `open` `action` `find` `info` `info.copy`¹ `view` `view.linked`¹ `system` `""` `danger` |
| Tab header | `title` `close` `pane` `open` `action` `find` `info` `info.copy`¹ `view` `view.linked`¹ `system` `""` `danger` |

¹ A submenu ("Copy path", "Open linked view"); an entry there lands inside it.

In those host menus, take the section from `MENU_SECTION` (`lib/menu-section.ts`), which names what goes in each: `pane` checked display choices, `open` opening the file elsewhere, `action` doing something with it, `info` reading out or copying what identifies it, `view` opening a view about it, `danger` replacing or deleting what the user wrote. The lint rule `zotlit-menu/no-literal-section` holds every `setSection` argument to such a list.

Every entry of a host menu, and of a menu of verbs, carries an icon:

```ts
menu.addItem((item) =>
  item
    .setSection(MENU_SECTION.danger)
    .setTitle(m.command_overwrite_note_name())
    .setWarning(true) // every danger entry
    .setIcon("file-x")
    .onClick(() => void overwrite()),
);
```

- A menu whose rows are a list of names — examples, Profiles, languages — calls `setNoIcon()` so the rows read flush; check marks stay. A `setIsLabel(true)` row carries no icon.
- Menu construction is synchronous; only `onClick` may await. Read anything a click needs after an `await` (a trigger's box) before the first `await`.
- A menu opened from a control anchors with `showMenuAtButton` from `lib/menu.ts`.

## File menu entries

ZotLit has one `file-menu` listener: `registerFileMenu` in `services/file-menu.ts`. A feature exports a **segment** factory and adds it to the ordered list in `zt-main.ts`, whose order is the row order inside each section.

```ts
/** "Copy item key" on a Literature Note's file menu. */
export function indexedKeyFileMenu(): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (!itemKey) return;
    menu.addItem((item) => item.setSection(MENU_SECTION.info) … );
  };
}
```

- The context is resolved once per menu: `file` (a `TFile`), `source` (`file-explorer-context-menu`, `more-options`, `tab-header`, `link-context-menu`, …), `leaf` (set on a view's own menus), `itemKey`, `noteKey`.
- A file view's More options raises `file-menu` with `source: "more-options"` and its leaf, so an entry for one view reads `leaf.view`.
- A multi-file selection raises Obsidian's separate `files-menu` event.

## A view's own More options

`onPaneMenu(menu, source)` calls `super.onPaneMenu` first, then adds entries with `MENU_SECTION`: display toggles and checked modes in `pane` (beside Obsidian's "Reading view"), opening other documents in `open`, choosing and refreshing in `action`, copying keys in `info`, restoring defaults in `danger`. `views/note-preview/view.tsx` is the reference.

## Menus ZotLit builds itself

A menu ZotLit creates with `new Menu()` around a research object — an annotation card, a colour, a comment editor, a picker of Attachments or cited works — is a **raised menu**: it registers sections and raises a `zotlit:*-menu` workspace event, the way Obsidian raises `file-menu`, so a listener adds entries to the right group. `services/menu-events.ts` holds each event's info type and section order.

1. Add the event to `ZotLitMenuEvents` and its sections to `MENU_EVENT_SECTIONS`; listeners' `workspace.on` typing follows.
2. Give ZotLit's own entries sections from `const SECTION = menuSections("zotlit:…")`. Group with sections rather than `addSeparator()`.
3. After ZotLit's entries and before the menu shows: `raiseMenu(menu, { workspace: app.workspace, name, info })`.

## Testing

- The mock `Menu` (`__mocks__/obsidian.ts`) keeps insertion order and records each item's `section` and the menu's `sections`: assert sections, not positions.
- `services/__fixtures__/file-menu.ts` `fileMenuHandler(segments, frontmatter)` drives the real `registerFileMenu` listener.
- In the running app (`/obsidian-debug`), open the menu and read `body > .menu`: each `.menu-group` is a section group. Obsidian's CSS hides a separator that follows another.
