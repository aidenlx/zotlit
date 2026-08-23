# Proposal: Community template sharing and directory

Status: proposal (not yet an ADR). When the team accepts the decisions in
this document, record each load-bearing decision as an ADR in `docs/adr/`.

## Summary

ZotLit users get a **community template directory**: a public catalog of
Liquid template packs, hosted as part of the ZotLit web presence. Anyone can
browse and install a pack. Signed-in users can submit a pack through a web
form and give a pack a star. The plugin installs a pack through an
`obsidian://zotlit/…` link with a confirmation and preview step.

The design goals, in priority order:

1. **KISS and sustainable.** One small stateless API service, one managed
   SQLite database, static pages for everything else. Target running cost:
   $0/month on free tiers, below $5/month at realistic scale.
2. **Non-technical upload.** A web form with drag-and-drop. Git, GitHub PRs,
   and JSON editing are never required from a submitter.
3. **Safe by construction.** The directory accepts Liquid only. Liquid
   templates combine data into text and cannot run code (ADR 0004), so a
   hostile submission is at worst spam, never an exploit on the installing
   user. Eta/JavaScript templates stay out of the directory.
4. **Private preview.** Preview rendering runs fully client-side. A user's
   own library data never leaves their browser.
5. **Minimal stats.** Download count and star count per pack — the same
   granularity as the Obsidian community directory. No telemetry from the
   plugin, no analytics identifiers, no per-user tracing.

## What exists today (grounding)

- `@zotlit/templates` ships two engines behind one facade: **Liquid**
  (default, pure interpreter, no `eval`) and **Eta** (JS, gated per device
  behind the JavaScript Templates consent flag). ADR 0004 already states the
  sharing rationale: Liquid templates "are safe to share, sync, and install
  from community sources."
- A template is a plain markdown file `zotlit-<name>.<language>.md` in one
  flat vault folder. Canonical names: `filename`, `note`, `annotation`,
  `content`, `cite`, `cite2`. Extra names are reachable via `include()`.
  Managed Frontmatter fields are settings-stored `{key, expr, merge,
  language}` records, renderable with Liquid expressions.
- The **Template Data Explorer** already exports a real item's `zt` data
  tree as JSON (`zotlit-template-data-<key>-<timestamp>.json`). This is the
  bridge for "preview with my own data" on the website.
- The **Template Workbench CLI** already renders a template in-memory
  against a real item (`template-render`) — the in-plugin preview mechanism
  exists.
- `obsidian://zotlit/*` protocol handlers exist with an established policy:
  links are unversioned permanent artifacts with an additive-only wire
  format (ADR 0006).
- The docs site is a single Next.js 16 + Fumadocs app on Vercel (Git
  integration). The monorepo has **no backend, no auth, no database**
  anywhere today. Precedent for "static assets over a service" is GitHub
  Releases (ADRs 0018, 0019).

## The shareable unit: template pack

A **pack** is one JSON document. It can carry a single template or a full
set, plus optional Managed Frontmatter fields:

```jsonc
{
  "schema": 1,                       // pack format version, additive-only
  "name": "APA literature notes",    // display name
  "slug": "apa-literature-notes",    // registry id, unique, immutable
  "description": "…",                // short, plain text
  "version": 3,                      // integer, bumped by the registry on resubmit
  "language": "liquid",              // the only accepted value for now
  "templates": {                     // key = template name (canonical or custom)
    "note": "…liquid source…",
    "annotation": "…"
  },
  "frontmatter": [                   // optional; language "liquid" only
    { "key": "citekey", "expr": "{{ zt.citekey }}", "merge": "replace" }
  ],
  "contractVersion": "…"             // zt data-contract version authored against
}
```

Rules:

- `language` is `liquid` for every template and every frontmatter field.
  The registry enforces this server-side; there is no Eta path to design
  around. If Eta sharing ever becomes wanted, it arrives as a separate
  proposal with its own review pipeline.
- Size caps: 64 KiB per template body, 512 KiB per pack.
- The registry keeps every published version; the directory serves the
  latest and links older versions.

## Sharing: the submit flow

A `/templates/submit` page on the site:

1. **Sign in** with GitHub (MVP) — ORCID as a fast-follow provider for
   academics without GitHub. Sign-in exists to attribute packs and to
   rate-limit submissions; browsing and installing stay anonymous.
2. **Fill the form**: name, description, then one drop zone per template
   slot. The submitter drags their `zotlit-note.liquid.md` (etc.) files in,
   or pastes the source into a textarea. The plugin gains a "Copy template
   source" action per template row in Settings → Templates so a submitter
   never hunts for the file on disk.
