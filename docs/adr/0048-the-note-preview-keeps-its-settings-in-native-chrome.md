# The Note preview keeps its settings in native chrome

The Note preview pane in Obsidian stacked two rows of labelled selects above
the rendered note: Preview mode (Create, Update) and Refresh preview (Live, On
demand) on one row, then an h2 "Note preview" beside Show (Complete note,
Updated section only) and Preview format (Reading view, Markdown). In the
linked full pane at 366 px, the note body started about 280 px below the
pane top, under a 38 px native header, 68 px of controls, a 95 px result
header, and a bordered card with its own 12 px inset. Three of the four
settings change rarely, the heading repeated the native title's "Preview"
role, and "Live preview paused" stayed on screen for as long as On demand
was selected, describing a setting as if it were an event.

Decided in the Note preview grilling on this branch (2026-09-10): the pane
keeps its settings in Obsidian's own chrome. The pane menu has three
sections: the selection actions; one checked choice of note that starts with
the verb Preview — Preview as new note, Preview as updated note, Preview
updated section only; and the display checkboxes Automatically refresh
preview and Show Markdown. Show Markdown and the updated-section choice are
also view actions that swap icon and label like Obsidian's reading-view
toggle. The content starts with one 12 px pane heading, which still names
Note preview, Final properties, or Annotation example as the editor's tab
changes, beside a muted caption that names the chosen note and, in on-demand
mode, "On demand". The rendered note sits on the pane surface with no card.

The note choice is one question, "which note am I looking at", over the two
stored flags. Create and Update pick the base note; the managed region is the
same text under both, and Update equals Create whenever the Item has no note
in the vault. The menu maps the triple onto `mode` and `showManaged` in one
store write, so persisted layouts and the web Workbench need no migration,
and Preview as updated note is disabled while the last result reports no
existing note.

On-demand feedback follows the render scheduler's stale reason instead of
the refresh setting. The shared scheduler publishes `staleReason` — hold,
demand, live, or null — and refreshes it when a queued render is dropped on
switching to On demand. The Obsidian pane shows an inline notice with Run only
while the result is behind the edits ("Preview is behind your edits.") or
nothing has rendered yet ("No preview yet."); a live render in progress shows
the busy indicator and no sentence; a problem hold keeps "Showing the last
preview". This amends issue #1022's story 4, which had Stop say "Live preview
paused" on both hosts: no Stop control shipped, so the line restated the
select. The web Workbench keeps its own Run and paused line in its controls
and gains only the corrected stale wording.

## Considered options

- **Keep the selects in content, tighten the rows**: keeps every setting
  visible, and keeps about 160 px of chrome above the note in a pane whose
  task is inspecting the note.
- **Pane menu only, no view actions**: the smallest change, and two clicks
  to switch format while reading, with no visible cue that Markdown exists.
- **Two independent menu settings, mode and scope**: mirrors the stored
  flags, and offers four combinations of which the reader can tell three
  apart.
- **A pressed-state toggle for the note choice**: the Profile Editor's
  Advanced action uses it, but the note choice is a view of the result, and
  the reading-view idiom names the view the next press shows.
- **Keep the permanent "Live preview paused" line**: matches 1022's wording,
  and stays on screen while nothing needs rendering.
- **Drop On demand from the Obsidian pane**: fewest states, and removes the
  escape hatch for a slow template on a slow machine.

## Consequences

- `@zotlit/workbench/ui` exports `ResultBody`, the result without its
  heading, for a host that composes its own; `ResultColumn` is the header
  plus the body for the web page.
- `RenderSchedulerState` carries `staleReason` beside `stale`; the stale
  sentence is chosen by reason, on both hosts.
- The Obsidian mock records disabled menu items and stamps `data-icon`, so
  pane tests drive the pane menu and header actions rather than selects.
- WORKBENCH-DESIGN.md records the resulting rules under "Native chrome
  carries rare choices", and names "Select stack", "Setting as status", and
  "Card in a pane" as recognizable design failures.
- The web Workbench still shows "Live preview paused" in its own controls
  beside the new notice; retiring it is a web-side follow-up.
