# ZotLit Query

The field-oriented query capability for Zotero Items, their Attachments, and their Annotations. One query names its Query Dataset, evaluates ZotLit Filter Expressions, and returns one result set from one or more Libraries.

## Language

**ZotLit Query**:
The capability as a whole: one query form over three Query Datasets, with one result envelope, one Query Schema, one Query Clock, and one set of Target Libraries. The dataset names below name what one query reads.
_Avoid_: Item Query (as the umbrella), Zotero Query, DB Query

**Query Dataset**:
The kind of record that a query reads and returns, with everything that differs between the kinds: the fields and their Projection Paths, the Relation Lists, the Sortable Fields, the defaults, the Filter Expression vocabulary, and the readers. There are three Query Datasets: Item Query, Attachment Query, and Annotation Query. A query names its Query Dataset; one request planner, one diagnoser, and one execution serve all three.
_Avoid_: kind, dataset flag, query mode, table

**Item Query**:
The Query Dataset of Items: a query over the top-level, non-trashed Items of its Target Libraries. It contains one optional Filter Expression, selected fields, sort fields, and an optional result limit. The Items of all its Target Libraries are filtered, sorted, and limited as one set. An Item reaches its Attachments and its Annotations through Relation Lists.
_Avoid_: Base Query, Zotero Query, DB Query

**Attachment Query**:
The Query Dataset of Attachments: a query over the non-trashed Attachments of top-level, non-trashed Items in its Target Libraries. An Attachment of no Item (a standalone Attachment) is outside the universe, so every row has a parent Item. An Attachment reaches its parent Item and its Annotations through Relation Lists.
_Avoid_: file query, PDF query (Attachments can be PDF, EPUB, snapshot, or a link with no file)

**File Type**:
The kind of an Attachment: `pdf` for a PDF, `epub` for an EPUB, `web` for a web snapshot or a link to a web page, and `other` for every other Attachment, including one with no known content type.
_Avoid_: file kind, MIME type (the stored content type)

**Annotation Query**:
The Query Dataset of Annotations: a query over the non-trashed Annotations of the non-trashed Attachments of top-level, non-trashed Items in its Target Libraries. It selects Annotations through one Filter Expression, which reads Annotation fields and, through Relation Lists, the parent Attachment and the parent Item, and returns one Annotation Row per Annotation. A sibling of Item Query and Attachment Query: the three share Target Libraries, the result envelope, and the Query Clock.
_Avoid_: PDF annotation query (Attachments can be PDF, EPUB, or snapshot), annotation search, highlight query

**Parent Record**:
The single record that a record belongs to: the Item of an Attachment, or the Attachment and the Item of an Annotation. A dotted path reaches a Parent Record, such as `item.title`.

**Relation List**:
A list-valued field of a Query Dataset that holds one element for each related source row. In projection, a `creators` element is a creator with `family`, `given`, `literal`, `fullName`, and `role`. A `collections` element is text. A `tags` element is text on Attachments and Annotations, and a tag with `name` and `type` on Items. In Filter Expressions, `creators`, `tags`, and `collections` have text elements. The element is a record of another Query Dataset for `attachments` and `annotations` on an Item and `annotations` on an Attachment. A Relation List is read in a Filter Expression with the list methods of the language and in a Projection Path by element; it is never vectorized implicitly. The parent of an Attachment (`item`) and the parents of an Annotation (`attachment`, `item`) are single records, read with dotted paths such as `item.title`. Relations run in both directions, so a question can start at any of the three datasets.
_Avoid_: join, relation (alone), child list, link

**Annotation Row**:
One Annotation in the result of an Annotation Query. It carries the Annotation's Indexed Key, its parent Attachment and parent Item identities, and a flat map from each requested Projection Path to its value. Its position and Excerpt Image are available on request rather than by default.
_Avoid_: annotation entry, annotation object, highlight row

**Query Result**:
The complete ordered set of projected rows that a query returns from its Query Dataset.
_Avoid_: Base Entries, view result

**Query Row**:
One record in a Query Result. It contains the record's Indexed Key, the Indexed Keys of its parents when the Query Dataset has them, and a flat map from each requested Projection Path to its value. An Annotation Row and an Attachment Row are Query Rows of their datasets.
_Avoid_: Base Entry, database row, Item object

**Projection Path**:
A documented template-style accessor that selects data from a Query Row, such as `date.year`, `creators[0].fullName`, or `custom["review.status"]`. Selecting a parent path returns its complete structured value; array access does not vectorize implicitly.
_Avoid_: column expression, property expression

**Sortable Field**:
A scalar field of the Query Dataset, or a scalar field of a parent record such as `item.title`, that can order a Query Result. A value derived from a Relation List, such as its length, is not a Sortable Field. Null values sort last, and Indexed Key is the stable final tie-breaker, also between records of two Target Libraries: Indexed Keys compare as text, so the same Zotero Key in the groups 10 and 9 gives the order `g10`, `g9`.
_Avoid_: sort expression, sort path

**Query Group**:
One group of a grouped Query Result: a value of the group path, the number of matched records with that value, and their Query Rows up to the limit. A scalar group path puts each record in one group. A group path with one `[]`, such as `tags[].name` or `collections[]`, puts each record in one group for each distinct element value; a record with no element value is in the `null` group. Groups can overlap, so their counts can add up to more than the number of matched records.
_Avoid_: bucket, facet

**Query Schema**:
The source-aware description of the three Query Datasets: their fields, Projection Paths, Relation Lists and the dataset each one reaches, functions, value shapes, defaults, and filter, projection, and sort capabilities. A bare name that matches a built-in field, alias, or reserved name always means the built-in; `custom["name"]` reaches every custom field.
_Avoid_: field list, query metadata, Item Query Schema

**Target Library**:
A Library that a query reads. A query has one or more Target Libraries: by default the available Libraries of Library Scope, or the Libraries that the caller names, each as `personal` or `group:<groupID>`. A named Target Library can be outside Library Scope. A key inside a Filter Expression never adds a Target Library; a key that names another Library gives a Query Warning. Target Libraries have the canonical order of Library Scope: My Library first, then groups by ascending group ID.
_Avoid_: active library, library ID, query scope

**Query Clock**:
The one instant and one time zone that a query uses for every date function and every calendar-day comparison.
_Avoid_: current time, system time

**Fault**:
A typed fact that ZotLit Query states about an invalid request, or about a Filter Expression that can never match: the kind of mistake, the place, and what was found and expected there. A Fault carries no sentence.
_Avoid_: error message, problem, hint

**Diagnostic Report**:
The lines an agent reads for one Fault: the statement, an excerpt with the place marked, notes on the value the name was read on, and the action last. Every Diagnostic Report is written from a Fault by one renderer.
_Avoid_: rendered error, error text, stack trace

**Query Warning**:
A finding on a successful query that still answered: a comparison between two values whose types can never be equal, so that part of the filter selects nothing or everything, a key that names a Library outside the Target Libraries, or a literal Collection path absent from every Target Library. It arrives with the Query Result, not instead of it.
_Avoid_: soft error, lint, notice
