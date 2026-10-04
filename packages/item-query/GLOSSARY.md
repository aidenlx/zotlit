# Item Query

The field-oriented query capability for Zotero Items. It evaluates ZotLit Filter Expressions and returns one result set from one Library.

## Language

**Item Query**:
A query over the top-level, non-trashed Items in one Library. It contains one optional Filter Expression, selected fields, sort fields, and an optional result limit.
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
A top-level scalar Item field that can order a Query Result. Null values sort last, and Indexed Key is the stable final tie-breaker.
_Avoid_: sort expression, sort path

**Item Query Schema**:
The source-aware description of fields, Projection Paths, functions, value shapes, defaults, and filter, projection, and sort capabilities that Item Query accepts. A bare name that matches a built-in field, alias, or reserved name always means the built-in; `custom["name"]` reaches every custom field.
_Avoid_: field list, query metadata

**Target Library**:
The one Library that an Item Query reads. It defaults to ZotLit's configured citation Library and can be overridden with `personal` or `group:<groupID>`.
_Avoid_: active library, library ID

**Query Clock**:
The one instant and one time zone that an Item Query uses for every date function and every calendar-day comparison.
_Avoid_: current time, system time
