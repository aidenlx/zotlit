# Pandoc Citation Syntax in CodeMirror 6 Live Preview

How the Obsidian plugin can detect, parse, and decorate Pandoc citations — bracketed `[@citekey]` groups and bare `@citekey` — in Obsidian's Live Preview editor. Covers the Pandoc grammar the editor must recognize, the CodeMirror 6 decoration mechanics that fit, the Obsidian integration points, and how a decoration layer extends the existing Citation Key Links feature.

Sources are primary: the Pandoc manual and parser source, the CodeMirror 6 reference and source (`@codemirror/view` 6.38.6, `@codemirror/language`), Obsidian's public CM6 forks ([`lishid/cm-language`](https://github.com/lishid/cm-language), [`lishid/cm-view`](https://github.com/lishid/cm-view)), the `obsidian.d.ts` API surface in `packages/obsidian-api`, and this repo's own code and docs. Claims verified against Obsidian's extracted runtime (`app.js` 1.13.4) are marked as internals and carry line citations into `node_modules/.ob-rev-1.13.4/app.js` (a local extraction, not committed).

Related prior work in this repo:

- [Wikilink resolver and Pandoc filter contract](./wikilink-resolver-pandoc-filter-contract.md) — the export path turns Literature Note wikilinks into Pandoc `Cite` nodes; `[@key]` text in the editor is a separate, direct-Pandoc-syntax concern.
- [How citation key links work](../../apps/docs/content/docs/concepts/how-citekey-links-work.mdx) — the shipped feature this research extends.

## 1. The Pandoc citation grammar to support

