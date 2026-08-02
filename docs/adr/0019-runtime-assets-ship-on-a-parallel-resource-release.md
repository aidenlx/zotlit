# Runtime assets ship on a parallel Resource Release

The Obsidian community-plugin scanner accepts exactly `main.js`,
`manifest.json`, and `styles.css` on the release it reads, and reports every
other file as an additional file. ZotLit's plugin release also carried the
Language Packs and the template data JSON Schemas, so it failed that check. The
assets now ship on a **Resource Release** — a second release per plugin version,
tagged `res-<version>`, built from the same commit — and the plugin release
carries only the three accepted files.

Version pinning is the reason the assets cannot simply move to one rolling
release: an installed build composes its download URL from its own
`manifest.version`, so it reaches the packs compiled from its own message set
and the schemas its own contract emitted. A single rolling release would hand an
older installed build a newer message set — missing, renamed, or wrong strings —
and the same drift for the contract. This supersedes ADR 0018 in full, including
0018's own supersession of the versioning half of ADR 0012.

The two release tags carry different guarantees, and the ordering is what makes
that safe. The workflow creates and verifies the Resource Release **before** it
creates the plugin release, and the plugin tag remains the single idempotency
gate. While the plugin tag is absent, no installed build can name that version,
so a retry after a partial run may re-upload assets over it (`gh release upload
--clobber`). Once the plugin release exists, nothing rewrites its resources.

## Considered Options

- **One rolling resource release** — a single permanent tag, like the Zotero
  `zotero-release` host. Costs one tag instead of one per version, and
  reintroduces exactly the drift ADR 0018 was written to delete.
- **Separate releases per asset kind** — isolates a pack-upload failure from a
  schema-upload failure, at two extra tags per version to create, verify, and
  attest, for a failure mode that has not occurred.
- **Bundle everything in `main.js`** — removes the download and the second tag
  together, at a bundle size that grows with every locale for every user.
  Rejected in ADR 0012 and again in 0018 for the same reason.
- **Host the assets off GitHub** (docs site, CDN) — decouples them from the
  release entirely, and gives up build provenance, the byte-compare against the
  public URL, and the release commit as the single source of both artifacts.

## Consequences

- Every plugin version produces two releases on both channels, `<version>` and
  `res-<version>`. The Resource Release mirrors the plugin's prerelease flag and
  is never GitHub's "Latest", which stays reserved for the stable plugin release.
- Pack content, schema content, and plugin message keys still cannot diverge:
  all three come from one commit, and the pair of releases is created in one job.
- A verify failure now happens before the plugin release exists, so it needs no
  cleanup decision — the whole run is retried. Under ADR 0018 the release was
  already published at that point.
- A run that fails after the Resource Release is created, and whose fix needs a
  version bump, leaves an orphan `res-<version>` in the release list. Delete it
  by hand.
- Already-published releases are untouched. Their installed builds keep
  resolving assets from their own version tags, which still carry them.
- The reusable `@zotlit/obsidian-i18n` contract is unchanged: the Pack Source
  stays consumer-supplied, and the Locale Catalog still maps a locale to a flat
  file name. The release tag lives only in the base URL ZotLit supplies.
- A source build at an untagged version cannot download a pack or a schema. The
  plugin surfaces the pack failure as a notice; the dev-server override covers
  Language Packs in development, and schemas have no such override.
