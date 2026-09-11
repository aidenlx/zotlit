# Source-less Citation Popover — issue #1063

Design interview for [issue #1063](https://github.com/aidenlx/zotlit/issues/1063). All six decisions below were accepted during the interview and published to the issue at the user's request. The implementation extends the existing Citation Popover and Graph Citations services.

## Accepted scope

- Provide a source-less read for one work identified by an Indexed Key or Citation Key.
- Use the vault Citation Presentation: the Default Profile's Citation and References Style binding and the vault Citation Locale.
- In Graph Citations, use this read for Literature Notes and Cited Work Nodes when Hover Action is Citation Popover. Each graph work uses the vault presentation, independent of citing documents.
- Keep the existing Off and Page Preview behavior.
- Keep the References Sidebar and Cited By Sidebar behavior. Adding Citation Popover hover to either sidebar is separate work.

## Accepted presentation and identity decisions

- Show the bibliography body with the available Item actions. Omit Reference Numbers, Entry Markers, and Entry Serials.
- If the selected style has no bibliography entry or returns an empty entry body, show the Item summary and actions. Document-backed popovers retain their occurrence-specific note text.
- An Indexed Key identifies the exact Item for both display and actions, including an Item with no Citation Key or with a shared Citation Key.
- A Literature Note opens its exact Item's note. A Cited Work Node resolves its Citation Key and retains the missing or ambiguous result when applicable.

## Accepted failure and refresh decisions

- Keep the popover visible with a clear status and no Item actions when the Item cannot be read. Distinguish an unavailable database, pending Citation Key lookup, unresolved Citation Key, ambiguous Citation Key, and unavailable Item addressed by Indexed Key.
- A readable Item retains its summary and actions when formatting is unavailable or fails.
- Refresh an open Citation Key popover when resolution changes, including changes caused by Library Scope. Each displayed entry's actions target the exact Item shown.
- An Indexed Key request remains attached to its Item, independent of Library Scope or Citation Key lookup readiness.
- Recheck Item availability before an action. An old Citation Key must not redirect the action to another Item.

## Implementation boundaries

- Make source-less requests explicit. A document-backed request keeps its document presentation and closes if its source disappears.
- Reuse the bibliography cache for the one-Item render. Source-less reads need no Document Citation Set or Citation Text.
- Preserve the existing protection against late asynchronous reads replacing newer content. Subscribe to settled Citation Key resolution changes as well as relevant render invalidation.
- Resolve the current Literature Note path through Item identity when opening it. Use the existing open-or-create behavior when no note exists.
- Keep graph anchor placement, hover timing, and teardown behavior. Release the hover hold when its node disappears.
- Update the graph how-to page to describe source-less hover in place of the uncited-note fallback.

## Acceptance checks

- An uncited Literature Note and a Cited Work Node both show a source-less popover in Citation Popover mode. Off and Page Preview retain their existing behavior.
- A graph work uses the vault style and locale even when citing documents or its Literature Note declare different presentations.
- Numeric styles show the entry body without a marker or serial. Styles without a bibliography and unavailable formatting show the readable Item's summary and actions.
- An exact Item with no Citation Key or a shared Citation Key renders and opens correctly. Library Scope changes do not retarget an Indexed Key request.
- Pending, missing, ambiguous, unavailable-Item, and database-unavailable states remain distinct. Recovery and Citation Key resolution changes update an open popover.
- Actions use the displayed Item's identity and current availability. Note renames use the current path; note creation uses the current Item.
- Document-backed multi-item and note-class popovers retain their presentation. Deleting their source closes them.
- Verify graph hover, actions, refresh, and teardown in a running Obsidian instance, including a separate window.

## Implementation verification

- Service tests cover source-less reads, pending and failed lookups, exact Item actions, bibliography revalidation, late reads, and document deletion. Graph service tests cover Literature Note creation and deletion with the pointer on the node or inside its popover.
- Terra verified no-key, missing, and ambiguous work hovers in this worktree's Fixture Vault. The creation/deletion cycle, deletion during the initial hover delay, deletion after pointer transfer, and a graph in a separate window passed.
- Runtime inspection found that the engine returns an empty bibliography body for `LETTERS5`. The service now uses the Item summary for that result. A regression test and the original Fixture Vault check verify the correction.
- Terra independently confirmed the corrected `LETTERS5` summary and the unkeyed `EEEE5555` entry under a numeric vault style, with no number gutter. Fixture settings, notes, graph options, and probe state were restored.
- The Page Preview runtime check was inconclusive. Its existing graph service tests pass, and this change retains its existing request behavior.
- Standards and Spec reviews found no remaining issues after the cache-refresh and node-removal corrections.
- The full workspace suite passed (25 tasks), including all 3,367 Obsidian tests. The docs file-watcher test requires execution outside the filesystem sandbox. Lint and formatting passed; lint reported 11 existing warnings in unrelated files.

## Documentation

The Citation Presentation and Citation Popover glossary entries now include the source-less form. These changes use existing services and reversible presentation rules, so this design does not need a new ADR.

## Code facts checked before the interview

- The current popover requires a source document and reads its Document Citation Set, Citation Presentation, and Citation Text.
- Graph hover selects the alphabetically first citing path and falls back to native hover when none exists. Literature Note hover also requires a Citation Key today.
- The bibliography cache can already render a supplied Item under the vault presentation without a source document.
- Reference source reads report database readability separately from missing Items. The current popover discards that distinction.
- The current open-note action resolves a Citation Key again. The existing exact-Item open flow can preserve Indexed Key identity.
- Neither sidebar currently opens a Citation Popover.