3. **Automated validation**, synchronous, in the request handler:
   - file/field language is Liquid (extension and declared language);
   - each template parses with liquidjs in strict mode, with the tag and
     filter set restricted to ZotLit's registered set (`ZOTLIT_FILTER_NAMES`
     plus built-ins) — parse only, never render;
   - size caps and a plain-text check on name/description.
4. **Live preview before submit**: the form renders the pack client-side
   against bundled sample data (see Preview below), so the submitter sees
   what installers will see.
5. **Publish immediately.** Moderation is report-based (below), not
   pre-approval. A queue would add maintainer labor for a directory whose
   worst-case bad content is spam text.

### Moderation

- Every pack page has a **Report** button (reason + optional text; no
  sign-in required to report).
- Maintainers get a private list of reported packs and can unlist or delete
  with one click, and ban a submitting account.
- Rate limits: N submissions per account per day, M per IP per hour.
- Optional later: a "reviewed" badge a maintainer can grant, displayed like
  Obsidian's plugin metadata. This is additive and off the critical path.

## Distribution: the install flow

**MVP (works with any plugin version):** every template on a pack page has
a *Copy* button, and the pack page shows exact paste instructions
("create `zotlit-note.liquid.md` in your template folder"). Zero plugin
work required to launch the directory.

**One-click install (plugin work, phase 2):** the pack page's *Install in
Obsidian* button opens

```
obsidian://zotlit/install-template?slug=<slug>&version=<n>
```

following the ADR 0006 additive-wire-format policy. The plugin then:

1. fetches the pack JSON from `GET /v1/packs/<slug>/<version>` over HTTPS;
2. shows a confirmation modal: source (registry URL), author, description,
   the list of files it will write, and a rendered **preview against a real
   item chosen from the user's own library** (the Workbench render path,
   already in-memory and side-effect-free);
3. on conflict with an existing template file, offers keep / overwrite
   (with the old file renamed to a `.bak` sibling);
4. writes the `.liquid.md` files into the configured template folder and,
   when the pack carries frontmatter fields, offers to add them (never
   silently merges settings).

The install fetch is the download-count event (see Stats). Because the
files land as ordinary vault files, uninstall, editing, sync, and the
existing eject/shadowing rules all keep working with no new machinery.

## Preview with your own data

Preview is a client-side island on the pack page (and the submit page):

- liquidjs runs in the browser; the site reuses `@zotlit/templates`'s
  Liquid setup (custom tags, filters, `zt` binding) directly from the
  monorepo, so web preview and plugin rendering share one code path.
- Default data: two or three bundled **fictional sample items** (article,
  book chapter, item with annotations), generated once from the versioned
  `zt` contract so they stay honest as the contract evolves.
- **"Use my data"**: the user drags in a Template Data Explorer export
  (`zotlit-template-data-*.json`). The file is read in the browser,
  rendered locally, and never uploaded. The pack page states this
  explicitly next to the drop zone.
- Render errors and unknown-field warnings show inline, same tone as the
  Workbench's render warnings.

## Community directory (the website part)

Three pages inside the existing site, under `/templates`:

- **Index**: card grid — name, description, author, downloads, stars;
  sort by *recently updated* / *most downloaded* / *most starred*; plain
  substring search. The index is served from one cached JSON document
  (`GET /v1/index`), so browsing costs no database reads.
- **Pack page**: description, per-template source with syntax highlight,
  preview island, Copy / Install buttons, star button, report button,
  version list.
- **Submit page**: the form above.

Search stays client-side over the index JSON (a few hundred packs is a
small payload); this mirrors how the Obsidian directory works and defers
any search infrastructure indefinitely.

## Stats: minimal, Obsidian-directory-grade

Two counters per pack, nothing else:

- **Downloads**: incremented by the pack-download endpoint (both the
  plugin's install fetch and the website's Copy action call it). Raw
  counter, same as Obsidian's release-download counts. Optional dedupe
  later: count once per (pack, day, salted-hash(IP)) with a daily-rotating
  salt so no raw IP is ever stored.
- **Stars**: one per signed-in account per pack, toggleable. Stored as a
  `(user, pack)` row; only the aggregate is public.

Explicit non-goals: page analytics, plugin telemetry, install/uninstall
tracking, view counts, user profiles beyond "author name links to their
packs."

## Backend and hosting

### Shape: one small registry service, decoupled from the site framework

All server behavior fits one stateless HTTP service with a SQLite-class
database:

```
GET  /v1/index                  cached directory index (JSON)
GET  /v1/packs/:slug[/:ver]     one pack (JSON); counts a download
POST /v1/packs                  submit (auth; validates; publishes)
POST /v1/packs/:slug/star       toggle star (auth)
POST /v1/packs/:slug/report     report (no auth)
GET|POST /v1/auth/*             OAuth (GitHub, later ORCID)
```

