# Spec: ZotLit v2 documentation site

Status: ready-for-agent

## Problem Statement

ZotLit v2 is shipping as an alpha, but its documentation site is an empty scaffold. New users have no way to learn what ZotLit does, how to install the two plugins, or how to get their first literature note. Existing v1 users arriving at the alpha have no answer to "what changed, will my notes survive, how do I migrate my templates". The only written material is a set of unrevised internal drafts covering the template system, and the v1 docs — which describe an architecture v2 replaced — remain the top search result.

## Solution

Turn the docs app into the complete end-user documentation site for the v2 alpha at zotlit.aidenlx.site, written per the Diataxis framework: a short intro section (docs index + install pages), a prescriptive first-note tutorial, task-oriented how-to guides, a dedicated Templates section rewritten fresh from the drafts, concept explanations, and neutral reference pages. The site carries a unified changelog, comments, and analytics, and links out to the preserved v1 docs (zotlit-v1.aidenlx.site) instead of mirroring them. Docs describe exactly what the alpha ships — nothing more.

## User Stories

1. As a researcher new to ZotLit, I want a one-page overview of what ZotLit does, so that I can decide whether to install it.
2. As a new user, I want a step-by-step install tutorial with the requirements stated up front, so that I don't discover my Zotero version is unsupported halfway through.
3. As a new user, I want to be told exactly how to install the alpha (BRAT) and the companion (.xpi), so that I don't hunt for a community-store listing that doesn't exist.
4. As a new user, I want to create my first literature note within minutes of installing, so that I see the value before configuring anything.
5. As a writer, I want to insert citations while typing, so that I can reference my Zotero library without leaving the editor.
6. As a note-taker, I want to open or create a literature note from a quick switcher or a citekey, so that navigation and creation are one gesture.
7. As a user whose Zotero library changes, I want to update a literature note without losing my own writing, so that re-syncing is safe.
8. As a user with many notes, I want to batch-update from Zotero, so that keeping the vault current doesn't mean opening every note.
9. As a Zotero note-taker, I want to import child notes and standalone notes into my vault, so that my Zotero notes live alongside my Obsidian notes.
10. As a PDF reader, I want a sidebar of an item's annotations that can follow my active Zotero reader, so that I can pull highlights into notes as I read.
11. As a user, I want to set up live updates between Zotero and Obsidian, so that changes push instantly instead of waiting for a database refresh.
12. As a template author, I want a syntax reference for the default (Liquid) template language, so that I can customize note output safely.
13. As a template author, I want an exhaustive reference of the data available to each template type, so that I don't guess at property names.
14. As a template author, I want an explorer-driven workflow documented, so that I can find the right data path against my real library.
15. As a security-conscious user, I want to understand what the JavaScript Templates gate enables and risks, so that I can make an informed opt-in.
16. As a v1 user, I want a migration guide that tells me what happens to my install, settings, notes, and templates, so that I can upgrade without fear.
17. As a v1 template author, I want a step-by-step Eta template migration guide with property mappings, so that my custom templates keep working.
18. As a v1 user, I want the old docs preserved and linked, so that I can still consult them while I transition.
19. As a power user or tool author, I want the obsidian://zotlit/* protocol actions documented, so that I can script my own workflows.
20. As any user, I want a settings reference mirroring the settings UI, so that I can look up what a toggle does.
21. As any user, I want a commands reference, so that I can discover every palette command and its other entry points.
22. As a returning user, I want a changelog page per release, so that I know what changed before updating.
23. As a confused user, I want to comment on the exact page that failed me, so that I can get help in context.
24. As the maintainer, I want page-level comments and analytics, so that I learn where the docs fail users.
25. As an AI agent or LLM user, I want machine-readable page content, so that assistants can answer ZotLit questions accurately.
26. As a visitor landing on the domain root, I want an immediate pitch and a "Get started" path, so that I'm one click from the tutorial.

## Implementation Decisions

### Scope and audience

- Documents the **alpha feature set only** — no stubs or "coming soon" for post-alpha features (topic import, annotation merging, Better Notes compat, template playground).
- **Newcomer-first**: the spine assumes no v1 knowledge; migration is one prominent how-to plus a template-migration appendix page, not the structure.
- **English only**; no i18n routing or scaffolding now.
- **v2 site only**: rehoming the v1 site and adding banners to it is separate work in the v1 docs repo. v2 links out to zotlit-v1.aidenlx.site.

### Facts the docs assert (verified against the codebase)

- Requirement is **Zotero 9+**, stated once and everywhere; database compatibility is only guaranteed there, and no companion-less or older-Zotero path is documented.
- The **companion is required**; the tutorial installs both plugins as one path.
- Distribution: the Obsidian plugin installs from the official community directory (community.obsidian.md/plugins/zotlit) or via BRAT for pre-release builds; the companion installs via .xpi from the GitHub releases of aidenlx/zotlit. v2 keeps the v1 plugin id, so installing v2 replaces v1 in place; the plugin is desktop-only.
- v1 settings migrate automatically (best-effort) on first load.
- v1 literature notes are recognized but have no managed region: only Overwrite works on them; incremental update requires a v2-created note.
- Companion context menus work through protocol links with no server; live-updates push requires enabling the Obsidian-side server and the companion's notify preference, with matching endpoints.

### Information architecture

Nav is Diataxis plus a dedicated Templates group (the template system is too large to scatter across Reference/Explanation). Page tree (URL slugs are the product surface):

