# Template Workbench — design spec

## Scope

This file governs the Template Workbench on the docs site at `/workbench`
and its Obsidian counterpart: the Profile Editor with its Note preview and
Template data explorer panes. It holds judgment — task order, density,
alignment, disclosure, wording roles — as observable sentences an agent can
check against a rendered page. Reusable mechanics live in the shared kit and
theme values; mechanical rules live in the
[design check](src/lib/workbench/design.test.ts). Shared brand rules — the
token system, the four-face type system, and the editorial voice — live in
[DESIGN.md](DESIGN.md). The Workbench departs from the site's mono-uppercase
label voice: its utility chrome uses Inter sentence case, including labels
and pane headings.

## Reader and task

The users are researchers and academics — domain experts in their fields, not
programmers. Name objects with the vocabulary of literature management
(fields, notes, annotations, properties), not with implementation terms. Keep
error messages concrete: state what happened and the next action, without
technical internals. Place guidance behind a visible Help control beside its
task rather than assuming documentation has been read.

The main loop: choose a field, edit the template, inspect the note. Give
those three tasks the available space. Apply the same density to Note,
Properties, Name and folder, handoff, and the loading frame.

## Principles

Each principle is a sentence a reviewer can test on the page. The decisions
below are its applications.

1. **Content leads, settings recede.** The editing pane and the rendered note
   start within one control row of the pane top. A setting a researcher
   changes rarely lives in a menu, a popover, or native chrome, not in a row
   above the content.
2. **Native chrome first.** In Obsidian, an action goes in the view header
   and a setting in the pane menu before either goes in the content. On the
   web, the shared frame's control row is the equivalent.
3. **Hidden state stays visible.** A control that moves into a menu leaves a
   static cue in the content: a caption, a swapped icon, or a check mark.
   The page never renders a state the reader cannot name from what is shown.
4. **A notice names a condition and an action.** A status line appears only
   while there is something to act on, says what happened, and carries the
   next action at its trailing edge. A setting is not a condition.
5. **The pane is the box.** A rendered note sits directly on the pane
   surface. Cards mark disclosure or a group of controls, never the result.
6. **Labels name the outcome; verbs name actions.** A menu item or button
   starts with a verb that says what happens. A caption or heading is a short
   noun. The same object keeps one name across the header, menu, caption,
   and Help.
7. **One state, one owner.** Each preview setting has one store, and every
   surface — header, menu, caption, notice — derives from it. A choice that
   spans two flags maps onto them in one write.
8. **Same behaviour on both hosts.** The web Workbench and the Obsidian
   panes share one scheduler, one result contract, and one wording for each
   condition. A host adds chrome, not rules.

## Decisions

### Protect the editing space

Keep the Profile name and file actions in the header. Place the example picker
with the result it changes. Put optional guidance behind a visible Help control
beside its task. Give connection state, draft status, and persistent action
failures a dedicated status area below the panes; keep that area visible in
short viewports. Keep required confirmations beside the action they affect.

Each editing tab starts with one concise sentence that explains its task.
Order the tabs Note, Properties, Annotation, Name and folder, Match, Profile.
Use familiar terms for researchers and academics. Section descriptions add
only guidance needed to use that group, such as how defaults apply. Keep
self-explanatory fields brief and place detailed instructions in Help.
The Profile tab shows its identity fields directly, followed by collapsed
Advanced details. Its description needs no additional section heading.

Use 12 px outer insets and column gaps. In the three-column Note view, align
the top edges of the field list, editor, and preview content. Size the rows
above them together: search, template tabs, and preview controls follow the
same control row. Let the preview selectors share the width beside the heading.
Template tabs fit their labels; the editor receives the remaining space.

The [shared frame](src/lib/workbench/frame.tsx) keeps the loading and interactive
shells consistent. Coordinate pane headers with its control row when a control
needs more space.

The bottom status row carries a compact connection control and a short draft
state. Put setup instructions in the connection popover and persistent failures
in a bounded recovery area above the row. Routine action confirmations use
toasts. In the connected popover, show Vault, Profile, and Item first; put
website and access permissions behind **Connection details**.

### Item and annotation selection

