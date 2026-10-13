---
status: accepted
---

# The ZotLit Query first author is the first Primary Creator

Amends [ADR 0071](0071-zotlit-query-is-one-command-over-three-datasets-with-relation-lists.md). Decides [#1420](https://github.com/aidenlx/zotlit/issues/1420).

## Decision

- **The rule.** The first author of an Item is the first of its Primary Creators. The Primary Creators are the creators of the first role in this chain that the Item has: the primary creator type of the item type (`author` for a journal article, `director` for a film, `programmer` for software), then `editor`, `director`, and `contributor`. This is the rule of the template `authors`, so `firstAuthor` is the creator that a template shows as `authors[0]`. An Item with no creator in the chain has a `null` first author. An Item with only editors has its first editor as the first author.
- **The shape.** Item Query has the field `firstAuthor`, a creator with `family`, `given`, `literal`, `fullName`, and `role`, as a `creators` element is. A Filter Expression reads it as a record with these five members, such as `firstAuthor.family == "Smith"`. A Projection Path reads the creator or one member. A member path is a group path.
- **Sorting.** `firstAuthor` is a Sortable Field. It orders by the family name, then the given name, in the Item Query string order. A one-field (institutional) name sorts as a family name. Particles and non-Latin scripts use the stored family name and the untailored CLDR root order, with no particle rule. An Item without a first author sorts last.
- **Scope.** Attachment Query and Annotation Query reach it as `item.firstAuthor`, with the same filter, projection, and sort as `item.title`.
- **Hydration.** A hydrated creator carries `primary`: its creator type is the primary creator type of the item type, from Zotero's `itemTypeCreatorTypes`. `firstAuthor` loads the `creators` relation; no other statement runs for it.

ADR 0071 says that a value derived from a Relation List is projection only. `firstAuthor` is an exception: it is one record per Item, read from the one `creators` statement per hydrate chunk that a `creators` projection already runs. Other values derived from a Relation List, such as `annotations.length`, stay projection only.

## Why

Researchers ask for "the first author" in reading lists, exports, and screening. Before this field, `creators[0]` was the only route. It is the first creator of any role, so an editor or a translator can come first, and no creator path could filter or sort. The `zotlit-query` skill told agents to choose the first creator with the author role after the query. The eval `edge` case, an edited handbook whose editor is its first creator, made agents project every creator and choose locally.

ZotLit already has one answer to "who is the author" in its templates and citations. A second rule in the query would give a reading list one first author and the literature note of the same Item another.

## Considered Options

- **The first creator with the role `author`.** Rejected. A film, a software package, or an edited volume then has no first author, while its template and its citation show one.
- **The first creator of the primary creator type, without fallback.** Rejected. An edited handbook with only editors has no first author, while its template `authors` shows the editors.
- **The first creator of any role, as `creators[0]`.** Rejected. This is the behavior the issue reports.
- **Record navigation over `creators`**, such as `creators.filter(value.role == "author")[0].family`. Deferred, not rejected. It answers questions about any role, but a caller still has to know the rule, and it is not sortable.
