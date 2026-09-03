# Web Workbench, whole-surface design (#945), revision 2

## The question

How do the #938 frame and the five accepted focused trials (#933 blocks, #934 Properties,
#935 details, #936 preview, #937 data explorer) compose into one web Template Workbench
surface, on the final Annotation Section format (#940, ADR 0035), so the spec is carved from
one picture instead of six?

Revision 2 re-asks it from the target user's side: a researcher who has never edited a template
and who leaves at the first sight of code. The first revision put the trials' machinery on the
first screen (Liquid syntax, `zt.` keys, line numbers, mono apparatus labels, four toggles, a
Problems strip that says "none"). It was correct and too much. This revision keeps every
ruling that came from the trials and moves everything that is not the job off the first screen.

## The job, from first principles

The user's job is one sentence: **change what my literature notes look like, see it, keep it.**
Everything on the first screen serves one of those three verbs. Everything else is one select
away or in Advanced. The #938 three-concept ceiling holds and is the test for every board:

1. this is my note;
2. the orange parts fill in from Zotero, and I add one from the list;
3. Save keeps it.

## The asset

- `issue-945-web-workbench-hifi.html` — the canvas. Open it in a browser: one page of screens
  in the order a researcher meets them, and a second page with the rulings board.
- `issue-945-web-workbench-hifi/` — the artboard sources (`*.dc.html`) and `canvas.json`. The
  canvas is regenerated from these by the Claude Design canvas helper. Every artboard is
  static markup; nothing is wired.
- This file — the rulings, the tier table, and limits.

The trial assets were read for their logic, vocabulary, and rulings only. Their visual style
was set aside. The design matches the docs site the surface ships in (`apps/docs/DESIGN.md`):
cream ground, navy ink, deep-orange primary, Inter for chrome, Gelasio for headings, the
landing note mock's paper sheet. Mono type appears on the Advanced board only.

## Fixed inputs

Three columns and the note body as the only open pane (#938); one source buffer and one undo
history (#930, ADR 0032); public standalone `/workbench` under `apps/docs`, Liquid and JSON-e
only, Obsidian handoff for Eta and `js` (#931, ADR 0033); the document order manifest → note
source → required final `--- zotlit:annotation ---` section (#940, ADR 0035); the annotation
shortcut `{% render_annotation annotation %}` (ADR 0034); CodeMirror 6 at the Obsidian pins.

## Item 1 — Composition

**Ruling 1.1 — fields print as `{{ Title }}`, and a select reveals the code.** On the beginner
face a field keeps the Liquid braces and prints its human name inside them: `{{ Title }}`,
`{{ Authors }}`, `{{ Page }}`, `{{ Highlighted text }}`. The braces stay because they are the
one piece of syntax the researcher will meet again in the manual and in the vault file. The
chip is a live preview drawn as a CodeMirror decoration over the real expression in the one
source buffer (ADR 0032). Selecting a chip opens it in place and shows the expression as
ZotLit reads it, `{{ zt.title }}`, editable; selecting elsewhere closes it back to the
preview. Undo, Save, and Advanced all see the same text. Advanced shows the whole file as plain
source, with no field preview: every expression prints as written.

**Ruling 1.2 — one header row.** Template name, the paper shown, a `···` menu, Save. The
connection state prints only when it is not the normal one ("Not connected to Obsidian"). Save
reads "Save" when connected and "Download" when standalone. Undo, Download, and Advanced sit
behind `···`. There is no Revert, no unsaved-changes counter, no Advanced toggle on the bar.

**Ruling 1.3 — the middle column holds one open pane, chosen by three equal tabs.** Your note,
Properties, and Name and folder sit as tabs at the head of the column, each with a short
summary ("Properties · 4 fields", "Name and folder · Literature/…"). Your note is the open tab
on the first screen. Selecting a tab swaps the pane's content; the result column never moves.
The three are equal in weight and position; only the default differs.

**Ruling 1.4 — the field list shows values first, in human names.** Eleven common rows with
this paper's value under each, a search box, and "Everything else from Zotero · 41 more" at
the foot. Selecting a row reveals "Put in note" and "Copy". Typing `{{` in the note opens the
same list. Keys such as `zt.publicationTitle` stay in Advanced.

**Ruling 1.5 — the kept-up-to-date part is a tinted band; the highlight format is a dashed box
inside it.** One label each, one short sentence on the band ("ZotLit refreshes this part. The
rest stays yours."), no end marker, no scope link.

**Ruling 1.6 — the result is the note as a paper sheet, and nothing else.** No view toggles,
no cadence menu, no operation picker on the first screen. The property box, the body, and the
highlights render for the paper shown. A Problems strip appears only when there is a problem.

**Ruling 1.7 — under 780px the note fills the screen**, with a tab for the result and a bottom
"Add a field" button that opens the field list as a sheet.

### Tier table

| On the first screen | One select away | Advanced | Not on the web |
| --- | --- | --- | --- |
| Template name; the paper shown; field list with values; note body with chips; kept-up-to-date band; highlight box; result sheet; Save | Put in note and Copy; Properties tab; Name and folder tab; paper picker; everything else from Zotero; Download; Undo | Raw file with manifest; `--- zotlit:annotation ---` header; YAML for "Several from a rule"; language; IDs and compatibility; parser codes | Switch, create, share, delete a template (#918); JavaScript templates (ADR 0033) |

## Item 2 — The final-section format on every screen

- The file ends with the required highlight section (ADR 0035). The beginner face never prints
  the header; it prints "One highlight looks like".
- The first place highlights render is where the box is edited. A later place shows one grey
  line, "Highlights look the same as above · Edit them there".
- A file without the section shows one calm strip above the result, "Highlights have no format
  yet", with one button, "Add the highlight format". The same button sits in the empty box.
- Advanced shows the header line as text, tinted so it maps to the box.
- Diagnostics keep the parser codes (`missing-annotation-section`, `duplicate-annotation-section`,
  `unknown-section-header`, `duplicate-managed-block`, `invalid-managed-block`,
  `invalid-document`, `invalid-manifest`, `reserved-annotation-partial`) in small grey text
  after a plain-language line; the Problems board carries the catalogue.

## Item 3 — Words and owned flows

**Ruling 3.1 — the surface is the Template Workbench, and "template" is a printed word.** The
first screen says "Default template · what every literature note starts from". "Note layout"
is retired. The glossary entry in `apps/docs/CONTEXT.md` covers both hosts.

| Beginner word | Canonical term |
| --- | --- |
| Default template | Literature Note Profile document |
| Your note | the document body |
| Kept up to date | Managed Block |
| One highlight looks like | Annotation Section |
| From this paper | template data (`zt`) |
| Properties | Managed Frontmatter |
| Several from a rule | spread entry |
| Name and folder | manifest `filename` and folder |
| Showing | the example Item |
| Advanced | the raw Profile document |
| The note you get | the rendered preview |

**Ruling 3.2 — the web surface owns Open, Save or Download, and the Obsidian handoff.**
Switch, create, share, and delete stay in Obsidian (#918).

## Limits

Static boards, except Properties and Name and folder, which run: their rows, editors, folding, filename evaluation, and errors work on a small in-page Liquid and JSON-e subset over the sample paper. No editor runs elsewhere. Chip decorations over Liquid are a design ruling; the CodeMirror
extension that draws them is implementation work under #863. The Properties board shows the
"Several from a rule" entry read-only; its YAML editor is in Advanced per #930's amendment.
The Properties board shows one entry open for editing (name, `Value · Liquid` or
`Rule · JSON-e`, one-line source, the result for this paper, Done and Remove), per #934: a new
property starts as a Value in Liquid, and changing the language swaps the editor without
translating the text. The Filename board is the "Name and folder" form: the folder, the
one-line filename template with chips, the path this paper gets, and three ready-made names.
