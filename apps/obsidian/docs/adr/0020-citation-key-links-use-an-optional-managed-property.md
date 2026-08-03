# Citation Key Links use an optional Managed Frontmatter property and start disabled

The always-on Citation Key Links feature required ZotLit to own the `citekey` frontmatter field, but the feature works by patching internal Obsidian editor methods. New installations now start with Citation Key Links disabled, while settings migrations keep the feature enabled to preserve existing behavior. `citekey` becomes the default ordinary Managed Frontmatter field, sourced from `zt.citationKey` with Liquid and the Replace strategy; Citation Key Links use a separately configurable Citation Key Property, and `zotero-key` remains the authoritative Literature Note identity.

## Consequences

- Settings version 3 adds the default `citekey` field to existing configured field lists, enables Citation Key Links for every earlier settings version, and selects `citekey` as the Citation Key Property. New and reset settings keep the same property and default field with Citation Key Links disabled.
- The settings UI exposes a Citation Key Links toggle and a non-empty Citation Key Property. Its description links to the user documentation for the editor integration and its Live Preview and Source mode limits.
- When the feature is enabled and the selected property is absent from Managed Frontmatter, ZotLit reports one notice as the settings enter that state. Existing unmanaged values remain usable.
- Only Literature Notes with a valid `zotero-key` contribute Citation Key Property values. A property change rebuilds that index; disabling the feature removes its editor patch and citation-key index.
- Exactly one direct property match supports native hover and click behavior. A cache miss resolves the Zotero Item and checks `zotero-key` before note creation, and an ambiguous property value also resolves through `zotero-key` on click.
- Template `notePath` and `noteLink` helpers resolve through `zotero-key`. Templates can render `zt.citationKey` when they need a textual citation-key fallback.
