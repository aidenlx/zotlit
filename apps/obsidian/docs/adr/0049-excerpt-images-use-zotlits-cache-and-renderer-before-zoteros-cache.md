# Excerpt Images use ZotLit's cache and renderer before Zotero's cache

Accepted design; implementation is pending.

Zotero can remove an Excerpt Image after an ink colour or position change, and its PNG carries no stamp that proves which Annotation and PDF inputs produced it. ZotLit resolves a requested Excerpt Image from its own valid cache first, then attempts rendering without opening a PDF reader, and uses Zotero's PNG only as the final fallback when neither step supplies an image. ZotLit owns its generated cache separately from Zotero's cache; Zotero remains the authority for saved Annotation content.

This contract covers image and ink Excerpt Images in the Annotation View, annotation insertion, and Literature Note creation and update, with neither reader open. Imported Notes use it where annotation-template mode already requests live Annotation data; ordinary Child Note image snapshots retain their existing meaning. New creation tools and geometry editing remain separate work.

Rendering targets equivalent PDF content, crop geometry, and ink appearance. Differences in antialiasing and other engine-specific pixels are acceptable. This replaces the coupling of derived-image generation to future image and ink creation in [Scope derived excerpt images for this milestone](https://github.com/aidenlx/zotlit/issues/826#issuecomment-5694174793).

Durable vault images refresh during note update or re-import. Existing notes retain their saved images between those operations; the Annotation View refreshes independently. Durable generated embeds require Attachment Import to be enabled. With it disabled, note output retains a source link and an explicit unavailable-image fallback.

If every image source fails, the note operation continues. An existing vault image is preserved and reported as not refreshed; a new image is represented by an unavailable-image message and source link. Output must not introduce a broken embed.

A Zotero-cache fallback is displayed normally in the Annotation View. Import reports its use in a summary notice per batch, because its freshness is uncertain. The next refresh or import retries the normal resolution order. A fallback stays distinct internally from a validated ZotLit cache entry.

PDF freshness is determined by file size and modification time. Cache validity also includes the Annotation's rendering inputs and the renderer version. A PDF replacement that preserves both size and modification time can therefore reuse an earlier image; this is an accepted trade-off for avoiding a full-file hash on validation.

New vault image versions use distinct, collision-safe names and are immutable. Updating a note changes its embed to the new asset, so other notes retain their saved images. Existing filenames and older assets are preserved; links migrate only when their note is updated.

The derived cache uses versioned IndexedDB storage per vault on this device, with an initial 256 MiB byte budget, least-recently-used eviction, and a manual clear action. Cache eviction and clearing preserve durable vault assets. The initial budget remains subject to measurement.

When the PDF is unavailable, ZotLit can reuse its own cached image if the Annotation's rendering inputs and renderer version still match. The Annotation View displays it normally; import reports that PDF freshness could not be checked in its batch summary. Revalidate when the PDF becomes available. A known Annotation mismatch requires regeneration or the fallback path.

On-demand rendering must complete with neither PDF reader open and while Obsidian is minimized or in the background. Runtime verification must prove this behavior, including the installed PDF.js animation-frame scheduling. The source-based feasibility research does not yet establish that acceptance criterion.

The subsequent trial on Obsidian 1.14.2 with PDF.js 5.3.34 rendered image and ink excerpts with zero PDF readers open. Ordinary display rendering timed out in a minimized window; switching only the matching internal render task to promise scheduling completed while minimized and produced byte-identical PNGs to foreground display rendering for the tested excerpts. Production integration must guard this private scheduling seam and retain display intent. This evidence covers the tested runtime and fixtures; compatibility and broader PDF coverage remain implementation checks.
