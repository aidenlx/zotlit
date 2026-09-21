# Excerpt cache identity is shared across verified Annotation Sources

Accepted design; implementation is pending.

An Excerpt Image generated from a Zotero Local API snapshot can be requested again during a database-backed note operation. Both requests share a generated-image cache identity when their sources are verified as belonging to the same Zotero database and their source scope, Library, Attachment, Annotation, rendering inputs, and renderer version match. PDF freshness retains the size and modification-time checks in [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md).

The selected Annotation Source continues to supply the complete snapshot used by each consumer. Cache reuse compares that snapshot's pixel inputs; it preserves atomic source selection and database isolation. Requests whose database equivalence cannot be verified retain separate identities.

This trades source-specific cache partitioning for verified reuse across viewing and note operations, avoiding duplicate PDF parsing and rendering for identical pixels. The identity change must preserve existing durable vault assets and their links.
