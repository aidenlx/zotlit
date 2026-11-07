# Template Workbench — design guide

## Scope and ownership

This guide governs the Template Workbench on the docs site at `/workbench` and
the Obsidian Template Workbench View, including its Preview panel and the
Template Data Explorer. It records visual judgment: the reader's task,
composition, hierarchy, density, disclosure, and wording. Shared brand rules
live in [DESIGN.md](DESIGN.md).

The Workbench is an editing tool. Its utility chrome uses Inter in sentence
case, including labels and pane headings.

Put reusable control mechanics in the [shared UI kit](src/components/ui/) and
host themes. Put deterministic rules in the
[design check](src/lib/workbench/design.test.ts).
Put behavioral contracts, state, persistence, and architectural trade-offs in
the relevant ADR. The Workbench diagnosis contract is
[ADR 0056](../../docs/adr/0056-template-diagnosis-belongs-to-the-editor.md).

## Reader and job

Researchers and academics use the Workbench to choose data, edit a template,
and inspect the note it produces. Their expertise is in their research.
Name visible objects with literature-management
terms: fields, notes, annotations, properties, and template document.

The editing and result panes carry this loop. Keep optional explanation behind
a visible Help control beside the task. A message says what happened and what
the reader can do next, in terms of the template and its result.

## Guide the first annotation edit

Annotation offers one **Help** icon toggle in the same row as the task. Its
bounded inline guide keeps the source visible and the editor mounted,
preserving selection, scroll, and history. The same toggle opens and closes
the guide. Place the toggle directly after the task text. Present the guide as
quiet text on the pane surface. Keyboard users can also close it with Escape
and return focus to Help.

Teach one edit: replace `[!note]` with `[!quote]` in the built-in annotation format
and keep the rest of the line. Ask the researcher to inspect a real annotation
from the selected paper. Separate the three outcomes: the template saves, the
preview shows a quote callout, and **Update this note** applies it to the originating
Literature Note. The host names its available save and update actions. Explain
conditions, loops, and publishing metadata only when the reader asks for them.

## Create a second destination

Settings **Add profile** collects **Name** and **Literature Note folder** together.
Explain that the new Profile starts with the current Default template's appearance
and that existing notes keep their folders. Show validation beside the fields;
keep creation disabled until the existing Profile rules accept the values.
Cancel leaves the vault unchanged.

After creation, open **Name and folder** in the native Workbench so the researcher
can check the destination. Source, publishing metadata, and Match remain available
in their usual tabs. For a new Item, the manual Profile picker shows the resulting
note path before creation. Selecting a Profile applies its membership to that note.

## Shared template and note updates

When Customize starts from a Literature Note, identify the shared template
document before editing and explain that other notes can use it. Keep the
originating note's name beside **Update this note**. This target stays the same
when the reader changes the preview item or focuses another window.
Present this active context as one compact accent-bar notice: group the shared
template identity with automatic save and Preview behavior, and keep the named
note with the trailing update action. Let the two groups wrap on narrow panes.

Keep the three outcomes distinct: edits save the template automatically;
the preview renders the edit; **Update this note** applies the saved template
to the named note. Report the affected note on success. Give save failures
and unavailable-note failures their own explanation. Settings-launched editing
keeps its existing save and preview behavior.

## Composition and hierarchy

### Editing leads

- Start each editing tab with one concise sentence that names its task. Keep
  the order Note, Properties, Annotation, Name and folder, Match, Profile.
- Start editing and rendered content within one control row of the pane top.
  Use the same density in the loading frame and interactive panes.
- Keep the Profile name and file actions in the header. Put the example picker
  in the item row above the panels, after the item's name and its badge, since
  every panel reads that item. Put connection state, draft state, and lasting
  action failures below the panes, where short viewports still show them.
- In the wide Note view, align the field list, editor, and preview at their
  top edges. Use 12 px outer insets and column gaps. The control rows above
  them align together; template tabs take their label width and the editor
  takes the remaining space.
- Let the rendered note sit on its pane surface. Use cards to group controls
  or disclosure.

### Native chrome carries rare choices

In Obsidian, use native headers for actions and pane menus for settings. The
web frame's control row is the equivalent. Content shows the current outcome:
a caption, selected icon, or check mark tells the reader what a menu setting
means. Native titles lead with selected data and then the Fields role. With
no selection, use the generic **Template data explorer** name.

