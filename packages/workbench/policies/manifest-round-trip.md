# Manifest round trip

Text a reader types into a pane over the profile manifest reads back from YAML as exactly that text, and the rest of the profile keeps every byte. A pane shows the value YAML reads, and the slice codec (`src/document/slice-codec.ts`) or `scalarSource` writes the spelling; a manifest edit that writes text goes through one of them.

A change that writes reader text into the manifest — a new pane, codec, managed-entry action, or key edit — carries a test that types each of these and reads the stored value back through YAML:

- a `: ` inside the text, and a leading `*`, `&`, `!`, `- `, `'`, `"`
- the previous spelling in each style the slice can hold: plain, single-quoted, double-quoted, and a block scalar, an indent number header such as `|2-` included
- a profile with CRLF line breaks, where every byte outside the edit stays the same

A pane that stays mounted while Advanced rewrites its slice reads the codec at each use; a test switches the slice between styles under the open pane and types again.

The reviewer checks that each such change carries those cases, and that a test compares the stored source byte for byte rather than re-reading it through the code under test.
