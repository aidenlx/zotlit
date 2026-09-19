# Annotation reading is continuous and editing is an added capability

Zotero is the source of truth for Annotation existence and saved content. The Annotation View and PDF reader present one annotation collection that works from local Zotero data with Zotero closed, including on a cold start. The database supplies standalone reads; the native Local API supplies live reads and writes when available. Both are internal paths for the same collection. This keeps reading available without making users manage data sources or a background Zotero process.

Both surfaces consume the repository's published result. Refresh keeps the current content and interaction state until a complete replacement is ready. An older read cannot undo an acknowledged write.

The repository prefers the native API for live reads. If it becomes unavailable, the current result stays visible while a database replacement is prepared. That replacement must belong to the same Zotero database and Library and cover acknowledged API writes. A failed refresh keeps the held result. Selecting another Zotero database establishes a separate collection and write authority.

Core annotation reading, editing, and refresh work with the database and native Local API alone. Revalidate visible attachments when an Obsidian window gains focus, when an annotation surface becomes active, on explicit Refresh, and after ZotLit writes. The repository owns this operation and shares one refresh between surfaces showing the same Attachment. The current result stays visible during revalidation. The optional ZotLit Companion supplies notifications for prompt updates when data changes in Zotero. This keeps the core path event-driven; users who need ongoing external updates use the Companion. A successful API write is confirmed through the API without requiring a database snapshot to catch up first.

Editing is an added capability, separate from reading. Each surface offers one labeled action to enable editing while it is unavailable; that action guides the missing setup steps. Once editing is available, normal editing tools take its place. Connection and authorization details appear where they help complete an action. Ordinary read-only use carries no source label or permission warning.

This amends the source presentation in [ADR 0034](0034-the-annotation-source-is-atomic-per-attachment.md) and the always-present capability indicator in [ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md). Snapshot acquisition, revision checks, and refresh wiring implement this contract. Draft and write behavior is recorded in [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md).

Implementation and acceptance criteria are specified in [Spec #1157](https://github.com/aidenlx/zotlit/issues/1157).
