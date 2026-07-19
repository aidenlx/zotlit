# Spec: ZotLit v2 documentation site

Status: ready-for-agent

## Problem Statement

ZotLit v2 is shipping as an alpha, but its documentation site is an empty scaffold. New users have no way to learn what ZotLit does, how to install the two plugins, or how to get their first literature note. Existing v1 users arriving at the alpha have no answer to "what changed, will my notes survive, how do I migrate my templates". The only written material is a set of unrevised internal drafts covering the template system, and the v1 docs — which describe an architecture v2 replaced — remain the top search result.

## Solution

Turn the docs app into the complete end-user documentation site for the v2 alpha at zotlit.aidenlx.site, written per the Diataxis framework: a short intro section (docs index + install pages), a prescriptive first-note tutorial, task-oriented how-to guides, concept explanations, and neutral reference pages. Template documentation is rewritten fresh from the drafts and distributed across those same quadrants — template concepts in Concepts, template tasks in How-to guides, template lookup material as a subfolder inside Reference. The site carries a unified changelog, comments, and analytics, and links out to the preserved v1 docs (zotlit-v1.aidenlx.site) instead of mirroring them. Docs describe exactly what the alpha ships — nothing more.

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
12. As a template author, I want a guided task for ejecting and editing a default template, so that customizing starts from a working baseline instead of a blank file.
13. As a new user who has just created my first literature note, I want a guided lesson that customizes how my annotations render, so that I learn the template-editing workflow before I need it.
14. As a template author, I want a syntax reference for the default (Liquid) template language, so that I can customize note output safely.
15. As a template author, I want an exhaustive reference of the data available to each template type, so that I don't guess at property names.
16. As a template author, I want an explorer-driven workflow documented, so that I can find the right data path against my real library.
17. As a note organizer, I want a task guide for configuring frontmatter properties with merge strategies, so that my manual edits survive note refreshes.
18. As a security-conscious user, I want to understand what the JavaScript Templates gate enables and risks, so that I can make an informed opt-in.
19. As a v1 user, I want a migration guide that tells me what happens to my install, settings, notes, and templates, so that I can upgrade without fear.
20. As a v1 template author, I want a step-by-step Eta template migration guide with property mappings, so that my custom templates keep working.
21. As a v1 user, I want the old docs preserved and linked, so that I can still consult them while I transition.
22. As a power user or tool author, I want the obsidian://zotlit/* protocol actions documented, so that I can script my own workflows.
23. As any user, I want a settings reference mirroring the settings UI, so that I can look up what a toggle does.
24. As any user, I want a commands reference, so that I can discover every palette command and its other entry points.
25. As a returning user, I want a changelog page per release, so that I know what changed before updating.
26. As a confused user, I want to comment on the exact page that failed me, so that I can get help in context.
27. As the maintainer, I want page-level comments and analytics, so that I learn where the docs fail users.
28. As an AI agent or LLM user, I want machine-readable page content, so that assistants can answer ZotLit questions accurately.
29. As a visitor landing on the domain root, I want an immediate pitch and a "Get started" path, so that I'm one click from the tutorial.
30. As a reader entering a section from the sidebar or a card, I want the section's index to guide me by task or question, so that I find the right page without scanning a flat list.

## Implementation Decisions

### Scope and audience

- Documents the **alpha feature set only** — every published page describes behavior the alpha ships (post-alpha features are listed in Out of Scope).
- **Newcomer-first**: the spine is written for a reader without v1 knowledge; migration coverage is two how-to guides (Migrate from v1, Migrate v1 Eta templates).
- **English only** at alpha (i18n is listed in Out of Scope).
- **v2 site only**: rehoming the v1 site and adding banners to it is separate work in the v1 docs repo. v2 links out to zotlit-v1.aidenlx.site.

### Voice

- Two prose registers, split at the onboarding boundary. The **onboarding walk** — the Intro section and the Tutorial section (both lessons) — is a **friendly guide**: warmth as calm reassurance, modeled on 1Password's getting-started pages. Every other page, landing included, is **plain manual**: dry, declarative, second person, modeled on the Linear docs. The docs index is a router, too short to carry a register. Section indexes carry the register of their location: the Tutorial index sits inside the onboarding walk (friendly guide); the How-to, Concepts, Reference, and templates indexes are plain manual.
- The landing page carries pitch content in manual cadence — short confident declaratives; the pitch is in what's said, not how it sounds.
- The `docs/template-v2/` drafts contribute content only; their prose register is AI-default and every absorbed passage is re-voiced into the target register.
- The full register spec lives in the `docs-writing` skill's Writing Style section; this PRD records the decision and its boundary.

### Facts the docs assert (verified against the codebase)

