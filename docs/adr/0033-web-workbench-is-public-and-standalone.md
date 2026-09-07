# The web Workbench is public and standalone, with optional local data access

The web Workbench is served publicly at `/workbench` in `apps/docs` and renders
Liquid templates and JSON-e Properties in the browser so authoring works without
Obsidian. A temporary connection approved in Obsidian supplies selected Item
data, bounded template and citation-style
dependencies, and optional access to read and save one Profile document;
standalone users import and download files. JavaScript authoring and execution
remain Obsidian capabilities, while connected saves validate the Profile and
check its loaded revision before writing the exact source through the vault.

The web host rejects Profiles that require Eta or `js` Properties, including
required Eta dependencies, for editing, rendering, and connected Save. It
preserves their source for download and directs the user to Obsidian. This is an
explicit web-specific restriction on the shared editing model from
[#930](https://github.com/aidenlx/zotlit/issues/930#issuecomment-5472788830), whose
general rule permits valid source to survive preview failures; supported web
Profiles retain that distinction between validation and preview errors.

Obsidian offers entry from a Profile row and the current Literature Note. The
browser keeps drafts and snapshots usable after connection loss or a version
mismatch, while local reads and vault Save wait for a compatible connection.
Opening built-in Default stays in memory; its first Save creates the document
only if it remains absent. Save changes the Profile document and leaves existing
Literature Notes unchanged.

These decisions come from the [#931 design interview](https://github.com/aidenlx/zotlit/issues/931).
The [contract](../research/issue-931-web-workbench-contract.md) records the
operation table, validation boundary, and prototype evidence.
