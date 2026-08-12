# Obsidian Backlinks view: scoped parity for Cited By

Research for [#689](https://github.com/aidenlx/zotlit/issues/689). This note defines the
Backlinks-view behavior that the Cited By sidebar should reproduce. It does not prescribe an
exact port of Obsidian's Backlinks plugin.

## Scope and sources

The workspace compiles against `obsidian@1.13.1`. The matching extracted runtime was not
available, so this research uses the patch-compatible local extraction for **Obsidian 1.13.6**:

- `node_modules/.ob-rev-1.13.6/app.js` — runtime implementation and DOM construction.
- `node_modules/.ob-rev-1.13.6/app.css` — runtime stylesheet.
- Live Obsidian 1.13.6, vault `zt-vault-feat-cite-by`, inspected with `obsidian-cli` on
  2026-08-11. The target Literature Note had 39 linked mentions.
- The repository's retained stylesheet snapshot,
  [`prototype-references-sidebar/obsidian-app.css`](./prototype-references-sidebar/obsidian-app.css),
  corroborates the runtime CSS rules relevant to these components.

Patch versions can change internal class names and line numbers. The visible behavior and the
semantic Obsidian CSS variables are the intended reference.

## Observed structure

The live Backlinks leaf has the following relevant structure. This is a reference DOM, not a
required component hierarchy.

```text
.workspace-leaf-content[data-type="backlink"]
└─ .view-content
   ├─ .nav-header
   │  ├─ .nav-buttons-container
   │  │  ├─ .clickable-icon.nav-action-button   Collapse results (lucide-list)
   │  │  ├─ .clickable-icon.nav-action-button   Show more context (lucide-move-vertical)
   │  │  ├─ .clickable-icon.nav-action-button   Change sort order (lucide-sort-asc)
   │  │  └─ .clickable-icon.nav-action-button   Show search filter (lucide-search)
   │  └─ .search-input-container                hidden initially
   │     ├─ input[type="search"]
   │     └─ .search-input-clear-button
   └─ .backlink-pane
      ├─ .tree-item-self.is-clickable           Linked mentions + count
      ├─ .search-result-container
      │  └─ .search-results-children
      │     └─ .tree-item.search-result          one source file
      │        ├─ .search-result-file-title      file title + match count
      │        └─ .search-result-file-matches
      │           └─ .search-result-file-match.tappable
      │              ├─ span.search-result-file-matched-text
      │              ├─ .search-result-hover-button.mod-top
      │              └─ .search-result-hover-button.mod-bottom
      └─ …unlinked-mentions section
```

`Z3` creates this DOM at `app.js:156879-156975`. The real inspected leaf used exactly these
classes, including the hidden search container and the two section headers.

## Toolbar and search behavior

The toolbar is a compact native navigation header. It uses Obsidian icon controls, not custom
buttons. The header has `--size-4-2` padding, a wrapped icon row with `--size-2-1` gap, and an
active action uses `--icon-color-focused` plus `--background-modifier-hover`
(`app.css:9156-9175`; retained snapshot: `obsidian-app.css:9986-10005`).

The search field exists in the DOM but starts hidden. Selecting the search action shows it,
marks the icon `is-active`, and focuses the input. Hiding it clears the input and re-runs the
result query. Input changes use a 300 ms debounce and filter both Backlinks sections
(`app.js:157035-157095`). State, including whether the field is open and its query, is stored in
the workspace layout (`app.js:157015-157024`).

The live probe confirmed that a query left the field visible and restricted the displayed source
files and match lines. The Cited By view should use its own result data to implement filtering;
it does not need Obsidian's internal query parser.

## Results and surrounding context

Results are grouped by source file. A file title shows a count and can collapse its own match
list. A matched range is rendered with `.search-result-file-matched-text`; surrounding text is
in normal spans. A click on a source title or match navigates to that source, with the match
passed as editor state (`app.js:101061-101159`, `101347-101410`).

Each match starts as a compact logical excerpt. In the live probe, clicking the bottom chevron
expanded this excerpt:

```text
[[…locator=62]] found that respondent answers are inconsistent.
```

to include the next Markdown heading:

```text
[[…locator=62]] found that respondent answers are inconsistent.

## Citation Fragment — suppress-author mode
```

The top and bottom chevrons appear only while the pointer or keyboard focus is on the match and
there is content in the corresponding direction. Each click expands to the prior or next
logical Markdown chunk: list item including its descendants first, then a Markdown section, and
then a line fallback. Truncated ends display `…` (`app.js:101451-101617`). The global **Show
more context** action changes every match from its compact line to the logical-context variant
(`app.js:101112-101237`, `101722-101727`).

Shared Search CSS gives result cards their visual contract: compact UI type, muted container
text, `--search-result-background`, `--background-modifier-border`, matched-text highlight, and
hover selection (`app.css:16611-16704`; retained snapshot:
`obsidian-app.css:17720-17919`).

## Section and toolbar controls

The Backlinks-specific control set is:

| Control | Backlinks behavior | Cited By decision |
| --- | --- | --- |
| Collapse results | Collapses or expands every source-file group. | Include. |
| Show more context | Switches all match excerpts between compact and logical context. | Include. |
| Sort | A–Z/Z–A, newest/oldest modified, newest/oldest created. | Include. All six modes, default file name A–Z. The Citation Index keeps its vault-path order as the canonical base; the sidebar re-sorts for presentation. |
| Search filter | Default-hidden query input; clears its query when closed. | Include. |
| Linked section | Header, count, independent collapse. | Include the counts only, in the toolbar. Cited By holds one result section, so a section-level collapse duplicates the Collapse results action. |
| Unlinked mentions | Full-text basename/alias search plus a **Link** rewrite action. | Exclude. It is specific to ordinary Markdown links and writes files. |

Backlinks starts the linked section expanded and its unlinked section collapsed
(`app.js:156940-156975`). Its pane is the scroll container, with `--size-4-3` horizontal padding,
safe-area-aware bottom padding, and nav-heading tokens for section headers
(`app.css:14159-14202`; retained snapshot: `obsidian-app.css:15232-15280`).

## Scoped parity checklist

Implement these behaviors for Cited By:

- [ ] A native-looking toolbar with icon actions for collapse all, show more context, sort, and
  search. The row is plugin-owned: it reproduces the native header with utilities over Obsidian
  size tokens, so the DOM shape stays private, per the theme-hooks policy.
- [ ] A sort menu with the six Backlinks modes; file name A–Z is the default, and occurrences
  inside a group keep source-position order in every mode.
- [ ] Search is hidden by default; opening it focuses the field; closing it clears the active
  query and restores the unfiltered list.
- [ ] Query filtering applies to the Cited By source-file and occurrence data.
- [ ] The toolbar shows the note count and the citation count, and both follow the active
  filter. Cited By has no section-level collapse. In a narrow sidebar the counts take a row
  of their own at the end of it, below a centered icon row; where both fit on one line, the
  icons move to the start and the counts stay at the end.
- [ ] Results group occurrences by source file; each group shows the file name and occurrence
  count and can collapse independently.
- [ ] A compact match excerpt contains normal context and a semantic matched-range highlight.
- [ ] Clicking a file group or match opens the source at the occurrence.
- [ ] Hover or keyboard focus reveals contextual expansion controls before and after an excerpt
  when more source text is available.
- [ ] Each expansion reveals the adjacent logical block when the Cited By source model supplies
  one, otherwise the adjacent line; clipped excerpts show ellipses.
- [ ] The global context action expands all occurrences to their initial logical context.
- [ ] Empty and loading states use Obsidian semantic tokens and native Search result structure.

The following Backlinks features remain outside this scope: unlinked mention discovery, alias
matching, and the action that rewrites an unlinked mention into a Markdown link. These features
serve generic vault-link maintenance rather than citation occurrences.

## Styling guidance

Use the plugin's Tailwind-first `zt:` utilities and Obsidian semantic tokens. The Cited By root
should use `.zt-root`; native icon controls and input styling should remain native. Reproduce the
relationships above with the plugin's own `zt-` classes rather than selectors that target
Obsidian internals. See the local `obsidian-css` skill and its linked stylesheet sources for
token selection.
