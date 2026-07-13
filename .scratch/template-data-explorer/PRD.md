# Template Data Explorer

Status: ready-for-agent

## Problem Statement

Template authors writing Liquid (or Eta) templates have no way to see what data their templates actually receive. They guess field names from documentation, render a note to find out a path was wrong, and iterate blind. v1 had a "Zotero Item Details" JSON tree, but it was welded to the dead template-render-preview feature, showed the v1 helper object rather than a clean contract, and its hardcoded Solarized theming fought Obsidian themes. v2 has no equivalent: there is currently no way to answer "what can I type after `zt.` and what will it hold for a real item?"

## Solution

A **Template Data Explorer**: a sidebar view that displays, for any real Item from the user's Zotero library, the exact template data (`zt`) a Template receives — as an interactive tree anchored at the **Note Root** (what `note`/`content` templates get) or re-anchored at an **Annotation Root** (what the `annotation` template gets). Every node offers a shared copy-path (`zt.…`, valid member-access in both engines), copy-value, and per-engine Template Snippets — paste-ready output/if-present/loop/joined fragments in the engine's own syntax (Liquid always; Eta while JavaScript Templates is enabled). A filter box matches key names and values. The tree auto-refreshes when the Zotero database changes. Everything displayed is true at display time, and browsing never writes to the vault: the context is built through inert resolvers, so link helpers that would normally queue attachment copies or note imports display honestly without queueing anything. Entry points: a palette command (seeded from the active literature note), a literature-note menu action, a per-annotation action in the annotation sidebar view, and — from Zotero — item and reader-annotation context-menu entries via a new `explore` protocol action.

Rendered template output (preview) is explicitly not part of this feature.

## User Stories

1. As a template author, I want to browse the exact data object my `note` template receives for a real item from my library, so that I know which fields exist without guessing from documentation.
2. As a template author, I want the explorer to show only the template data contract (not raw database rows), so that every field I see is guaranteed usable in a template.
3. As a template author, I want to pick any library item via the existing fuzzy item search, so that I can explore the exact item I am writing a template against.
4. As a template author, I want the explorer to seed from the active literature note's item when first opened, so that the common case needs no picker at all.
5. As a template author, I want the explorer to live in the sidebar beside my template editor, so that I can reference it while typing.
6. As a template author, I want to copy a node's Liquid data path (e.g. `zt.annotations[0].comment`), so that I can paste it directly into an interpolation or a `{% for %}` tag.
7. As a template author, I want each node to also offer paste-ready snippets — an interpolation, a truthiness guard, and (for arrays) a loop or comma-join — in my template language, so that I can drop a working fragment in without hand-writing the delimiters.
8. As a template author with JavaScript Templates enabled, I want those snippets offered for both Liquid and Eta in labeled submenus (Liquid alone, inline, while it is off), so that the UI never advertises the gated engine yet gives me each engine's exact syntax when both apply.
9. As a template author, I want to copy a node's current value, so that I can debug why my template prints `null` or unexpected text.
10. As a template author, I want a filter box matching key names by case-insensitive substring, so that I can find `pageLabel` without expanding forty annotations.
11. As a template author, I want the same filter to match primitive values, so that I can go from "I see this text in Zotero" to the field that holds it.
12. As a template author, I want filter matches displayed with their ancestor chain auto-expanded and everything else collapsed away, so that each match shows its full path.
13. As a template author, I want an action on any annotation node to re-anchor the tree at that annotation, so that I see exactly the shape my `annotation` template receives at its root.
14. As a template author, I want copy paths from an Annotation Root rooted at the annotation itself (`zt.comment`, not `zt.annotations[3].comment`), so that pasted paths are correct for the `annotation` template.
15. As a template author, I want a breadcrumb/back control from the Annotation Root, so that I can return to the Note Root.
16. As a template author, I want link helpers (`noteLink`, `fileLink`, `imageLink`) displayed with their evaluated zero-argument rendering plus a signature hint, so that I can see what a link produces and that the target resolves.
17. As a template author, I want lazy parent getters (`parentItem`, `parentAttachment`) resolved when I expand them, so that the annotation shape is fully explorable.
18. As a plugin user, I want browsing the explorer to never write to my vault, so that inspecting data queues no attachment copies and no note imports.
19. As a template author, I want not-yet-imported child notes and excerpt images shown as clearly labeled placeholders (e.g. "not imported"), so that the display never fabricates a path that doesn't exist yet.
20. As a template author, I want the tree to refresh automatically when the Zotero database changes, so that an edit made in Zotero shows up without re-picking the item.
21. As a template author, I want tree expansion preserved across refreshes, so that a background update doesn't collapse my exploration mid-thought.
22. As a template author, I want the explored item and annotation anchor restored with the workspace, so that my authoring setup survives an Obsidian restart.
23. As a plugin user, I want an "Open template data explorer" palette command that reveals the existing leaf or creates one in the right sidebar, so that opening it is one action.
24. As a plugin user viewing a literature note, I want a menu action to explore that note's item data, so that I can jump straight from the note to its data.
25. As a plugin user in the annotation sidebar view, I want a per-annotation action to explore that annotation's template data, so that I can inspect the exact highlight I'm looking at.
26. As a Zotero user, I want an item context-menu entry that opens the explorer for that item in Obsidian, so that I can start exploring from where my data lives.
27. As a Zotero user, I want a reader-annotation context-menu entry that opens the explorer anchored at that annotation, so that a specific highlight is one click away.
28. As a script author, I want the `explore` protocol URL to work when crafted by hand, so that external tooling can deep-link into the explorer.
29. As a template author, I want an explicit "item no longer in library" state when the explored item disappears after a refresh, so that I'm never staring at silently stale data.
30. As a template author, I want the annotation anchor to fall back to the Note Root when the anchored annotation vanishes, so that the view degrades gracefully.
31. As a plugin user, I want the explorer to show the standard database-not-ready treatment, so that its behavior is consistent with the annotation view.
32. As a plugin user, I want an invalid or unknown-item `explore` URL to produce a Notice and a logged warning, so that failures are visible and consistent with existing protocol handlers.
33. As a plugin user, I want a fresh explorer with no item to show a single "Choose item" call to action, so that the empty state teaches the first step.
34. As a plugin user, I want the standard refresh action in the view menu, so that I can force a database refresh like the annotation view allows.
35. As a theme user, I want the tree styled with Obsidian's native tokens, so that it reads correctly in any theme, light or dark.
36. As a non-English user, I want every explorer string localized (plugin strings via Paraglide, companion strings via Fluent), so that the feature matches the rest of the product.

