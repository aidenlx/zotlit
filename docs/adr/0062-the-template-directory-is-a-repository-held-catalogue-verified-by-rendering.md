# The Template Directory is a repository-held catalogue verified by rendering

ZotLit's readers are academics who mostly do not write code, and the templates they find today in forum threads often need a CSS snippet or another plugin, or print `Vol. null` when a field is empty. The Template Directory ([ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md), [ADR 0051](0051-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md)) gives them ready-made Profiles and recipes they can trust on first import. Decided in the Template Directory spec (#1276): the Directory is a folder of files in the repository, at `docs/template-directory/`, one folder per Directory Entry. Each folder holds the entry's facets and reader-facing description (`entry.md`) and the exact artifact a reader imports or copies. The docs site reads that folder at build time and renders it; entries change through pull requests, like code.

Every entry is verified by rendering, in CI. The loader, entry schema, and verification suite live in `apps/docs` (`src/lib/template-directory/`), which already depends on the Workbench render module and already reads a repository-root folder (the agent skills) at build time. The suite runs under `pnpm test`: it renders every Profile entry, and every partial and property entry through a harness Profile, over every Sample Item, Sample Annotation, and item data derived for the types without a Sample Item. Any diagnostic fails it. It stores each entry's rendered output as a reviewed snapshot beside the entry, so a plugin change that alters an entry's output shows in review.

Entries are portable by construction, because an imported Profile must work in a vault its author has never seen:

- No `folder`, `importFolder`, or `citationStyle` binding and no Imported Note binding, so notes land in the reader's own folders and style.
- A Profile Match only on built-in item types, never on tags, collections, or Library, whose names differ between vaults.
- A fixed, unique Profile ID per Profile entry, so a newer edition imports as the same Profile.
- Every partial a Profile calls is packed in its manifest, byte-identical to the partial entry of that name. The Directory is one partial namespace: two Profiles that pack the same partial pack the same source, so importing the second never changes how the first renders. A drift check fails the suite until the re-pack command copies an edited partial into every Profile that calls it.
- Template sources are Liquid only, and every property is a JSON-e rule, so an entry runs without the JavaScript Templates gate.

## Considered options

- **Entries as MDX pages under `apps/docs/content/`** (rejected): the importable artifact would be embedded in page prose, and the verification suite, the re-pack command, and later agent tooling would have to extract it again.
- **Packing with the plugin's pack export** (rejected): it writes each partial as one JSON line, which makes a changed partial unreadable in review. The re-pack command rewrites only the manifest's `partials` key as YAML block text and leaves every other byte as written.
- **Hand-written expected output for each entry** (rejected): it multiplies with every Sample Item and falls out of date with every contract change. Stored snapshots stay true by construction; the independent review compares them with each description.

## Consequences

- Entry descriptions are a fourth source of user-facing copy, beside docs MDX, i18n messages, and the Workbench guide. The root `AGENTS.md` names them.
- The first entry of a new kind (citation text, note name, citation-context partial) must add its verification before it ships; until then the suite reports it as `unverified`.
- That a Profile ID never changes between editions is a review rule: the suite checks form and uniqueness only.
