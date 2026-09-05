# The highlight box opens on the highlight it produces

In the web Template Workbench's Basic mode, the first annotation render
call in the note is the highlight box (ADR 0035). The box now opens on one
rendered highlight — the sample's first, in the current format — and holds
the Annotation Section's source behind an "Edit format" press, with "Done"
leading back. Both faces stay mounted and cross-fade in place at a fixed
height, so the note text around the box never moves. A format the render
refuses shows the render's own sentence in the preview face with a "Fix
format" press that opens the source; a sample without highlights says so
and leaves the edit path open.

The box keeps the semantics the call carries and the beginner face hides.
Its header names the format and says how many highlights in the note it is
used for. While the reader hovers or focuses the box, that sentence gives
way to the real call and an "Open in Source" link, so the bridge to Source
mode is one look away without appearing in the reading flow. Later calls
in the note are chips carrying the format's name and a hint back to the
first box. A note that calls the format nowhere offers "Insert highlights
here", which puts the loop over every highlight where the caret is, adds
the missing section first when the document lacks one, and says so in the
status line until the next edit.

The result column stays on the whole note while the box is open. The
renderer reports where each highlight's output landed in the note body, and
the sheet gathers each run of blocks into one marked block; those blocks
light up together while the reader is at the box, and the first is scrolled
into view once per visit. The renderer also renders the Annotation Section
on its own before the note, so a failure inside the format is reported as
the format's part and can be shown where the format is edited.

This replaces the result-column swap to a single-highlight view, and the
Source-mode detour for a note without a call, both from the #863 Workbench
work under ADR 0035. The single-highlight view duplicated what the box now
shows in place, and the swap hid the one-to-many relationship the column
now points at. The box's editable face remains a source editor; a chip
editor over the format's tags was considered and deferred until the
preview-first box has been tried with the Basic mode's readers.