- Requirement is **Zotero 9+**, stated once and everywhere; the docs describe a single supported path — Zotero 9+ with the companion installed — which is where database compatibility is guaranteed.
- The **companion is required**; the tutorial installs both plugins as one path.
- Distribution: the Obsidian plugin installs from the official community directory (community.obsidian.md/plugins/zotlit) or via BRAT for pre-release builds; the companion installs via .xpi from the GitHub releases of aidenlx/zotlit. v2 keeps the v1 plugin id, so installing v2 replaces v1 in place; the plugin is desktop-only.
- v1 settings migrate automatically (best-effort) on first load.
- v1 literature notes are recognized but have no managed region: only Overwrite works on them; incremental update requires a v2-created note.
- Companion context menus work through protocol links with no server; live-updates push requires enabling the Obsidian-side server and the companion's notify preference, with matching endpoints.
- Edited template files recompile live (vault watcher, no plugin reload). "Update literature note" re-renders the managed region — annotation callouts included — with the currently compiled templates; "Update literature note metadata" touches frontmatter only; "Overwrite literature note" is a separate destructive command behind a confirm modal.

### Information architecture

Nav is **pure Diataxis**: Intro · Tutorial · How-to guides · Concepts · Reference. Template documentation distributes across the quadrants — explanation pages in Concepts, task pages in How-to guides, lookup material as a nested subfolder inside Reference. Page tree (URL slugs are the product surface):

```
/docs                      Docs entrypoint — the Intro section's index; routes the reader into the sections below
/docs/install-zotlit       Install ZotLit
/docs/install-companion    Install the companion
/docs/tutorial           Tutorial section index — the two lessons as an ordered path
/docs/tutorial/first-note  Create your first literature note (start here)
/docs/tutorial/customize-template  Customize your annotations (lesson 2)
/docs/how-to             How-to section index, then:
                         Create and open literature notes · Insert citations ·
                         Keep notes up to date · Import Zotero notes ·
                         Use the annotation view · Set up live updates ·
                         Customize a template · Explore template data ·
                         Configure frontmatter properties ·
                         Enable JavaScript templates ·
                         Migrate from v1 · Migrate v1 Eta templates
/docs/concepts           Concepts section index, then:
                         Literature notes & the managed region ·
                         How ZotLit connects to Zotero ·
                         How templates work · JavaScript templates
/docs/reference          Reference section index, then:
                         Settings · Commands · Protocol links
/docs/reference/templates  Templates section index, then:
                         Syntax · Data · Frontmatter · Defaults · Eta syntax
/changelog               release entries
/                        landing page — the "what is ZotLit" story (hero + overview)
```

- Sidebar sections, in order: **Intro** · **Tutorial** · **How-to guides** · **Concepts** · **Reference**. Intro holds the docs index plus the two install pages; Tutorial holds the two lessons, Create your first literature note and Customize your annotations — those two sections are the entire onboarding surface. Mechanism (per Fumadocs page conventions): Intro is a `(intro)/` folder group — parenthesized folders are stripped from slugs, so its children keep root-level URLs — and its `index.mdx` is `/docs` itself, which per the folder-index convention makes the "Intro" section header clickable. Tutorial is a real `tutorial/` folder. Every real section folder (Tutorial, How-to, Concepts, Reference, and the `templates/` subfolder) carries its own index page, so by the same folder-index convention every section header is clickable and every section URL resolves.
- **Reference is subgrouped**: the three app pages (Settings, Commands, Protocol links) sit directly under Reference; the five template reference pages live in a collapsible `templates/` subfolder with slugs under /docs/reference/templates/. This keeps the Reference sidebar at four top-level items and gives template lookup pages stable deep-link URLs.
- **Section indexes** (Documentation-context term: Section Index) are wayfinding pages, organized around the reader's situation or question — never a flat listing of the section's pages. They route and nothing else: no tutorial, how-to, concept, or reference content of their own, one framing sentence plus cards. Per section: the Tutorial index presents the two lessons as an ordered path (what each leaves you with, install prerequisites linked); the How-to index groups its cards under three headings — **Core usage** · **Templates** · **Migrating from v1** — with situation-phrased descriptions; the Concepts index is question-oriented ("what's the managed region", "how does data reach Obsidian") with a suggested reading order for newcomers; the Reference index splits by lookup intent (a setting, a command, a protocol action, template internals) and notes that template *tasks* live in How-to; the templates index is a question→page map across its five pages. Card descriptions are written freely where a target page's frontmatter description doesn't answer "when do I need this page", reused where it does.
- **How-to ordering** follows the reader's workflow: the six core-usage guides first (create/open through live updates), then the four template tasks as a cluster (customize · explore data · frontmatter · enable JavaScript), then the two migration guides last. **Customize a template** is the lean goal-directed recipe — eject any of the six types, edit the file, how changes take effect — for a reader who already knows what to change; the guided worked example lives in the tutorial's second lesson, which the page cross-links.
- Concept page split: **How templates work** covers the six template types, the two languages (Liquid default, Eta behind the gate), filename matching, and the defaults-plus-eject model. **JavaScript templates** covers what the gate enables, why it exists, the risks of opting in, and the consequences when disabled — it serves the informed-opt-in decision and links to the enable how-to for steps.
- The Tutorial section is a two-lesson curriculum. Lesson 1 — Create your first literature note — opens with its visible win: it is the first page a new user reaches, states the two install prerequisites up front (linking to Install ZotLit and Install the companion), then walks through creating a note with metadata and annotations, and closes by pointing to lesson 2 as its next step. The Install ZotLit page presents the official community directory and BRAT as tabs whose default tracks the release stage (BRAT preselected during alpha, official once v2 reaches the store) — the default tab is the prescriptive path, so the tutorial's single-path rule holds.
- Lesson 2 — Customize your annotations (working title; slug customize-template) — states one prerequisite: the note from lesson 1. Arc: eject the annotation template from Settings > Templates, change the callout type (`[!note]` → `[!quote]`) in the ejected file, run Update literature note (the metadata variant touches frontmatter only and would show nothing), and watch the existing note's callouts transform in place. Second beat: open the Template Data Explorer, find one property (colorName), copy its path, and add it to the callout title. The lesson uses incremental update exclusively — Overwrite is absent — so it demonstrates that the reader's own writing survives a re-render. It closes with the safety note that deleting the ejected file restores the built-in default, then hands off to Explore template data, Customize a template, and How templates work. Everything outside the Tutorial section's two lessons is a how-to.
- Companion preferences are documented inside the companion-install and live-updates pages — those two pages are the companion's full documentation surface.
- Every answer lives in the page that owns its topic (this takes the place of an FAQ section).
- Every page is exactly one Diataxis type; each carries title (<60 chars) and description (<160 chars) frontmatter.

