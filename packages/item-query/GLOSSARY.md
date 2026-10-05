# Item Query

The field-oriented query capability for Zotero Items. It evaluates ZotLit Filter Expressions and returns one result set from one or more Libraries.

## Language

**Item Query**:
A query over the top-level, non-trashed Items of its Target Libraries. It contains one optional Filter Expression, selected fields, sort fields, and an optional result limit. The Items of all its Target Libraries are filtered, sorted, and limited as one set.
_Avoid_: Base Query, Zotero Query, DB Query

**Query Result**:
The complete ordered set of projected Item rows that an Item Query returns.
_Avoid_: Base Entries, view result

**Query Row**:
One Item in a Query Result. It contains the Item's Indexed Key and a flat map from each requested Projection Path to its value.
_Avoid_: Base Entry, database row, Item object

**Projection Path**:
A documented template-style accessor that selects data from a Query Row, such as `date.year`, `creators[0].fullName`, or `custom["review.status"]`. Selecting a parent path returns its complete structured value; array access does not vectorize implicitly.
_Avoid_: column expression, property expression

**Sortable Field**:
A top-level scalar Item field that can order a Query Result. Null values sort last, and Indexed Key is the stable final tie-breaker, also between Items of two Target Libraries: Indexed Keys compare as text, so the same Zotero Key in the groups 10 and 9 gives the order `g10`, `g9`.
_Avoid_: sort expression, sort path

**Item Query Schema**:
The source-aware description of fields, Projection Paths, functions, value shapes, defaults, and filter, projection, and sort capabilities that Item Query accepts. A bare name that matches a built-in field, alias, or reserved name always means the built-in; `custom["name"]` reaches every custom field.
_Avoid_: field list, query metadata

**Target Library**:
A Library that an Item Query reads. An Item Query has one or more Target Libraries: by default the available Libraries of Library Scope, or the Libraries that the caller names, each as `personal` or `group:<groupID>`. A named Target Library can be outside Library Scope. Target Libraries have the canonical order of Library Scope: My Library first, then groups by ascending group ID.
_Avoid_: active library, library ID, query scope

**Query Clock**:
The one instant and one time zone that an Item Query uses for every date function and every calendar-day comparison.
_Avoid_: current time, system time
