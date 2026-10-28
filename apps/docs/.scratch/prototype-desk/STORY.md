# Landing page story: "An integrated research desk for Obsidian"

Prototype round 2. This file is the story that all five variants tell. The data behind it is
`JOBS` and `FEATURES` in the `// --- Shared ---` region of `prototype-desk.html`.

## Facts the page states (checked 2026-10-29)

| Fact | Value | Source |
| --- | --- | --- |
| Install | Obsidian community plugins (`obsidian://show-plugin?id=zotlit`). 2.2 betas: BRAT. | `docs/(intro)/install-zotlit.mdx` |
| Needs | Obsidian 1.14.2 or later, Zotero 9 or later (Zotero 10 to edit annotations from Obsidian). Desktop only: Windows, macOS, Linux. | `manifest.json`, `install-zotlit.mdx` |
| Companion | Optional. Not needed to browse, search, read, take notes, cite or export. Needed for Zotero menus, batch from a collection, the note-status column, live updates. | `install-companion.mdx` |
| Better BibTeX | Recommended for stable citation keys, not required. | `insert-citations.mdx` |
| Privacy | Reads the Zotero database on the computer, read-only. No account, no ZotLit server. | README "Disclosures" |
| Licence | AGPL-3.0-or-later. | `LICENSE` |
| GitHub stars | 1,047. | `gh api repos/aidenlx/zotlit` |
| Release state | Stable is 2.1.4. 2.2 is in beta (latest tag 2.2.0-beta.4; beta.5 has a changelog, no tag). The page is drawn for 2.2's release day. | `gh release list`, `apps/obsidian/package.json` |

## Why this order

The reader is an academic, not a developer. They judge a tool by the work it lets them
finish. So the page follows the order in which a researcher meets the features, the same
order the docs tutorials use (`tutorial/first-note` → `write-and-export-cited-note`):

```
 Bring your library → Find a paper → Read and annotate → Take literature notes
        → Cite while you write → See how your sources connect → Export and submit
                                                  └→ Make it yours (optional, power users)
```

"Integrated" is shown, not claimed: the same mock papers recur in every step. The paper the
reader finds is the one they read, quote, cite, see in the graph and export.

Each job has one **lead** feature with a full demo. The other features of that job sit in a
quiet list under it. That way all 40 features are on the page and the page stays clean.

The user's three tiers cut across the jobs:

- **Signature (the showpieces):** Citations in Live Preview, Citation Popover, Citations in
  the graph view.
- **Daily (practical):** References Sidebar, Library View, Query files and blocks, PDF
  reader, and most basics.
- **Advanced (power users):** Template Workbench, Literature note profiles, Template Data
  Explorer, AI assistant skills, ZotLit Query CLI (experimental), Your own Pandoc.

## The features, by job

Badge rule: "2.0" features are the basics and carry no badge; others show "Since 2.1" or
"New in 2.2". Work on `main` after 2.2.0-beta.4 is counted as 2.2.

### 1. Bring your library
| Feature | Since | Lead |
| --- | --- | --- |
| Reads Zotero directly (no add-on, Zotero may be closed) | 2.0 | ● |
| Group libraries (one search across all libraries) | 2.1 | |
| Zotero 9 and 10 | 2.1 | |
| Guided setup (Welcome banner: connect, choose folder, open library) | 2.2 | |
| ZotLit Companion for Zotero (optional add-on: menus, batch, status column, Open PDF in Obsidian) | 2.0 | |
| Chinese titles and interface (segmenter, Language Pack) | 2.2 | |

### 2. Find a paper
| Feature | Since | Lead |
| --- | --- | --- |
| Library View (collection tree, Unread / Annotated / Has note / PDF, search, tags) | 2.2 | ● |
| Reading Card (title-page view with your annotations) | 2.2 | |
| Recent ("read 2 h ago in Obsidian") | 2.2 | |
| Quick switcher (title, author, year, citation key) | 2.0 | |
| Show in Library (from citations, references, graph nodes) | 2.2 | |

### 3. Read and annotate
| Feature | Since | Lead |
| --- | --- | --- |
| PDF reader (Zotero PDFs in Obsidian, highlights in Zotero colours) | 2.2 | ● |
| Annotate in Obsidian (Highlight, Underline, Add note, Add text, Select area, Draw; saves to Zotero) | 2.2 | |
| Annotation view (filter, recolour many, drag into a note) | 2.0 | |
| Figures and drawings (excerpt images) | 2.2 | |
| Annotation Popover | 2.2 | |

### 4. Take literature notes
| Feature | Since | Lead |
| --- | --- | --- |
| Literature notes (one keystroke) | 2.0 | ● |
| Drag a highlight into a note (quote, page, citation) | 2.0 | |
| Annotations that stay current (live query block) | 2.2 | |
| Your writing is kept (update details, keep your text) | 2.0 | |
| A whole collection at once (batch with preview) | 2.0 | |
| Import Zotero notes | 2.0 | |
| Reading status (to-read / reading / read, edit in a table) | 2.2 | |

### 5. Cite while you write
| Feature | Since | Lead |
| --- | --- | --- |
| Citations in Live Preview (signature) | 2.1 | ● |
| Citation Popover (signature) | 2.1 | |
| Citation Suggester (`[@`) | 2.0 | |
| Any citation style (styles installed in Zotero, per note) | 2.1 | |
| Links count as citations (wikilink citations) | 2.1 | |

### 6. See how your sources connect
| Feature | Since | Lead |
| --- | --- | --- |
| References Sidebar | 2.1 | ● |
| Cited By Sidebar | 2.1 | |
| Citations in the graph view (signature; faint Cited Work Nodes) | 2.2 | |
| Query files and blocks (Table / Cards / List / Annotations) | 2.2 | |

### 7. Export and submit
| Feature | Since | Lead |
| --- | --- | --- |
| Export with citations (Word document or HTML) | 2.1 | ● |
| Copy bibliography | 2.1 | |
| Your own Pandoc (integration files) | 2.1 | |

### 8. Make it yours
| Feature | Since | Lead |
| --- | --- | --- |
| Template Workbench (fields, editor, live preview) | 2.2 | ● |
| Literature note profiles (Profile Match picks one per paper) | 2.2 | |
| Template Data Explorer | 2.0 | |
| AI assistant skills (Claude Code, Codex, pi) | 2.2 | |
| ZotLit Query CLI (experimental) | 2.2 | |

## Left off the page on purpose

- Annotation Suggester (`[>`): behind a build flag, held back from 2.2.0.
- Web Workbench at `/workbench`: disabled in this release.
- Settings internals (read mode, device override, approved folders), protocol links, theme
  hooks, LaTeX citation filters, migration guides: real, but they belong in the docs, not
  on a first page for academics.
