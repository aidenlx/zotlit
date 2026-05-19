# Zotero Plugin Development: Changes Across Zotero 7 → 8 → 9

## 0. Release Status as of May 17, 2026

Both Zotero 8 and Zotero 9 are **shipped stable releases** — neither is in beta or planning anymore:

- **Zotero 8.0** was released on **January 22, 2026**, after roughly a year of beta testing (originally labeled the "Zotero 7.1" beta before being re-numbered when its scope grew). Patch versions 8.0.1 (Jan 27), 8.0.2 (Feb 3), 8.0.3 (Feb 7), 8.0.4 (Mar 6), and 8.0.5 (Mar 26 — Mac-only Safari 26.4 compatibility) shipped in the following weeks.
- **Zotero 9.0** was released on **April 10, 2026** — less than three months after Zotero 8, under Zotero's newly announced rapid release cycle. Patch versions 9.0.1 (Apr 21), 9.0.2 (Apr 30), and 9.0.3 (May 6) are out.
- Going forward, the Zotero team has committed to a **6–10 week major-release cadence** (Zotero 10, 11, …), with `strict_max_version` checks remaining in place. Dan Stillman has stated on the forums that future releases will involve far fewer plugin-breaking changes at once, and that new "sandboxed APIs" are being introduced that will "(mostly) remain stable between major versions" so well-behaved plugins may not need `strict_max_version` bumps at all.

Two framing remarks from the Zotero team that shape everything below:

- The Zotero 7 → Zotero 8 transition is described by Dan Stillman as **"a fairly big change as well, but it required much more straightforward changes"** compared with Zotero 6 → 7 (which required all plugins to be rewritten).
- The Zotero 8 → Zotero 9 transition is **the smallest plugin-relevant major transition to date** — there is no dedicated "Zotero 9 for Developers" page; the _Zotero 8 for Developers_ page is still the authoritative migration reference for plugin authors on the 8/9 platform. (Forum thread "Zotero 9 is amazing, but the plugin documentation is becoming a 'scavenger hunt'", April 15, 2026, with Dan Stillman replying "But we'll be improving this soon.")

In practice a plugin that already works on Zotero 8 will, in most cases, work on Zotero 9 with only a `strict_max_version` bump in `manifest.json`. Zutilo and Zoplicate are documented exceptions that broke on the Zotero 9 release day.

---

## 1. Zotero 7 → Zotero 8: Plugin-Relevant Changes

### 1.1 Underlying Mozilla / Gecko Platform

Zotero 8 incorporates the entire change set from Firefox 115 ESR through Firefox 140 — a **25 Firefox-version jump** spanning two ESR upgrades. Internally this happened in two steps that you may encounter in beta-era code:

- **Firefox 115 → Firefox 128** (the "Zotero 7.1" beta phase)
- **Firefox 128 → Firefox 140** (Zotero 8 proper)

`Zotero.platformMajorVersion` returns the underlying Firefox major (115, 128, or 140) and is the recommended way to feature-detect at runtime across the beta/release transition.

**Mozilla-side breaking changes that ripple into plugin code** (from the official _Zotero 8 for Developers_ page):

Firefox 115 → 128:

- Manual `Services.jsm` imports must be removed; `Services` is now a global in ESM scope.
- `nsIScriptableUnicodeConverter` is gone; replace `convertToByteArray()` and `convertToInputStream()` with `TextEncoder`/`TextDecoder` or Zotero's own helpers.
- `nsIOSFileConstantsService` is gone; use `PathUtils`/`IOUtils`.
- `XPCOMUtils.defineLazyGetter` is replaced by `ChromeUtils.defineLazyGetter`. The full `XPCOMUtils.defineLazyModuleGetters` / `defineLazyServiceGetters` family also moves under `ChromeUtils.*ESModuleGetters*`. Any plugin code using `Components.utils.import(...)` (`Cu.import`) must be migrated to either `ChromeUtils.importESModule(...)` (with the new `.sys.mjs` URL) or, more idiomatically, to a plain `import` statement inside an ESM.
- `nsIDOMChromeWindow` is gone.
- Login Manager: `addLogin` → `addLoginAsync`.
- `nsIFilePicker.init` now expects a `BrowsingContext` (Zotero recommends using the wrapper `Zotero.FilePicker` module instead).
- `DataTransfer#types` is now a standard array — `contains()` must become `includes()`.
- CSS pseudo `-moz-nativehyperlinktext` becomes `LinkText`.

Firefox 128 → 140 (the bigger one):

