# Proposal: Template sharing and the ZotLit Template Directory

- Status: proposed
- Date: 2026-08-23
- Related: [ADR 0004](../adr/0004-liquid-default-eta-behind-javascript-templates-gate.md) (Liquid default, JavaScript Templates gate), [ADR 0015](../adr/0015-template-contract-artifacts-generate-from-ts-types.md) (contract artifacts), [ADR 0019](../adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md) (Resource Release pattern)

## Summary

Give ZotLit users one place to publish, browse, and install templates. The design is the proven "data-in-git" registry shape: a dedicated GitHub repository holds the template content, CI validates every submission and compiles one `index.json`, a CDN serves both the index and the template bodies at $0, and the docs site renders a searchable directory page as a thin static consumer of that index. The plugin gains install support in phases, starting at zero plugin changes.

Everything below the site layer is framework-independent, so the directory survives a docs-site migration from Vercel + Next.js to Cloudflare + TanStack Start or Astro untouched.

## Goals and constraints

1. **Distribute** — a user installs a shared template into the vault template folder in one action, with a safe default.
2. **Share** — an author publishes a template with low friction (no git knowledge required for the easy path).
3. **Directory** — a browsable, searchable community catalog exists on the web and, later, in the app.
4. **KISS, $0 hosting, low maintenance** — no servers, no databases, no per-submission human review pipeline. A small team must be able to run this for years.
5. **Security posture of ADR 0004 holds** — Liquid is the shareable default; anything that executes JavaScript stays behind the per-device gate and is labeled as such in the directory.

## What we already have

Facts from the current codebase that shape the design:

- A template is a plain vault file `zotlit-<name>.<language>.md` (`<language>` is `liquid` or `eta`); the six canonical names (`filename`, `note`, `annotation`, `content`, `cite`, `cite2`) bind to slots, and any other name is an includable partial. Installing a template is therefore *just writing a file* — the file watcher picks it up live with no reload.
- Liquid templates are pure interpretation (no eval); the docs already state they are "safe to share, sync, and install from community sources." Eta templates run JavaScript and sit behind the per-device, non-synced JavaScript Templates gate.
- Template data has a machine-readable contract: `CONTRACT_VERSION` plus generated JSON Schemas per root (`note`, `annotation`, `filename`), shipped on version-pinned Resource Releases.
- The Resource Release pattern (ADR 0019) is the house precedent for asset distribution: version-pinned, tag-addressed, immutable.

## Prior art (verified 2026-08)

The recommendation rests on measured evidence, not vibes:

- **Zotero's CSL style repository** serves **10,857 styles** to every client as a single ~343 KB gzip `styles.json` with pure client-side search — no server. This is the existence proof that a template directory needs no backend at any scale ZotLit will reach.
- **Obsidian's community registry** is one flat JSON of repo pointers on a CDN; its cost center was *human PR review*, which collapsed under a 2,300-item backlog in 2026 and forced a move to automated review. Lesson: automate validation from day one, keep human judgment for exceptions.
- **Espanso Hub** stores package content in-repo, validates in CI, and compiles a `store.json` for a static site — the closest shape to what is proposed here.
- **Obsidian's own `community-snippets.json`** has held a single placeholder entry for years. Snippet-scale directories are demand-limited; build the cheapest structure that can grow and add machinery only when submissions exist.
- **Transport limits**: the GitHub REST API allows 60 unauthenticated requests/hour per IP (unusable for in-app fetching); `raw.githubusercontent.com` is rate-limited with undisclosed numbers; **jsDelivr** serves tagged GitHub content with ~1-year immutable caching, permanent retention, `Access-Control-Allow-Origin: *`, and a 20 MB/file ceiling. GitHub Pages gives 100 GB/month; Cloudflare Pages free has no bandwidth cap, 500 builds/month, 20,000 files/site.

## Design

### 1. The shareable unit: a template pack

A directory entry is a **pack**: one folder holding one or more template files plus a manifest.

```
packs/<id>/
  manifest.json
  zotlit-note.liquid.md          # any mix of canonical + partial names
  zotlit-annotation.liquid.md
  README.md                      # shown on the entry's detail page
  screenshot.png                 # optional
```

`manifest.json` (validated by a valibot schema shared with the plugin via a small package or copied schema):

```jsonc
{
  "id": "minimal-academic",          // [a-z0-9-]+, unique, folder name
  "name": "Minimal academic notes",
  "author": "aidenlx",               // GitHub handle
  "description": "Compact literature notes with callout annotations.",
  "tags": ["note", "annotation", "callout"],
  "slots": ["note", "annotation"],   // derived by CI from filenames, checked for consistency
  "language": "liquid",              // "liquid" | "eta"; CI verifies against file extensions
  "requiresJs": false,               // CI-derived, never self-declared
  "contractVersion": 2,              // the zt contract the pack was written against
  "minPluginVersion": "2.0.0"        // optional
}
```

