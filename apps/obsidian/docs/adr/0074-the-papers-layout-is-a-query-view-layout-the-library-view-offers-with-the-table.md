# The Papers Layout is a Query View Layout the Library View offers with the Table

The Papers Layout is a fifth Layout of the Query View for the Items dataset, next to Annotations, Table, List and Cards: each Item row has two lines (title; creators, year and publication) and a reading-state line, and it expands into Attachments, child notes and Annotations through the expansion the Table uses. A Query File can name it like any Layout, so "Save as query file" reproduces the rows the Library View shows. The Library View offers only Papers, its default, and Table; a host names the Layouts it offers, and the view menu lists only those.

Proposed on 2026-10-17 with [#1547](https://github.com/aidenlx/zotlit/issues/1547).

## Considered Options

- **Rows drawn by the Library View itself** (rejected): a second Item list beside the Query View, with its own expansion, selection and refresh, and a saved Query File could not show it.
- **Restyle the List Layout** (rejected): List is a Layout of every dataset, and a Query File that uses it today would change.
- **A new Layout, offered per host** (chosen): one way to draw Items, available to every Query File, and the Library View stays as small as its jobs.

## Consequences

- The Query View host contract gains the list of Layouts it offers; a host that names none offers every Layout of the dataset, as today. Under `displayOnly` (ADR 0070) the view menu shows only this Layout switch, with no Add view or Configure view. A host that gives `saveAs` adds "Save as query file" below the Layout rows (#1553).
- The reading-state line omits when the Item was last read until ZotLit Query reads `lastRead` (#1532, #1533).
- The Library View Document stores `papers` or `table`; a stored Layout this build does not offer takes the default.
- The reading-state line counts every Annotation type and reads "N annotations", as the Annotated facet counts them, with up to five colour marks; it ends with the reason the host gives the row, when the host gives one (ADR 0075); a line with nothing to say is left out. The Literature Note shows as the note icon at the end of the row, not as words on the line, so the row says it once (amended after the interface review).
- In the Table and Papers Layouts, a child note row links to the note in Zotero through `zotero://select`, the link Show in Zotero opens (ADR 0073).
