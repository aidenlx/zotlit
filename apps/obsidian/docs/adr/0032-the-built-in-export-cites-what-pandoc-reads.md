---
status: accepted
---

# The built-in export cites what Pandoc reads

The built-in export reads the document with Pandoc before it resolves anything. The sandbox filter turns each Literature Note wikilink into a Citation that names its Item by an Injected Id, and Pandoc's own reader supplies every literal `@citation-key` Citation. An Injected Id starts with a character no Pandoc citation key can start with, so the two identities share no spelling and one Item's Indexed Key is never read as another Item's Citation Key. That one prepared document is the export's complete Citation set, and the same prepared document is what citeproc formats.

Each cited Item then takes one canonical CSL `id`: the Citation Key the author wrote, where a literal Citation named the Item, and otherwise the `id` its bibliography source gave it. The prepared document's Citation ids are rewritten onto that canonical id before citeproc runs.

This decision keeps the export's own membership contract, which ADR-0022 leaves to it. It settles how that membership is decided.

## Consequences

- Both Citation Syntaxes reach the bibliography. A note that cites only literal Citation Keys exports with formatted citations and a bibliography.
- Membership has one implementation, and it is Pandoc's. A Citation Key inside code, inside an escape, or inside any other construct Pandoc reads as ordinary text is no Citation of the export, with no second scanner to agree with.
- A `nocite` metadata Citation is a Citation of the document, so its Item reaches the bibliography without taking a number in the prose. Pandoc's `nocite` wildcard names no work: it resolves to nothing and reaches citeproc as the document wrote it.
- An Item cited as a wikilink and as a literal Citation Key collects one bibliography entry.
- A literal Citation Key that names no live Item in the Library Scope, or that several Items answer to, stops the export and names the keys. The alternative is Pandoc's undefined-citation output — a bold key and a missing entry — inside a document the user is about to send somewhere.
- Literal Citation Keys resolve through the citekey resolution snapshot, so an export cites what Live Preview shows, under the same Library Scope.
- Every Citation of the rendered document has bibliography data, checked against the document itself before citeproc runs. A document that fails the check writes no output file.
- An export runs two conversions rather than one. The prepared document stays inside the engine between them.
- The Native Pandoc Workflow keeps its own contract: its filter variant resolves through `zotlit:resolve`, and the user supplies its bibliography.

## Considered options

- **Add a literal-citekey scanner to link-based discovery**: fixes the reported case, but keeps two implementations of what a document cites, and any Citation the scanner and Pandoc read differently stays a defect waiting to be noticed.
- **Check the rendered output for unresolved citations**: reports the same defect later, after citeproc has already written it, and reads Pandoc's rendering rather than the document.