Primary sources: the [Pandoc manual, "Citation syntax"](https://pandoc.org/MANUAL.html#citation-syntax) (verbatim in `jgm/pandoc` `MANUAL.txt`, section `## Citation syntax`), and the key parser [`src/Text/Pandoc/Parsing/Citations.hs`](https://github.com/jgm/pandoc/blob/main/src/Text/Pandoc/Parsing/Citations.hs) (`citeKey`, `simpleCiteIdentifier`).

### Citation keys

- A simple key starts with a letter, digit, or `_` (the parser also accepts `*` as first character, for the `@*` nocite wildcard: `simpleCiteIdentifier`, `firstChar <- alphaNum <|> char '_' <|> char '*'`).
- After the first character, a key contains alphanumerics, `_`, and *single internal* punctuation from the set `:.#$%&-+?<>~/`. "Internal" means the punctuation character must be followed by another key character: the parser wraps punctuation in `internal p = try $ p <* lookAhead regchar`. So `@Foo_bar.baz.` yields key `Foo_bar.baz` (the final period is not internal), and `@Foo_bar--baz` yields `Foo_bar` (repeated punctuation terminates the key). Manual: "Unless a citation key starts with a letter, digit, or `_`, and contains only alphanumerics and single internal punctuation characters (`:.#$%&-+?<>~/`), it must be surrounded by curly braces".
- Exception for URLs: `:` or `/` is also accepted when followed by `/` (`try (oneOf ":/" <* lookAhead (char '/'))`), so `@https://example.com` scans further than the single-punctuation rule alone allows.
- The braced form `@{...}` accepts any non-space characters with balanced braces (`charsInBalanced '{' '}' (satisfy (not . isSpace))`); the braces are not part of the key. The manual recommends braces for URL keys.
- A citation `@` must not directly follow a word: `citeKey` begins with `guard =<< notAfterString`. This is why `user@host` and `a@b.com` are not citations. An editor regex approximates this with a lookbehind.

### Citation forms

From the manual:

| Form | Meaning |
| --- | --- |
| `[@doe99; @smith2000; @smith2004]` | Normal citation group. Square brackets, items separated by semicolons. |
| `[see @doe99, pp. 33-35 and *passim*; @smith04, chap. 1]` | Items carry an optional prefix (`see `), locator (`pp. 33-35`), and suffix (`and *passim*`). |
| `[-@smith04]` | `-` before `@` suppresses the author name. |
| `@smith04 says blah.` | Author-in-text citation: bare key, no brackets. |
| `@smith04 [p. 33] says blah.` | Author-in-text with a bracketed locator/suffix immediately after. |
| `[@smith{ii, A, D-Z}, with a suffix]` | Braces after the key force locator content; `@smith{}` prevents locator parsing entirely. |

Locator detection is a *heuristic*, sensitive to the locator terms of the active CSL locale ("Pandoc uses some heuristics to separate the locator from the rest of the subject. It is sensitive to the locator terms defined in the CSL locale files"; if no term matches, "page" is assumed). Reproducing this locale-aware split in the editor is out of scope; the editor only needs the structural split: prefix text, `@key` tokens, suffix text, `;` separators.

### Editor-grammar decisions this implies

1. **Two match shapes.** A bracketed group `[ ... ]` containing at least one `@key` (with optional `-` prefix per item), and a bare `-?@key` outside brackets. Inside a group, the item boundary is `;`.
2. **Key charset per the parser**, including the trailing-punctuation trim and the `@{...}` form. The existing `CITEKEY_RE` in `apps/obsidian/src/services/citekey-click/parse.ts:18` (`(?<![\w.])@(?<key>[^\s\[\];,@]+)`) is looser than Pandoc: it keeps trailing punctuation, accepts characters outside Pandoc's set, and has no braced form. A shared, Pandoc-faithful key grammar should replace it (arkregex, per `policies/regex.md`).
3. **Single-line scope is acceptable.** Pandoc inline syntax lets a bracketed group wrap across a soft line break, but CodeMirror's regex decoration helper is line-scoped (section 3), and Obsidian's own bracket-link tokenization comes from a line-based stream parser (a CodeMirror [`StreamParser`](https://codemirror.net/docs/ref/#language.StreamParser) works line by line). Treat a citation group as single-line in the editor; a wrapped group simply gets no decoration.

## 2. What ZotLit ships today

### Citation Key Links (bracket-link hook)

The shipped feature is documented in [`apps/docs/content/docs/concepts/how-citekey-links-work.mdx`](../../apps/docs/content/docs/concepts/how-citekey-links-work.mdx): "The brackets matter because Obsidian's editor already displays bracketed text as a link, and that display is what ZotLit's hook builds on. A bare `@key` outside brackets is ordinary text to the editor."

Implementation: `apps/obsidian/src/services/citekey-click/service.ts`. It does not add any decoration. It wraps two prototypes with `monkey-around` (`#patch`, lines 173–206):

- `Editor.getClickableTokenAt` — returns a synthetic `internal-link` token for the `@citekey` under the cursor position (`findCitekeyToken`, lines 268–292), so Obsidian's own hover-preview and click plumbing treat the span as a link.
- `MarkdownEditView.triggerClickableToken` — intercepts tokens carrying a create-marker to run note creation before opening.

Recognized forms today: `[@key]`, `[@key, p. 3]`, `[@a; @b]` (each key its own link). The visual link styling of the bracketed span is Obsidian's, not ZotLit's.

Limits of this approach:

- **Display depends on Obsidian internals.** The `[...]` span looks like a link only because Obsidian's markdown mode tokenizes bracketed text that way (see section 6). ZotLit controls none of the styling, and the docs page carries a standing caveat: "It relies on an internal Obsidian editor integration, so Obsidian changes can affect its behavior."
- **Bare `@key` gets nothing.** No styling, no hover, no click — the editor sees plain text, and `getClickableTokenAt` is only consulted at positions the user interacts with.
- **No structure awareness.** Prefix, locator, suffix, `-` suppression, and `@{...}` keys are invisible; there is no rendered-citation preview and no way to style key vs. locator differently.
- **No syntax gating.** The regex hook fires inside code spans or math if the user clicks there.
- **Plain left-click is gated in Live Preview.** Obsidian's internal click gate passes a plain click on an `internal-link` token only when the click target sits under a `.cm-underline` element, and Obsidian withholds that mark from bare links (internals: section 6.5). Per the runtime code, only Mod-click and Source mode reach `triggerClickableToken` for `[@key]` today; the docs page describes click navigation, so verify the shipped behavior at runtime and reconcile.

### Neighboring citation machinery

- `apps/obsidian/src/services/citation-scan/scan.ts` — the References Sidebar scans **wikilinks** to Literature Notes via `metadataCache`, not `@citekey` text. A Pandoc-syntax decoration layer is a separate detector; if the sidebar later counts `[@key]` citations, the shared grammar from section 1 is the meeting point.
- `apps/obsidian/src/services/pandoc/` — the export pipeline converts wikilinks to `Cite` nodes through a Lua filter ([contract](./wikilink-resolver-pandoc-filter-contract.md)). Direct `[@key]` text passes through to Pandoc untouched and is already valid Pandoc citation syntax; the editor feature and the export feature meet only at the citation-key vocabulary (`policies/vocabulary.md`).

## 3. CodeMirror 6 decoration mechanics

### Decoration types and the provisioning rule

The [system guide, "Decorating the Document"](https://codemirror.net/docs/guide/#decorating-the-document) defines four types: mark decorations "add style or DOM attributes to the text in a given range"; widget decorations "insert a DOM element at a given position"; replace decorations "hide part of the document or replace it with a given DOM node"; line decorations "add attributes to a line's wrapping element".

Decorations reach the editor through the [`EditorView.decorations`](https://codemirror.net/docs/ref/#view.EditorView^decorations) facet, "directly, by putting the range set value in the facet (often by deriving it from a field), or indirectly, by providing a function from a view to a range set". The dividing rule, from the guide: "Only directly provided decoration sets may influence the vertical block structure of the editor, but only indirectly provided ones can read the editor's viewport."

The facet's own doc comment (verified in `@codemirror/view` 6.38.6, `dist/index.d.ts` ~line 1247; source [`view/src/extension.ts`](https://github.com/codemirror/view/blob/main/src/extension.ts)) states the constraint for the indirect path: functions "are called *after* the new viewport has been computed, and thus **must not** introduce block widgets or replacing decorations that cover line breaks." The [decoration example](https://codemirror.net/examples/decoration/) says the same: "Decorations that significantly change the vertical layout of the editor, for example by replacing line breaks or inserting block widgets, must be provided directly, since indirect decorations are only retrieved after the viewport has been computed."

A `ViewPlugin` provides decorations indirectly through its spec: `PluginSpec.decorations` "should be a function that take the plugin value and return a decoration set" (`dist/index.d.ts` ~line 444). So:

- **Mark decorations, inline widgets, and inline (single-line) replace decorations** can come from a `ViewPlugin` and be computed over just the viewport.
- **Block widgets and replacements that cover line breaks** must come from a `StateField` whose value feeds `EditorView.decorations` directly (`provide: f => EditorView.decorations.from(f)`).

Obsidian's developer docs restate this decision rule for plugin authors ([Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations), source `obsidianmd/obsidian-developer-docs` `en/Plugins/Editor/Decorations.md`): "Use a view plugin if you can determine the decoration based on what's inside the Viewport. … Use a state field if you want to make changes that could change the content of the viewport, for example by adding line breaks. If you can implement your extension using either approach, then the view plugin generally results in better performance."

Everything a citation highlighter needs — marks over key/prefix/suffix spans, optionally an inline widget or inline replace for a rendered citation — stays within what a `ViewPlugin` may provide.

### MatchDecorator

[`MatchDecorator`](https://codemirror.net/docs/ref/#view.MatchDecorator) (source: [`view/src/matchdecorator.ts`](https://github.com/codemirror/view/blob/main/src/matchdecorator.ts); verified locally at `node_modules/.pnpm/@codemirror+view@6.38.6/node_modules/@codemirror/view/dist/index.js:9381`) is a "helper class used to make it easier to maintain decorations on visible code that matches a given regular expression. To be used in a view plugin."

API facts, from the source and doc comments:

- The `regexp` "will only be matched inside lines (not across them). Should have its 'g' flag set" — the constructor throws a `RangeError` without the `g` flag. The line scope is structural: `iterMatches` walks the document with `doc.iterRange` and only runs the regex on non-line-break chunks (`if (!cursor.lineBreak) while (m = re.exec(cursor.value))`).
- Either a `decoration` (static, or a function of `(match, view, pos)`), or a `decorate` callback `(add, from, to, match, view)` that may add several decorations per match — the right hook for decorating a bracketed group's sub-spans (keys, separators, punctuation) from one match.
- `createDeco(view)` builds the set over `view.visibleRanges`, with each range extended to line boundaries clipped by `maxLength` (default 1000).
- `updateDeco(update, deco)` updates incrementally: it re-runs only the changed range, and falls back to a full `createDeco` when the viewport moved or the change span exceeds 1000 characters.
- An optional `boundary` regex reduces re-matching; JS lookbehind (the `(?<![\w.])` guard) works because matching always restarts from a line start or a boundary character, so left context is present.

Fit: exactly one line-scoped regex pass over the viewport — the right tool for citation matching, given the single-line decision in section 1. One caveat: `updateDeco` reacts to document and viewport changes only. A design where decorations depend on the *selection* (cursor-reveal, section 4) must also rebuild on `update.selectionSet` by calling `createDeco` again, or must keep selection-dependence out of the decoration set (marks only).

### Syntax-tree gating

A regex alone would decorate `[@key]` inside code blocks, inline code, math, comments, and existing links. The gate is the syntax tree:

- [`syntaxTree(state)`](https://codemirror.net/docs/ref/#language.syntaxTree) returns "the current (possibly incomplete) parse tree of the active language, or the empty tree if there is no language available" ([`language/src/language.ts:203`](https://github.com/codemirror/language/blob/main/src/language.ts)).
- [`ensureSyntaxTree(state, upto, timeout = 50)`](https://codemirror.net/docs/ref/#language.ensureSyntaxTree) will "do at most `timeout` milliseconds of work" to extend the tree (`language.ts:211`). Inside a view plugin this is rarely needed: the visible viewport is what gets decorated, and the editor parses the viewport eagerly.
- `tree.iterate({ from, to, enter(node) { ... } })` over each `view.visibleRanges` entry is the pattern Obsidian's own docs use for both the state-field and view-plugin variants ([Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations), emoji-list example).

Obsidian's markdown language is not a Lezer grammar; it is a stream parser whose tokens carry CSS-class-style names (`hmd-*`, `formatting-*`, etc. — section 6). Two access paths exist:

- **Upstream-standard**: `node.type.name`. In upstream `@codemirror/language`, stream-parser tokens become node types named after the token string with spaces replaced by underscores ([`language/src/stream-parser.ts`](https://github.com/codemirror/language/blob/main/src/stream-parser.ts), `createTokenType`: `let name = tagStr.replace(/ /g, "_")`).
- **Obsidian-specific**: `node.type.prop(tokenClassNodeProp)`, a `NodeProp<string>` holding the space-separated token classes. `tokenClassNodeProp` is **not** exported by upstream `@codemirror/language` (checked [`language/src/index.ts`](https://github.com/codemirror/language/blob/main/src/index.ts) — no such export); it comes from Obsidian's public fork [`lishid/cm-language`](https://github.com/lishid/cm-language): defined at [`src/stream-parser.ts:454`](https://github.com/lishid/cm-language/blob/main/src/stream-parser.ts) (`lineClassNodeProp` at 455, the `ignoreSpellcheckToken` facet at 535), exported from [`src/index.ts:16`](https://github.com/lishid/cm-language/blob/main/src/index.ts). The runtime match is confirmed in the bundle's export table (`node_modules/.ob-rev-1.13.4/app.js:14730`, `tokenClassNodeProp: () => kp`). Dataview consumes it this way as prior art: `const tokenProps = type.prop<String>(tokenClassNodeProp); const props = new Set(tokenProps?.split(" "))` ([`obsidian-dataview` `src/ui/lp-render.ts`](https://github.com/blacksmithgu/obsidian-dataview/blob/master/src/ui/lp-render.ts), `renderNode`), then skips rendering when `props.has("inline-code")`.

Obsidian's runtime `@codemirror/view` is likewise the public fork [`lishid/cm-view`](https://github.com/lishid/cm-view) (58 commits ahead of upstream at the time of writing). Its diff vs. upstream leaves `src/matchdecorator.ts` untouched, so the MatchDecorator behavior above holds at runtime.

Because the plugin builds with all `@codemirror/*` packages external (`apps/obsidian/vite.config.ts:95-102`), `import { tokenClassNodeProp } from "@codemirror/language"` resolves to Obsidian's bundled fork at runtime; the compile-time type needs a local module augmentation (same pattern as `src/typings/obsidian-ex.d.ts`, but for the `@codemirror/language` module). The gating check itself: at each regex match position, resolve the tree node and skip the match when its token classes include code, math, frontmatter, comment, or link tokens. The exact class names are Obsidian internals — see section 6.

### Atomic ranges

[`EditorView.atomicRanges`](https://codemirror.net/docs/ref/#view.EditorView^atomicRanges) is a facet "used to provide ranges that should be treated as atoms as far as cursor motion is concerned. This causes methods like `moveByChar` and `moveVertically` (and the commands built on top of them) to skip across such regions" (`@codemirror/view` `dist/index.d.ts` ~line 1284). The decoration example adds that atomic ranges make sense "for replacing decorations and placeholder widgets", letting backspace remove them in one step.

Relevant only if a rendered-citation *replace* decoration ships: supply the same range set to `atomicRanges` so the cursor jumps over the widget instead of entering hidden text. Pure mark decorations need none of this.

## 4. Obsidian integration points

All symbols below are from `packages/obsidian-api/obsidian.d.ts` (the initialized submodule, Obsidian API 1.13.1).

- **`Plugin.registerEditorExtension(extension: Extension): void`** (`obsidian.d.ts:5019`) — "Registers a CodeMirror 6 extension. To reconfigure cm6 extensions for a plugin on the fly, an array should be passed in, and modified dynamically. Once this array is modified, calling `Workspace.updateOptions` will apply the changes." `Workspace.updateOptions()` is `obsidian.d.ts:8043`. This is the settings-toggle mechanism: register a mutable array once, splice the citation extension in or out, call `updateOptions()`.
- **`editorLivePreviewField: StateField<boolean>`** (`obsidian.d.ts:2609`) — "Use this StateField to check whether Live Preview is active." Read inside the extension as `view.state.field(editorLivePreviewField)`; Dataview gates its whole live-preview render pass on it (`lp-render.ts`, `if (!update.state.field(editorLivePreviewField))`). This distinguishes Live Preview from Source mode per editor instance.
- **`editorInfoField: StateField<MarkdownFileInfo>`** (`obsidian.d.ts:2603`) — file/editor context from inside the extension ("such as the associated file, or the Editor"). Needed to resolve citation keys against the note index for per-key styling (known vs. unknown key).
- **`editorEditorField: StateField<EditorView>`** (`obsidian.d.ts:2597`) — "a reference to the EditorView".
- **`livePreviewState: ViewPlugin<LivePreviewStateType>`** (`obsidian.d.ts:3834`) — exposes exactly one field, `mousedown: boolean`: "True if the left mouse is currently held down in the editor (for example, when drag-to-select text)." Useful to keep widgets inert during drag-selection.

### The cursor-reveal convention

Live Preview hides markdown syntax and reveals it when the cursor is inside the construct. **There is no public API for this.** `obsidian.d.ts` contains no reveal/conceal primitive and no hook into Obsidian's own live-preview decorations (verified by search over the full `.d.ts`; the only editor-adjacent exports are the five symbols above). Plugins that hide or replace text replicate the behavior themselves, by convention:

1. On every relevant update (including `selectionSet`), compute decorations.
2. For each candidate range, check whether any selection range overlaps it; on overlap, skip the replace/widget decoration so the raw text shows.

Prior art for the convention (secondary confirmation): Dataview's `selectionAndRangeOverlap` — `range.from <= rangeTo && range.to >= rangeFrom` over `selection.ranges` ([`lp-render.ts`](https://github.com/blacksmithgu/obsidian-dataview/blob/master/src/ui/lp-render.ts), lines 45–52), applied with a one-character margin (`selectionAndRangeOverlap(selection, start - 1, end + 1)`); that file states it is "inspired and adapted from" Latex Suite's [`conceal.ts`](https://github.com/artisticat1/obsidian-latex-suite/blob/main/src/conceal.ts). Obsidian's internal live-preview code uses the same interval test (internals, section 6). Mark decorations sidestep the whole convention: they hide nothing, so nothing needs revealing.

### Coexisting with Obsidian's own `[...]` display

Obsidian's editor already styles the bracketed span of `[@key]` as a bare link — the display the current Citation Key Links feature piggybacks on (section 2). A ZotLit mark decoration over the same span *adds* classes rather than replacing Obsidian's: mark decorations compose, and overlapping marks split into spans carrying both classes (guide, "Decorating the Document"). Two consequences:

- Styling must be written against a span that may also carry Obsidian's link classes (specificity, color interplay).
- A replace decoration over a span Obsidian also decorates raises precedence questions and can fight Obsidian's own reveal logic. How exactly Obsidian tokenizes and conceals `[@key]` is an internals question — section 6.

## 5. Recommended architecture

Phase the feature so each stage is shippable and the risky parts stay optional:

**Shared grammar module** (pure, tested): a Pandoc-faithful tokenizer for one line of text → citation groups and bare keys, each with sub-spans (`bracketOpen`, `itemPrefix`, `suppress`, `key`, `keyBraced`, `itemSuffix`, `separator`, `bracketClose`). Built on arkregex per `policies/regex.md`; replaces/absorbs `CITEKEY_RE` in `citekey-click/parse.ts` so click targets and decorations agree on what a citation is.

**Phase 1 — mark decorations (ViewPlugin + MatchDecorator):**

```ts
const citationDecorator = new MatchDecorator({
  regexp: CITATION_LINE_RE, // g-flagged; matches a bracketed group or a bare key
  decorate(add, from, to, match, view) {
    if (!view.state.field(editorLivePreviewField)) return; // or also style Source mode
    if (insideForbiddenNode(view.state, from, to)) return; // syntaxTree gate
    for (const span of tokenizeCitation(match)) {
      add(span.from, span.to, Decoration.mark({ class: `zt-cite-${span.kind}` }));
    }
  },
});

const citationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = citationDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = citationDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);
```

Marks only: no vertical-layout risk (legal from a ViewPlugin per section 3), no cursor-reveal machinery, no atomic ranges. `insideForbiddenNode` iterates `syntaxTree(state)` at the match position and rejects code/math/frontmatter/comment/link token classes (names pending section 6). Registered through `registerEditorExtension` with a mutable array; the settings toggle mirrors the existing `citation.key-links` pattern and calls `workspace.updateOptions()`.

**Phase 2 (optional) — resolution-aware styling:** look up each key against `NoteIndex`/`@zotlit/db` (as `citekey-click/service.ts` already does for clicks) and vary the mark class (resolved / unresolved / ambiguous). This makes decorations depend on data outside the document; the ViewPlugin then needs an external trigger (e.g. rebuild via a `StateEffect` dispatched on index change).

**Phase 3 (optional) — rendered citation widgets:** inline `Decoration.replace` with a `WidgetType` rendering the formatted citation. This is where the full convention set lands: selection-overlap reveal (rebuild on `update.selectionSet` — `MatchDecorator.updateDeco` alone is not enough), `WidgetType.eq` to avoid redraws, `atomicRanges` for cursor motion, `livePreviewState.mousedown` during drags, and coexistence with Obsidian's own concealment of the bracketed span. Ship only if Phase 1/2 prove insufficient.

Click/hover behavior stays in `citekey-click` (the `getClickableTokenAt` patch already covers bracketed and bare keys at interaction time); Phase 1 gives bare `@key` the visual affordance that patch cannot. To restore plain left-click in Live Preview, include `cm-underline` in the mark class over key spans — it satisfies Obsidian's internal click gate (section 6.5). Phase 1 marks need no `selectionSet` handling; `updateDeco`'s doc/viewport triggers suffice.

## 6. Verified internals (Obsidian 1.13.4)

Facts below were read from the locally extracted runtime, `node_modules/.ob-rev-1.13.4/app.js` (extracted from `obsidian-1.13.4.asar` via the `obsidian-asar-extract` skill; a patch substitution for API 1.13.1 within the same minor). The CM5 markdown mode Obsidian's HyperMD wrapper delegates to sits beside it at `node_modules/.ob-rev-1.13.4/lib/codemirror/markdown.js`. All are undocumented internals: minified names (`B3`, `a3`, …) drift between releases; re-verify line numbers per Obsidian version.

### 6.1 Live Preview decoration architecture

Obsidian uses two CM6 mechanisms side by side — matching the provisioning rule in section 3:

- **Inline syntax concealment → `ViewPlugin`** (`ViewPlugin.define` at `app.js:156281`; value class `B3` extends base `N3`, `app.js:155350`/`155327`). It iterates `syntaxTree(state)` over `view.visibleRanges` only and emits `Decoration.replace({})` over formatting tokens plus a few marks. Three replace variants encode cursor-snap direction: `a3` snap-left (`app.js:154147`), `s3` snap-left only when the selection spans lines — header markers (`154148`), `l3` snap-right — closing formatting (`154149`). Marks: `c3` = `cm-underline` (`154150`), `u3` = `cm-transparent` (`154151`), `h3` = `is-unresolved` (`154152`).
- **Block/widget rendering → `StateField`** (factory `H3`, `app.js:155639`; field at `156136`; `provide: EditorView.decorations.from(...)`). It iterates the whole tree (`155814`, no range bounds) and produces `Decoration.replace({ widget, side: 1, block })` for embeds, images, math, callouts, tables, HTML, and code-block previews. Widget instances are cached and reused across updates.

Rebuild gating (`N3.prototype.update`, `app.js:155332–155346`): rebuild when the tree changed, on `viewportChanged`, on `selectionSet`, or when a transaction carries the internal re-decorate effect (`e3`, `154132`) or a highlight effect. It skips the rebuild — and only maps the old set through the changes — when the parse is incomplete (`tree.length < viewport.to`), during IME composition, or while `livePreviewState.mousedown` is true; a ~50 ms delayed re-dispatch after mouseup re-runs it (`156232–156239`). The widget field additionally calls `ensureSyntaxTree(state, viewport.to + 2000, 20)` (`156143–156150`).

`EditorView.atomicRanges` is applied only to decorations whose spec carries `isImageEmbed` (set at `155763`, consumed `156432–156448`). Text concealment is **not** atomic — cursor traversal is handled by the snap-out logic in 6.2.

Extension ordering: `getDynamicExtensions()` (`app.js:132391`) pushes the live-preview extension at `132421` and appends plugin extensions from `registerEditorExtension` last (`132440`). Plugin decorations are therefore later facet inputs; use `Prec` when relative precedence matters.

### 6.2 Cursor-reveal rules

The whole convention reduces to one inclusive interval test plus a grouping pass (reconstructed):

```ts
// app.js:85613–85630
const rangeOverlaps = (r, from, to) => r.from <= to && r.to >= from; // ML — inclusive both ends
const hasSelectionOverlap = (ranges, from, to) =>
  ranges.some((r) => rangeOverlaps(r, from, to)); // SL

// app.js:155407–155420 (B3.prototype.buildDeco)
const ranges = view.hasFocus ? state.selection.ranges : []; // no reveal when unfocused
const isRevealed = (from, to) =>
  hasSelectionOverlap(ranges, from, to) || hasSearchMatchHighlight(from, to);
```

Exact rules:

- **Touching an endpoint counts.** A collapsed cursor exactly at the group's start or end reveals it.
- **Reveal is per adjacent-token group, not per line.** Decorations buffer into a group; a group is a maximal run of adjacent styled tokens, flushed whenever `node.from !== groupEnd` (unstyled text produces no node, so a gap flushes; `app.js:155423–155449`). On flush of a concealed multi-decoration group, the last `a3` flips to `l3` so the cursor snaps forward out of it.
- **Line-scope reveal exists for exactly two cases**: blockquote `>` markers (`155480`) and escape backslashes (`155486`).
- **Drag selection** reveals on overlap like any range; while `livePreviewState.mousedown` is true the set is frozen and only mapped (`155337`).
- **Blur conceals everything** (`view.hasFocus ? ranges : []`); focus/blur DOM handlers dispatch the re-decorate effect after 10 ms (`156195–156258`).
- **Search-match highlights also reveal** (highlight field at `87115`, class `obsidian-search-match-highlight`, `131279`).

Cursor snap-out (`B3.prototype.update`, `app.js:155356–155405`), run only when `!docChanged && selectionSet && !mousedown`: a selection endpoint inside a concealed range snaps to the range start (`a3`), the range end (`l3`), or the start only for multi-line selections (`s3`), iterated up to 10 times per range; the corrected selection is dispatched asynchronously via `setTimeout`, guarded by selection identity.

### 6.3 Token bridge and gating vocabulary

The markdown mode is a CM5-style stream mode (`window.CodeMirror.defineMode("hypermd", ...)`, `app.js:109417`) wrapping the bundled CM5 `markdown` mode with `tokenTypeOverrides` (`109406–109413`: `code → "inline-code"`, `hashtag → "hashtag meta"`, …). The stream→tree bridge (`app.js:35855–35911`, `35943–35975`) shapes what `syntaxTree` yields. Its readable source is the fork's [`stream-parser.ts`](https://github.com/lishid/cm-language/blob/main/src/stream-parser.ts) — fork line numbers below alongside the bundle's:

- `line-…` / `line-background-…` classes are stripped from tokens and re-emitted as one node spanning the whole line under `lineClassNodeProp`. The remaining classes are `.sort().join(" ")` and become the node's `tokenClassNodeProp` (fork `stream-parser.ts:344–356`, `378`); the node **name** is that string with spaces → `_` (fork `:432`, `createTokenType`).
- **Tokens with a null/empty style produce no node at all** (`app.js:35861`; fork `:428`, `tokenID` returns id 0 for an empty tag). Plain paragraph text is absent from the tree — treat "no covering node" as plain text; `resolveInner` there returns the document node, so iterate the line instead.
- **Adjacent tokens with the identical class string merge into one node** per line (`app.js:35883–35885`; fork `:364–368`).
- ⇒ Always read `node.type.prop(tokenClassNodeProp)?.split(" ")`; never match on `node.name`. `tokenClassNodeProp`/`lineClassNodeProp` come from the `lishid/cm-language` fork (section 3); upstream has neither.

Token-class strings for contexts to **exclude** from citation decoration:

| Context | `tokenClassNodeProp` classes | Line class (`lineClassNodeProp`) |
| --- | --- | --- |
| Fenced / indented code block | `hmd-codeblock` (every token of the line), `hmd-indented-code` | `HyperMD-codeblock`, `-begin`, `-end` |
| Inline code | `inline-code`; delimiters `formatting formatting-code inline-code` | — |
| Math | `math`, `math-block`; delimiters `formatting formatting-math formatting-math-begin`/`…-end` | — |
| Comment `%%…%%` | `comment`, `comment formatting comment-start`/`-end` | — |
| Frontmatter | `hmd-frontmatter` (plus yaml sub-mode styles) | — |
| Tag | `hashtag meta`, `formatting formatting-hashtag hashtag-begin`/`-end`, `tag-<name>` | — |
| Wiki link / embed | `hmd-internal-link`, `hmd-embed`, `link-alias`, `link-alias-pipe`, `link-has-alias`, `formatting-link formatting-link-start`/`-end`, `formatting-embed` | — |
| Markdown link | text `link`; href `string url` (+ `formatting formatting-link-string`) | — |
| Autolinked URL / bare email | `url` (HyperMD wrapper, `app.js:109796–109798`) | — |
| Footnotes | `footref`, `hmd-footnote`, `hmd-footref2`, `hmd-footnote-url`, `inline-footnote`(`-start`/`-end`), `formatting-inline-footnote` | `HyperMD-footnote` |
| Escapes | `hmd-escape-backslash`, `hmd-escape-char`, `escape` | — |
| Raw HTML | `hmd-html-begin`, `hmd-html-end`, `hmd-cdata-html` | — |
| Table | `hmd-table-sep`(`-<n>`, `-dummy`) | `HyperMD-table-*` |
| Block id | `blockid` | — |
| Callout | `hmd-callout` | `HyperMD-callout` |

Obsidian's own canonical "special context" shortlist is what it feeds the `ignoreSpellcheckToken` facet (`app.js:131000`): `url inline-code property footref hmd-footnote math link-has-alias formatting-link hmd-codeblock blockid hmd-frontmatter hashtag`. The facet itself is a public fork export (fork `stream-parser.ts:535`, exported via `src/index.ts:16`), so it is importable from `@codemirror/language` at runtime.

**`@` tokenization:** no token exists for a bare `@key` — verified by running the bundled `markdown.js` mode standalone (`"before @key …"` → `@key` gets a null style, hence no tree node). `@` is absent from the mode's word-exclusion class, and the HyperMD URL/email probe rejects a leading `@`. There is no at-mention token to collide with. **One real collision:** `a@b.com` and `www.x.com/@k` do get the `url` class from the wrapper (`109796–109798`), so the citekey matcher must skip positions covered by a `url` token. Inside `[...]` the probe is disabled entirely (`state.linkText`, `109793`).

### 6.4 How `[@key]` tokenizes and renders

- **Tokenizer path:** HyperMD's barelink branch, decided at `app.js:109984–109999` when the base mode's `state.linkText` flips: a `[...]` span **not** followed by `(`, `[`, ` [`, or `:` — and not a `[^…]` footref — becomes `hmd-barelink` (link-state map at `109390`). The class is appended to every token while the link state is live (`110004–110006`).
- **Resulting tree nodes** for `see [@smith2020, p. 3] and @bare2021 end`: `[` and `]` carry `formatting formatting-link hmd-barelink link`; the inner text carries `hmd-barelink link`; the surrounding plain text has no node. The base mode emits the inner content as several tokens, but they share one class string, so the bridge **merges them into a single node** — `[@a; @b]` is one `hmd-barelink link` node spanning `@a; @b`, one `<span class="cm-hmd-barelink cm-link">` in the DOM. Per-key spans must come from ZotLit's own decoration.
- **Live Preview does not conceal or specially decorate barelinks.** At `app.js:155534`, `g.has("hmd-barelink") && !g.has("hmd-footnote")` forces both "is formatting" and "should hide" to false: the brackets are never replaced, and the `cm-underline` mark is withheld. The only visual treatment is the generic syntax-highlight marks (`.cm-link.cm-hmd-barelink`; `.cm-formatting-link` on the brackets). The tokens still count as "linkish" (`r3` set, `154138`), so they extend the reveal group of adjacent concealed constructs.

### 6.5 Click and hover path

- **Hover:** a delegated `mouseover` handler on `.cm-link, .cm-hmd-internal-link, .cm-footref` (`app.js:132052–132056`) fires for barelinks, calls `editor.getClickableTokenAt(...)`, and triggers `hover-link` only for `internal-link`/`footref` tokens (`132685–132698`). ZotLit's synthetic `internal-link` token is what makes native hover work.
- **`getClickableTokenAt`** (`app.js:131744–131898`) natively returns `null` for a barelink: it sees the `link` class, scans forward for a `string url` token, finds none, and falls through every branch. This is the gap the `citekey-click` patch fills.
- **Live Preview click gate** (`onEditorClick`, `app.js:132651–132678`): Source mode and Mod-click always pass; a `tag` token passes; a plain click on an `internal-link` token passes **only when the click target sits under `.cm-underline`**. Obsidian withholds `cm-underline` from barelinks (6.4), so a plain left-click on `[@key]` in Live Preview never reaches `triggerClickableToken`, even with `getClickableTokenAt` patched. A plugin mark that adds the `cm-underline` class to the span restores plain-click (the subsequent `.cm-link` `matchParent` branch then passes).

### 6.6 `editorLivePreviewField` and rebuild signals

- `editorLivePreviewField` (`app.js:130854`) is a settable boolean `StateField` from an internal factory (`130836–130850`) whose only update path is an internal set-field effect. It is initialized per editor as `!sourceMode` (`132414`) and toggled inside `updateOptions()` (`132460`); the editor element gets/loses `is-live-preview` (`132412`).
- **The entire live-preview extension is present only when `!sourceMode`** (`132418–132422`) — in Source mode there are no concealment decorations to conflict with.
- `editorViewField === editorInfoField` — literally the same field object (`130853`).
- `livePreviewState` is a bare `ViewPlugin` carrying `{ mousedown: boolean }` (`154134`); Obsidian reads it to freeze rebuilds during drags (`155337`, `156148`).
- Two internal `StateEffect`s force live-preview rebuilds: re-decorate (`154132`; dispatched on the `post-processor-change` workspace event, focus, and blur — `156407`, `156195–156258`) and drop-widget-cache (`154133`). A plugin cannot dispatch these, but should mirror the pattern with its own effect for data-driven redecoration (Phase 2).

### 6.7 What this settles for the citation decorator

- **Bare `@key` is uncontested**: no token, no decoration, no click handling. The plugin owns it outright.
- **`[@key]` is contested only cosmetically**: Obsidian puts `cm-link`/`cm-hmd-barelink` marks there but no replace decoration and no concealment. ZotLit marks — or even a replace — layer cleanly; there is nothing to suppress.
- **Mirror `B3`, don't fight it**: build over `view.visibleRanges`; reuse the inclusive-endpoint overlap test gated on `view.hasFocus`; skip rebuilds while `livePreviewState.mousedown` (map instead); bail to `decorations.map(update.changes)` when `syntaxTree(state).length < view.viewport.to`.
- **Widgets/concealment (Phase 3)**: `atomicRanges` is safe to use — Obsidian claims only image embeds — or replicate the `a3`/`l3` snap-out contract.
- **Guard the barelink assumption**: the non-concealment of `hmd-barelink` is a single internal clause (`155534`) with no contract. Design so a future Obsidian change degrades to "decoration not applied", not visual corruption.

## 7. Open questions and risks

- **Gating vocabulary is fork-specific.** Both access paths to token classes (`tokenClassNodeProp`, or `node.type.name` shaped by Obsidian's fork) live in `lishid/cm-language`, which is public and readable but carries no compatibility contract; the concrete vocabulary in section 6.3 is pinned to 1.13.4. Risk: silent breakage on Obsidian upgrades. Mitigation: keep the gate predicate in one function, tolerate unknown names (fail open to "decorate" or closed to "skip" — decide), watch the fork repo for changes, and cover the gate with a runtime smoke test via the `obsidian-debug` flow.
- **Interplay with Obsidian's bare-link display — settled additively.** Obsidian applies only highlight marks to `[@key]`, never concealment (section 6.4), so ZotLit styles additively over `.cm-link.cm-hmd-barelink`; there is nothing to suppress. Residual risk: that non-concealment is one internal clause with no contract — design for graceful degradation (section 6.7).
- **Click-gate discrepancy.** The runtime click gate (section 6.5) blocks plain left-click on `[@key]` in Live Preview, while the shipped docs describe click navigation. Verify actual behavior in a live vault; either the docs overstate, or another path compensates. The `cm-underline` mark from Phase 1 resolves it either way.
- **Wrapped citation groups.** A `[@key]` group broken across a line break gets no decoration (MatchDecorator is line-scoped). Accepted; matches Obsidian's own line-based tokenization.
- **Locator/suffix fidelity.** The editor shows structure, not CSL semantics. Locale-aware locator detection (manual heuristics) stays in Pandoc/citeproc; the editor's `itemSuffix` span deliberately covers locator + suffix undifferentiated.
- **Bare-key false positives.** The `notAfterString` guard maps to a lookbehind, but Pandoc's guard is parser-state-based, not purely textual. Edge cases (e.g. `@key` directly after a closing bracket or emphasis marker) may diverge slightly from Pandoc; acceptable for highlighting, but the shared grammar's tests should pin the chosen behavior.
- **Reading mode.** Out of scope here — decorations only affect the CM6 editor. The docs page already documents the limitation for Citation Key Links; a Reading-mode equivalent would be a markdown post-processor, a separate design.
- **Selection-driven rebuilds (Phase 3 only).** `MatchDecorator.updateDeco` ignores `selectionSet`; a reveal-capable variant must call `createDeco` on selection changes, trading some of the incremental-update benefit.
