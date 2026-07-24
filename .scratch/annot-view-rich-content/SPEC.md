# Annotation Card rich content: rich-text excerpts and Markdown comments

Status: ready-for-agent

## Problem Statement

In the annotation view, an Annotation Card flattens what the user actually wrote in Zotero. The Excerpt Block drops Zotero's inline rich-text formatting (italic, bold, subscript, superscript survive in the Zotero reader but render as plain text in the card — chemistry formulas, species names, and math exponents all degrade). The comment is worse: it renders as raw pre-wrapped HTML, so any Markdown the user typed in a Zotero comment — `**emphasis**`, `[[wikilinks]]`, lists, math — shows as literal syntax, and none of it is clickable. The card also disagrees with what lands in the vault: the annotation Template converts the same comment to Markdown, so the sidebar preview and the Literature Note show two different renderings of the same annotation.

## Solution

The Annotation Card renders both fields faithfully and compactly. The Excerpt Block shows the annotation's live text with Zotero's inline formatting intact. The comment renders as Markdown — same dialect the annotation Template produces — with Obsidian's native markdown styling, live internal/external links, and prose typography tightened to fit the card's dense layout. What you see in the card is what your notes will contain.

## User Stories

1. As a Zotero user highlighting scientific text, I want subscripts and superscripts in my excerpt (H₂O, x²) to render properly in the Annotation Card, so that formulas remain readable outside the Zotero reader.
2. As a Zotero user, I want bold and italic formatting in my excerpt to survive into the Annotation Card, so that emphasis and species names look as they do in the source.
3. As a note-taker who writes Markdown in Zotero comments, I want the comment rendered as Markdown in the Annotation Card, so that my emphasis, lists, and code render instead of showing literal syntax.
4. As a note-taker, I want the card's comment rendering to match what the annotation Template inserts into my Literature Note, so that the sidebar is a truthful preview of my notes.
5. As a vault user, I want `[[wikilinks]]` typed in a Zotero comment to be clickable in the Annotation Card, so that I can jump to the linked note directly from the sidebar.
6. As a vault user, I want links in a comment to resolve relative to the annotation's Literature Note, so that relative links behave the same in the card as in the note itself.
7. As a vault user, I want modifier-clicks on internal links to behave like they do everywhere in Obsidian (new tab, etc.), so that link navigation feels native.
8. As a reader, I want external links in comments clickable and styled like Obsidian links, so that references open in my browser as expected.
9. As a user who types `#tag` in Zotero comments as ordinary prose, I want it to stay plain text in the card, so that stray hashes don't turn into misleading tag pills.
10. As a user with math in comments, I want `$…$` to render, so that formulas display instead of raw TeX.
11. As a sidebar user, I want the rendered comment to stay visually secondary (muted, small), so that the excerpt remains the visual lead of the card.
12. As a sidebar user, I want prose inside the card compact — tight paragraph, heading, and list spacing — so that markdown comments don't balloon the card in a narrow dock.
13. As a sidebar user, I want a comment with headings, lists, tables, and code blocks to stay contained in the card (horizontal scroll for wide tables, no bleed outside the card edges), so that one rich comment doesn't break the list layout.
14. As a theme user, I want the rendered comment to pick up my theme's markdown styling (links, code, callouts) and both light and dark schemes, so that the card looks at home in my setup.
15. As a user collapsing the view, I want collapse to keep clamping the excerpt to three lines while never clamping the comment, so that existing behavior is preserved.
16. As a user of image/ink annotations, I want image excerpts unchanged (height-capped when collapsed), so that nothing regresses for area annotations.
17. As a user selecting text, I want both the excerpt and rendered comment selectable, so that I can copy fragments out of the card.
18. As a user dragging an annotation into the editor, I want the drag payload still produced by the annotation Template from raw data, so that rendering changes never alter what gets inserted.
19. As a user of the card's copy action, I want it to keep copying the raw annotation text, so that copy behavior is unaffected by rich rendering.
20. As a user with plain-text-only annotations, I want cards without any formatting or comment to look exactly as they do today, so that the common case stays untouched.
21. As a user with an empty comment, I want no comment block rendered at all, so that cards stay minimal.
22. As a user whose comment contains an embed (`![[Note]]`), I want default Obsidian embed behavior, so that nothing surprising is invented for a rare case.
23. As a user scrolling a long annotation list, I want comment rendering to not visibly jank the list, so that the view stays responsive.
24. As a maintainer, I want the excerpt sanitized through Obsidian's own sanitizer, so that untrusted DB HTML can never inject markup into the plugin UI.
25. As a maintainer, I want the annotation text field documented as possibly carrying Zotero rich-text inline tags, so that future code treats it correctly.

## Implementation Decisions

