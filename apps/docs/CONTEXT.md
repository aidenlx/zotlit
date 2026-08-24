# ZotLit Documentation

The end-user documentation sites: naming and framing rules for how product concepts are presented to users. Product-domain terms are defined in the [Obsidian Plugin context](../obsidian/CONTEXT.md); this context covers vocabulary that exists only in the docs.

## Language

**ZotLit** _(unqualified)_:
The Obsidian plugin. When docs say "ZotLit" with no qualifier, they mean the Obsidian side. The Zotero side is ZotLit Companion, the Zotero add-on.
_Avoid_: ZotLit for Obsidian, the Obsidian plugin (as a standing name; fine as an occasional clarifier)

**ZotLit Companion**:
The required Zotero add-on. Write “ZotLit Companion, the Zotero add-on” on first use in a page and “the Companion” later. It installs under the display name “ZotLit” in Zotero's add-on manager, so docs never call it by its displayed name alone.
_Avoid_: Zotero companion, ZotLit Zotero companion, companion plugin, Zotero plugin (v1 term), zotero-obsidian-note (v1 product), ZotLit for Zotero

**Section Index**:
The wayfinding page at a section's own URL (e.g. /docs/how-to): it helps the reader find the material they need — organized around the reader's situation or question, never a flat listing of the section's pages. It routes and nothing else: no tutorial, how-to, concept, or reference content of its own. The Intro section's index is the docs index ("Introduction").
_Avoid_: table of contents, overview page, section landing page

**Pre-release**:
The channel that carries beta builds — BRAT for ZotLit, `update-beta.json` for the Companion. It is the reader-facing name for both apps' beta line; docs never expose the branch it ships from.
_Avoid_: beta channel, next channel, nightly, canary

**Stable Docs**:
The documentation deployment for the Stable channel, published at zotlit.aidenlx.site. Its content describes the Stable Release Line that the deployment represents.
_Avoid_: production docs, main docs

**Pre-release Docs**:
The documentation deployment for the Pre-release channel, published at zotlit-beta.aidenlx.site. Its content can describe a Stable Release Line that is ahead of Stable Docs.
_Avoid_: beta content, mixed docs

**Dormant Pre-release**:
The state where the Pre-release channel carries nothing newer than Stable, between beta cycles. Install pages report it as "no pre-release available" and never advertise a version behind Stable.
_Avoid_: no beta, unreleased (that word marks a channel that never shipped)

**Changelog Entry**:
One release note on the site's /changelog, keyed by the Obsidian plugin's semver version. Companion releases have no entries of their own; a companion release is noted inside the plugin-version entry it shipped alongside.
_Avoid_: release page, companion changelog

**Introduced Release**:
The first ZotLit release that contained the main subject of a documentation page, identified by its full semantic version. It records permanent release history for that subject; compatibility requirements for individual instructions and Companion versions remain page prose.
_Avoid_: minimum version, page version, new status

**Updated Release**:
The latest ZotLit release whose product changes materially changed an existing page's main-subject guidance, identified by its full semantic version. Wording corrections preserve this release history.
_Avoid_: edit date, last modified, documentation version

**Stable Release Line**:
The non-prerelease major, minor, and patch version to which a release belongs. For example, `2.0.0-beta.4` belongs to `2.0.0`.
_Avoid_: base version, final version

**Docs Release Line**:
The Stable Release Line represented by one documentation deployment. It determines which pages receive release badges.
_Avoid_: latest Stable, badge baseline, site version

**New Feature**:
A documentation page whose Introduced Release belongs to the Docs Release Line.
_Avoid_: new page, new status field

**Updated Page**:
A documentation page whose Introduced Release belongs to an earlier Stable Release Line and whose Updated Release belongs to the Docs Release Line.
_Avoid_: edited page, recently modified page

**v1 Docs**:
The legacy documentation site at zotlit-v1.aidenlx.site, kept online for v1 users. v2 pages link out to it where relevant (migration guide); it is never mirrored or embedded in the v2 site.
_Avoid_: old docs, obzt docs (stale domain)
