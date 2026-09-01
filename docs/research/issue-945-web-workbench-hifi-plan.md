# Web Workbench, whole-surface design (#945)

## The question

How do the #938 frame and the five accepted focused trials (#933 blocks, #934 Properties,
#935 details, #936 preview, #937 data explorer) compose into one web Template Workbench
surface, on the final Annotation Section format (#940, ADR 0035), so the spec is carved from
one picture instead of six?

## The asset

- `issue-945-web-workbench-hifi.html` — the canvas. Open it in a browser: one page of screens
  in the order a researcher meets them, and a second page of boards (rulings, words, flows,
  diagnostics).
- `issue-945-web-workbench-hifi/` — the artboard sources (`*.dc.html`) and `canvas.json`. The
  canvas is regenerated from these by the Claude Design canvas helper; the sources are the
  editable form. Every artboard is static markup; nothing is wired.
- This file — the rulings, the tier table, and what the trials' assets left behind.

The earlier trial assets were read for their logic, vocabulary, and rulings only. Their visual
style was set aside; the design here matches the docs site the surface will ship in
(`apps/docs/DESIGN.md`, "Manuscript & Machine": cream ground, navy ink, deep-orange primary,
Inter for chrome, Gelasio for display, IBM Plex Mono for code and apparatus labels, square
primary action, the landing note mock's paper sheet with its hard offset shadow and bookmark tab).

## Fixed inputs

Three columns and the note body as the only open pane (#938); one source buffer and one undo
history (#930, ADR 0032); public standalone `/workbench` under `apps/docs`, Liquid and JSON-e
only, Obsidian handoff for Eta and `js` (#931, ADR 0033); the document order manifest → note
source → required final `--- zotlit:annotation ---` section (#940, ADR 0035); the annotation
shortcut `{% render_annotation annotation %}` (ADR 0034); CodeMirror 6 at the Obsidian pins.

## Item 1 — Composition

**Ruling 1.1 — the middle column holds one open pane; the others are strips.** The three panes
of the middle column are the note body, Properties, and Details, in that order. The body is
open on the first screen; Properties and Details are folded strips beneath it, each carrying a
one-line summary of its contents. Opening a strip makes it the open pane and folds the body
into a strip above it. The result column never moves. This is the #938 Unfold behaviour and
the #934 focused artboard, stated once. #935's "separate tabs" ruling is honoured by the same
rule: Profile details and the note are alternate panes of one column, both mounted, sharing
the source and the undo history.

**Ruling 1.2 — the field rail is the #937 explorer in the #938 value-first form.** One panel,
open by default, showing name and this paper's value on every row, with a filter box. A row
click inspects: the row expands to show Insert, Copy, and the snippet kind (Output · If present
· Loop · Joined) with Insert primary; Enter or a second click on the row inserts the Output
form at the saved cursor. That keeps #938's one-gesture insert for a beginner and #937's
explicit actions for everyone else. The root follows editor focus and is named in the panel's
corner ("for your note" · "for one highlight" · "for the note name"); the panel remounts on a
root change, so the filter resets. Typing `{{` in the note opens the same list.

**Ruling 1.3 — the header carries the surface, the document, and the paper.** Row one: the
wordmark, "Template Workbench", the connection state, the unsaved state, Undo, and Save. Row
two: the Profile name in display type with a one-line lede, the "Showing" paper picker, and
the Advanced switch. Save reads "Save to vault" when connected and "Download" when standalone;
one button whose meaning follows the connection. There is no Revert: ADR 0032's single undo
history is the way back, and Undo sits beside Save.

**Ruling 1.4 — the result column is the note as a paper sheet, with its controls above it and
Problems below it.** Above the sheet: the preview status word, the view toggle
(Note · Markdown), and the operation picker ("New note" · "Updating an existing note"). The
sheet shows the note name, the final Properties as a list, and the body in reading view with
the Managed Region banded and labelled "Kept up to date". The single-highlight and
kept-up-to-date-only views are entries of the view toggle, one select away. Cadence (Live ·
On demand · Run · Stop) is a menu on the status word. Problems is a strip under the sheet on
every screen, per ADR 0032, empty by default.

**Tier table — where each trial's controls live**

| Tier | Controls |
| --- | --- |
| First screen, open | Field rail with filter, values, Insert · Copy · kind on the inspected row (#937); note body editor with the Managed Block boundary widgets "Kept up to date" / "End of the kept-up-to-date part" and About scope (#933); the nested "How one highlight looks" editor at the first render call with its one-highlight line (#933/#940); later-call links "the same one, open above · Take me there"; Properties and Details strips with summaries; the paper picker; the result sheet with note name, Properties, body, Managed Region band; view toggle; operation picker; preview status; Problems (empty); Save; Undo; Advanced switch; connection state |
| One select away (strips, menus, view entries) | Properties pane: entries with Value/Rule editors, produced-fields table, If it exists (Replace · Append · Keep), Add a property, More ways to add → Several properties from one rule, Entry options → Written as · Add an override after this, move/duplicate/remove (#934); Details pane: Name, Description, Version, Author, Note name (one-line template editor with live result), Folders & imports with Override / Use default and From default · This template origin chips, Citation style (#935); result views One highlight and Kept-up-to-date part; the existing-note fixture behind "Updating an existing note"; cadence menu; Markdown view (#936) |
| Advanced | The whole document with the three parts named in canonical words; the `--- zotlit:annotation ---` header and section bar (line, through end of file, Remove section); raw `{% managed %}` tags; the language row (Liquid · JSON-e; Eta and JavaScript are Obsidian-only); locked identity (Profile ID, Contract, Minimum app version) and Sample item type; YAML the forms cannot edit safely (anchors, flow style, block scalars); canonical field paths in the rail; move/delete of the Managed Block; missing-section repair (#933/#935/#940) |
| Not on the web surface | Eta editing and execution, `js` Properties, the JavaScript Templates gate (ADR 0033); the trials' scenario navs, snapshot inspectors, and Run Eta controls |

**Ruling 1.5 — the responsive fallback is Direction C.** Under 780 px the columns stack in
source order: fields above the editor as a collapsible strip, Editor / Preview buttons switch
the middle and result columns, and the preview keeps its own scroll (#936/#937 narrow-width
rulings). The three-concept budget is not claimed on a phone.

## Item 2 — The final-section format on every screen

- The note body shows the render call's box "How one highlight looks" at the first
  `{% render_annotation annotation %}` and a link at every later call. The box edits the final
  section of the same file; its footer shows one highlight from this paper. The section itself
  is not shown in the body view; its position is fixed at the end of the file.
- The Details strip and the Properties pane keep a pointer strip "How one highlight looks —
  edited in the note, where the highlights appear · Show me".
- With no render call, the pointer opens the section in Advanced ("This highlight format has
  no visible render call. Its definition is open in Advanced.").
- Advanced shows the whole file with the header line highlighted and a section bar:
  "Annotation Section · line 24 · through end of file · Remove section". The repair action for
  a missing section is "Add the highlight section" and appends the header at the end of the
  file.
- Problems carries the current parser diagnostics with the parser's own recovery sentences:
  missing, duplicate, and unknown section headers; duplicate or broken Managed Block; invalid
  manifest; a partial named `annotation`. Properties engine errors name the entry position and
  key; preview errors are separate from Save.

This closes the four "Prototype refresh required after #940" items in #863 as design evidence.
The trials' code branches stay on their earlier layouts.

## Item 3 — Words and owned flows

**Ruling 3.1 — the surface is the Template Workbench, and "template" is a printed word.** The
header names the surface "Template Workbench" on every screen; the lede under the Profile name
reads "The template ZotLit uses to write every literature note." "Note layout" is retired. The
Obsidian glossary entry extends to cover both hosts: the agent-facing CLI in Obsidian and the
human-facing web surface at `/workbench`. Recorded in `apps/docs/CONTEXT.md`. The other
beginner labels from #938 stand (Your note · Kept up to date · Properties · How one highlight
looks · Fields from this paper · Showing · Details · Note name · Advanced); the surface still
never prints Profile, manifest, frontmatter, Managed Block, or partial. "Reusable piece" is
dropped from the words board: partials have no control on this surface.

**Ruling 3.2 — the web surface owns three flows.** Open, Save, and the unsupported-language
handoff.

| Flow | Web surface | Obsidian |
| --- | --- | --- |
| Open | Three doors: from Obsidian through an approved connection (the Profile row, the current note); "Open a template file…" or paste for standalone use; "Start from the built-in Default" | Entry actions (#931) |
| Save | "Save to vault" when connected — validates, checks the loaded revision, keeps the draft on refusal; "Download" when standalone; Default's first Save creates its document | The vault write (#931) |
| Handoff | A template that needs Eta or JavaScript: read-only source, "Download source", "Continue in Obsidian" | Editing, rendering, the JavaScript Templates gate |
| Switch | Not owned. One document per connection; the header names it; another Profile is opened from Obsidian or as another file | Informed picker (#918) |
| Create | Not owned. "Start from Default" is a file, not a vault Profile | Create dialog (#918) |
| Share | Not owned. Download emits the plain document; bundling partials stays with Share… | Share… (#918) |
| Delete | Not owned | Delete dialog (#918) |

A flow prototyped on the web ports as the shared editing core (ADR 0032): editor extensions,
source mapping, the Properties and Details forms. Dialogs, file access, and transport stay
host-owned; nothing here asks Obsidian to re-implement a web dialog.

## What the trial assets left behind

- The `{% annotation %}` block layout (#938, #933 at the accepted checkpoint) is replaced by
  the final section everywhere on this canvas.
- #938's five-column Properties table becomes #934's entry list with the keyless "Several
  properties" entry; "If it exists" gains Append.
- #938's "This layout lives at … in your vault" banner and "JavaScript layouts are off on
  this device" become the connection state and the Obsidian-only language row (ADR 0033).
- #935's compact one-line Note name editor replaces #938's taller one; the live result sits
  beside it.
- The trials' Run Eta, JavaScript gate, and scenario controls are not part of the web surface.

## Limits

Static artboards, not a running editor: completion popups, hover documentation, and undo are
described, not wired. Sample data is the #936 bundled journal article. Connection, conflict,
and revision states are shown as they are ruled in #931, not verified against a bridge.