- **JSM → ESM ("ESMification").** Every `.jsm` in Firefox and Zotero is now an `.mjs` (or `.sys.mjs` for Firefox internals). Plugins are expected to convert their own JSMs, switch to standard ES `import` statements, and assign imported modules to a variable (the old "global import" pattern is no longer supported). All ESMs execute in **strict mode**.
- Zotero ships a migration script: copy `migrate-fx140/` from the zotero/zotero repo into your plugin and run `migrate-fx140/migrate.py esmify path/to/Module.jsm` (the `--imports` flag updates imports in non-JSM files; both forms accept a directory for batch conversion).
- **Bluebird has been removed.** Zotero now uses standard `Promise` everywhere. `Zotero.Promise.delay()` and `Zotero.Promise.defer()` are still shimmed for back-compat, but `defer()` is no longer callable as a constructor. Bluebird instance methods — `.map()`, `.filter()`, `.each()`, `.isResolved()`, `.isPending()`, `.cancel()` — are gone. Collection helpers should be rewritten as iteration or `await`. The same `migrate-fx140` directory has an `asyncify` mode: `migrate-fx140/migrate.py asyncify path/to/file.js`.
- `ZoteroProtocolHandler` extensions: `new AsyncChannel()` now takes an `async function`, not a generator.
- `Zotero.spawn()` has been removed.
- `Services.appShell.hiddenDOMWindow` is removed outside macOS; use only as a fallback.
- `ZOTERO_CONFIG` must now be `import`ed explicitly (it was previously a global).
- The first path segment of a `zotero:` URI is now parsed as the URI **host** rather than as part of its path — anything that builds or parses internal `zotero:` URLs (item handlers, custom protocol code, link generators) needs auditing.
- Button labels must be updated via the `.label` property, not via `setAttribute("label", …)`.

### 1.2 XUL → HTML Migration Progress

