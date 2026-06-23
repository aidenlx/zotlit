# ZotLit v2 Template System

ZotLit v2 replaces the v1 template engine, data model, and frontmatter system. This guide covers everything needed to write and migrate templates.

## What changed

- **Data root**: The template variable changed from `it` to `zt`. All field access is now `zt.title`, `zt.creators`, etc.
- **Field naming**: Zotero canonical names with two CSL-inspired renames (`abstractNote` -> `abstract`, `publicationTitle` -> `containerTitle`). All fields are flat on `zt.*`.
- **Creator shape**: A flat `creators` array with `{family, given, literal, role, fullName}` replaces v1's role-keyed Proxy wrappers. Creators coerce to `fullName` in string contexts.
- **Frontmatter**: JS expression evaluation replaces the v1 `zt-field` template. Users configure fields with a key, expression, and merge strategy instead of editing a template.
- **Annotation updates**: A managed-region overwrite (`%%zt-managed%%`) replaces v1's block-ID-based incremental diffing.
- **Removed templates**: `zt-field` and `zt-colored` are gone. `zt-annots` is renamed to `zt-content`.
- **Removed helpers**: Template data is plain objects with simple properties.

## Documentation

- [Template Syntax](syntax.md) -- Eta syntax, `zt.*` prefix, `include()`, `bq()` and `suffix()` helpers, autoTrim, managed region
- [Data Reference](data-reference.md) -- Complete property reference for every template type
- [Frontmatter](frontmatter.md) -- JS expression system, system fields, user fields, merge behavior
- [Default Templates](defaults.md) -- Side-by-side v1 vs v2 defaults with explanations
- [Migration Guide](migration.md) -- Step-by-step guide for migrating custom v1 templates
