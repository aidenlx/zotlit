# UI Labels

- Render every ZotLit-owned UI Label through a component prop that takes a typed Paraglide `m.*()` call from the shared catalog: `<Command name={…} />` for command names, `<UiLabel name={…} />` for setting, option, menu, button, tooltip names and quoted notices, and `<SettingsPath page={…} setting={…} />` for a Settings Path.
- MDX prose reaches a Message only through such a prop. The components own the emphasis and the `Settings > ZotLit` prefix; keep other framing such as the `ZotLit:` command prefix, colons, and surrounding sentence at the call site.
- ZotLit Companion labels (its Zotero preferences pane, menu entries, and Database Status panel) live under the `zotero` namespace and are reached through the bracket accessor: `<UiLabel name={m["zotero.menu_item_open.label"]()} />`. A plural label takes its count, e.g. `m["zotero.menu_item_update.label"]({ count: 2 })`.
- Keep labels owned by Obsidian, Zotero, and other products as literal prose.
- Account for every handwritten ZotLit UI Label in changed prose before completion.
