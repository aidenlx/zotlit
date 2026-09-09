# Template Workbench — design spec

The Workbench is a compact editing utility for a literature note Profile,
hosted at `/workbench`. Its users are researchers and academics —
domain experts in their fields, not programmers. Name objects with the
vocabulary of literature management (fields, notes, annotations,
properties), not with implementation terms. Keep error messages concrete:
state what happened and the next action, without technical internals.
Place guidance behind a visible Help control beside its task rather than
assuming documentation has been read.

The main loop: choose a field, edit the template, inspect the note. Give
those three tasks the available space. Apply the same density to Note,
Properties, Name and folder, handoff, and the loading frame.

Shared brand rules — the token system, the four-face type system, and the
editorial voice — live in [DESIGN.md](DESIGN.md). The Workbench departs
from the site's mono-uppercase label voice: its utility chrome uses Inter
sentence case, including labels and pane headings.

## Protect the editing space

Keep the Profile name and file actions in the header. Place the sample picker
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

## Control vocabulary

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

In Obsidian, all Profile editor text buttons and standalone selects share the
Match tab's outlined native surface. Define its normal, hover, and border
variables once on the Profile editor root. Share text-button classes through
`profileEditorButton`; call sites add layout and state only. Match condition
controls retain their joined input surface through local variable overrides.
Use native icon controls for row actions and navigation.

In the Obsidian Profile editor, property cards keep the compact 8 px inset and
native medium radius. Preserve the title button’s native padding and align the
expanded form to the title and summary with a matching inline inset
(`--size-2-3`). Use 6 px within field
groups and 12 px between groups. Keep labels compact and place the value format
selector beside its label in a wrapping row. A chevron shows whether the
property is expanded. Name and folder contains its editing controls directly.

## Popovers and editor cards

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

## Type and wording by role

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
labels and verbs for actions, with instructions in complete sentences.
Read the current labels from [the message catalog](../../messages/en.json)
and keep terminology consistent with [the vocabulary](../../policies/vocabulary.md).

## Grouping and feedback

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
language confirmations, and annotation bars. The text states the condition
and the next action; color supports that meaning.

The annotation action adds all item annotations at the end of the note body.
Start the insertion on a new line and add no blank line above it. Preserve
the editor selection’s text, reveal the insertion, and undo the insertion
and any required annotation-section repair together.

## Adapt the composition

At 1180 px and wider, keep fields, editor, and result in three columns. Below
that, **Add a field** opens the field sheet. Below 780 px, switch between editor
and result views. These folds protect usable editing width. Let a short,
narrow viewport scroll the page while the editor retains room for several
lines. Preserve full labels through wrapping or an accessible expanded view.

Use logical properties (`ms-`, `ps-`, `border-s`, `start-`, `end-`) for directional
layout. Keep Help and sheet triggers named and reachable by keyboard, preserve
visible focus, and return focus when their overlays close. Compact controls
retain at least a 24 px target with distinct, non-overlapping hit areas.

## Enforcement

Place each accepted correction with its owner, following the
[Vercel design.md approach](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md):

| Owner | What belongs there |
| --- | --- |
| This spec | Judgment: task order, density, alignment, disclosure, and type roles |
| Shared components and tokens | Reusable mechanics: control variants, the common frame, and theme values |
| [Design check](src/lib/workbench/design.test.ts) | Mechanical rules: supported control sizes, Button size overrides, logical direction classes, and chrome type utilities |

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

A repeated correction becomes a concise decision here. Add a kit variant when
the mechanics are shared, and a regression check when the failure is measurable.
Rerun the affected scenario to confirm the correction.