The Preview panel of the Template Workbench View keeps infrequent display and
preview choices in the view's pane menu, shown while the panel shows; Show
Markdown and the updated-section choice are menu entries, not header actions.
The panel begins with the chosen Item and its chooser, then one role heading
and a muted caption that names the current view, such as **New note** or
**Updated note**. The web uses the shared result header for the corresponding
controls. The settings contract lives in
[ADR 0048](../../docs/adr/0048-the-note-preview-keeps-its-settings-in-native-chrome.md),
as amended by
[ADR 0081](../../docs/adr/0081-fields-and-preview-are-side-panels-of-the-template-workbench-view.md).

## Data and result context

Show one field tree for the selected Item or Annotation. Common fields lead;
the remaining fields belong to familiar sections. For Items, use Reference,
Identifiers, Content and files, Organization, Links, and Zotero record. For
Annotations, use Annotation, Source, Organization, Links, and Zotero record.
Every field has one home.

Use the human field name in the list. Keep raw paths for the tooltip and Copy
path. Rows reveal Insert field and their menu on hover or focus, and keep those
actions available on touch. Long values wrap beneath their names.

Keep Item and Annotation selection near the task it affects. Inline selection
uses a compact, borderless text-and-icon control, visually subordinate to the
result, with clear keyboard focus. Align its text with the result and allow
both to wrap. Selection, loading, no-result, and failed-result states need
distinct wording and a relevant next action. Name the Note name result
**Preview**.

## Diagnosis and feedback

Give detailed diagnosis a stable reading surface in the editor's Problems
area, with room for source and explanation while both remain readable.
Show verified source errors as persistent CodeMirror lint underlines. A red dot in a narrow left gutter
opens the line’s diagnosis in Problems. Keep the explanation in that panel
and reserve the source width for editing. Error
icons and semantic error colors distinguish failures from ordinary hints. The preview names the effect on its result and
offers **Show problem**, leading to the same explanation.

Lead with the affected object, a plain explanation, and a short text suggestion
for what to check or change. For an unclassified failure, show the first line
of the engine’s error and offer the report-sharing path for help identifying
the cause. Keep its full evidence in Technical details. A location the engine reported inside another
template reads as its own quiet line, apart from the control that navigates, so
a reported location is never mistaken for a repair target. Keep technical
evidence behind a collapsed disclosure. Group **Copy error report** and **Ask the community** beside it,
within reach when the explanation scrolls. The explanation is what scrolls;
the controls that navigate and report keep one place along the area's bottom
edge. ADR 0056 owns the behavior, report contents, and state transitions.

Keep feedback steady while the reader types. Inline notices use the shared
accent-bar treatment and a trailing action. Make waiting, rendering, and
failed results distinguishable; the visible cue names the actual condition.

## Type, density, and wording

Use Inter sentence case for Workbench chrome. Pane headings, card summaries,
and notice headings are compact and semibold; labels are compact and medium;
hints and status are compact and muted. Chrome stays at 12 px or larger.
Template source uses IBM Plex Mono at 14 px with a unitless 1.5 line height.
The rendered note keeps reading-view typography so its hierarchy matches the
note it will produce.

Labels are short nouns. Buttons and menu items start with an outcome verb, such
as **Preview as new note**. Keep one name for an object across the header,
menu, caption, and Help. Read current labels from the
[message catalog](../../messages/en.json) and use the
[canonical vocabulary](../../policies/vocabulary.md). Use complete sentences
for instructions. On narrow screens, inputs use 16 px text and labels wrap.

Use space to make groups legible: a tight label-to-control relationship, clear
row spacing, and a larger gap between groups. Keep property cards compact,
with disclosure showing their current expansion state. Text-bearing controls
may grow for wrapping; their shared size and padding come from the UI kit.
In Match, nested groups span their parent's content width with a small inner
inset. Conditions share a right-aligned label column; each group's selector
and add actions align at its leading edge.

## Adaptation and access