```
/docs                      Docs entrypoint — the Intro section's index; routes the reader into the sections below
/docs/install-zotlit       Install ZotLit
/docs/install-companion    Install the companion
/docs/tutorial/first-note  Create your first literature note (start here)
/docs/how-to             Create and open literature notes · Insert citations ·
                         Keep notes up to date · Import Zotero notes ·
                         Use the annotation view · Set up live updates ·
                         Explore template data · Migrate from v1
/docs/templates          Overview · Syntax · Data reference · Frontmatter ·
                         Default templates · JavaScript templates · Eta syntax ·
                         Migrate v1 Eta templates
/docs/concepts           Literature notes & the managed region · How ZotLit connects to Zotero
/docs/reference          Settings · Commands · Protocol links
/changelog               release entries
/                        landing page — the "what is ZotLit" story (hero + overview)
```

- Sidebar sections, in order: **Intro** · **Tutorial** · **How-to guides** · **Templates** · **Concepts** · **Reference**. Intro holds the docs index plus the two install pages; Tutorial holds Create your first literature note. There is no getting-started page or group. Mechanism (per Fumadocs page conventions): Intro is a `(intro)/` folder group — parenthesized folders are stripped from slugs, so its children keep root-level URLs — and its `index.mdx` is `/docs` itself, which per the folder-index convention makes the "Intro" section header clickable. Tutorial is a real `tutorial/` folder.
- The tutorial opens with its visible win — Create your first literature note is the first page a new user reaches, states the two install prerequisites up front (linking to Install ZotLit and Install the companion), then walks through creating a note with metadata and annotations; everything else is a how-to. The Install ZotLit page presents the official community directory and BRAT as tabs whose default tracks the release stage (BRAT preselected during alpha, official once v2 reaches the store) — the default tab is the prescriptive path, so the tutorial's single-path rule holds.
- Companion preferences are documented inside the companion-install and live-updates pages; no separate companion reference.
- No FAQ section: answers live in the page that owns the topic.
- Every page is exactly one Diataxis type; each carries title (<60 chars) and description (<160 chars) frontmatter.

### Content sourcing

- The draft template docs (`docs/template-v2/`) are **raw material, not pages**: rewritten fresh per Diataxis, then the drafts directory is deleted once fully absorbed (the note-import draft splits across the import how-to, Templates, and Concepts).
- v1 docs are structural inspiration only; v1-specific content does not carry over.
- Behavior claims, UI strings, setting defaults, and protocol parameters are verified against the plugin source, message catalogs, settings schema, and protocol schemas — never against v1 docs or the drafts.
- Vocabulary comes verbatim from the domain glossaries: the Obsidian Plugin context for product terms, the Documentation context for docs-only naming ("ZotLit" unqualified = the Obsidian plugin; the Zotero add-on is "the companion").

### Site behavior

- **Changelog**: a separate content collection rendered at /changelog — one entry per Obsidian-plugin release, keyed by its semver version; companion releases are noted inside the entry they shipped alongside. Entries link out to the GitHub release. Released 2.0.0 alphas are backfilled. Modeled on the Media Extended website's changelog.
- **Comments**: Giscus on every docs page (footer slot), discussions hosted on aidenlx/zotlit, pathname-keyed, theme following the reader's color scheme.
- **Analytics**: Vercel Analytics mounted once at the root layout.
- **Home**: the "what is ZotLit" story lives here — logo/wordmark, pitch, a concise what-it-does overview (literature notes, citations, annotation view, note import), Get-started CTA, GitHub link. No further marketing sections at alpha.
- **Docs index** (`/docs`): titled "Introduction", the Intro section's index page; an entrypoint, not an explanation — routes the reader to get started (tutorial first, then cards into How-to, Templates, Concepts, Reference; "Coming from v1?" pointer).
- Existing plumbing is preserved: docs search (docs collection only — changelog unindexed), OG images, llms.txt and markdown content negotiation.
- **Media policy**: text-first; screenshots only where prose genuinely fails (annotation view, Template Data Explorer). Full media pass deferred to beta.

## Testing Decisions

There is no unit-testable module; the seam is **the built site**, verified at the highest level:

- The repo's lint/build pipeline stays green (lint includes typecheck; the docs app must build).
- Every page renders in the dev server and every internal link resolves — no orphan slugs, no links into deleted draft paths.
- **Accuracy checks against source of truth**: exact command names, setting labels, and menu labels are diffed against the plugins' message catalogs; the settings reference is diffed against the settings schema key list; the commands reference against the set of command registrations; protocol parameters against the protocol schemas; a spot-check of template data properties against the template-data mappers.
- **Quadrant check** per page: a tutorial page contains no alternatives; reference pages contain no opinions or steps; explanations contain no numbered procedures.
- Prior art: none — this is the first content in the docs app; the checks above are written into each implementation issue's Verify section.

## Out of Scope

- v1 docs repo work: domain move to zotlit-v1.aidenlx.site, redirects from the old domain, any v2 banner there.
- zh-CN translations and i18n routing.
- Documentation of post-alpha features; a screenshot-rich media pass; a full marketing landing page.
- Hosting/domain provisioning for zotlit.aidenlx.site (deploy-time, outside the repo).

## Further Notes

- Implementation is split into five issues under `.scratch/docs-site-v2/issues/` (01 plumbing → 02 index+tutorial → 03 how-tos → 04 templates → 05 concepts+reference). 01 lands the nav skeleton first; 02–05 are order-independent except that draft deletion in 04 waits on 03/05 absorbing their parts.
- Deploy-time prerequisites flagged, not blocking: GitHub Discussions with a comments category (Giscus IDs), and verifying the actual release tag/asset naming for the BRAT and .xpi install instructions.
- Decision trail: companion-required-in-tutorial was an explicit user decision over the optional-companion alternative, which is what collapses the requirement story to "Zotero 9+ everywhere".
