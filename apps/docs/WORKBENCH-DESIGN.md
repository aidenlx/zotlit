# Template Workbench — design guide

## Scope and ownership

This guide governs the Template Workbench on the docs site at `/workbench` and
the Obsidian Template Workbench View, including its Note Preview and Template
Data Explorer companions. It records visual judgment: the reader's task,
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

## Composition and hierarchy

### Editing leads

- Start each editing tab with one concise sentence that names its task. Keep
  the order Note, Properties, Annotation, Name and folder, Match, Profile.
- Start editing and rendered content within one control row of the pane top.
  Use the same density in the loading frame and interactive panes.
- Keep the Profile name and file actions in the header. Put the example picker
  beside the result it changes. Put connection state, draft state, and lasting
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
means. Native titles lead with selected data and then the Preview or Fields
role. With no selection, use the generic **Note preview** or **Template data
explorer** name.

The Note Preview keeps infrequent display and preview choices in native chrome.
Its content begins with one role heading and a muted caption that names the
current view, such as **New note** or **Updated note**. The web uses the shared
result header for the corresponding controls. The settings contract lives in
[ADR 0048](../../docs/adr/0048-the-note-preview-keeps-its-settings-in-native-chrome.md).

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
Keep source markers short. The preview names the effect on its result and
offers **Show problem**, leading to the same explanation.

Lead with the affected object, a plain explanation, and a short text suggestion
for what to check or change. A location the engine reported inside another
template reads as its own quiet line, apart from the control that navigates, so
a reported location is never mistaken for a repair target. Keep technical
evidence behind a collapsed disclosure. Group **Copy error report** and **Ask the community** beside it,
within reach when the explanation scrolls. ADR 0056 owns the behavior,
report contents, and state transitions.

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

At 1180 px and wider, show fields, editor, and result in three columns. Below
that, fields open in the **Add a field** sheet. Below 780 px, switch between
editor and result views. These folds protect useful source width. A short,
narrow viewport scrolls the page while preserving several lines of editor
space.

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
