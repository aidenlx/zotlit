# Template delimiter pairing and completion

Design interview for [#947](https://github.com/aidenlx/zotlit/issues/947),
re-evaluating the prototypes from [#863](https://github.com/aidenlx/zotlit/issues/863).
All design rounds were confirmed on 2026-09-05. The interview is complete.
This document is the agreed specification for implementation.

## Confirmed decisions

Round one was confirmed on 2026-09-05.

- Pair Liquid output delimiters `{{…}}`, Liquid tag delimiters `{%…%}`, and
  Eta delimiters `<%…%>`. Pair ordinary quotes and `()[]{}` inside template
  expressions. Bare expression fields receive ordinary pairing without added
  template delimiters.
- Leave the first `{` or `<` unchanged. When the opening delimiter is complete,
  insert the closing delimiter and one space on each side of the cursor:
  `{{ | }}`, `{% | %}`, or `<% | %>`. Here, `|` marks the cursor.
- Completion reuses an existing generated closer.
- Typing a closing character skips only closers supplied by automatic pairing
  or completion. Manually written and pasted closers remain ordinary text.
- Block creation, including a paired Managed Block, remains an explicit
  Template Snippet.

Round two was confirmed on 2026-09-05.

- Follow template-language context. Markdown fences remain active. Suppress
  automatic pairing inside strings, comments, and raw content; boundary tags
  retain their existing help.
- Backspace in an editor-generated empty pair removes the whole pair and its
  padding. Once content exists, use normal deletion. Manually written and
  pasted pairs retain normal deletion.
- Reflow opening trim markers and Eta output prefixes only in a fresh empty
  generated pair. Liquid `-` produces `{{- | }}` or `{%- | %}`. Eta `=` or `~`
  selects the output form; an optional `-` or `_` trim marker precedes the
  output prefix. Opening and closing trim markers remain independent. A minus
  sign inside an expression remains ordinary input.
- Custom template delimiter pairing initially runs at one empty cursor.
  Selection replacement and multiple-cursor editing keep their normal
  behavior. Ordinary quotes and brackets can retain standard selection
  wrapping.

Round three was confirmed on 2026-09-05.

- Typing a closing delimiter dismisses suggestions without accepting a
  candidate. Move over the generated closer one character per keystroke,
  crossing generated padding as needed. For example, `{{ value| }}` becomes
  `{{ value }|}` after the first `}`, then `{{ value }}|` after the second.
- Recognize generated pairs across undo, redo, and pane switches within the
  same open document. Pair insertion belongs to the opening keystroke;
  completion remains a separate undo step. Undo and redo restore the
  corresponding pairing state. Loading or importing a document starts with
  ordinary text.
- Treat pasted text and IME composition as ordinary insertion. Automatic
  pairing runs for direct typing. Enter finishes composition before
  completion handles it.

## Existing decisions retained

The newer [Template Completion design](./issue-947-template-language-design.md)
governs the interaction where it differs from the prototype:

- Enter accepts; Tab retains normal editor behavior.
- Scalar completion finishes the expression and moves the cursor past its
  closer. Object completion adds a dot and continues inside the expression.
- Shared rules support Liquid and Eta. The web host supports Liquid and JSON-e;
  Eta prepares the later Obsidian host.
- Edits use the master document's history and preserve unrelated source and
  line endings, as required by [ADR 0032](../adr/0032-web-workbench-edits-one-source-document.md).

## Exploration findings

- The Eta prototype was already ported to `packages/workbench`. Its pairing
  uses surrounding text, with no record of which closers the editor supplied.
- Web Liquid inherits CodeMirror's rule that changes `{|}` to `{%|%}` when `%`
  is typed. The web editor supplies no general `closeBrackets()` extension.
- Scalar completion already avoids duplicate closing delimiters. Pairing and
  completion need to be verified together.
- Slice updates can replace a view's document from the master. Generated-closer
  tracking must remain correct across these updates, undo, and redo.
- Markdown fences remain active template source in both renderers. Raw blocks,
  comments, and string contents have distinct language semantics.
- Eta's current grammar can stop at a closing delimiter inside a JavaScript
  string or comment, while its renderer skips those literals. Pairing context
  must account for this difference.

## Agreed verification boundaries

Test actual editor typing together with Template Completion and the master
document history. Use the public editor input and selection interfaces,
completion edits, and `WorkbenchDocumentController` rather than private pairing
state. Verify the following behavior:

- Exact text and cursor positions when opening, accepting completion, typing
  over closers, deleting empty pairs, and entering markers or prefixes.
- Generated closers receive automatic handling; manually written and pasted
  closers retain ordinary behavior.
- Pairing and completion together reuse closers, preserve the scalar/object
  acceptance distinction, and dismiss suggestions when a closer is typed.
- Language context distinguishes active template source from strings,
  comments, and raw content, including the Eta delimiter-in-string case.
- Normal selection replacement and multiple-cursor editing remain intact.
- Pane switches, undo, and redo preserve the agreed text, cursor, and pairing
  behavior through the master document's history.
- Composition and paste retain their normal input behavior.
- LF and CRLF line endings and unrelated source remain intact.

Use browser checks for the visible popup and retained editor focus. The shared
rules cover Liquid and Eta; browser checks exercise the web host's supported
authoring surfaces.