## Implementation Decisions

- **Contract-only display.** The explorer renders exactly the template data contract — the note-template context and `TemplateAnnotation` shapes from `@zotlit/db` — never raw rows or a second vocabulary. It doubles as living documentation of the `zt.*` contract.
- **Container previews via `toString`.** Items, attachments, and notes carry a non-enumerable `toString` in `@zotlit/db` (title / filename / title-or-key), matching the treatment creators, dates, and tags already had. This is a change to the shared template-data contract, not explorer-local: every consumer now sees a container stringify to a meaningful label (e.g. `{{ zt.parentItem }}` prints a title rather than a key). Adopted so the explorer's collapsed previews — and any template that stringifies a container — read honestly.
- **Two roots, cite excluded.** Note Root (default) and Annotation Root share one context fetch; the Annotation Root is a re-anchoring of a `TemplateAnnotation` already present in the note context. The cite root is excluded: its citation-scoped properties (locator, prefix/suffix) come from editor context that doesn't exist when picking an item, so displaying them would fabricate data.
- **Sidebar ItemView, annot-view conventions.** Per-instance zustand vanilla store + React context, a register module, right-sidebar default. View state persists the item reference and optional annotation anchor key. No follow-active-note mode: while authoring, the active file is the template, so an explicit picker (seeded from the active literature note on first open) is the honest selection model.
- **Inert resolvers (ADR 0005).** The context is assembled through the same resolver interfaces the note feature injects (`NoteResolvers`/`AnnotationResolvers`), implemented display-only. Side-effect-free helpers (`noteLink`, `fileLink`, `notePath`, lazy getters) evaluate for display. The two helpers that queue vault writes on first invocation — excerpt-image links (attachment copy) and child-note links (import with path minting) — resolve to their existing targets when already imported and to labeled inert placeholders otherwise. Nothing is ever minted or queued.
- **Pure display-tree module.** One pure module maps (context, anchor, filter, expansion state) to typed display nodes — kinds: plain value, evaluated helper (with signature hint), inert placeholder — including copy-path string generation and filter-driven ancestor expansion. The React layer renders nodes and dispatches actions; all behavior lives in the pure module.
- **One shared copy-path, per-engine snippets (ADR 0008).** Both engines bind data to `zt`, so a single `zt.…` copy-path serves both — there is no `it` variant. Because the bare path is not a complete pasteable fragment, each node also offers Template Snippets wrapped in one engine's delimiters, generated per engine where the languages diverge (notably a helper interpolates as `{{ zt.fileLink }}` in Liquid vs `<%= zt.fileLink() %>` in Eta). Snippet generation is its own pure `(node, engine, kind) → string` module, unit-tested independently; the menu shows Liquid inline while Eta is gated off and Liquid/Eta submenus once both apply.
- **Copy affordances.** Copy value is a one-click hover/focus button on each row (checkmark flash on success; primitives verbatim, objects/arrays as JSON) — the common debugging action, so it costs one click, not a menu trip. Copy path lives in a per-row template-actions menu button as a bare dot-path (array indices included; rooted at `zt` for Liquid). With JavaScript Templates enabled on the device, that menu lists both "Copy Liquid path (`zt.…`)" and "Copy Eta path (`it.…`)" explicitly; with it off, only the Liquid copy exists. The same menu carries the explore-as-annotation-root action when the node is a top-level annotation entry. No pre-wrapped `{{ … }}` variant, no insert-into-editor.
- **Filter.** One box; case-insensitive substring over key names and stringified primitive values; matches highlighted with ancestors auto-expanded. The filter is scoped to the active root: every root change — re-anchoring at an annotation, the breadcrumb back, or the vanished-anchor fallback — clears the query and its transient collapse overrides, so anchoring always lands on the full, unfiltered shape. No regex, fuzzy modes, or match-count chrome.
- **Freshness.** Subscribe to the database service's `changed` event; refetch the current item's context; expansion state keys on data paths so it survives refetch. The standard view-menu refresh action delegates to the database refresh. Vanished item → explicit empty state; vanished annotation anchor → silent fallback to Note Root, clearing any active filter.
- **Hand-rolled tree, no react-json-tree.** Recursive React component rendering only expanded nodes (no virtualization needed); Obsidian `Menu` for node context actions; Tailwind + Obsidian native tokens per the plugin's styling conventions.
- **Value rendering fidelity.** Beyond the node kinds, the tree styles values for readability: each primitive type in a distinct Obsidian-token tone (with `null` set apart from strings); Markdown links, bare URLs, and hex colors render as anchors and swatches rather than raw text; long strings (over ~140 chars or multi-line) collapse to a one-line preview with a `more`/`less` toggle, so one long field can't push its siblings off-screen; object keys sort alphabetically for predictable `zt.*` reading while arrays keep insertion order; and a container carrying its own `toString` shows that string as its collapsed preview instead of a bare entry count. Rows top-align key and value so a wrapping value can't detach from its label. The link/long-text resolution is recorded in `bug-report-imglink-filelink-display.md`.
- **One shared open function** taking an item reference plus optional annotation key, used by every entry point: palette command, literature-note menu action, annot-view per-annotation action, and the protocol handler.
- **Protocol action `explore`.** Added to the protocol package alongside the existing actions (item parameter plus optional annotation parameter, same validation/source-id conventions). The Obsidian plugin registers the handler; the Zotero companion adds menu entries to its existing item and reader-annotation menus that send the URL. Full round trip ships with this feature.
- **Naming.** Glossary: Template Data Explorer, Note Root, Annotation Root (added to the Obsidian context glossary). UI strings in Obsidian sentence case: view title "Template data explorer", command "Open template data explorer".
- **Edge states.** No item → "Choose item" call to action; database not ready → standard annot-view treatment; unknown item via protocol → Notice + logged warning; JavaScript Templates flag affects only the copy menu, never the tree.
- **i18n.** Plugin strings via Paraglide; companion strings via Fluent.

