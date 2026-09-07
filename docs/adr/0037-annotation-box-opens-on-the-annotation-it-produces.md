# The annotation box opens on the annotation it produces

> **Amended by [ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md).** Annotation formatting has its own tab. Basic shows a collapsed placeholder with an expandable example and an Edit format action; the new tab pairs the format editor with a single-annotation result.

In the web Template Workbench's Basic mode, the first annotation render
call in the note is the annotation box (ADR 0035). The box now opens on one
rendered annotation — the sample's first, in the current format — and holds
the Annotation Section's source behind an "Edit" press, with "Done"
leading back. Both faces stay mounted and cross-fade in place at a fixed
height, so the note text around the box never moves. A format the render
refuses shows the render's own sentence in the preview face with a "Fix"
press that opens the source; a sample without annotations says so
and leaves the edit path open.

The box keeps the semantics the call carries and the beginner face hides,
first things first. Its first line says what the placeholder does in the
note: each annotation is written here. Under it, the real call stands as a
faint monospace subtitle, always in view, so the reader learns the name the
Source mode uses without a hover or a second control. Only then comes the
format: a labelled row that says how many annotations in the note it is used
for and holds the edit control, over the preview. Later calls
in the note are chips carrying the format's name and a hint back to the
first box. A note that calls the format nowhere offers "Insert annotations
here", which puts the loop over every annotation where the caret is, adds
the missing section first when the document lacks one, and says so in the
status line until the next edit.

The result column stays on the whole note while the box is open. The
renderer reports where each annotation's output landed in the note body, and
the sheet gathers each run of blocks into one marked block; those blocks
light up together while the reader is at the box, and the first is scrolled
into view once per visit. The renderer also renders the Annotation Section
on its own before the note, so a failure inside the format is reported as
the format's part and can be shown where the format is edited.

This replaces the result-column swap to a single-annotation view, and the
Source-mode detour for a note without a call, both from the #863 Workbench
work under ADR 0035. The single-annotation view duplicated what the box now
shows in place, and the swap hid the one-to-many relationship the column
now points at. The box's editable face remains a source editor; a chip
editor over the format's tags was considered and deferred until the
preview-first box has been tried with the Basic mode's readers.