Data Explorer's initial Item selection list offers four Sample Item types:
journal article, conference paper, book, and thesis. It also offers a short
list of recently updated Zotero Items and an action to open the full Zotero
Item suggester. Selecting an Item replaces the list with its fields.

The initial Annotation list and chooser offer annotations from the selected
Item and six built-in examples: highlight, underline, note, text, image, and
ink. The Annotation suggester searches these choices.

Item and Annotation selections made in any linked view propagate to the other
linked views. Independent workbenches retain their own selections. Annotation
fields and previews follow the chosen Annotation with its own parent context;
the note's Item stays selected.

Each view keeps its Item or Annotation selection trigger near the task that
uses it. Use selection details in content where they help the current task.
Inline Item selection uses a search icon and visible task wording: "Choose
item to preview" in Name and Properties, and "Choose item to check" in Match.
Use compact, borderless text-and-icon controls with normal text weight and a
muted resting color. Keep them visually subordinate to the result, with subtle
hover emphasis and clear keyboard focus. Use the shared button spacing between
icon and text. Align button and result text with matching line heights, and
let labels and results wrap in narrow panes.

Review selection hints, result labels, and match indicators together with the
tab's description. Name the result and distinguish configured values from
results for the selected data. Give no selection, loading, an empty result,
and a failed result distinct wording, with selection actions near the result.
Match reports "Matches selected item" or "Does not match selected item".
Label the Note name result "Preview". Keep selection, retry, and data reload
actions relevant to the displayed state.

### Template fields

The field list shows one tree for the selected Item or Annotation, grouped
into sections. Common fields lead in a fixed order with the names a
researcher uses. Every other field has one home: Reference, Identifiers,
Content and files, Organization, Links, and Zotero record for an Item;
Annotation, Source, Organization, Links, and Zotero record for an
Annotation. A field the taxonomy does not name joins the first section. No
field appears twice, and a field that is empty for every Item, such as the
note-name root's note path, does not appear.

Every top-level row shows a human name: ZotLit's label for its own fields,
and Zotero's own field label in the reader's locale for the rest, with
English Zotero labels in sentence case. The raw path stays in the tooltip
and in Copy path. Search matches the name, the raw key, and the value.
Nested keys show as written, in monospace.

Every row uses one density: a 30 px minimum, name and value inline, long
values wrapping beneath. A named list counts its entries in parentheses. A
row carries two actions, Insert field and a menu, revealed on hover or focus
and always visible on touch; a right click opens the same menu. Copy value
lives in the menu.

Sections open by default. A section's closed state is view state, saved with
the workspace. Search opens every section that matches and disables their
toggles. In Obsidian, the pane menu and a view action offer Collapse all
sections and Expand all sections, swapping icon and label like the file
explorer's collapse action; the sidebar keeps the same icon beside Choose
item. The in-content heading appears only in a sidebar, where the native
title is hidden. The search field names the root: "Search note fields",
"Search annotation fields", "Search note name fields".

### Obsidian panes

Native headers and titles lead with the selected data, followed by the
Preview or Fields role. Identify an Annotation by type, page, and a short
excerpt. Label built-in data as Example. With no selection, use the generic
Note preview and Template data explorer names.

Full panels offer selection through native header actions. Keep Reload preview
data in the pane menu. It rereads the available fields, annotations, or built-in
examples for the current selection. Automatic refresh continues; in on-demand
mode, Run renders the preview. Sidebars keep a small selection trigger near
the current task. The pane menu provides actions in both layouts. Place Open
template workbench in the Profile Editor's pane menu.

The Note preview pane keeps its settings in native chrome, in three pane menu
sections: the selection actions; one checked choice that starts with the verb
Preview — Preview as new note, Preview as updated note, Preview updated
section only; and the display checkboxes Automatically refresh preview and
Show Markdown. Preview as updated note is disabled while the selected Item has
no note in the vault. Show Markdown and the updated-section choice are also
view actions that swap icon and label like Obsidian's reading-view toggle;
each label names the view the next press shows. The content starts with one
pane heading and a muted caption that names the chosen note as a short noun —
New note, Updated note, Updated section only — and, in on-demand mode, "On
demand". An on-demand result behind the edits shows an inline notice with
Run; before the first render it says "No preview yet." The rendered note
carries no border or inset of its own.