Content lives **in the registry repo** (CSL/Espanso model), not as pointers to author repos (Obsidian model). Templates are tiny text files; in-repo content lets CI validate the actual bytes, makes entries immutable once tagged, and removes the author-repo-rot failure mode. One uniform license for the whole repo — **MIT** (authors stay named in the manifest; no per-entry license matrix to reason about forever).

### 2. The registry repo: `zotlit-templates`

A new repository (e.g. `aidenlx/zotlit-templates`) containing `packs/`, the CI workflows, and `CONTRIBUTING.md`.

**Submission — two paths, both landing as a PR:**

1. **Direct PR** for git-comfortable authors: add `packs/<id>/`, open a PR.
2. **Issue form** for everyone else: a `.github/ISSUE_TEMPLATE/submit-template.yml` form (name, description, tags, pasted template body). A GitHub Action parses the issue and opens the PR via `peter-evans/create-pull-request`. No fork, no git.

**CI validation on every PR (this is the moderation system):**

- Manifest parses against the schema; `id` is unique and matches the folder.
- Filenames match `zotlit-<name>.<language>.md`; `language`/`slots` agree with the files.
- **Liquid packs**: the template compiles with `@zotlit/templates`' own liquidjs setup (parse-only — safe, no eval). Unknown `zt.*` fields against the generated contract JSON Schema produce warnings.
- **Eta packs**: compile-checked, `requiresJs: true` forced, and the PR gets a `javascript` label that requires an explicit maintainer approval — the one place human judgment is mandatory.
- Size caps (e.g. 64 KB per file), no binary files except one screenshot.
- Auto-format the submitted files and push the fix back to the PR (CSL's "sheldon" pattern) so formatting never costs a review round-trip.

Green CI + no `javascript` label = a merge is one click. Steady-state maintainer work is merging, not reviewing.

**Takedown path**: a `removed.json` list (id + reason) mirrors Obsidian's `community-plugins-removed.json`; the index build excludes listed ids, and clients can warn about an installed removed pack later.

### 3. Index build and distribution

On merge to the default branch, an Action:

1. Compiles `index.json` — one compact record per pack (`id`, `name`, `author`, `description`, `tags`, `slots`, `language`, `requiresJs`, `contractVersion`, `updated`). Bodies are **not** inlined; this file stays small for years (the 10,857-entry Zotero index is 343 KB gzip).
2. Tags a rolling release (e.g. date-stamped `v2026.08.23`) so the content is addressable immutably.

**Serving, all $0:**

| Asset | Primary URL | Notes |
| --- | --- | --- |
| `index.json` | `https://cdn.jsdelivr.net/gh/<owner>/zotlit-templates@latest/index.json` | jsDelivr resolves `@latest` to the newest tag; ~12 h edge cache, `ACAO: *` |
| Pack files | same CDN, path into `packs/<id>/…` | fetched only when a user opens/installs an entry (two-tier fetch, the CSL model) |
| Fallback | `raw.githubusercontent.com` or the docs site itself | jsDelivr is unreliable in mainland China, which matters for ZotLit's user base — the docs site (already deployed) re-exporting `index.json` is the simplest resilient fallback |

The GitHub REST API is never used by clients (60 req/h per IP unauthenticated).

### 4. The web directory — hosting on both stacks

The directory page is deliberately a **thin static consumer of `index.json` with client-side search** (Fuse.js at this scale; records are small and flat). No server rendering, no per-entry build step: detail pages render client-side from the index record plus an on-demand fetch of the pack's README/body from the CDN. That single decision makes the page identical on both hosting targets.

**Target A — today: Vercel + Next.js (current `apps/docs`).**
Add a `/templates` route to the docs site. The page is a client component (or a static shell + client fetch) that loads `index.json` from the CDN at view time. Zero server compute, zero ISR, zero deploy coupling: a merged pack appears on the site when the CDN cache rolls, with **no docs redeploy**. Optionally, a build-time fetch embeds a snapshot of the index for SEO, refreshed by a Vercel deploy hook that the registry repo's CI calls on merge — nice-to-have, not required.

**Target B — future: Cloudflare (Pages/Workers) + TanStack Start or Astro.**
The same page ports as-is: in Astro it is one static page with a client-side island (or `client:load` script); in TanStack Start it is a client-rendered route. Because entries are not pre-rendered per-pack, the site never approaches Cloudflare Pages' 20,000-file limit, and the 500 builds/month budget is untouched by directory updates (registry merges do not trigger site builds). Cloudflare's uncapped free bandwidth makes this the better long-term host; the design requires nothing from it beyond static file serving.

**Migration cost between A and B for the directory: porting one page component.** The registry repo, CI, CDN URLs, index format, and plugin behavior all stay identical.

If the catalog ever grows past what a client-side index handles comfortably (thousands of entries with long descriptions), swap Fuse.js for Pagefind and pre-render entry pages — a contained change on either stack.

### 5. Plugin-side distribution, in phases

Because a template is just a vault file, phase 1 needs **zero plugin changes**.

- **Phase 1 — copy from the site.** Detail pages show the template body with a copy button and the exact target filename (`zotlit-<name>.liquid.md`). The user pastes it into the template folder; the file watcher activates it live. Ship this with the registry + site.
- **Phase 2 — install command.** A command/setting "Install template from URL" (accepting a directory entry id or CDN URL) fetches the pack, shows a **diff-and-confirm preview** against any existing file, then writes into the template folder. Reuses the existing eject/reset UI patterns in `setting-tab/templates.ts`.
- **Phase 3 — in-app gallery (only if demand shows).** A browse UI over the cached `index.json` (ETag revalidation, local TTL), Obsidian-community-browser style. The `community-snippets.json` placeholder is the cautionary tale: build this only after phases 1–2 see real traffic.

**Install-time safety rails (phase 2+):**

- `requiresJs: true` packs: refuse install while the JavaScript Templates gate is off, with the same loud, self-naming behavior ADR 0004 mandates — no silent fallback. The directory UI labels these entries.
- `contractVersion` mismatch with the running plugin: warn before install.
- Overwrite of an existing template file always goes through the diff preview.

### 6. Security model

- **Liquid-first.** The directory's default and overwhelming majority is Liquid: pure interpretation, no filesystem, no network, no eval. This keeps per-submission review unnecessary — the property that makes $0 moderation viable.
- **`requiresJs` is CI-derived, never self-declared**, and gates both extra review at submission (maintainer approval on the labeled PR) and installation (per-device gate check).
- CI never *renders* submitted templates with data; it parse-checks only. If rendering in CI is ever wanted, gate it behind a maintainer-applied label revoked on each new commit (the CSL `safe to test` pattern).
- Transport is immutable, tag-addressed CDN content — no author can mutate a published version in place.

### 7. Versioning and compatibility

- The **index and packs are versioned by registry tag**; clients always read a coherent snapshot.
- Each pack stamps the `contractVersion` it targets. When the zt contract bumps, CI can flag stale packs, the site can badge them, and the plugin can warn — no breakage, just signal.
- No per-pack semver in v1. A pack update is a PR to its folder; "latest tag" is the only channel. Add per-pack versioning only if a real need appears (KISS).

## Cost and maintenance summary

| Item | Cost | Ongoing work |
| --- | --- | --- |
| Registry repo + Actions | $0 (public repo) | merge green PRs; review only `javascript`-labeled ones |
| CDN (jsDelivr + raw fallback) | $0 | none |
| Directory page on docs site | $0 marginal (existing deploy) | none after initial page; port once on stack migration |
| In-app gallery (phase 3) | $0 | plugin code maintenance — deferred until justified |

No servers, no databases, no accounts to manage, no bandwidth bills. Every component is replaceable: if jsDelivr degrades, the fallback origin serves; if the site moves hosts, the page ports; if GitHub Actions change, the validators are plain scripts.

## Rejected alternatives

- **Pointer-to-author-repo registry (Obsidian model)** — adds repo-rot and per-author release discipline for content that is a few KB of text; blocks CI from validating actual bytes.
- **GitHub Discussions gallery as the primary mechanism** — zero cost but nothing machine-readable; fine as an informal "show and tell" funnel into the registry, not as the directory.
- **Per-submission human review (Raycast/Espanso model)** — the demonstrated cost center that broke Obsidian's queue (2,300 backlog) and Zotero's translator queue (months). Liquid's inertness makes it unnecessary here.
- **In-app browsing via the GitHub API** — 60 unauthenticated requests/hour per IP; unusable behind shared NAT.
- **Server-rendered directory (API routes, database)** — recurring cost and operational surface for a read-mostly catalog that a static index serves better; also couples the directory to the site framework, which the two-stack hosting requirement explicitly punishes.
- **Per-entry license choice** — creates a permanent compatibility matrix; a single repo-wide MIT license removes it (CSL, Raycast, and awesome-lists all fix one license).

## Suggested rollout

1. Create `zotlit-templates` with schema, CI validation, issue-form submission, and 5–10 seed packs extracted from the built-in defaults' variations and maintainer-authored examples (an empty directory launches dead).
2. Add the `/templates` page to the docs site (target A); announce on Discord/Discussions.
3. Ship the phase-2 install command in the plugin.
4. Revisit the in-app gallery after observing submission volume.