Build it with **Hono** as a workspace package (`packages/registry-api`
or similar). Hono's adapters run the identical codebase as a Next.js
route handler on Vercel **and** as a Cloudflare Worker. That single
decision makes the "Vercel today, Cloudflare maybe tomorrow" question
cheap: the site framework (Next.js now, TanStack Start or Astro later)
only ever renders pages and calls the JSON API; a migration moves the
deploy target, not the code.

Database schema is four tables: `packs`, `pack_versions`, `stars`,
`reports` (+ `accounts`). Keep it in Drizzle — the repo already uses
Drizzle in `packages/db`, so the ORM knowledge transfers.

### Option A — current stack (Vercel + Next.js)

- Registry mounts at `apps/docs/app/api/registry/[[...route]]/route.ts`
  via Hono's Vercel adapter. One deploy pipeline (the existing Vercel Git
  integration), no new hosting account.
- Database: **Turso** (managed libSQL/SQLite; free tier covers this
  workload for years) or Neon Postgres. Turso preferred: SQLite semantics
  match a later D1 migration almost 1:1.
- Auth: Auth.js (GitHub provider; ORCID is standard OAuth2, added as a
  custom provider).
- Cost: $0 on Vercel Hobby + Turso free tier. Watch item: Vercel function
  invocation limits if the directory gets popular; the cached `/v1/index`
  keeps hot-path traffic on the CDN.

### Option B — target stack (Cloudflare + TanStack Start / Astro)

- Registry deploys as its **own Worker** (`registry.<domain>`) with
  **D1** as the database — Hono is native there, `wrangler deploy` is the
  whole pipeline. Free tier: 100k requests/day and 5M D1 reads/day, far
  beyond plausible traffic; the paid floor is $5/month.
- The site (Astro or TanStack Start on Cloudflare, or even still Next.js
  on Vercel during a transition) consumes the same JSON API. For a
  directory that is mostly static lists plus one preview island, **Astro
  islands are the better fit** of the two candidates; TanStack Start
  earns its keep only if the site grows real app-like interactivity.
- Cache `/v1/index` at the edge with a short TTL and purge on publish.

### Recommendation

Start with **Option A** (registry inside the existing Vercel app, Turso)
because it adds zero new hosting surface, and write the registry in Hono +
Drizzle from day one so Option B is a redeploy, not a rewrite. If the
Cloudflare migration is already decided for this year, skip straight to
the standalone Worker + D1 and let the current Next.js site call it —
the standalone Worker is also the end state under Option A anyway.

### Sustainability and exit hatch

- **Public data export**: a nightly job (or on-publish hook) mirrors all
  published packs as files into a public GitHub repo
  (`aidenlx/zotlit-templates`). This gives transparency, free backup,
  data portability if the service ever shuts down, and a familiar venue
  for takedown history — while keeping git invisible to submitters.
- All registry code lives in this monorepo; the service has no state
  outside the one database.
- Bus-factor: the whole system is one Worker/route-handler + one SQLite
  database + static pages — restorable from the GitHub mirror in an
  afternoon.

## Security model (recap)

- **Installer safety** comes from the format, not from review: Liquid
  cannot read files, reach the network, or run code (ADR 0004). Strict
  parse with an allowlisted tag/filter set rejects anything else at
  submit time, and the plugin's install path re-validates
  (extension + parse) before writing files — the registry is not a trusted
  computing base.
- **Directory integrity** comes from auth + rate limits + report/takedown.
- **Privacy**: preview data stays in the browser; stats store aggregates
  only; sign-in scope is minimal (public profile id for attribution).
- Eta/JavaScript templates remain out of scope for the directory. The
  existing per-device JavaScript Templates gate is unchanged.

## Rollout

**Phase 1 — directory without plugin changes.** Pack format, registry
service (submit/list/get/star/report, GitHub OAuth), `/templates` pages,
client-side preview with sample data and Template Data Explorer import,
Copy-button install. Ships value on its own.

**Phase 2 — one-click flows.** `obsidian://zotlit/install-template`
handler with confirmation modal and own-library preview; "Copy template
source" share affordance in Settings → Templates; download counting moves
to the install fetch.

**Phase 3 — polish, each item optional.** ORCID sign-in, "reviewed"
badge, nightly GitHub mirror, download dedupe, in-plugin directory
browser (Obsidian community-plugin-style modal).

## Open questions

1. Directory URL: under the docs site (`zotlit.aidenlx.site/templates`) or
   its own subdomain? (Subdomain eases the later site migration.)
2. Pack granularity for canonical names: encourage full packs
   (note+annotation+content together) or allow single-template shares of
   e.g. only `cite`? Proposal allows both; the submit form should nudge
   toward coherent packs.
3. Does a pack version pin `contractVersion` hard (warn on mismatch at
   install) or soft (informational only)? Proposal: soft, with render-time
   warnings doing the real work.
