# Excerpt Image storage uses WebP

Accepted design; implementation is pending.

Use lossless WebP for newly generated ZotLit Excerpt Images in the derived cache and durable note assets to reduce encoded image size while preserving small text, equations, and ink strokes. Encode each generated result once and reuse its encoded bytes for cache storage and note materialization. This refines the PNG format assumption in the design behind [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md). Measure encoded size and encoding time against the existing PNG output on representative excerpts to verify the benefit.

Existing durable PNG assets and their links retain compatibility. Zotero-owned PNG sources and frozen Child Note snapshots retain their ownership and meaning. Image format, validated bytes, MIME type, and filename extension must agree at display and storage boundaries.

Zotero fallback PNGs retain their original validated bytes when used or saved by ZotLit. Their freshness remains uncertain, and they remain separate from validated generated cache entries. This keeps the failure-recovery path independent of WebP encoding. New generated WebP assets and retained PNG assets therefore coexist.