Lay out the editor and the Preview Panel with the shared panels, and the
Fields popover over them, as the Template Workbench View in Obsidian does.
"Fields" in the header opens and closes the Fields popover at every width, and
"Show preview" shows and hides the Preview. One
item row above the panels names the item they all read and holds the sample
chooser; each panel's head keeps only what is its own. The shared placement
rule measures the main area under that row. The Preview is a column in a
main area 56rem (896 px) wide or wider, as wide as the reader drags it while
the editor keeps 360 px. In a narrower main area the Preview goes under the
editor, at its saved share of the height, as the same region: it keeps its
focus and scroll across the move. The Fields popover stands inset at the
right edge of the main area, 20rem wide and as tall as the main area less
an 8 px gap to its top, right and bottom edges, and follows the main area
as it resizes. It has no backdrop and is not modal: the editor and the
Preview stay usable beside it. Escape, a press outside it and its close
button close it and return focus to "Fields", which reads as a disclosure
of it. The editor keeps its toolbar, tabs and five
source lines; the edit region is its one scroller, so the source grows to
its text and a reveal scrolls the selected text into view. A pressed view
action shows a primary border and icon over the muted fill. Document order
is editor, Preview Panel, Fields popover. A short viewport scrolls the page
while preserving several lines of editor space.

The "View" header menu holds "Show fields", "Show preview" and one size group
for each handle the page draws ("Resize preview"), so a reader who cannot
drag sizes every panel (WCAG 2.5.7). "Show fields" in the menu presses the
same Fields action as the header. The menu stays open across size steps and
closes when a step moves a panel to another place, so no entry moves under
the pointer. A polite status reads each new size. The "Help" header menu
lists the template guide, the syntax and data references, and the community,
the same pages as the Obsidian view's Help action; each opens in a new tab.
The Fields Panel's button that collapses or expands every section trails its
field search.

Source and Problems share the editor pane. An open Problems area keeps the share the reader chooses by dragging its top
divider. Arrow keys adjust the focused divider; Home and End select its size
limits. Keep source visible above it. One ghost chevron opens the area or
closes it and returns focus to the source. Its accessible label names that
action. A repair that empties the explanation keeps the chosen size.

Use logical direction properties. Keep Help, sheets, menus, and source markers
reachable by keyboard, with visible focus and returned focus after overlays
close. Compact controls keep a 24 px target with separate hit areas. Preserve
full labels through wrapping or an accessible expanded view.

## Recognizable design failures

- **Select stack:** controls consume the space between a pane title and its
  task. Put rare choices in native chrome or the frame control row; leave a
  visible outcome in content.
- **Card in a pane:** a result has a second bordered, padded container. The
  pane is its surface.
- **Setting as status:** a permanent line repeats a setting. Show a notice only
  for an active condition and its next action.
- **Silent menu state:** a menu-only setting leaves no visible outcome.
- **Noun-only menu choice:** a choice sounds like a vault mutation. Start with
  the verb that names the displayed outcome.
- **Two flags, one choice:** separate controls produce indistinguishable views.
  Present one reader-facing choice; the shared state contract owns its mapping.
- **Heading echo:** content repeats a native title without adding a role.
- **Mode switch in content:** a switch creates two vocabularies for one field
  list. Use sections and disclosure instead.
- **Wrong-cause sentence:** one stale message covers waiting, rendering, and
  failure. State the actual cause.
- **Inline diagnosis wall:** a detailed explanation expands below a source line
  and displaces the work it describes. Use the editor Problems area.
- **Layout in JavaScript:** viewport state chooses a layout. Use CSS container
  rules and native container selectors.
- **Assembled string:** fragments form a sentence around a value. Use one
  translated message.

## Review loop

Review the reader's task before styling details: can a researcher find the
current data, edit source, inspect the result, and recover from a problem
without losing their place? Compare the same template, Sample Item, editing
mode, theme, and viewport across a correction. Cover normal, loading, empty,
error, recovery, desktop, both responsive folds, 320 px, and 200% zoom. Text
and theme changes also cover long translations, RTL, and both color schemes.

Use runtime inspection for wrapping, alignment, focus, contrast, and editing
space. The design check catches supported control sizes, logical direction,
and chrome type rules. Theme classes belong in
[the web theme](src/lib/workbench/theme.tsx) and
[the Obsidian theme](../obsidian/src/views/template-workbench/theme.tsx);
shared structure and behavior belong in `@zotlit/workbench/ui`.

Record accepted corrections as observable sentences. Put a judgment in this
guide, a reusable mechanism in the kit or theme, and a repeatable failure in a
deterministic check. Rerun the affected scenario. A correction is complete
when the scenario no longer reproduces the failure without harming the task it
supports.
