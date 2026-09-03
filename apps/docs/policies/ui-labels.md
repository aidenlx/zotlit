# UI Labels

- Render every ZotLit-owned UI Label through a component prop that takes a typed Paraglide `m.*()` call from the shared catalog: `<Command name={…} />` for command names, `<UiLabel name={…} />` for setting, option, menu, button, tooltip names and quoted notices, and `<SettingsPath page={…} setting={…} />` for a Settings Path.
- MDX prose reaches a Message only through such a prop. The components own the emphasis and the `Settings > ZotLit` prefix; keep other framing such as the `ZotLit:` command prefix, colons, and surrounding sentence at the call site.
- Keep labels owned by Obsidian, Zotero, and other products as literal prose.
- Account for every handwritten ZotLit UI Label in changed prose before completion.