The XUL-to-HTML transition that began in Zotero 6 and accelerated in Zotero 7 (replacing `tabbox`, `listbox`, the item pane's horizontal tabs, etc. with HTML or with custom elements) is **substantially complete** in Zotero 8. Practical implications:

- Preference panes are now declared as XUL/XHTML fragments with no `<!DOCTYPE>`, default namespace XUL, HTML available under the `html:` prefix (e.g. `<html:link rel="localization" href="…">`). This format has not changed in 8/9 from how it worked in 7.
- The item pane in 7's redesign has fully migrated from XUL tabs to HTML-based collapsible sections plus a sidenav (consume via `Zotero.ItemPaneManager.registerSection` — unchanged in 8/9).
- Many remaining `xul:textbox`, `xul:listbox` usages were replaced by `html:input`, `html:select`. In Zotero 8 beta there were temporary regressions around `<textarea>` styling in plugin preference panes (no visible border in some XHTML windows, gray background in embedded HTML windows) — these were tracked on the zotero-dev list during 8.0 beta 4. By 8.0 stable the major issues were resolved.
- DTD entity localization (`<!ENTITY …>` substitution) is **dead**: Mozilla removed the `.dtd` parser in Firefox 115 and Zotero 8 no longer ships it. Anything still relying on `.dtd` will break silently (entities will render as raw `&name;`). Migrate to Fluent (`.ftl`).
- `.properties` files still work in 7 and 8 but are deprecated; Mozilla is removing usages internally. New plugin code should use Fluent.

### 1.3 Plugin Architecture, `bootstrap.js`, and Manifest

The bootstrap model from Zotero 7 is **unchanged**: `manifest.json` (WebExtension-style, with the `applications.zotero` block specifying `id`, `update_url`, `strict_min_version`, `strict_max_version`), a `bootstrap.js` with `startup` / `shutdown` / `install` / `uninstall` / `onMainWindowLoad` / `onMainWindowUnload` hooks, an `updates.json` update manifest, and runtime chrome registration via `aomStartup.registerChrome(...)` in `startup()`.

The lifecycle constants — `APP_STARTUP`, `APP_SHUTDOWN`, `ADDON_ENABLE`, `ADDON_DISABLE`, `ADDON_INSTALL`, `ADDON_UNINSTALL`, `ADDON_UPGRADE`, `ADDON_DOWNGRADE` — and the `{ id, version, rootURI }` argument shape are unchanged. Plugins still get full XPCOM access; Zotero has not adopted the WebExtensions sandbox model. `install.rdf` and the legacy RDF update manifest, which Zotero 6 supported in parallel, are now unsupported (the Z6 fallback is gone since most users are on Z7/8 already; for new plugins this was already true in Z7).

There is no `Zotero.Plugins` namespace exposed to plugins — plugin metadata is queried via the standard `AddonManager` (`Cc["@mozilla.org/addons/integration;1"]` / `AddonManager.getAddonByID(...)`). Plugins normally interact with the lifecycle exclusively through the bootstrap hooks.

**New for Zotero 8: self-uninstall via update manifest.** A plugin can include `"uninstall": true` inside an `updates` entry in its `update_url` JSON. The next time Zotero checks for plugin updates, that plugin will be uninstalled automatically. This is useful for end-of-life or hostile-takeover cleanups.

### 1.4 Preference Panes — Important Breaking Change

`Zotero.PreferencePanes.register({ pluginID, src, scripts, stylesheets })` still works, but in Zotero 8 **each preference pane's script now runs in its own global scope.** A top-level `var foo = …` is no longer reachable from sibling preference panes or, in some cases, from the pane's own XHTML. You must explicitly attach symbols to `window` (e.g. `window.MyPlugin = MyPlugin;`) if you need to reference them from `onload="MyPlugin.init()"`-style attributes in your XHTML. This was confirmed on the zotero-dev list by Zotero staff during 8.0 beta and tripped a number of long-standing plugins (including Zutilo).

`Zotero.Prefs.get()` / `Zotero.Prefs.set()` / `Zotero.Prefs.registerObserver()` / `Zotero.Prefs.clear()` and the `prefs.js`-in-plugin-root default-preferences convention from Zotero 7 are unchanged. Direct `<preference>`-tag-based two-way binding (Z6) remains unsupported; field-to-pref binding uses the Z7+ form `<html:input type="text" preference="extensions.zotero.myplugin.color"/>`.

### 1.5 New Official Plugin API: `Zotero.MenuManager`

Zotero 8 introduces `Zotero.MenuManager.registerMenu({ menuID, pluginID, target, menus: [...] })` and the corresponding `Zotero.MenuManager.unregisterMenu(id)`. Plugins are now expected to use this rather than monkey-patching popups via DOM injection. Menu items support `onShowing` and `onCommand` callbacks (which receive an `event` and a `context` object exposing `items`, `setVisible()`, etc.) and can contain nested `submenu` entries.

Available `target` values (verbatim from the docs):

- Menubar: `main/menubar/file`, `main/menubar/edit`, `main/menubar/view`, `main/menubar/go`, `main/menubar/tools`, `main/menubar/help`
- Library context menus: `main/library/item`, `main/library/collection`
- Toolbar/file submenus: `main/library/addAttachment`, `main/library/addNote`
- Tab context menu: `main/tab`
- Reader menubar: `reader/menubar/file`, `reader/menubar/edit`, `reader/menubar/view`, `reader/menubar/go`, `reader/menubar/window`
- Item pane: `itemPane/info/row`
- Notes pane buttons: `notesPane/addItemNote`, `notesPane/addStandaloneNote`
- Sidenav: `sidenav/locate`

Custom menus registered under a `pluginID` are automatically torn down when the plugin is disabled or uninstalled. Implementation is in `chrome/content/zotero/xpcom/pluginAPI/menuManager.js`.

The Zotero-7-era APIs are all still present and unchanged: `Zotero.ItemTreeManager.registerColumn`, `Zotero.ItemPaneManager.registerSection`, `Zotero.ItemPaneManager.registerInfoRow` (plus its `refreshInfoRow(rowID)` method added in 7.0.10-beta.3), and `Zotero.Reader.registerEventListener(type, handler, pluginID)` with the full set of reader event types (`renderTextSelectionPopup`, `renderSidebarAnnotationHeader`, `renderToolbar`, `createColorContextMenu`, `createViewContextMenu`, `createAnnotationContextMenu`, `createThumbnailContextMenu`, `createSelectorContextMenu`).

### 1.6 Data Model: The Big One for Direct-DB Consumers — Annotations Are Now Items

For anyone reading `zotero.sqlite` directly (as ZotLit does), the **single most important Zotero 8 data-model change** is:

> **Annotations from PDFs, EPUBs, and webpage snapshots are now first-class items in the items list under their parent attachments.** "Item Type" = "Annotation" is now a searchable value in Advanced Search; annotations can be tagged, related, and grouped just like other items.

This is largely a UI/JS-API surfacing of the existing `itemAnnotations` table (which has existed since Zotero 6 introduced the built-in PDF reader). However:

- Queries that previously returned "regular" items from `items`/`itemData` and treated annotations as opaque attachment-child rows must now decide whether annotations should appear in user-facing item lists.
- The `items` row for an annotation still has its standard `itemTypeID` (= the `annotation` row in `itemTypes`), and the annotation-specific metadata still lives in `itemAnnotations` (`parentItemID`, `type`, `text`, `comment`, `color`, `pageLabel`, `sortIndex`, `position`, `isExternal`, etc.). The change is one of UI visibility and search-indexing scope, not of underlying tables.
- Search results in Zotero 8 by default _hide_ annotations that don't match the search query string (`View → Hide Non-Matching Annotations`, added in 8.0.3). If you replicate Zotero's filtered views in Drizzle, you may need to mirror this.

Other Zotero 8 data-model / behavior changes worth knowing for a DB reader:

- **Continuous file renaming.** Attachment filenames are kept in sync with parent-item metadata changes (formerly only on initial add). The DB column changed is `itemAttachments.path` (and the `attachmentFilename` synced setting / item title for non-primary attachments). The Tools → Manage Attachments → "Normalize Attachment Titles…" command can be used to retroactively fix old titles.
- **Annotation tagging UI** uses the regular `itemTags` table — no new schema; just more items pointing at it.
- The citation-dialog rewrite is purely UI; it does not touch storage.
- Note tabs and the redesigned reader-appearance system store their state in `syncedSettings` and local prefs, not in new tables.
- The item-type and field universe is still populated from the **global JSON schema** (https://api.zotero.org/schema). Zotero 8 ships with the latest global schema at install time but updates it from the server at startup; new item types (e.g. preprint variations) and new fields (e.g. `archiveID`) appear as new rows in `itemTypes` and `fields`, with `itemTypesCombined` and `fieldsCombined` rebuilt at startup to merge customs. No built-in itemType or field was _removed_.

### 1.7 SQLite Schema (`zotero.sqlite`) — Authoritative Sources and Stability

Zotero deliberately does not publish a delta-by-delta schema changelog. The authoritative sources remain:

- `resource/schema/userdata.sql` in zotero/zotero (the canonical schema for new installs)
- `resource/schema/system.sql` (system/global-schema tables)
- `resource/schema/triggers.sql`
- `chrome/content/zotero/xpcom/schema.js::_migrateSchema()` (the JS migration that brings older databases forward to match userdata.sql; the comment block in userdata.sql explicitly notes: _"any changes made here must be mirrored in transition steps in schema.js::\_migrateSchema()"_)
- Per-release migration is driven by integer schema versions stored in the `version` table — there are _multiple_ schema strings, not one. `SELECT schema, version FROM version` typically returns rows for `'userdata'`, `'system'`, `'triggers'`, `'globalSchema'`, `'repository'`, `'lastclient'`, etc. The `'userdata'` row is the one that bumps for plugin-visible structural changes; this is **not** the same as `PRAGMA user_version` (which Zotero does not use as its primary schema marker).

From the source files visible on github.com/zotero/zotero (`main` branch at the time of this report), the **table inventory** that a Drizzle reader should expect is essentially the Zotero 6/7 list and is unchanged in Zotero 8:

| Category           | Tables                                                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference data     | `itemTypes`, `itemTypesCombined`, `fields`, `fieldsCombined`, `itemTypeFields`, `itemTypeFieldsCombined`, `itemTypeCreatorTypes`, `creatorTypes`, `customItemTypes`, `customFields`, `customItemTypeFields`, `customBaseFieldMappings`, `fileTypes`, `fileTypeMimeTypes`, `charsets`, `fieldFormats` |
| Items core         | `items`, `itemData`, `itemDataValues`, `itemCreators`, `creators`, `itemRelations`, `itemNotes`, `itemAttachments`, `itemAnnotations`, `itemTags`                                                                                                                                                    |
| Membership/library | `libraries`, `users`, `groups`, `groupItems`, `publicationsItems`, `feeds`, `feedItems`, `collections`, `collectionItems`, `savedSearches`, `savedSearchConditions`, `tags`, `relations`                                                                                                             |
| Trash              | `deletedItems`, `deletedCollections`, `deletedSearches`                                                                                                                                                                                                                                              |
| FTS / search       | `fulltextItems`, `fulltextWords`, `fulltextItemWords`, `indexedFulltextItems` (where present), `highlight`                                                                                                                                                                                           |
| Other              | `retractedItems`, `proxies`, `proxyHosts`, `storageDeleteLog`, `syncCache`, `syncedSettings`, `settings`, `version`                                                                                                                                                                                  |

For the columns ZotLit relies on most heavily:

- `itemData(itemID, fieldID, valueID)` and `itemDataValues(valueID, value)` — **unchanged in 7→8→9**. This is the core key–value join you use to read item fields. The `itemTypeFieldsCombined` view tells you which `fieldID`s are valid for a given `itemTypeID`.
- `itemTypes(itemTypeID, typeName, templateItemTypeID, display)` and `itemTypesCombined` — unchanged in shape. `itemTypeID` numbers can drift between installs and versions, so resolve `typeName` → `itemTypeID` dynamically.
- `fields(fieldID, fieldName, fieldFormatID)` and `fieldsCombined(fieldID, fieldName, label, fieldFormatID, custom)` — unchanged in shape. Same advice: resolve `fieldName` → `fieldID` at runtime.
- `itemAttachments(itemID, parentItemID, linkMode, contentType, charsetID, path, syncState, storageModTime, storageHash)` — unchanged in 7→8. (New `dateLastOpened` column added in 9; see §2.)
- `itemAnnotations(itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal)` — unchanged in 7→8.
- `deletedItems(itemID, dateDeleted)` — unchanged.
- `fulltextItems(itemID, indexedPages, totalPages, indexedChars, totalChars, version, synced)` — unchanged.

**The Zotero team has not published any guidance suggesting that the schema changed in an incompatible way for direct readers between Zotero 7 and Zotero 8.** No table from the Zotero 7 schema was renamed or dropped in 8. The `userdata` schema-version integer was bumped multiple times during the 7→8 cycle, but those bumps were additive — adding columns, indexes, or rows to the reference tables.

**Critical caveat the Zotero team repeats explicitly:** _"the SQLite database structure can change between Zotero releases"_ and _"access to the SQLite database should be done only in a read-only manner"_ (dev:client_coding:direct_sqlite_database_access). Dan Stillman has also said in the rapid-release announcement thread: _"providing more reasons for people not to upgrade is not the goal here… that will break as soon as we make data-model changes (new fields and other long-awaited features)."_ This is an explicit warning that the future rapid-release cycle **will** add new fields/columns; a direct-DB reader should be defensive about unknown columns and unknown `itemTypeID` / `fieldID` values, and should re-read `itemTypes`, `fields`, `itemTypeFields`, `fieldsCombined`, and `itemTypesCombined` on every connect rather than hardcoding IDs.

### 1.8 `Zotero.Items`, `Zotero.Item`, `Zotero.DB`, `Zotero.Notifier`

These public JS APIs are **stable across 7→8** in their primary surface: `Zotero.Items.get()`, `Zotero.Items.getAsync()`, `Zotero.Items.getAll()`, `Zotero.Item#getField()`, `Zotero.Item#setField()`, `Zotero.Item#saveTx()`, `Zotero.Item#getAttachments()`, `Zotero.Item#getAnnotations()` (still operates on the attachment item, not the parent regular item), `Zotero.DB.queryAsync()`, `Zotero.DB.executeTransaction()`, `Zotero.DB.valueQueryAsync()`, `Zotero.DB.columnQueryAsync()`, and `Zotero.Notifier.registerObserver({ notify: (event, type, ids, extraData) => … }, ['item','collection','tag', …], 'my-plugin')` are all unchanged.

The implicit changes are:

- Many of these methods now return native `Promise`s rather than Bluebird promises. Code that relied on Bluebird-specific methods (`.map`, `.filter`, `.each`, `.cancel`, `.isPending`) on the returned values must be rewritten.
- Methods that returned generators / coroutines via `Zotero.spawn` need to be `async function`s.
- `Zotero.Notifier` observer callbacks must be `async`-compatible (they always could be; just don't return Bluebird-only constructs).

### 1.9 Note Editor, PDF Reader, Annotations

- The note editor is unchanged from a plugin-API standpoint; new in 8.0 are word count, faster search on large notes, and preserved cursor position across multiple editors of the same note.
- The reader gained the **Reader Appearance** panel with built-in themes (Dark, Snow, Sepia) plus user-defined themes (replacing the old "Use Dark Mode for Content" preference); the 8.0.1 Black theme and the "Invert Images" option for custom dark themes followed shortly after.
- EPUB and webpage-snapshot image copy/save support was added.
- The full set of `Zotero.Reader.registerEventListener` event types from Zotero 7 still works.
- Annotation storage on disk and in the database is unchanged; the change is exclusively in surfacing them in the items list.

### 1.10 Build Tooling, Translators, Connector, Sync, Storage

- **Scaffold** (Zotero's translator-development tool, distributed with the desktop app) was substantially upgraded in 8.0: better test UI (PR #5301), item-pane-style preview of translated items, Codestral-powered code completion (set hidden pref `scaffold.completions.mistralAPIKey`), shorthand URL entry, and a now-interactive Defer checkbox. Repeated reload prompts were fixed in 8.0.3.
- **Translators** themselves did not get a breaking API change in 7→8. The translator framework, `Zotero.Translate.*`, and the translator JSON header format are unchanged.
- The **Zotero Connector** protocol is unchanged; existing connectors keep working.
- **WebDAV** authentication handling had several rounds of fixes in 8.0.2 and 8.0.4 (the change to Firefox 140's networking stack caused regressions with some servers that don't send a `WWW-Authenticate` header on the initial PUT). End-user-visible only; no plugin-API change.
- **Zotero File Storage (ZFS)** sync is unchanged.
- **Local HTTP API** (the `127.0.0.1:23119` server that plugins and the Connector use): now returns annotations, has new `/fulltext` endpoints, and returns full data when `since=0` (resolving issue #5011). This materially closes the gap for plugins that previously needed to walk the SQLite DB to fetch annotation or fulltext data and that want to write back.
- The community-maintained **zotero-plugin-template**, **zotero-plugin-toolkit**, **zotero-plugin-scaffold**, and **`@zotero/types`** packages (windingwind et al.) are all maintained for 8/9 and work fine; the toolchain itself is unaffected by the Zotero 8 internals change.

### 1.11 Minimum OS Requirements (Zotero 8)

- macOS 10.14 and earlier — **dropped**. macOS 10.15+ required.
- Windows 7 and 8 — **dropped**. Windows 10+ required.
- Linux requires a Firefox 140–compatible distribution.
- **New: ARM64 Linux build**, including Apple-Silicon-Linux VMs, Asahi Linux, ARM Chromebooks, Raspberry Pi.

---

## 2. Zotero 8 → Zotero 9: Plugin-Relevant Changes

Zotero 9 is the first product of the new rapid release cycle. It shipped 12 weeks after Zotero 8 and contains **no Firefox/Gecko version bump** (it remains on Firefox 140 ESR — 140.10.0esr in 9.0.2), **no JS-runtime overhaul**, **no ESM migration**, and **no preference-pane scope change**. The _Zotero 8 for Developers_ page remains current for Zotero 9; there is no Zotero 9 for Developers page as of mid-May 2026.

To enumerate the same categories used above:

### 2.1 Plugin API / bootstrap / lifecycle

Unchanged. Bootstrap hooks, lifecycle constants, `manifest.json` schema, `updates.json` schema, runtime chrome registration via `aomStartup.registerChrome`, and the `"uninstall": true` flag introduced in 8 all carry forward identically.

### 2.2 Platform (Gecko / ESR / XUL→HTML / Fluent)

Unchanged. Still Firefox 140 ESR, no further XUL→HTML migration step required of plugin authors, Fluent localization unchanged. 9.0.2 contains a fix for "incorrect localization due to plugin conflicts" — implying that the existing namespace-conflict problem in Fluent IDs (plugin A's `data-l10n-id` colliding with plugin B's) is still a thing in 9.0; the 9.0.2 fix is on the Zotero side to mitigate it, not a new API.

### 2.3 JS runtime / `Components.utils` / `ChromeUtils` / ESM

Unchanged from 8.

### 2.4 Database Schema — The One Concrete Change

The one DB schema change in Zotero 9 that direct-SQLite readers should know about is the new **"Recently Read"** infrastructure, which uses a new column on `itemAttachments`:

- A new column, **`itemAttachments.dateLastOpened`**, was added (Pull Request zotero/zotero #2854, "Track Date Last Opened, add virtual collection + search condition", merged into main).
- A migration was added in `schema.js::_migrateSchema()` that adds the column and an index. **The migration is forward-only but does not mark the database as incompatible with older Zotero versions** (per the PR discussion). In other words, a Zotero-9 DB can still be opened by Zotero 8 — Zotero 8 simply ignores the new column.
- The new column is indexed and used by the "Recently Read" virtual collection and by the "Attachment Last Read" Advanced Search condition.
- **Group libraries** present a wrinkle: per the PR's design discussion, group-library last-read times are _also_ stored in `syncedSettings` under per-item `lastRead_<itemKey>` setting names (so they can sync between users), and the `itemAttachments.dateLastOpened` column gets populated from those for indexing. A direct reader interested in last-read for groups should read both sources.

For a Drizzle ORM reader: **add `dateLastOpened` (nullable, ISO-8601 string) as an optional column on the `itemAttachments` table model**. Treat its absence as "never opened" (NULL).

### 2.5 Zotero.Items / Zotero.Item / Zotero.DB / Zotero.Notifier

Unchanged surface. `Zotero.Notifier` gained no new event types in 9.0 that are documented for plugin consumption.

### 2.6 Data Model

- "Added By" / "Modified By" for group libraries — a UI surfacing of existing schema. The columns `groupItems.createdByUserID` and `groupItems.lastModifiedByUserID` (foreign keys to `users.userID`) have existed for years; Zotero 9 simply exposes them as columns in the items list and as item-pane metadata rows in group libraries. **No schema change.** If you read group libraries, you already have these.
- "Citation Key" column in the items list — surfaces the citation key stored under the `citationKey` field on the item (for Better BibTeX users) or computed by Zotero. No schema change.
- "Recently Read" — see §2.4.

### 2.7 Preferences / Settings API

Unchanged. 9.0.1 fixed a bug where "plugin default preferences" were not getting updated after a plugin update — an internal fix, no API change.

### 2.8 Note Editor / PDF Reader / Annotations

- **Read Aloud** is a reader-internal feature backed by the new **Zotero Voices** server-side TTS (Standard tier rendered on Zotero servers; Premium tier via external TTS providers). There is no documented plugin hook to extend Read Aloud as of 9.0.3. Plugins that synthesize or annotate around text selections continue to use the existing reader event listeners. The `H`/`U` shortcuts annotate the last spoken sentence and could potentially conflict with plugin-defined keyboard shortcuts — test your plugin against this.
- Improved theme handling for scanned PDFs; support for fixed-layout EPUBs; printed PDFs no longer get dark-mode styling. No plugin-API change.
- **Insert annotations directly into word processor documents** — handled internally by the word-processor integration plugins (Word/LibreOffice/Google Docs) plus the citation dialog; no third-party plugin API exposed.

### 2.9 Build Tooling, Translators, Connector, Sync, Storage

- Translators: unchanged.
- Connector: unchanged protocol.
- Sync: improved external-attachment-change detection during sync; avoid repeated checks for remotely missing files. No plugin-visible API change.
- Storage: on macOS, **APFS cloning** is now used for file copies (including automatic database backups), potentially saving hundreds of MB or GB of local disk. If your plugin makes file copies of `zotero.sqlite` or attachment files on macOS, you can take advantage of `clonefile()` (via `IOUtils`) for the same savings.
- WebDAV: no further breakage in 9.x.
- ZFS: unchanged.
- **Web-based login** — the in-app credentials flow has been replaced by a browser-based OAuth-style login. Two-factor authentication is in opt-in beta (`forums.zotero.org/discussion/comment/510383`). Plugins that scrape or impersonate the login UI must be rewritten to honor the new OAuth tokens stored by Zotero. Dan Stillman: _"Zotero 9 has important security fixes, and with the addition of MFA support, earlier versions will be blocked from even logging in in the near future. No one should stay on an old version of Zotero."_

### 2.10 Minimum OS Requirements

Unchanged from Zotero 8.

### 2.11 New plugin APIs / hooks

None publicly documented for 9.0. The forward-looking "sandboxed plugin API tier" referenced in the rapid-release announcement thread is still on the roadmap.

### 2.12 Patch-level fixes specifically relevant to plugins (9.0.x)

- 9.0.1: Fixed context menu sometimes not working after plugin removal.
- 9.0.1: Fixed plugin default preferences not getting updated after a plugin update.
- 9.0.2: Fixed possible incorrect localization due to plugin conflicts.
- 9.0.2: Mozilla platform updated to 140.10.0esr.

---

## 3. Consolidated Migration Guide for a Plugin That Worked on Zotero 7

If your plugin is currently shipping for Zotero 7 and you want it to work cleanly on both Zotero 8 and Zotero 9:

### 3.1 Things that will most likely break (mostly Z7 → Z8)

1. **`.jsm` files and `ChromeUtils.import()` / `Components.utils.import()` of JSMs.** Convert to `.mjs` ESMs, switch to `import` statements, and assign every import to a variable. Run `migrate-fx140/migrate.py esmify` over your tree. (Hard requirement for 8+.)
2. **Bluebird-specific promise usage** — anywhere your code does `.map(asyncFn)`, `.each()`, `.filter()`, `.cancel()`, `.isPending()`, `.isResolved()`, or `Zotero.spawn(generator)`. Run `migrate-fx140/migrate.py asyncify`. (Hard requirement.)
3. **`Services.jsm` manual imports** — remove them; `Services` is a global in ESM scope.
4. **`nsIScriptableUnicodeConverter`, `nsIOSFileConstantsService`, `nsIDOMChromeWindow`** — gone. Replace with Web APIs (`TextEncoder`/`TextDecoder`, `IOUtils`/`PathUtils`) or Zotero's wrappers.
5. **`XPCOMUtils.defineLazyGetter`** — switch to `ChromeUtils.defineLazyGetter`. `defineLazyModuleGetters` / `defineLazyServiceGetters` → `ChromeUtils.defineESModuleGetters` (passing `.sys.mjs` URLs).
6. **`Services.appShell.hiddenDOMWindow`** — works only on macOS now.
7. **Preference-pane `var` leakage into sibling panes or XHTML `on*=""` attributes** — explicitly attach to `window`. (Most likely cause of "my preference pane init function isn't found" errors in 8/9.)
8. **`addLogin` → `addLoginAsync`** in the Login Manager.
9. **`DataTransfer.types.contains()` → `.includes()`** in any drag-and-drop code.
10. **Button labels set via `setAttribute("label", …)`** — switch to assigning the `.label` property.
11. **`zotero:` URL parsers** that assume the first path segment is part of the path (it is now the host).
12. **`AsyncChannel` generators** in any custom `ZoteroProtocolHandler` extension — convert to `async function`.
13. **`.dtd` localization** — if anything in your plugin still depends on DTD entity substitution, it is broken on 8/9. Migrate to Fluent.

### 3.2 Z8 → Z9 break list

In the vast majority of cases, nothing breaks. The only practical actions are:

- Bump `strict_max_version` in `manifest.json` to `"9.*"` (or, prudently, `"9.0.*"` and revisit at the next release).
- If you read `zotero.sqlite` directly, add `dateLastOpened` to your `itemAttachments` Drizzle model.
- If your plugin uses keyboard shortcuts on `H`, `U`, `R`, or `L` inside the reader, verify they don't collide with the new Read Aloud shortcuts.
- If your plugin scrapes or impersonates Zotero account login, rewrite it for the new web-based OAuth flow.

### 3.3 New capabilities worth adopting

- `Zotero.MenuManager` (Zotero 8+) — replaces every monkey-patched `popupshowing` listener.
- `Zotero.ItemPaneManager.registerSection` / `registerInfoRow` (since 7; still recommended) and `refreshInfoRow(rowID)` (since 7.0.10-beta.3) for dynamic info-row values.
- `Zotero.ItemTreeManager.registerColumn` for adding columns to the items list — Zotero 9's "Citation Key" column is a good reference example.
- `Zotero.Reader.registerEventListener` for everything inside the reader (text-selection popups, sidebar UI, color picker, view/annotation/thumbnail/selector context menus).
- The local HTTP API's new annotation and `/fulltext` endpoints for plugins that previously had to walk the SQLite DB to extract these.
- The new `uninstall: true` field in `updates.json` for orderly plugin EOL.
- APFS cloning via `IOUtils.copy(..., { recursive: true })` on macOS, if you copy large files.
- The forthcoming **sandboxed plugin API tier** that Dan Stillman has signaled: if you only use stable APIs and never reach into XPCOM, you'll likely be able to drop `strict_max_version` entirely in a future Zotero version.

### 3.4 Manifest example, end-to-end compatible

```json
{
  "manifest_version": 2,
  "name": "My Plugin",
  "version": "x.y.z",
  "applications": {
    "zotero": {
      "id": "my-plugin@example.com",
      "update_url": "https://example.com/my-plugin/updates.json",
      "strict_min_version": "7.0",
      "strict_max_version": "9.*"
    }
  }
}
```

Note: Zotero 9 (and the rapid-release cycle in general) means `strict_max_version` will need to be bumped roughly every 6–10 weeks for plugins that use full-privilege APIs. Beta builds ignore `strict_max_version`, so testing on the beta channel is the recommended way to keep ahead of the cycle.

---

## 4. SQLite Schema Across 7 → 8 → 9: Specific Guidance for ZotLit / Drizzle

### 4.1 What changed (concrete, confirmed)

| Transition | Schema change                                                                                                                                      | Mechanism                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7 → 8      | No table renames, no table drops, no column drops.                                                                                                 | Additive `userdata` schema-version bumps for new built-in itemTypes/fields delivered via the global JSON schema, indexes, and small reference-data adjustments. The annotation-as-item change is a UI/JS-API change, not a schema change. |
| 8 → 9      | One additive change: **`itemAttachments.dateLastOpened`** column + index. Group last-read also stored in `syncedSettings` as `lastRead_<itemKey>`. | `_migrateSchema()` migration in PR #2854. Does **not** mark the DB incompatible with older Zotero versions.                                                                                                                               |

No table was renamed or dropped in 7 → 8 → 9. No primary-key restructure was performed in 7 → 8 → 9.

### 4.2 Recommended Drizzle posture

1. Generate the Drizzle schema from a live, freshly migrated **Zotero 9.0.3+** database (or from `userdata.sql` on the `main` branch of zotero/zotero).
2. Treat **all columns as nullable on read** unless `userdata.sql` declares `NOT NULL`.
3. Look up `itemTypes`, `fields`, `itemTypeFields`, `itemTypesCombined`, `fieldsCombined`, and `creatorTypes` **dynamically on connect** rather than hardcoding their integer IDs — these are populated from the global JSON schema (https://api.zotero.org/schema), can change with new Zotero versions when new built-in item types or fields are added, and _will_ drift again as the rapid-release cycle continues (Dan Stillman's explicit warning about "new fields and other long-awaited features" coming with rapid release).
4. Re-read the `version` table on connect; if `SELECT version FROM version WHERE schema='userdata'` is newer than what your model expects, log a warning rather than failing.
5. Specifically for ZotLit's annotation-export use case: the underlying tables for annotations (`itemAnnotations` + the parent `items`/`itemAttachments` rows) have **not** changed between 7 and 9. Your existing queries should still work; the only semantic shift is that Zotero 8+ users will expect annotations to be addressable as full items (e.g. by key in `items.key`).
6. For Zotero 9 specifically, if you want to expose "Recently Read" sorting/filtering in ZotLit, read `itemAttachments.dateLastOpened` (nullable) and union with `syncedSettings` rows whose `setting` starts with `lastRead_` for group libraries.

### 4.3 Zotero's official position on direct DB access (unchanged across 7→8→9)

From `dev:client_coding:direct_sqlite_database_access` (last modified 2022-08-14, still authoritative under Zotero 9):

> "While it is generally preferable to access Zotero library data via either the Web API or JavaScript API, it is also possible to directly access the SQLite database of the Zotero client using an SQLite client, library, or third-party tool. … However, **access to the SQLite database should be done only in a read-only manner.** Modifying the database while Zotero is running can easily result in a corrupted database. A caching layer breaks the normal file-locking in SQLite that allows for safe concurrent file access, and even if Zotero is shut down before accessing the file, modifying the database directly bypasses the data validation and referential integrity checks performed by Zotero. Generally, the SQLite database should be viewed as an internal database that has the benefit of being externally readable for people who want to get the data out in other ways. **Also be aware that the SQLite database structure can change between Zotero releases.**"

Two implications for ZotLit:

- Read-only Drizzle usage (which is what ZotLit does) is officially sanctioned and unlikely to break in non-additive ways within the 7/8/9 line, but Zotero offers **no stability guarantee** and explicitly warns the rapid-release cycle will introduce new fields/columns.
- For any feature that conceptually wants to _write back_ to Zotero (tags, related items, annotation comments, etc.), the recommended path is the local HTTP API on `127.0.0.1:23119`. In Zotero 8 this API gained annotation read/write and `/fulltext` endpoints, which materially closes the gap.

### 4.4 Where to track future schema changes

- zotero/zotero `main` branch: `resource/schema/userdata.sql`, `system.sql`, `triggers.sql`, and `globalSchema.json`.
- Commits to `chrome/content/zotero/xpcom/schema.js` — search for `_migrateUserDataSchema` / `_migrateSchema` and grep for numeric step labels (e.g. `if (fromVersion < N) { ... }`). Each step is one schema-version bump.
- The zotero-dev Google Group, where Zotero staff announce upcoming platform/data-model changes before stable releases (this is the primary channel: Dan Stillman in the forum thread _"Zotero 9 is amazing, but the plugin documentation is becoming a 'scavenger hunt'"_ explicitly directs developers there).
- The third-party but well-maintained reference at `https://windingwind.github.io/doc-for-zotero-plugin-dev/`, plus `zotero-plugin.dev`, plus the `zotero-plugin-template` and `zotero-plugin-toolkit` repos.

---

## 5. Forward-Looking Statements

These are statements about the future from the Zotero team and have **not yet shipped** — treat them as roadmap, not as committed features:

- A **sandboxed plugin API tier** that will be "(mostly) guaranteed to remain stable between major versions" and may eventually let well-behaved plugins drop `strict_max_version` entirely. No timeline or API surface has been published.
- An **official plugin registry / directory** ("An official plugin directory is planned" on the support page) — currently plugins are discovered via forum threads and the community-maintained "Zotero Chinese List" / "Official Plugin List" on zotero-plugin.dev.
- More data-model additions (new fields, multilingual referencing-style fields like translated titles) are explicitly anticipated under rapid release.
- A reorganized developer documentation site (Dan Stillman, April 16, 2026: _"But we'll be improving this soon."_).
- Read Aloud on iOS and Android.
- Full MFA enforcement (Zotero 9.0 already supports it in opt-in beta; once it's mandatory, older Zotero versions will be blocked from server login — a hard floor on how long plugins can keep supporting Zotero ≤ 8).

None of these have published API signatures, table changes, or release dates as of May 17, 2026, so a plugin author should not architect against them today.

---

## Summary One-Liner

**Zotero 8 (Jan 2026) is the real plugin-breaking transition** — it bundled two Firefox-ESR jumps (115 → 128 → 140), full ESM-ification, removal of Bluebird, removal of several XPCOM interfaces, a preference-pane scope change, and dropped support for macOS 10.14 / Windows 7-8 — but Zotero provides automated migration scripts (`migrate-fx140`) and the bootstrap/manifest/lifecycle model is otherwise unchanged from Zotero 7. **Zotero 9 (Apr 2026) is a thin release on top of Zotero 8** — same platform, same JS runtime, same plugin APIs, with one additive schema change (`itemAttachments.dateLastOpened` for the new Recently Read collection) and feature additions (Read Aloud, web-based login, group-library "Added By"/"Modified By"). For a direct-SQLite reader like ZotLit, no Zotero-7 table was renamed or dropped through Zotero 9; the only concrete schema migration to track is the new `dateLastOpened` column, plus the open-ended promise that rapid release will keep adding new fields and item types, which makes dynamic resolution of `itemTypes` / `fields` from the database on every connect mandatory rather than optional.