### Content sourcing

- The draft template docs (`docs/template-v2/`) are **raw material, not pages**: rewritten fresh per Diataxis, then the drafts directory is deleted once fully absorbed. The absorption map:
  - `index.md` → types/languages/eject model into the How templates work concept; the Template Data Explorer section into the Explore template data how-to; the getting-started section into the Customize your annotations tutorial.
  - `syntax.md` → the Syntax reference page, including file naming and the Liquid-wins shadowing rule.
  - `data-reference.md` → the Data reference page.
  - `frontmatter.md` → configuration workflow and validation into the Configure frontmatter properties how-to; field tables, merge strategies, reserved keys, merge-on-update, and gate interaction into the Frontmatter reference page.
  - `defaults.md` → the Defaults reference page; its annotated walkthroughs also seed the Customize your annotations tutorial's worked material.
  - `javascript-templates.md` → what/why/risks/disabled-behavior into the JavaScript templates concept; the opt-in steps into the Enable JavaScript templates how-to.
  - `note-import.md` → trigger semantics, the render-annotations setting, and the import folder into the Import Zotero notes how-to; the notes shape and imported-note frontmatter fields into the Data reference page.
  - `eta/syntax.md` → the Eta syntax reference page.
  - `eta/migration.md` → the Migrate v1 Eta templates how-to.
- v1 docs are structural inspiration only; v1-specific content does not carry over.
- Behavior claims, UI strings, setting defaults, and protocol parameters are verified against the plugin source, message catalogs, settings schema, and protocol schemas — never against v1 docs or the drafts.
- Vocabulary comes verbatim from the domain glossaries: the Obsidian Plugin context for product terms, the Documentation context for docs-only naming ("ZotLit" unqualified = the Obsidian plugin; the Zotero add-on is "the companion").

### Site behavior

- **Changelog**: a separate content collection rendered at /changelog — one entry per Obsidian-plugin release, keyed by its semver version; companion releases are noted inside the entry they shipped alongside. Entries link out to the GitHub release. Released 2.0.0 alphas are backfilled. Modeled on the Media Extended website's changelog.
- **Comments**: Giscus on every docs page (footer slot), discussions hosted on aidenlx/zotlit, pathname-keyed, theme following the reader's color scheme.
- **Analytics**: Vercel Analytics mounted once at the root layout.
- **Home**: the "what is ZotLit" story lives here — logo/wordmark, pitch, a concise what-it-does overview (literature notes, citations, annotation view, note import), Get-started CTA, GitHub link. Those sections are the complete alpha landing page.
- **Docs index** (`/docs`): titled "Introduction", the Intro section's index page; an entrypoint, not an explanation — routes the reader to get started (tutorial first, then cards into How-to, Concepts, Reference; "Coming from v1?" pointer).
- Existing plumbing is preserved: docs search (indexing the docs collection only), OG images, llms.txt and markdown content negotiation.
- **Media policy**: text-first; screenshots only where prose genuinely fails (annotation view, Template Data Explorer). Full media pass deferred to beta.

