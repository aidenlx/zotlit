# The Annotation Source is atomic per Attachment

Amended by [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md): both surfaces present one continuous annotation collection. Source selection stays internal, refresh preserves the published result until a complete replacement is ready, and source handoff preserves acknowledged writes.

Protocol correction from the 2026-09-19 source review: Zotero stores item and library `clientVersion` in its database. The old implementation below omitted these columns from its read model. Database reading remains a read-only adapter by design; version availability is not the reason writes use the native API.

The annotation repository reads an Attachment's Annotations from one Annotation Source at a time: the Zotero Local API while Zotero answers the capability probe, otherwise the Zotero DB through the database service. The switch is capability-driven, never per request, and a read result carries its source. The two record sets never join — the prototype's projection of Zotero Local API fields onto DB rows keyed by Indexed Key, which dropped every remote-only row, is not carried forward. Reads on the Zotero Local API need no key, so an unauthorized session still reads from it; authorization gates writes alone. Both partitions live in one query-core cache behind the repository, and the DB partition is dropped wholesale on every database refresh.

## Considered Options

- **Project remote fields onto DB rows** (rejected): an Annotation created in Obsidian is missing until SQLite catches up, and a stale DB row can carry a live version number, which is exactly the mix a `412` conflict cannot untangle.
- **Per-request fallback** (rejected): two adjacent Attachments could render from different sources, and one list could show a card the other cannot edit, with nothing to explain why.
- **One source per moment, replaced atomically** (chosen): a record set is either wholly writable, with versions, or wholly read-only, and the source travels with the result so a surface can say which it is.

## Consequences

- A write while the source is the Zotero DB is refused with a typed failure before any request, because the DB partition holds no versions.
- Consumers learn of a switch through the repository's own change event and re-read; nothing patches a list in place.
- The Zotero DB partition may be older than the Zotero Local API partition it replaces; the result's source and capture time are what a surface shows, not a merged "best of both".
