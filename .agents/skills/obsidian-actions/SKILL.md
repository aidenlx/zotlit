---
name: obsidian-actions
description: |
  Patterns for registering commands (action modules) and building context menus (menu segments) in
  the Obsidian plugin. Use when adding commands, menu items, context menu logic, or wiring
  action/menu code in apps/obsidian/src/services/. Also use when a service needs to expose
  functionality to the user via the command palette or right-click menus.
---

# Action Modules & Menu Segments

Two separate concerns for exposing service functionality to users:
- **Action modules** — register commands (keyboard / command palette)
- **Menu segments** — build context menu items (right-click, pane menus)

Both close over service deps. Both colocate with their feature domain. For the underlying service architecture, see the `obsidian-services` skill.

## Action Modules

Each domain owns its action module. No centralized ActionService. Each feature exports an `add*Actions(plugin, deps)` function as the entry point convention. Internally, action modules are free to organize however makes sense: define command descriptors, register disposables via `plugin.register(...)`, set up repeat-key handlers, etc. The convention is the entry point shape, not the implementation.

### File placement

Colocate with the service: `services/<domain>/actions.ts`

### Shape

```ts
// services/database/actions.ts
export function addDatabaseActions(
  plugin: ZotLitPlugin,
  deps: { db: DatabaseService },
) {
  plugin.addCommand({
    id: "zotlit:refresh-db",
    name: "Refresh Zotero database",
    callback: async () => {
      try {
        await deps.db.ready;
        await deps.db.refresh();
      } catch {
        new Notice("Database is not available");
      }
    },
  });
}
```

### Graceful degradation

Command handlers check `service.ready` at invocation time. If the backing service failed to init, the command shows a notice rather than crashing:

```ts
try {
  await deps.db.ready;
  // ... do work
} catch {
  new Notice("Database is not available");
}
```

`onError` (in `ServiceContainer`) handles detailed error reporting. Consumers only need to know whether the service is available.

### editorCheckCallback pattern

For commands that only apply in certain editor contexts, use `editorCheckCallback`. The `checking` parameter separates visibility from execution:

```ts
plugin.addCommand({
  id: "zotlit:update-literature-note",
  name: "Update literature note",
  editorCheckCallback(checking, _editor, ctx) {
    if (!ctx.file || !isLiteratureNote(ctx.file, plugin.app)) return false;
    if (checking) return true;
    void (async () => {
      try {
        await deps.db.ready;
        const itemKey = getItemKeyOf(ctx.file!, plugin.app.metadataCache);
        if (!itemKey) {
          new Notice("Cannot get Zotero item key from file");
          return;
        }
        // ... update logic
      } catch {
        new Notice("Database is not available");
      }
    })();
  },
});
```

### Wiring in onload()

Action modules are called unconditionally in `onload()` after `buildServices`:

```ts
addDatabaseActions(this, { db: services.db });
addNoteActions(this, { db: services.db, noteIndex: services.noteIndex });
addCitationActions(this, { db: services.db, settings: services.settings });
```

## Menu Segments

No wrapper around `Menu`. Obsidian's imperative-declarative API (`.addItem(i => i.setTitle(...).onClick(...))`) is already clean enough. The only abstraction is a shared function signature and a unified context type.

### MenuSegment type

A segment is a function that may add zero or more items to a menu based on context. No class, no interface beyond this. Returns `true` if it rendered any items, `false` otherwise — composites use this to skip separators or avoid empty submenu wrappers:

```ts
type MenuSegment = (menu: Menu, ctx: ItemMenuContext) => boolean;
```

### ItemMenuContext — unified menu context

Different menu events provide different raw data. `ItemMenuContext` normalizes them into a discriminated union separating **event kind** from **menu source**:

```ts
type PaneMenuSource = 'more-options' | 'tab-header' | 'sidebar-context-menu';

type ItemMenuContext = {
  file: TFile | undefined;
  itemKey: string | undefined;
  isLitNote: boolean;
} & (
  | { kind: 'editor'; source: 'editor' }
  | { kind: 'file'; source: string }
  | { kind: 'pane'; source: PaneMenuSource }
);
```

`kind` distinguishes event origin for routing; only routing logic should inspect it. `source` carries the Obsidian-provided source string (especially useful for pane menus). Domain fields (`file`, `itemKey`, `isLitNote`) are resolved once — feature segments inspect these, never raw event args.

### resolveItemContext

Converts raw Obsidian event args into `ItemMenuContext`:

```ts
function resolveItemContext(
  app: App,
  ctx:
    | { kind: 'editor'; file: TFile | null | undefined }
    | { kind: 'file'; file: TAbstractFile; source: string }
    | { kind: 'pane'; source: PaneMenuSource; file: TFile | null | undefined },
): ItemMenuContext {
  const file = ctx.file instanceof TFile ? ctx.file : undefined;
  const base = {
    file,
    itemKey: file ? getItemKeyOf(file, app.metadataCache) : undefined,
    isLitNote: !!file && isLiteratureNote(file, app),
  };
  switch (ctx.kind) {
    case 'editor': return { ...base, kind: 'editor', source: 'editor' };
    case 'file':   return { ...base, kind: 'file', source: ctx.source };
    case 'pane':   return { ...base, kind: 'pane', source: ctx.source };
  }
}
```

To add a new context dimension (e.g., editor selection state), extend the relevant union branch — segments gain access automatically.

### Writing a segment

Each feature exports a factory that closes over deps and returns a `MenuSegment`. File placement: `services/<domain>/menu.ts`

```ts
// services/note-index/menu.ts
import type { DatabaseService } from "../database/service";
import type { NoteIndexService } from "./service";

interface NoteMenuDeps {
  db: DatabaseService;
  noteIndex: NoteIndexService;
}

export function noteMenuSegment(deps: NoteMenuDeps): MenuSegment {
  return (menu, ctx) => {
    if (!ctx.itemKey) return false;

    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle("Open in Zotero")
        .setIcon("external-link")
        .onClick(async () => {
          try {
            await deps.db.ready;
            // ...
          } catch {
            new Notice("Database is not available");
          }
        }),
    );

    if (ctx.source !== "tab-header") {
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle("Update literature note")
          .setIcon("refresh-cw")
          .onClick(async () => {
            try {
              await deps.db.ready;
              // ...
            } catch {
              new Notice("Database is not available");
            }
          }),
      );
    }
    return true;
  };
}
```

Visibility logic (the `if` checks) lives inside the segment — the feature decides what to show where. The segment returns `false` when irrelevant, so composites can react to empty contributions without pre-filtering.

### Rules

**Menu construction is synchronous.** Never `await` during segment execution. Obsidian builds menus in one tick. Only `onClick` handlers may be async.

**Use `setSection()`** with a consistent section key on all items so they cluster together regardless of insertion order.

**Return the boolean.** `false` when the segment adds nothing (e.g., no `itemKey`). Composites depend on this.

**Visibility uses sync state only.** Services may provide a synchronous readiness accessor (e.g., a getter or method) that reflects whether init has completed, failed, or is still pending — implementation is up to the service. If a service is still loading, disable the item with a placeholder title (e.g., "Loading…") using that synchronous state — don't await inside the segment body.

### Composing segments

Segments are composed into a single callable. Ordering is explicit:

```ts
// services/menu.ts
export function buildMenuSegments(services: Services): MenuSegment {
  const segments = [
    noteMenuSegment({ db: services.db, noteIndex: services.noteIndex }),
    citationMenuSegment({ db: services.db, settings: services.settings }),
    templateMenuSegment({ db: services.db, settings: services.settings }),
  ];
  return (menu, ctx) => {
    let rendered = false;
    for (const seg of segments) {
      if (seg(menu, ctx)) rendered = true;
    }
    return rendered;
  };
}
```

### Wiring to Obsidian events

Registration happens in `onload()`. Custom workspace events and DOM-based menu hooks also live in `onload()` for now; extract to a dedicated service if the wiring grows complex.

```ts
const zotlitMenu = buildMenuSegments(services);

this.registerEvent(
  this.app.workspace.on("editor-menu", (menu, _editor, info) => {
    zotlitMenu(menu, resolveItemContext(this.app, { kind: "editor", file: info.file }));
  }),
);

this.registerEvent(
  this.app.workspace.on("file-menu", (menu, file, source) => {
    zotlitMenu(menu, resolveItemContext(this.app, { kind: "file", file, source }));
  }),
);
```

For view `onPaneMenu` (not a workspace event — called by Obsidian on the view instance). The view receives the composite segment via deps (closure capture in `registerView` factory):

```ts
onPaneMenu(menu: Menu, source: string) {
  super.onPaneMenu(menu, source);
  this.#zotlitMenu(menu, resolveItemContext(
    this.app, { kind: "pane", source: source as PaneMenuSource, file: this.file },
  ));
}
```

## Relationship Between Actions and Menus

Action modules and menu segments are separate concerns that may share the same underlying operation. Menu items may call `app.commands.executeCommandById()` to reuse command logic, but direct invocation is also fine when the menu handler needs different args or flow.

## Shared Context Resolution

Shared context resolution (e.g., "which item is the current note about?") lives in utility functions (`getItemKeyOf`, `isLiteratureNote`), not a service — it's stateless frontmatter lookup.

## View Degradation

Views also check `service.ready` at open time:

```ts
async onOpen() {
  try {
    await this.#db.ready;
    // render normally
  } catch {
    // render unavailable state
  }
}
```
