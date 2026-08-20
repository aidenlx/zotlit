# Patching reader internals

The reader (`reader._internalReader`) lives in the iframe's **content** compartment; the plugin runs in **chrome**.

- Patch content reader methods by **plain assignment** (`obj.method = fn`) plus restore-on-dispose.
- Never `monkey-around`/`around()` here — its cross-compartment prototype reparenting trips Gecko's security membrane and breaks the reader. `monkey-around` is fine in `apps/obsidian` (single compartment).
- Failure mode and live evidence: [`docs/reader-patching.md`](../docs/reader-patching.md).