## Testing Decisions

The seam is **the built site** — the highest level available, since content pages carry all the behavior:

- The repo's lint/build pipeline stays green (lint includes typecheck; the docs app must build).
- Every page renders in the dev server and every internal link resolves — no orphan slugs, no links into deleted draft paths.
- **Accuracy checks against source of truth**: exact command names, setting labels, and menu labels are diffed against the plugins' message catalogs; the settings reference is diffed against the settings schema key list; the commands reference against the set of command registrations; protocol parameters against the protocol schemas; a spot-check of template data properties against the template-data mappers.
- **Quadrant check** per page: a tutorial page contains no alternatives; reference pages contain no opinions or steps; explanations contain no numbered procedures. Section indexes are routers — the check for them is that they carry no quadrant content at all.
- **Slop check** per page: the `slop-check` audit runs on every page before it ships. The writer fixes high- and medium-severity flags and re-runs; only disputed false positives are escalated to the maintainer.
- **Absorption check** before deleting `docs/template-v2/`: every row of the absorption map above is accounted for in a published page.
- Prior art: none — this is the first content in the docs app.

## Out of Scope

- v1 docs repo work: domain move to zotlit-v1.aidenlx.site, redirects from the old domain, any v2 banner there.
- zh-CN translations and i18n routing.
- Documentation of post-alpha features; a screenshot-rich media pass; a full marketing landing page.
- An interactive template playground. Declined for alpha: a lesson's win must land in the reader's own vault, the Template Data Explorer is already the real-data interactive surface, and an honest playground would have to bundle the plugin's custom Liquid surface (bq tag, embed filter, callable links) and track every release. Revisit post-alpha as a sandbox on the template Syntax reference, the one page whose reader experiments with language mechanics rather than their own data.
- Hosting/domain provisioning for zotlit.aidenlx.site (deploy-time, outside the repo).

## Further Notes

- **Current state**: the docs app's design system, nav skeleton, changelog backfill (2.0.0-alpha.0 through .6), Giscus, and analytics are already in place; intro pages exist as placeholders. The remaining work is content, plus bringing the content tree in line with the page tree above (the `reference/templates/` subfolder replaces the scaffolded `templates/` group).
- Implementation is broken into tickets under `issues/` (01–16); work the frontier — any ticket whose blockers are done.
- Deploy-time prerequisites flagged, not blocking: GitHub Discussions with a comments category (Giscus IDs), and verifying the actual release tag/asset naming for the BRAT and .xpi install instructions.
- Decision trail:
  - Companion-required-in-tutorial was an explicit user decision over the optional-companion alternative, which is what collapses the requirement story to "Zotero 9+ everywhere".
  - The dedicated Templates nav group (an earlier revision of this spec) was **reversed** in favor of pure Diataxis: its page list had ended up mirroring the draft files one-to-one, with mixed-quadrant pages. Template material now splits by quadrant, with the reference subfolder as the only grouping.
  - Reference page granularity was decided coarse (five template reference pages, in-page TOC for navigation) over splitting syntax or data into multiple pages.
  - The template-customization lesson (Customize your annotations) is a second Tutorial page, not an enrichment of the Customize a template how-to. Both pages stay: the tutorial owns the guided worked example, the how-to the lean recipe. Duplicating the worked example was rejected as drift-prone; dropping the how-to would force competent users through a lesson.
  - The lesson re-renders with Update literature note, not Overwrite: annotation callouts live inside the managed region, edited templates recompile live (both verified against the plugin source), and incremental update demonstrates the safety story the docs elsewhere assert.
  - Register exemplars were chosen by sampling live pages: Linear won plain-manual for zero warmth/marketing drift; 1Password won the onboarding register (warmth as reassurance) over Notion (warmth as enthusiasm — emoji, exclamation marks) and a single Raycast register site-wide; Tailscale was struck as an exemplar after its sampled page read benefits-first marketing.
  - An earlier revision made only the Intro header clickable; that was **reversed** once the docs index's section cards pointed at unresolved section URLs. Section indexes were chosen over the alternatives (retargeting cards at each section's first page, or leaving headers non-clickable) and specified as wayfinding pages rather than flat listings; all five real section folders get one for a uniform sidebar contract.
  - The landing page's four overview claims and hero subline were verified against the plugin source (single-command template-rendered note creation; in-editor citation search; sidebar annotation view with follow-active-reader mode; child and standalone note import) — the scaffold's copy ships unchanged; only its link targets needed retargeting.