- **Excerpt Block** (glossary term: the live quoted region of an Annotation Card, distinct from the frozen Annotation Excerpt in a Child Note): render `text` through the existing sanitized-HTML hook (Obsidian's `sanitizeHTMLToDom`) inside the existing blockquote — no custom allowlist. Verified against Zotero reader source: highlight/underline text uses the rich-text editor with `supportedFormats = ['i','b','sub','sup']`, so those inline tags are real data. Selectability, three-line clamp when collapsed, and the blockquote's color border are unchanged. The db layer's JSDoc for the annotation `text` field is updated to document the possible inline tags.
- **Comment pipeline**: comment HTML → Markdown via the existing `commentToMarkdown` Turndown seam (template-dialect parity is the point — the card previews what notes will contain) → `MarkdownRenderer.render()`. This is the plugin's first MarkdownRenderer integration; it lives local to the annotation view and is promoted to a shared module only when a second consumer appears.
- **Render container**: carries Obsidian's `markdown-rendered` class plus a plugin-scoped class. Obsidian's unlayered `.markdown-rendered` rules deliberately beat the scoped Tailwind preflight and `zt:` utilities — that is the mechanism by which prose styling "overrides the preflight". Theme markdown styling comes free.
- **Component lifecycle**: rendering binds to an Obsidian `Component` tied to the view's lifecycle. `sourcePath` is the parent item's Literature Note path resolved through the Note Index, falling back to vault root when no Literature Note exists.
- **Link interactivity**: internal links wired to Obsidian's link-open API with standard modifier-key handling; external links default anchor behavior. No hover-preview wiring.
- **Tag neutralization**: a pure DOM post-processor runs on the rendered container and unwraps tag anchors into plain text (MarkdownRenderer auto-linkifies `#tag`; the card must not). This post-processor is the single new functional-core seam and the home for any future post-render fixups.
- **Typography identity**: the comment stays secondary — muted foreground, small UI font, current padding. The container inherits the UI font (MarkdownRenderer output sets no font of its own), so all em/ch-based markdown sizes scale off the card's small base size automatically.
- **Compaction**: card-scoped, unlayered CSS in the view stylesheet overriding Obsidian's markdown variables — paragraph spacing, heading spacing, list spacing/indent — plus targeted overrides established by a full audit of Obsidian's stylesheet: the bare `hr` rule's hard-coded 2rem block margin; the hard-coded `3ch` top-level list-item indent; negative-offset bleed from list bullets, collapse indicators, and task-list checkboxes (contained by container padding or explicit resets); horizontal overflow scrolling on the comment container for tables (cells have a 6ch min-width and would otherwise overflow the card); task-checkbox alignment rules that Obsidian scopes to reading view and therefore don't apply here.
- **Known blind spots, accepted**: `sub`/`sup` have no Obsidian rules at all, so the scoped preflight governs them (consistent between excerpt and comment, and arguably better than reading view). Top-level `ul` bullet markers may be stripped by the preflight (no unlayered rule restores them; nested lists and ordered lists are safe) — verified at runtime first, restored with one card-scoped `list-style-type` rule if needed.
- **Collapsed semantics unchanged**: collapse clamps the excerpt only; the comment is never clamped. The comment's `whitespace-pre-wrap` styling is removed — the Markdown pipeline owns line breaks (literal newlines become hard breaks during conversion).
- **Rationale capture**: the double-conversion pipeline (HTML→MD→render) gets a module-level comment explaining template parity; the decision is cheaply reversible so no ADR.

## Testing Decisions

- Good tests assert external behavior at seams — data in, data/DOM out — never implementation details; imperative shell (render hook, link clicks, CSS) is excluded per the ui-seams policy and verified at runtime instead.
- **One new tested seam**: the comment DOM post-processor — given a container with rendered markdown children, assert tag anchors are unwrapped to plain text and everything else is untouched. Runs under happy-dom via the per-file environment pragma.
- **Existing seams reused, not re-specified**: `commentToMarkdown` already has its own tests (supported inline tags, sub/sup passthrough, newline promotion); no changes expected there.
- Prior art: the turndown comment tests (happy-dom pragma, tiny pure-function assertions) and the annotation view's colocated data-level tests (filter, resolve-target).
- Runtime verification via the obsidian-debug loop: build → reload → screenshot for a fixture set covering rich-text excerpt, markdown comment (headings/lists/table/code/math/links/tags), collapsed/expanded, and the cross-theme checklist (light/dark, accent, a community theme). Top-level `ul` marker survival is explicitly checked here.

## Out of Scope

- Tag-click wiring to global search (tags render as plain text; revisit on demand).
- Hover preview on internal links.
- Embed neutralization or any special embed handling (default behavior stands).
- Clamping or collapsing the comment; any per-card collapse state or new density mode.
- A shared/general Markdown component (local until a second consumer exists).
- Changes to drag-insert or copy payloads (both read raw data, verified unaffected).
- Excerpt-side Markdown conversion (excerpt is sanitized HTML only).
- Styling changes to tags, page label, header row, or anything outside the Excerpt Block and comment.

## Further Notes

- Glossary: **Annotation Card** and **Excerpt Block** are defined in the Obsidian context's CONTEXT.md, cross-referenced against the pre-existing **Annotation Excerpt** (frozen Child-Note snapshot) to resolve the term collision.
- The obsidian-css skill's scoped-preflight caveat was corrected during this design session (the set of unlayered bare-element rules is much larger than previously documented — includes `a`, `b`/`strong`, `i`/`em`, `kbd`, nested `ul`, `li`, and others); the compaction decisions above are based on that verified audit.
- Comments are sparse across annotations, so per-card MarkdownRenderer cost is expected to be negligible; no virtualization work is planned.
