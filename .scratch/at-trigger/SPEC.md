# Spec: At Trigger for the Citation Suggester

Status: ready-for-agent
Source: https://github.com/aidenlx/zotlit/issues/114

## Problem Statement

Inserting a citation while writing requires typing `[@` to summon the Citation Suggester. Users coming from Notion-style mention UIs (and from the issue's demo) expect a bare `@` to open the dropdown; typing the bracket first for every citation is friction on the most frequent operation of the citation workflow. Additionally, in the inline suggester Shift+Enter inserts a newline instead of the secondary citation format, even though the command-palette modal already supports Shift+Enter for secondary — the two entry points behave inconsistently.

## Solution

An opt-in **At Trigger** for the Citation Suggester: with the new toggle enabled, typing a bare ASCII `@` at a word boundary opens the suggester immediately, exactly as `[@` does today. Because the at-query has no closing delimiter, it ends at the first space; an underscore in the query stands for a space in the search, so multi-word fuzzy queries remain possible (`@machine_learning`). Selecting a suggestion replaces the typed trigger text with the rendered Citation — primary format by default, secondary via a trailing `/` in the query or Shift+Enter. Shift+Enter-for-secondary works for both trigger styles, closing the inconsistency with the modal. The toggle defaults to off; the Bracket Trigger's behavior is unchanged.

## User Stories

1. As a note-writing user, I want the Citation Suggester to open when I type `@`, so that I can cite without typing a bracket first.
2. As a user who has not opted in, I want typing `@` to do nothing special, so that my existing writing flow is undisturbed by default.
3. As a user who opted in, I want the dropdown to appear immediately on `@` with an empty query, so that the trigger feels instant rather than broken.
4. As a user typing an email address or handle (`user@example.com`), I want a mid-word `@` to never open the suggester, so that the popup doesn't interrupt ordinary prose.
5. As a user writing a parenthetical citation, I want `(@` to open the suggester, so that citing inside parentheses works naturally.
6. As a user searching by title, I want an underscore in the at-query to act as a space in the search (`@machine_learning`), so that multi-word fuzzy search works despite the query ending at the first space.
7. As a user who typed `@` incidentally, I want typing a space or pressing Escape to close the popup, so that I can continue writing prose without fighting the suggester.
8. As a user selecting from the at-triggered dropdown, I want the rendered primary Citation to replace everything from the `@` onward, so that no trigger residue is left in the note.
9. As a user wanting a narrative cite, I want a trailing `/` in the at-query to insert the secondary format, so that the convention I learned from the Bracket Trigger carries over.
10. As a user wanting a narrative cite, I want Shift+Enter on the highlighted suggestion to insert the secondary format, so that I don't have to reach for the `/` convention.
11. As a Bracket Trigger user, I want Shift+Enter-for-secondary to work in the inline suggester too, so that the inline path and the command-palette modal behave consistently.
12. As a Bracket Trigger user, I want `[@` (and `【@`) to keep working exactly as before — spaces allowed in the query, closing bracket consumed on insert — so that opting into the At Trigger changes nothing I rely on.
13. As a user reading the suggester's instruction row, I want it to list both secondary-format gestures (`/` and Shift+Enter), so that the feature is discoverable in place.
14. As a user configuring the plugin, I want an "At Trigger"-style toggle in the citation settings, visible only while the Citation Suggester toggle is on, so that I'm not shown a dead control for a disabled feature.
15. As a user reading that toggle's description, I want the underscore-for-space convention stated there, so that I learn the query syntax without leaving the settings pane.
16. As a user with "Show citekey in suggestions" enabled, I want at-triggered suggestions rendered identically to bracket-triggered ones, so that the two triggers share one look.
17. As an existing user upgrading the plugin, I want my stored settings to load with the new toggle defaulting to off, so that the upgrade requires no action.
18. As a docs reader, I want the how-to page on inserting citations to document the `@` trigger and its underscore convention, so that I can learn the feature outside the app.
19. As a docs reader, I want the settings reference and commands reference to reflect the new toggle and trigger, so that the reference material stays complete.
20. As a CJK-input user, I want the At Trigger to fire only on ASCII `@`, so that the trigger's behavior is predictable (full-width `＠` is not a trigger).
21. As a user selecting an item that has no citekey, I want the same notice the Bracket Trigger shows today, so that failure behavior is consistent across triggers.

## Implementation Decisions

- **Setting**: new flat boolean key `citation.at-trigger`, schema default `false`. Effective only while `citation.editor-suggester` is on. No settings migration — the schema default covers previously stored configs.
- **Settings UI**: a declarative toggle in the citation group, conditionally visible while `citation.editor-suggester` is enabled. Its description documents the underscore-for-space convention. All copy through Paraglide, worded via the i18n-ui-text conventions.
- **Trigger precedence**: the Bracket Trigger is matched first; the At Trigger is consulted only when the bracket pattern doesn't match. When the char before `@` is an opening bracket, the bracket path wins deterministically.
- **At Trigger match rules** (all settled in the grilling session):
  - Fires on ASCII `@` only.
  - Left boundary: the `@` must be at line start or preceded by whitespace or one of a closed set of opening brackets/quotes — `(` `[` `{` `（` `【` `「` `"` `'`. Never mid-word.
  - Query charset: everything up to whitespace or a closing bracket (`]`/`】`); punctuation such as `.` `,` `/` `_` stays in the query.
  - Empty query fires (the popup opens immediately on `@`).
  - Underscores in the query are converted to spaces before the fuzzy search — At Trigger only; the Bracket Trigger query is untouched.
  - A trailing `/` is stripped and selects the secondary format, same as the bracket path.
- **Insertion**: identical to the bracket path — the rendered Citation (primary `cite` template by default, `cite2` when secondary) replaces from the trigger's start through the cursor. Adjacent-closing-bracket consumption remains a Bracket-Trigger-only behavior; the At Trigger never eats a following `]`.
- **Inline citation output** (settled in the 2026-07-24 follow-up grilling): cite-template output is normalized to inline form everywhere it renders — inline suggester, insert modal, `zt.citation` in annotation templates, Copy citation, and note-import citation resolution. Normalization trims the ends and collapses every whitespace run containing a line break to a single space; runs of plain spaces inside the output stay as authored. Lives in one shared `inlineCitation` helper.
- **Trailing space on insert** (same session): every editor insert — inline suggester (both triggers, both formats) and the insert modal — writes the Citation plus exactly one trailing space in a single atomic edit, with the cursor after the space. A literal space already at the insert position is reused instead of doubled. The space keeps the inserted Citation from re-matching a trigger (an alternate-format `@key` at a word boundary would otherwise re-open the At-Trigger suggester). Copy citation stays unpadded — clipboard text is the bare Citation.
- **Shift+Enter**: registered on the inline suggester's key scope; secondary is derived as (trailing-`/` in query) OR (Shift held on selection), for both trigger styles. The derivation stays in the imperative shell, mirroring how the command-palette modal already reads the modifier. The modal is untouched.
- **Escape**: default EditorSuggest dismiss behavior is accepted; no suppress-until-context-exit state. The no-space query rule means a space also naturally closes the popup.
- **Seam (Option A from the seam review)**: all trigger decisions move into one new pure exported trigger-resolution function — input: line text around the cursor plus the at-trigger enabled flag; output: `{ start, end, query, secondary } | null`. The `onTrigger` shell shrinks to reading settings, calling it, and mapping the result to Obsidian's trigger info. The existing pure `resolveCitationInsert` seam is reused unchanged.
- **Vocabulary**: the Obsidian-plugin glossary now defines **Citation Suggester**, **Bracket Trigger**, and **At Trigger**; code, settings copy, and docs use these terms.
- **Docs** (authored via the docs-writer flow): three touchpoints — the insert-citations how-to ("Insert while typing" gains the `@` trigger and underscore convention; "Suggester settings" gains the toggle), the settings reference Hub table (new row), and the commands reference wording that currently names only `[@`.

## Testing Decisions

- Good tests here assert **data in, data out** on the pure decision core (the repo's ui-seams policy): plain strings and flags in, trigger-info objects or `null` out. No Obsidian mock expansion, no editor simulation, no assertions on internal steps.
- **Module under test**: the new pure trigger-resolution function. Cases to pin: bracket-over-at precedence (`[@`, `【@`); each boundary character fires and each word character before `@` doesn't (email case); underscore→space conversion applied to the at-query and not the bracket query; trailing `/` stripped and flagged secondary for both triggers; empty at-query fires; full-width `＠` does not fire; at-trigger flag off yields the bracket-only behavior byte-for-byte; closing-bracket end-extension for bracket matches only.
- **Existing tests preserved**: the `resolveCitationInsert` unit tests in the citation-suggest view module are the prior art for style and continue to pass unchanged — that seam's contract does not move.
- **Inline-output and trailing-space seams**: `inlineCitation` is pinned directly (trim, line-break collapse, plain-space runs preserved) and through `renderCitation` (default template with a trailing newline; a multi-line Eta template) and `renderAnnotationCitation` (newline never reaches the clipboard). `padCitationInsert` is pinned on: space appended with cursor after it, appended before a non-space character, existing space reused, and the padded alternate format no longer matching the At Trigger.

## Out of Scope

- Full-width `＠` as an At Trigger character (rejected in the grilling session).
- Underscore-for-space in the Bracket Trigger query.
- Suppress-until-context-exit Escape behavior (revisit only if the default annoys in practice).
- Any change to the command-palette insert modal.
- Citation template customizability and issue #117 (raised by commenters; separate efforts).
- The release changelog entry (authored at release time via the changelog flow).

## Further Notes

- Design settled in a batch-grilling session on 2026-07-24 (rounds recorded in the conversation; every decision above was explicitly confirmed, none assumed).
- Glossary entries for Citation Suggester / Bracket Trigger / At Trigger were added to the Obsidian plugin context's `CONTEXT.md` during the session.
- The feature is deliberately opt-in and quiet-by-default: the only behavior change for a user who does nothing is none.
