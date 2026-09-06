# Annotation format has its own Workbench tab

The web Template Workbench separates annotation placement from annotation
formatting. The Note tab controls where annotations appear; an always-available
Annotation tab edits the Profile's Annotation Section with the existing
template editor and Annotation Root fields. The format also supplies direct
insertion and Imported Notes, so access to it is independent of calls in the
note. This gives formatting one stable home, at the cost of a tab change from
its use in the note.

Basic orders its tabs as Note, Properties, Annotation, and Name and folder.
It presents an annotation render call as a compact inline Annotation placeholder,
collapsed by default. Its arrow opens one read-only example in a full-width block
below the line containing the call. Opening another example moves this shared
preview to that call. The preview includes the annotation chooser; Edit format
opens the Annotation tab. Source mode exposes the original call;
surrounding loops remain editable in the Note tab. The existing source editor
and field insertion controls remain the format's authoring surface.
Every placeholder uses the same actions and opens the same format editor.
Returning to Note preserves its scroll position, caret, and expanded preview.
Annotation calls and Managed Block tags reveal their source when a cursor or
selection touches them. Moving the selection away restores their widgets. The
managed region keeps its background while its boundary tags are editable.

The Annotation tab's result pane shows one example annotation. The
Note tab keeps the whole-note result and its Managed Region view. The example
is identified as such: the selected annotation can differ from the annotation
a particular call receives. The active tab determines the field
context and result, so the reader can edit one task with its relevant data
and output together.

Annotation examples are selected through a searchable suggester using the
[shadcn Base Command dialog](https://ui.shadcn.com/docs/components/base/command).
Its list includes representative built-in Sample Annotations and annotations
from the selected Item Snapshot, grouped under Examples and From this item.
The format result, the expanded Note preview, and annotation field values
use the same selected example.

The literature Item Snapshot and annotation example are independent selections.
Choosing a built-in annotation changes the annotation preview and field values
while the note result continues to use its selected Item Snapshot. Each example
retains its own parent Item and attachment data, so fields and citations describe
that example consistently. A selected example is preview data; annotation calls
in the note continue to render with the data their source supplies.

The built-in annotation set has one example of each supported type: highlight,
underline, note, text, image, and ink. Together these examples cover comments,
tags, and empty optional fields. Both the note and annotation reading previews
display image output with bundled placeholder images. This applies to built-in
examples and annotations from the selected Item Snapshot. Image targets identify
where a placeholder belongs; device image contents remain unread. The rendered
Markdown retains its image references.

The literature Item Snapshot selector uses the same suggester interaction.
A short title label and a button replace the select control beside the result;
the dialog gives the choices room for their full titles and identifying details.
Both suggesters focus search on open, support arrow-key navigation and Enter
to select, and return focus to their trigger on close. Escape keeps the current
selection. The active choice has a visible selected state. Empty groups show a
muted explanation: Obsidian is disconnected, no Item Snapshot is loaded, or the
current Item has no annotations.

The active result shows its relevant selector: the literature Item Snapshot
on the existing authoring surfaces, including Source, and the annotation example
on Annotation. Inline placeholders reuse the selected annotation example
and offer Edit format for navigation.

The browser draft keeps the annotation choice with the document and literature
Item Snapshot. A built-in choice stays selected when the paper changes. An
annotation from the current Item is retained by identity on refresh; when it is
unavailable, selection falls back to the current Item's first annotation, or the
built-in highlight when the Item has none. A fresh annotation selection uses
that same default.

The Annotation tab shows format errors beside its editor. A document
missing the Annotation Section offers the existing repair action there, which
adds the section header and opens the empty format for editing. Inserting
annotations into the note remains a separate Note action.

Both tabs edit the same Profile document through targeted source edits and
share its undo history, Save behavior, and invalid-draft rules from
[ADR 0032](0032-web-workbench-edits-one-source-document.md). The Annotation
Section and its rendering scope remain as defined in
[ADR 0035](0035-profile-annotation-section.md). This amends the inline editor
and annotation preview placement from
[ADR 0037](0037-annotation-box-opens-on-the-annotation-it-produces.md).