## Testing Decisions

Good tests exercise external behavior at seams — display-node output for a given context and UI state, resolver contract guarantees, URL codec round-trips — never React internals or DOM structure.

- **Inert resolver tests** (existing seam: the resolver interfaces consumed by the context fetch). Build the context with inert resolvers over the existing test-fixture schema; assert evaluated values are correct and, behaviorally, that no import work is ever queued (injected fakes record zero import/queue calls). Prior art: the `zt-template-*` context tests in the db package and the note-feature operations tests with injected fakes.
- **Display-tree module tests** (the display seam). Cover node kinds, the shared `zt.…` copy-path generation for both roots, annotation re-anchoring, filter matching with ancestor auto-expansion, and expansion preservation across a context refetch. Prior art: the annot-view resolve-target module test — a pure module beside a thin view.
- **Snippet module tests** (the snippet seam). Cover each engine × kind × node kind: interpolation and its Liquid-auto-invoke/Eta-call divergence for helpers, the truthiness guard, array loop with element-variable singularization, and the join-stringifiability gate that drops `joined` for plain-object arrays.
- **Tree-state module tests** (the navigation-state seam). Cover the pure root/filter/expansion transitions: toggle routing between expansion and filter-collapse, filter enter/leave snapshot-and-restore, and the filter-clearing root changes in both directions including the vanished-anchor fallback. Same pure-module-beside-a-thin-view pattern.
- **Protocol codec tests** (existing seam). Encode/decode/validation for the `explore` action beside the existing URL tests in the protocol package.
- **Untested by design:** the React tree component, view registration, menu wiring, and companion menu items stay thin, consistent with how the annotation view is handled today.

## Out of Scope

- **Rendered template preview** — the v1 popout ensemble (template editor / rendered output / details) is dead; no rendering of template output anywhere in this feature.
- **Cite root** (`cite`/`cite2` data) — excluded until real citation-scoped context can back it.
- **General Zotero item inspector** — raw DB rows, sync debugging, anything outside the template contract.
- **Follow-active-note / follow-reader live modes** — explicit picker only.
- **Ribbon icon**, insert-into-editor, pre-wrapped `{{ … }}` copy, pinning subtrees, regex/fuzzy search.
- **react-json-tree** or any tree-rendering dependency.

## Further Notes

- v1 reference: the "Zotero Item Details" view (react-json-tree over the v1 helper object, popout-coupled). This feature is a greenfield replacement, not a port.
- The side-effect discovery that motivated the inert-resolver decision: annotation `imageLink` queues an attachment copy on first invocation, and child-note links queue an import with a minted, frozen path — naive eager evaluation would make *browsing* write to the vault. Recorded as ADR 0005.
- The `explore` action's companion-side menu entries are a deliberate exception to the earlier "companion work is post-alpha" scoping; the v2 companion's menu scaffolding already exists.
