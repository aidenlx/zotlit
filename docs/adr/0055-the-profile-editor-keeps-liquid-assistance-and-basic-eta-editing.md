# The Profile Editor keeps Liquid assistance and basic Eta editing

The Profile Editor gives frontmatter one text color and adds small Markdown hints while
keeping Liquid highlighting and assistance primary. Markdown hints color
heading, list, and quote markers in Note, Annotation, and the corresponding
Advanced source; body text keeps its normal size and weight. The implementation
uses existing language libraries and keeps the production bundle small.

Liquid keeps its token colors inside Markdown code spans and fenced code
blocks, where the template engine still evaluates it. Liquid raw bodies and
comments retain their literal treatment. Within YAML fields that contain
Liquid, template tokens keep their colors. Frontmatter lines use the public
`zt-template-frontmatter` hook and default to `--text-muted`. Heading and quote
markers default to `--text-faint`; list markers use `--list-marker-color`.
These colors follow Obsidian's Source mode. Every pane keeps its existing
monospace font, code size, spacing, and background. The editor uses the existing
document boundaries for frontmatter styling. The runtime `yaml` AST continues
to support source-preserving Profile edits; the CodeMirror YAML language and
Lezer YAML parser are removed to reduce the editor bundle.

Eta retains source editing, basic delimiter colors, Explorer insertion, and
rendering under the existing JavaScript Templates gate. The Profile Editor
reuses the shared automatic-pairing handler: typing `<%` creates `<% | %>`
with the caret at `|`; prefix and trim-marker input, generated-closer skipping,
empty-pair deletion, and pair history remain supported. Selection wrapping
retains the useful capability supplied on `main`.

The existing small Eta Lezer grammar supplies delimiter colors and pairing
context. Its tag boundaries follow Eta's delimiter rules for quoted strings
and block comments, including a tag preceded by another `<`. Incomplete tags,
strings, and comments retain usable editing context. Eta tag bodies and `js`
Properties use plain code styling. The JavaScript parser, Eta semantic
completion, Eta Template Hover, and full JavaScript context analysis are
outside this editor support tier. This trades advanced Eta assistance for
better support of the default Liquid workflow and a smaller bundle. The Eta
render engine remains independent of the editor language support.

The combined change must keep raw production `main.js` at or below the
2,206,489-byte baseline measured after commit `c674dbd07`, with the same build
settings. A comparison of complete production builds determines acceptance;
individual parser measurements are estimates. This extends the Profile Editor
contract in [ADR 0045](0045-the-profile-editor-is-a-dedicated-view-beside-the-markdown-view.md).

The implementation contract is [spec #1077](https://github.com/aidenlx/zotlit/issues/1077).
