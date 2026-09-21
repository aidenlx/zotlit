# Reader and detached excerpts share cache publication

Accepted design; implementation is pending.

ZotLit's PDF reader integration and detached excerpt rendering publish generated Excerpt Images to the same ZotLit-owned cache through the shared Excerpt Image service. Both paths use the same verified identity, freshness validation, image-format policy, duplicate-work coordination, and cache-clear generation checks. Reader and detached work must cooperate without changing the reader's visible output or invalidating its owned resources.

This extends [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md) with a reader producer while preserving detached operation when no reader is open. The reader currently paints full pages and Annotation Marks rather than cacheable Excerpt Images; the integration must establish equivalent excerpt content and rendering inputs before sharing entries. Zotero's externally owned PNG cache retains its fallback role.

An excerpt request uses a compatible loaded Obsidian PDF document when available and generates only the requested image or ink crop. Viewing a PDF page alone does not proactively generate all Excerpt Images. Reader-backed excerpts follow the same geometry, saved Annotation snapshot, and lossless WebP policy as detached excerpts; visible reader overlays are not the source of cached pixels.

Batch import and PDF reader viewing are mutually exclusive workloads for this design. Their cache entries remain reusable when the user switches workflows. Excerpt work owns its render task and output canvas while the reader retains ownership of its document, pages, and visible render tasks. Reader closure or document replacement must invalidate access to borrowed resources.

Reader reuse must establish which PDF revision the loaded document represents. A current filesystem size and modification time alone cannot establish that a previously loaded document contains the current bytes. When that evidence is unavailable, detached rendering supplies the validated source. A reader that closes or replaces its document during excerpt work invalidates that attempt; a still-requested excerpt can retry through detached rendering. The existing Reader Session identifies which reader holds a compatible Attachment; a narrow adapter over its PDF view binding, not the Reader Session interface itself, supplies document access.
