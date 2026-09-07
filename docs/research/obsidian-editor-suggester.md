# Obsidian editor suggestion behavior

Research for the Template Workbench completion design, 2026-09-05. This records
source observations and design implications. Product decisions remain pending.

## Sources and version

The `obsidian` package resolved from `apps/obsidian` reports **1.13.1**. The
available formatted runtime is **1.13.7**, reused from
`node_modules/.ob-rev-1.13.7/app.js`. This is a patch substitution within the
same minor version. No archive was extracted and no runtime behavior was tested.
The runtime findings below apply to 1.13.7; the public signatures were checked
against `packages/obsidian-api/obsidian.d.ts`.

The runtime export table establishes these names, rather than inferring them
from minified class names:

| Runtime symbol | Meaning | Source |
| --- | --- | --- |
| `VR` | Public `EditorSuggest` | [app.js:14987](../../node_modules/.ob-rev-1.13.7/app.js#L14987) |
| `TR` | Public `PopoverSuggest` | [app.js:15024](../../node_modules/.ob-rev-1.13.7/app.js#L15024) |
| `ly` | Public `Scope` | [app.js:15031](../../node_modules/.ob-rev-1.13.7/app.js#L15031) |
| `CO` | Public `Editor` | [app.js:14986](../../node_modules/.ob-rev-1.13.7/app.js#L14986) |
| `ww` | Internal suggestion list; this label describes its implementation | [app.js:58927](../../node_modules/.ob-rev-1.13.7/app.js#L58927) |
| `L6` | Internal workspace editor suggestion manager | [app.js:144007](../../node_modules/.ob-rev-1.13.7/app.js#L144007) |

## Observed editor pipeline

1. The editor update listener schedules suggestion checks with a 50 ms helper
   on focus, document, or selection changes. It marks an update as eligible to
   open suggestions when a document-changing transaction is an `input` or
   `delete` event. Transactions marked `set` are excluded from the relevant
   document-change test. See [updateEvent](../../node_modules/.ob-rev-1.13.7/app.js#L132371)
   and [event predicates](../../node_modules/.ob-rev-1.13.7/app.js#L85728).
2. The workspace manager checks that CodeMirror has focus, then calls registered
   suggesters in order. The first truthy trigger stops the search. Links, tags,
   and footnotes are registered first; plugin registration appends a suggester.
   There is no candidate merging or ranking across providers here. See
   [manager](../../node_modules/.ob-rev-1.13.7/app.js#L144007) and
   [plugin registration](../../node_modules/.ob-rev-1.13.7/app.js#L150673).
3. `EditorSuggest.trigger()` rejects a nonempty primary selection. It calls
   `onTrigger()` with the cursor, editor, and file, and copies the returned
   start/end/query into a new context. It calls `getSuggestions()` when the
   open flag is set or its popup is already open. Thus a selection move can
   update an open popup without opening a closed popup. See
   [trigger](../../node_modules/.ob-rev-1.13.7/app.js#L93584).
4. A nonempty result replaces the list, with a default limit of 100. An empty
   result closes the popup. List replacement resets selection to the first
   item. See [showSuggestions](../../node_modules/.ob-rev-1.13.7/app.js#L93623)
   and [list state](../../node_modules/.ob-rev-1.13.7/app.js#L59026).

The public API documents frequent `onTrigger()` calls and asks implementations
to reject irrelevant contexts early. It permits synchronous or asynchronous
`getSuggestions()` and recommends synchronous results. It describes start/end
as the popup anchor range; these values do not prescribe the accepted edit.
See [EditorSuggest declarations](../../packages/obsidian-api/obsidian.d.ts#L2689)
and [trigger information](../../packages/obsidian-api/obsidian.d.ts#L2750).

## Focus, keys, position, and dismissal

`EditorSuggest` prevents the popup's `mousedown` default. Its popup contains
result elements, with no search input. `PopoverSuggest.open()` appends it to
the active window body and pushes a keyboard `Scope`; it does not call focus
on a result. This supports continuous typing in the editor. See
[EditorSuggest constructor](../../node_modules/.ob-rev-1.13.7/app.js#L93564)
and [PopoverSuggest lifecycle](../../node_modules/.ob-rev-1.13.7/app.js#L93221).

The internal list binds Arrow Up/Down, Page Up/Down, Home/End, Ctrl-P/N, and
Enter. Arrow navigation wraps, and keyboard navigation scrolls the active row
into view. Enter and arrow handlers guard against IME composition. Pointer
movement changes the active row; click accepts it. Escape belongs to the
popover scope and closes it. Tab acceptance is **not** in the base list:
the built-in link suggester registers it separately. See
[list handlers](../../node_modules/.ob-rev-1.13.7/app.js#L58927),
[list selection](../../node_modules/.ob-rev-1.13.7/app.js#L59043), and
[link bindings](../../node_modules/.ob-rev-1.13.7/app.js#L94413).

The editor also installs CodeMirror key handlers for Up, Down, Enter, and Tab
that consume the key while the workspace manager reports an open suggestion.
Consequently, the native popup combines Obsidian's scope handling with an editor
guard; installing a second completion UI requires explicit key ownership.
See [editor keymap](../../node_modules/.ob-rev-1.13.7/app.js#L132409).

Popup position comes from `editor.coordsAtPos(context.start/end)`. The runtime
builds a rectangle, transforms it for the editor window, and aligns it using
the source line's text direction. The popover placement helper uses a gap of
5 and overlap prevention. The workspace manager can reposition the active
popup. See [updatePosition](../../node_modules/.ob-rev-1.13.7/app.js#L93631),
[placement](../../node_modules/.ob-rev-1.13.7/app.js#L93278), and
[manager reposition](../../node_modules/.ob-rev-1.13.7/app.js#L144039).

Editor blur closes the workspace suggestion. `EditorSuggest.close()` clears
context; the base close removes the keyboard scope and popup and clears the
list. Escape therefore does not need to move focus back from another input.
An input/delete update can subsequently open suggestions again. See
[blur](../../node_modules/.ob-rev-1.13.7/app.js#L132463),
[close](../../node_modules/.ob-rev-1.13.7/app.js#L93651), and the trigger pipeline
above. This is an observed event rule, not a promise that all programmatic
cursor changes reopen a popup.

## Acceptance and asynchronous results

The base list calls `selectSuggestion(value, event)`; it performs no text edit
and does not close automatically. The host implementation owns both. The
built-in link suggester saves its context, closes, calculates replacement and
selection, then applies an editor transaction with `input.autocomplete` as its
event label. It schedules editor focus afterward. Footnotes likewise provide
an explicit post-insert selection. See
[base acceptance](../../node_modules/.ob-rev-1.13.7/app.js#L59076),
[link acceptance](../../node_modules/.ob-rev-1.13.7/app.js#L94496), and
[footnote acceptance](../../node_modules/.ob-rev-1.13.7/app.js#L143934).

The base asynchronous branch awaits the result and checks editor focus. It
does **not** compare the captured context with the current context or a request
sequence before showing results. It also does not catch a rejected promise in
the inspected branch. This permits stale results to replace newer suggestions
when both resolve while the editor is focused. The built-in link suggester
adds its own cancellable operation, checks cancellation before returning, and
cancels again on close. See
[base async branch](../../node_modules/.ob-rev-1.13.7/app.js#L93602) and
[link cancellation](../../node_modules/.ob-rev-1.13.7/app.js#L94464).

## Relationship to CodeMirror completion and the web Workbench

The runtime separately exports CodeMirror's `autocompletion`,
`acceptCompletion`, and `startCompletion`. The inspected `EditorSuggest`
pipeline uses its own manager, list, and popover; it does not invoke those
CodeMirror completion functions. Thus native `EditorSuggest` is an adapter
target separate from CodeMirror's completion extension. This observation does
not establish a universal priority rule for third-party extensions. See
[CodeMirror exports](../../node_modules/.ob-rev-1.13.7/app.js#L14879) and the
manager and keymap sources above.

The current web Workbench has two distinct flows:

- [SliceEditor](../../apps/docs/src/lib/workbench/slice-editor.tsx) installs
  the package's CodeMirror `templateCompletion` extension and separately
  reports a newly typed `{{` with a saved range and screen coordinates.
- [FieldDialog](../../apps/docs/src/lib/workbench/workbench.tsx) is a fixed
  `role="dialog"` container around the field list. The list has a separate
  search input in [field-list.tsx](../../apps/docs/src/lib/workbench/field-list.tsx).
  The Workbench closes the brace trigger when editor selection leaves its
  opening range. Insertion uses the saved range and the reveal path to return
  to the editor. This is a field-search flow, not a continuous query read from
  the editor in the native Obsidian style.

The current [CodeMirror adapter](../../packages/workbench/src/language/completion.ts)
maps suggestion text into `apply` but omits the core option's custom replacement
range and `cursorOffset`. Those fields are used by whole-tag snippets in
[suggestions.ts](../../packages/workbench/src/language/suggestions.ts). A new
adapter must carry the complete edit contract if these snippets remain in scope.

## Design implications, pending agreement

These are recommendations derived from the observations, not settled decisions:

- Share source/caret analysis, candidates, filtering, and an explicit edit plus
  resulting selection as data. Keep editor coordinates, focus, popup state,
  keyboard handling, and transaction application in each host adapter.
- Choose whether the web typing popup keeps editor focus. A Command search
  input changes the query owner; a dialog and a caret-driven completion list
  therefore need distinct interaction rules even if they share result logic.
- Give one web component ownership of completion keys. Define Enter, Tab,
  Escape, IME composition, pointer acceptance, and reopening together.
- Keep contract-based suggestions synchronous when practical. Any asynchronous
  provider needs its own stale-result and close handling in both hosts.
- Preserve replacement ranges and cursor placement through acceptance. The
  popup anchor and accepted replacement can be different ranges.
- Gate an Obsidian provider narrowly: earlier built-in providers can claim a
  cursor context even when a later provider could return useful candidates.

Property-pane suggestion behavior was not needed to establish these editor
rules and was not traced fully. Browser accessibility behavior and third-party
extension conflicts require interaction tests after the design is chosen.
