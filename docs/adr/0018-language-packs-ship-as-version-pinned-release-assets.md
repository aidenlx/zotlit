# Language Packs ship as version-pinned release assets

> **Status: superseded by ADR-0019**
> ([Runtime assets ship on a parallel Resource Release](./0019-runtime-assets-ship-on-a-parallel-resource-release.md)),
> which keeps the version pinning below but moves the assets off the plugin
> release onto a parallel Resource Release. Kept for the record.

Each plugin release tag carries its own Language Pack assets, uploaded from the
release commit inside the same tag-gated steps as the plugin binaries. ZotLit's
release policy composes the Pack Source base URL from the plugin version it
already receives, so an installed build downloads the pack compiled from its own
message set. This replaces a rolling `language-packs` release that served one
copy of every Language Pack to every installed plugin, where a push to `next`
handed an older installed build a newer message set — missing, renamed, or wrong
strings. That release and its tag are deleted.

This supersedes the versioning half of ADR 0012 — the rolling release and the
absence of a version pointer — and reaffirms its other half: packs stay remote,
consent-gated, eval-free data, applied after restart.

## Considered Options

- **Keep the rolling release, add a version field to each pack** — the plugin
  can then detect a mismatch, but there is still only one pack per locale, so
  the older build has nothing correct to download.
- **Bundle every locale in `main.js`** — removes the download entirely and the
  mismatch with it, at a bundle size that grows for every user with each added
  locale. Rejected for the same reason as in ADR 0012.
- **A separate versioned pack release per plugin release** — the same asset
  immutability without adding a second tag per release to create, verify, and
  attest.

## Consequences

- Pack content and plugin message keys cannot diverge: both come from one
  commit and land in one release.
- A published version's assets are never rewritten — the workflow uploads each
  pack once, inside the gate — so a translation fix reaches users with the next
  plugin release. There is no hotfix channel in between.
- Pushes to `next` publish no translation assets outside a release.
- The reusable `@zotlit/obsidian-i18n` contract is unchanged: the Pack Source
  stays consumer-supplied, and the Locale Catalog still maps a locale to a flat
  file name. The version lives only in the base URL.
- Language Pack assets receive provenance attestation and a post-upload
  byte-compare from their public versioned URL.
- A source build at an untagged version cannot download a pack; the plugin
  surfaces the failure notice. The dev server override covers development.
- Installed builds that cached a pack from the rolling release keep it — the
  cache is version-scoped — until they upgrade. A fresh install of one of those
  older betas still offers the pack its catalog lists, the download 404s against
  a tag that carries no pack asset, and the plugin surfaces the failure notice.
