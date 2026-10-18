# The Papers Layout is a Query View Layout the Library View offers with the Table

The Papers Layout is a fifth Layout of the Query View for the Items dataset, next to Annotations, Table, List and Cards: each Item row has two lines (the title, cut to one line; creators, year and publication), and it expands into Attachments, child notes and Annotations through the expansion the Table uses. A Query File can name it like any Layout, so "Save as query file" reproduces the rows the Library View shows. The Library View offers only Papers; a host names the Layouts it offers, and the view menu lists only those (amended after the second interface review: the Table left the Library View, which is no place for the full Query View).

Proposed on 2026-10-17 with [#1547](https://github.com/aidenlx/zotlit/issues/1547).

## Considered Options

- **Rows drawn by the Library View itself** (rejected): a second Item list beside the Query View, with its own expansion, selection and refresh, and a saved Query File could not show it.
- **Restyle the List Layout** (rejected): List is a Layout of every dataset, and a Query File that uses it today would change.
- **A new Layout, offered per host** (chosen): one way to draw Items, available to every Query File, and the Library View stays as small as its jobs.

## Consequences

- The Query View host contract gains the list of Layouts it offers; a host that names none offers every Layout of the dataset, as today. Under `displayOnly` (ADR 0071) a host that offers one Layout shows no view menu at all. A host that gives `saveAs` shows "Save as query file" as a toolbar button (#1553); the saved file uses the Papers Layout, so it opens on the rows the Library View showed, with the Table and every other control one click away.
- A row has no reading-state line (amended after the second interface review): three lines per paper with an Annotation count read as noise in a list meant for finding a paper. The row reads only the title, creators, date, Venue and Attachment kinds, not the Annotation colours. The reason the host gives the row, when it gives one (ADR 0076), ends the second line. The Literature Note shows as the note icon at the end of the row; the Annotated facet and the Reading Card carry the rest of the Reading State.
- In the Table and Papers Layouts, a child note row links to the note in Zotero through `zotero://select`, the link Show in Zotero opens (ADR 0074).