Use CSS selectors on Obsidian's native sidebar containers to switch these
layouts. Container membership determines the layout; keep viewport and
layout detection out of JavaScript state.

In Obsidian, all Profile editor text buttons and standalone selects share the
Match tab's outlined native surface. Define its normal, hover, and border
variables once on the Profile editor root. Share text-button classes through
`profileEditorButton`; call sites add layout and state only. Match condition
controls retain their joined input surface through local variable overrides.
Use native icon controls for row actions and navigation.

In the Obsidian Profile editor, property cards keep the compact 8 px inset and
native medium radius. Preserve the title button’s native padding and align the
expanded form to the title and summary with a matching inline inset
(`--size-2-3`). Use 6 px within field groups and 12 px between groups. Keep
labels compact and place the value format selector beside its label in a
wrapping row. A chevron shows whether the property is expanded. Name and
folder contains its editing controls directly.

### Popovers and editor cards

Compose button-triggered popovers with the shared
[Popover kit](src/components/ui/popover.tsx), following the
[shadcn Base UI Popover](https://ui.shadcn.com/docs/components/base/popover)
composition: trigger, content, header, title, and description. Help at every
pane and the connection control use this kit. Dismiss with Escape, an outside
press, or the trigger; return focus to the trigger. Keep the title row devoted
to the heading and omit close buttons.

Use 12 px text, a semibold title, muted guidance, and 12 px content padding.
Keep 8 px between a title and its explanation or between related facts, and
16 px between separate groups. Align labels and values to shared edges, with
wrapping columns for long names and translated labels. Connection facts lead;
access details sit behind the visible disclosure and Disconnect follows them.

Use the menu surface: semantic popover colors, an 8 px radius, a subtle ring,
and the shared elevation shadow. Content has a preferred width of 320 px,
16 px viewport clearance, and a scrollable height bounded by the available
space. Place panels 6 px from their anchor; let collision handling flip and
shift them. Keep frequent popover feedback immediate.

Completion uses the same Popover content with a caret anchor and keeps focus
in the editor. Its list uses 4 px insets, 4 px item radii, 32 px minimum rows,
and a scroll limit of 288 px or the available height, whichever is smaller.
Keep the selected suggestion visible as the user moves through the list.
Field hover cards retain Base UI Hover Card behavior and use the same surface,
text, spacing, wrapping, and viewport bounds. Titles, paths, types, and syntax
wrap inside these cards; sample values may scroll. These editor surfaces keep
their existing keyboard and pointer lifecycle.

### Type and wording by role

Inter carries the utility chrome in sentence case. Use 16 px semibold for
the Profile name; 12 px semibold for pane headings, card summaries, and notice
headings; 12 px medium for form labels; and 12 px muted for hints and status.
Body sentences use 14 px where they are the pane's sole content. Set wrapping
hints with `text-pretty` and keep chrome text at 12 px or larger.

Template source uses IBM Plex Mono at 14 px with a unitless 1.5 line height.
Below 640 px, the editor, text inputs, and native selects use 16 px text to
keep mobile input readable. The [editor theme](src/lib/workbench/editor-theme.ts)
and control variants own that transition. The rendered note keeps
[reading-view typography](src/lib/workbench/reading-view.tsx), so the preview
shows the content hierarchy the template produces.

Name objects directly. The field panel is **Template fields**; its current
context is **Note**, **Annotation**, or **Note name**. Use short nouns for
labels and verbs for actions, with instructions in complete sentences. A menu
item that sets a mode starts with the verb that names the outcome ("Preview as
new note"), and a checkbox describes its on state ("Automatically refresh
preview"). Read the current labels from
[the message catalog](../../messages/en.json) and keep terminology consistent
with [the vocabulary](../../policies/vocabulary.md).

### Grouping and feedback

Use space to show relationships: 4 px from a form label to its control, 8 px
between rows in a card, 12 px between fields, and 16 px between groups.
Cards inset 10 px horizontally and 8 px vertically. A disclosure card uses
its summary as the heading and a chevron as the visible expansion cue.

In Match, follow the Bases editor's hierarchy: nested groups span their
parent's content width and add a small inner inset. Individual conditions
use a right-aligned label column: “where” first, then “and” or “or”. Align
each group's selector and add actions to its leading edge, with 8 px gaps
between controls. Place Remove match as a destructive text button beside
the root group's selector.

Use the site's semantic color tokens. Save or Download is the filled primary
header action; Connect and the Profile menu use outline buttons. Basic and
Source share a muted segmented track, with a card surface and pressed state
on the active segment. Lucide icons inherit the control's color. Keep frequent
editing feedback immediate so the interface stays steady while typing.

Inline notices share one shape: `bg-fd-accent/40`, a 2 px `border-s` accent bar,
12 px horizontal and 8 px vertical padding, and `xs` actions at the trailing
edge. Apply it to restore prompts, Problems, preview problems, format and
language confirmations, annotation bars, and the on-demand preview notice.
The text states the condition and the next action; color supports that
meaning. A stale result is worded by its cause: a problem hold keeps "Showing
the last preview"; an on-demand wait says the preview is behind the edits;
a live render in progress shows the busy indicator and no sentence.

The annotation action adds all item annotations at the end of the note body.
Start the insertion on a new line and add no blank line above it. Preserve
the editor selection’s text, reveal the insertion, and undo the insertion
and any required annotation-section repair together.

### Adapt the composition

At 1180 px and wider, keep fields, editor, and result in three columns. Below
that, **Add a field** opens the field sheet. Below 780 px, switch between editor
and result views. These folds protect usable editing width. Let a short,
narrow viewport scroll the page while the editor retains room for several
lines. Preserve full labels through wrapping or an accessible expanded view.

Use logical properties (`ms-`, `ps-`, `border-s`, `start-`, `end-`) for directional
layout. Keep Help and sheet triggers named and reachable by keyboard, preserve
visible focus, and return focus when their overlays close. Compact controls
retain at least a 24 px target with distinct, non-overlapping hit areas.

## Available primitives

Use the kit's size variants for button, input, and select height, internal
padding, text, and icons. Call sites compose layout (`flex-1`, `ms-auto`, `mt-2`)
and states (`aria-pressed:*`, `data-pressed:*`). A repeated control size belongs
in the kit so the header, toolbar, forms, and notices change together.

| Role | Component / variant | Size |
| --- | --- | --- |
| Header action, pane action, form button, notice action | `Button size="xs"` | 32 px, 12 px text, 14 px icon |
| Segment inside a segmented control | `Button size="2xs"` | 28 px in a 32 px pill |
| Template tabs | `PaneTabList` in the shared frame | 28 px tabs in a 32 px strip, 12 px text |
| Icon button on the control row (undo, redo, close) | `Button size="icon-sm"` | 32 px |
| Icon button inside a list row or card | `Button size="icon-xs"` | 28 px |
| Icon button inline in a chip or compact list row | `Button size="icon-2xs"` | 24 px |
| Action menu | `DropdownMenuContent size="xs"` | 32 px minimum rows, 12 px text, 14 px icons |
| Text input, native select | `size="xs"` | 32 px, 12 px text on desktop |

Treat text-bearing control heights as minimums. Let them grow for wrapped
labels and mobile text. The kit owns the values in
[Button](src/components/ui/button.tsx), [Input](src/components/ui/input.tsx),
and [NativeSelect](src/components/ui/native-select.tsx). Marketing and docs
chrome keep their `sm` and `default` sizes.

Menus use the same density as their triggers, with 4 px outer insets and 8 px
horizontal row padding. Let labels wrap within the viewport.

Shared surfaces and their owners:

| Primitive | Owner | Use it for |
| --- | --- | --- |
| `WorkbenchFrame`, `WorkbenchSkeleton`, `WorkbenchHelp`, `AddFieldButton` | [frame.tsx](src/lib/workbench/frame.tsx) | The page shell, its control row, Help at every pane |
| `Popover` kit | [popover.tsx](src/components/ui/popover.tsx) | Help, the connection control, completion, hover cards |
| `toast.add()` | [toast.tsx](src/components/ui/toast.tsx) | Routine action confirmations |
| `ResultHeader`, `ResultBody`, `ResultColumn`, `PreviewControls` | `@zotlit/workbench/ui` | The rendered result and its stale notice on both hosts; a host that owns its own heading composes `ResultBody` |
| Render scheduler `staleReason` | `@zotlit/workbench/ui` | Which stale sentence a host shows: hold, on demand, or none |
| Theme parts per component | [web theme](src/lib/workbench/theme.tsx), [Obsidian theme](../obsidian/src/views/profile-editor/theme.tsx) | Every class a shared part wears; a new part needs a value in both |
| `profileEditorButton`, `selectionBar`, `selectionControl`, `selectionHint` | Obsidian theme | Text buttons, the selection row, its triggers, and hint text in the Obsidian panes |
| `addAction`, `onPaneMenu` with `setSection` and `setChecked` | Obsidian API | Header actions and grouped, checked pane menu items |

## Patterns to avoid

Named so a reviewer can point at one. Each has a decision above that replaces it.

- **Select stack.** A row of labelled `<select>` controls between the pane
  title and the content. Move the settings into the pane menu or the frame's
  control row and leave a caption.
- **Card in a pane.** A bordered, padded box around a rendered note inside a
  pane that already frames it. The pane is the box.
- **Setting as status.** A permanent status line that restates a setting, such
  as "Live preview paused" beside an On demand select. Show a notice only while
  a condition holds, with its action.
- **Silent menu state.** A setting reachable only through a menu, with nothing
  in the content that names its current value.
- **Noun-only menu choice.** A menu item such as "New note" that reads as an
  action on the vault. Start it with the verb that names the outcome.
- **Two flags, one choice.** Two independent settings whose combinations
  include states the reader cannot tell apart. Offer one checked choice that
  maps onto the stored flags.
- **Heading echo.** An in-content heading that repeats the native title. A
  heading earns its line by naming the role the title does not.
- **Mode switch in content.** A segmented control above a list that chooses
  between two vocabularies for the same data. Group the list into sections
  and let disclosure carry the choice.
- **Wrong-cause sentence.** One stale message for every cause, such as
  "Resolve the problem below" while the preview merely waits for Run.
- **Layout in JavaScript.** Viewport or container detection in state to pick
  the sidebar or full-pane layout. Use the native container selectors.
- **Assembled string.** A sentence built from fragments around a variable.
  Use a full templated message.

## Enforcement

Place each accepted correction with its owner, following the
[Vercel design.md approach](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md):

| Owner | What belongs there |
| --- | --- |
| This spec | Judgment: task order, density, alignment, disclosure, and type roles |
| Shared components and tokens | Reusable mechanics: control variants, the common frame, and theme values |
| [Design check](src/lib/workbench/design.test.ts) | Mechanical rules: popovers from the kit, supported control sizes, Button size overrides, logical direction classes, and chrome type utilities |

The check scans source; rendered-note typography is exempt from its chrome
type rules. Use runtime inspection for wrapping, alignment, focus, contrast,
and whether the page supports the editing task.

For UI changes, use [design-review](../../.claude/skills/design-review/SKILL.md)
and the six domain skills routed by `better-interface`. Keep the same Profile,
Sample Item, editing mode, theme, and viewport when comparing a correction.
Cover the affected normal, loading, empty, error, and recovery states. Compare
all affected forms when a shared variant changes.

For layout changes, extend the review's desktop and narrow scenarios to both
folds, 320 px, and 200% zoom. For text or theme changes, include long translated
labels, the RTL layout, and both color schemes. Record measured control and
content edges with screenshots; identify any check that remains unverified.

### Feedback loop

A correction from a review, a grilling, or an issue enters this file as one
observable sentence, not as an impression: "the note starts within one
control row of the pane top", not "the header feels heavy". Write it where
the narrowest owner can enforce it: a kit variant when the mechanics are
shared, a regression check when the failure is measurable, a decision here
when it is judgment. When the same correction recurs, give the pattern a name
under **Patterns to avoid**. Rerun the affected scenario to confirm the
correction; a fix that does not stop the recurrence is the wrong fix.
