# Wikilink Editor Styling on the HyperMD Syntax Tree

How ZotLit can put mark decorations on the wikilinks its Citation Index recognizes as Citations, reading Obsidian's own Markdown tokens through the CodeMirror 6 syntax tree instead of re-scanning the document for `[[…]]`. Covers the token inventory Obsidian emits for internal links, the stream-parser → syntax-tree bridge that carries it, what the tree does and does not exclude for free, how far the tree reaches inside a view plugin, where a plugin's marks land relative to Obsidian's conceal and underline decorations, and how an editor-side span is matched against index knowledge.

Written for [#663](https://github.com/aidenlx/zotlit/issues/663) (part of spec #642): marks only, layered on top of what Obsidian draws; Obsidian's wikilink click, hover, and Live Preview conceal behavior stay exactly untouched; Reading mode untouched; decoration-range computation stays pure and testable.

Primary sources:

- Obsidian's extracted runtime, `node_modules/.ob-rev-1.13.4/app.js` (a local extraction, not committed). All bare line numbers are into that file.
- Obsidian's public CM forks, checked out locally: [`lishid/cm-language`](https://github.com/lishid/cm-language) at `~/repo/zotlit-repo/cm-language` (fork of `@codemirror/language` 6.12.3) and [`lishid/cm-view`](https://github.com/lishid/cm-view) at `~/repo/zotlit-repo/cm-view` (fork of `@codemirror/view` 6.43.7). Cited as `cm-language/src/<file>:<line>` / `cm-view/src/<file>:<line>`.
- `@codemirror/state` 6.5.0 at `node_modules/.pnpm/@codemirror+state@6.5.0/…/dist/index.js` (unforked; Obsidian bundles the same behavior).
- This repo's own code, cited `path:line`.

Prior work in this repo, cited rather than repeated:

- [Pandoc citation syntax in CodeMirror 6 Live Preview](./pandoc-citekey-cm6-live-preview.md) — §3 (provisioning rule, syntax-tree gating), §6.1 (live-preview decoration architecture), §6.2 (cursor-reveal rules), §6.3 (the bridge and the exclusion vocabulary), §6.6 (`editorLivePreviewField`, rebuild signals). This note extends §6.3/§6.4 from bare links to internal links.
- [Obsidian's clickable-token pipeline](./obsidian-clickable-token-pipeline.md) — §2 (the three DOM gates around click and hover), §2.3 (who produces `cm-underline`), §2.5 (the CSS attached to it).
- [Pandoc citekey index and MetadataCache](./pandoc-citekey-index-metadatacache.md) — §"Editor-side live parsing" (the save debounce that makes cache positions lag the editor), §"Link resolution".

## 0. Scope, versions, method

Analyzed runtime: **Obsidian 1.13.4**. The `obsidian` API package this workspace compiles against is 1.13.1 (`node -p` through `apps/obsidian`); `apps/obsidian/package.json:87` declares `"minAppVersion": "1.13.4"`. The 1.13.4 extraction was reused (patch substitution inside the same minor), which keeps every line number in this note comparable with the two prior notes.

Minified names drift between releases. Re-derive them; do not copy them forward.

| Minified | Role | Definition | Public name |
| --- | --- | --- | --- |
| `Su` | `syntaxTree` | export table `14727` | `syntaxTree` |
| `xu` | `ensureSyntaxTree` | export table `14695` | `ensureSyntaxTree` |
| `kp` | `tokenClassNodeProp` | export table `14730` | `tokenClassNodeProp` |
| `Cp` | `lineClassNodeProp` | export table `14721` | `lineClassNodeProp` |
| `Mp` | `lineHighlighter` (`Prec.lowest(ViewPlugin…)`) | `36053`, export table `14722` | `lineHighlighter` |
| `Sp` | `ignoreSpellcheckToken` facet | export table `14712` | `ignoreSpellcheckToken` |
| `aU` | HyperMD link-state enum (`INTERNAL_LINK = 9`, `EMBED = 10`) | `109376–109388` | — |
| `vU` | link-state → token-class map | `109389–109397` | — |
| `DJ` | `StreamLanguage.define(CodeMirror.getMode({}, {name:"hypermd"}))` | `130945` | — |
| `B3` / `W3` | Live-preview inline conceal: value class / its `ViewPlugin` | `155350` / `156281` | — |
| `H3` | Live-preview widget/embed `StateField` factory (also emits `is-unresolved`) | `155639` | — |
| `U3` | The composite live-preview extension | `156301` | — |
| `a3`, `l3`, `s3` | `Decoration.replace({})` — snap-left, snap-right, header-only | `154147`, `154149`, `154148` | — |
| `c3` | `Decoration.mark({class:"cm-underline", attributes:{tabIndex:"-1",draggable:"true"}})` | `154150` | — |
| `h3` | `Decoration.mark({class:"is-unresolved"})` | `154152` | — |
| `r3` | "linkish" class set | `154138–154145` | — |
| `YE` | wiki-inner-text → `{href, title, isAlias}` | `65162` | — (internal) |
| `mD` / `gD` | `getLinkpath` / `parseLinktext` | `71602` / `71606`, export table `15087` / `15103` | `getLinkpath` / `parseLinktext` |
| `OJ.getClickableTokenAt` | the tree walk that turns a position into an `internal-link` token | `131744` | `Editor.getClickableTokenAt` |

**Method for §1.** The token inventory below is not read off the minified source alone; it was produced by running Obsidian's own tokenizer. The bundled CM5 core, mode bundle, and Markdown mode (`node_modules/.ob-rev-1.13.4/lib/codemirror/{codemirror,modes.min,markdown,overlay}.js`) were loaded into a `node:vm` context with a stub `document`/`navigator` and Obsidian's `String.prototype.contains` polyfill; then `app.js` lines `109341–110146` — the whole HyperMD section, from `Jj = window.CodeMirror` to `defineMIME("text/x-hypermd", "hypermd")` — were evaluated in the same context, which registers the real `hypermd` mode. The mode is instantiated exactly as the runtime does it (`CodeMirror.getMode({}, { name: "hypermd" })`, `130945`), each line is tokenized, and the raw token styles are pushed through a faithful re-implementation of the bridge in `cm-language/src/stream-parser.ts:331–379` (strip `line-*`, sort, join, merge adjacent equal). The output is therefore the node list `syntaxTree` yields, per line. The harness is a scratch artifact, not repo code.

## 1. Token inventory for internal links

### 1.1 Where the classes come from

`hmd-internal-link` and `hmd-embed` are not base-Markdown classes; they come from HyperMD's own link-state machine wrapped around the CM5 `markdown` mode.

The state enum and its class map (`109376–109397`):

```js
(e[(e.INTERNAL_LINK = 9)] = "INTERNAL_LINK"), (e[(e.EMBED = 10)] = "EMBED")
…
(_j[aU.INTERNAL_LINK] = "hmd-internal-link"),
(_j[aU.EMBED]         = "hmd-internal-link hmd-embed"),
```

The branch that recognizes the construct (`109722–109752`), reading the base mode's `state.linkText`:

- `("!" === t.peek() || "[" === t.peek()) && t.match(/^(!?\[\[)(.*?)]]/, !1)` — the opener probe. On `![[` it appends `" formatting-link formatting-link-start formatting-embed"` and sets `internalEmbed`; on `[[` it appends `" formatting-link formatting-link-start"` and sets `internalLink`. It also records `o.hasAlias = F[2].contains("|")` — whether the *whole* `[[…]]` body holds a pipe (`109745–109752`).
- Inside the link: `"|" === t.peek()` appends `" link-alias-pipe"` and flips `isAlias`; after the pipe the token gets `" link-alias"`; before the pipe, when `hasAlias`, the token gets `" link-has-alias"` (`109728–109740`).
- `"]" === t.peek() && t.match("]]", !1)` clears the link state and appends `" formatting-link formatting-link-end"` (`109730–109736`).
- While the link state is live, `vU[o.hmdLinkType]` is appended to every token (`110004–110006`).

Note the opener probe requires a **closing `]]` on the same line**. Nothing about internal links crosses a line break.

### 1.2 The observed node list

Every row below is the bridge's output: `[from,to)` of one syntax-tree node, and its `tokenClassNodeProp` string (already sorted and space-joined by `cm-language/src/stream-parser.ts:354`).

| Source | Node spans and `tokenClassNodeProp` |
| --- | --- |
| `see [[Note]] end` | `[4,6) "[["` → `formatting-link formatting-link-start`<br>`[6,10) "Note"` → `hmd-internal-link`<br>`[10,12) "]]"` → `formatting-link formatting-link-end` |
| `[[Note\|Alias]]` | `[0,2) "[["` → `formatting-link formatting-link-start`<br>`[2,6) "Note"` → `hmd-internal-link link-has-alias`<br>`[6,7) "\|"` → `hmd-internal-link link-alias-pipe`<br>`[7,12) "Alias"` → `hmd-internal-link link-alias`<br>`[12,14) "]]"` → `formatting-link formatting-link-end` |
| `[[Note#Heading]]` | `[0,2) "[["` → `formatting-link formatting-link-start`<br>`[2,14) "Note#Heading"` → `hmd-internal-link`<br>`[14,16) "]]"` → `formatting-link formatting-link-end` |
| `[[Note#^block-id]]` | identical shape; the whole `Note#^block-id` is **one** `hmd-internal-link` node |
| `[[#Heading]]`, `[[#^abc123]]` | one `hmd-internal-link` node covering `#Heading` / `#^abc123` |
| `![[Image.png]]` | `[0,3) "![["` → `formatting-embed formatting-link formatting-link-start`<br>`[3,12) "Image.png"` → `hmd-embed hmd-internal-link`<br>`[12,14) "]]"` → `formatting-link formatting-link-end` |
| `![[Note#Heading\|Alias]]` | `[0,3)` → `formatting-embed formatting-link formatting-link-start`<br>`[3,15) "Note#Heading"` → `hmd-embed hmd-internal-link link-has-alias`<br>`[15,16) "\|"` → `hmd-embed hmd-internal-link link-alias-pipe`<br>`[16,21) "Alias"` → `hmd-embed hmd-internal-link link-alias`<br>`[21,23) "]]"` → `formatting-link formatting-link-end` |
| `[[a\|b\|c]]` | one `link-has-alias` node (`a`), then alternating `link-alias-pipe` / `link-alias` nodes for `\|b`, `\|c` |
| `[[]]` | `[0,2)` `formatting-link formatting-link-start`, `[2,4)` `formatting-link formatting-link-end`. **No `hmd-internal-link` node at all.** |
| `[[Unclosed` | `[0,2) "[["` → `formatting formatting-link hmd-barelink link`<br>`[2,10)` → `hmd-barelink link` — a bare link, **not** an internal link |
| `text [[Note` ⏎ `more]] text` | first line as above (barelink); second line has no nodes. Wikilinks never span lines. |

Five facts fall out of that table, and each one is load-bearing:

1. **The opening bracket carries no `hmd-internal-link`.** It is identified only by `formatting-link-start`, and only `formatting-embed` on it distinguishes `![[` from `[[`.
2. **The closing bracket carries neither `hmd-internal-link` nor `hmd-embed`.** `]]` is always exactly `formatting-link formatting-link-end`, embed or not. An embed can therefore only be recognized from its opener or from its interior nodes.
3. **`link-has-alias` marks the target, `link-alias-pipe` the pipe, `link-alias` the display text.** A link with no alias has a target node carrying bare `hmd-internal-link` — indistinguishable, by class, from an alias node. The two are told apart only by position relative to `link-alias-pipe`.
4. **Subpaths are not tokenized.** `#Heading` and `#^block-id` live inside the target node; splitting them out is a string operation on the node text, which is exactly what `parseLinktext` does.
5. **`[[]]` produces no interior node**, so "no `hmd-internal-link` in the run" is a real case to handle, not a defensive branch.

### 1.3 Contextual classes ride along, and the target run can be split

Enclosing constructs append their own classes to every token, and the bridge merges only *identical* class strings, so a target run can be several nodes:

| Source | Interior nodes |
| --- | --- |
| `> [[Note]]` | `[[` → `formatting-link formatting-link-start quote quote-1`; `Note` → `hmd-internal-link quote quote-1` (line class `HyperMD-quote HyperMD-quote-1 parse-next`) |
| `- [[Note]]` | `Note` → `hmd-internal-link list-1` (line class `HyperMD-list-line HyperMD-list-line-1`) |
| `# Head [[Note]]` | `Note` → `header header-1 hmd-internal-link` |
| `**[[Note]]**` / `*[[B\|c]]*` | `Note` → `hmd-internal-link strong`; `B` → `em hmd-internal-link link-has-alias` |
| `\| [[X\\\|y]] \|` (escaped pipe in a table) | `X` → `hmd-internal-link link-has-alias`; **`\`** → `formatting-escape hmd-internal-link link-has-alias`; `\|` → `hmd-internal-link link-alias-pipe`; `y` → `hmd-internal-link link-alias` |

Consequences: never compare `tokenClassNodeProp` for string equality — split it and use a `Set`, the way `apps/obsidian/src/services/citekey-editor/decorate.ts:40` already does. And never assume the target is one node: the escaped-pipe row splits it into two.

### 1.4 Extracting linkpath and alias from the tree alone

Obsidian does this twice in its own runtime, with the same algorithm, and both are worth mirroring exactly.

**`Editor.getClickableTokenAt` (`131744–131825`).** It flattens one line's tree nodes into an ordered list of `{type, from, to}` (untyped gaps included, `131752–131766`), finds the entry covering the position, and then:

```js
var m = "hmd-internal-link",
    g = f.contains(m),
    y = f.contains("formatting-link") && ["[[", "![[", "]]"].contains(v);   // 131782–131784
if (g || y) {
  for (var b = l - 1; b >= 0; ) { var w = i[b].type; if (!w || !w.contains(m)) break; b--; }   // walk left
  for (var k = l + 1; k < i.length; ) { var C = i[k].type; if (!C || !C.contains(m)) break; k++; }  // walk right
  var E = "", M = r.to, S = r.from;
  for (c = b + 1; c < k; c++) {                                              // 131799–131803
    var x = i[c];
    x.type.contains(m) && ((E += h(x)), x.from < M && (M = x.from), x.to > S && (S = x.to));
  }
  var T = (function (e) {                                                    // 131804–131814
    var t = e, n = "", i = e.indexOf("|");
    -1 !== i && ((n = e.slice(i + 1)), "\\" === e.charAt(i - 1) && i--, (t = e.slice(0, i)));
    var r = gD((t = t.trim()));                                              // gD = parseLinktext
    return { path: r.path, subpath: r.subpath, displayText: n };
  })(E);
  return { type: "internal-link", text: D + A, displayText: P, start: EL(n, M), end: EL(n, S) };
}
```

So: the raw inner text is the **concatenation of every `hmd-internal-link` node in a maximal adjacent run** (which is what makes the escaped-pipe split harmless), the alias split is on the *first* `|` with a one-character back-off when it is escaped, `parseLinktext` separates path from subpath, and the token's reported extent (`M`…`S`) is the min-`from`/max-`to` over those interior nodes — i.e. the inner text, brackets excluded.

**The live-preview widget field (`155857–155871`)** does the same walk streaming, as a state machine over the whole tree:

```js
else if (re.has("formatting-link-start")) ((P = re.has("formatting-embed")), (I = r), (L = a));
else if (I > -1)
  if (re.has("hmd-internal-link")) ((F += v.sliceString(r, a)), (O = a));
  else {
    if (re.has("formatting-link-end") && F)
      if (P) { var m = Q(F, I, a); $(m, I, a); }                       // embed → widget
      else {
        var g = YE(F).href;                                            // split on '|', trim, NFC
        n.metadataCache.isUnresolved(mD(g), k) && C.push(h3.range(L, O));   // getLinkpath, is-unresolved mark
      }
    ((F = ""), (I = -1));
  }
```

`I`/`L` are the from/to of the opener node, `O` tracks the end of the last interior node. The `is-unresolved` mark lands on `[L, O)` — **from the end of `[[` to the end of the last `hmd-internal-link` node**. That is Obsidian's own answer to "what range *is* this wikilink", and it agrees with `getClickableTokenAt`'s `start`/`end`.

`YE` (`65162–65172`) is the string half: split on the first `|`, trim both halves, drop a trailing `\` from the href, collapse ` ` and NFC-normalize (`UE`, `65140`). `mD` is the public `getLinkpath` (strip at `#`); `gD` is the public `parseLinktext`.

## 2. The bridge: token classes → syntax-tree nodes

Obsidian's Markdown "language" is a CM5 stream mode (`window.CodeMirror.defineMode("hypermd", …)`, `109417`) registered as a `StreamLanguage` (`130945`). The bridge is `cm-language/src/stream-parser.ts`. The essentials (already recorded in [pandoc-citekey-cm6-live-preview §6.3](./pandoc-citekey-cm6-live-preview.md), re-verified here against the fork checkout):

- **Line classes are hoisted.** Every `line-…` / `line-background-…` class is stripped from the token, collected per line, and re-emitted as one node spanning the whole line under `lineClassNodeProp` (`stream-parser.ts:344–353`, `376–379`).
- **The remaining classes are sorted and space-joined**, then interned: `cls = tokens.sort().join(' ')` (`:354`), cached in `tokenCache` (`:355`).
- **The node name is that string with spaces → `_`** (`createTokenType`, `:431–442`), and the prop is attached there: `lineMode ? lineClassNodeProp.add({[name]: tagStr}) : tokenClassNodeProp.add({[name]: tagStr})` (`:438`). Both props are `new NodeProp<string>()` (`:454–455`), exported from `cm-language/src/index.ts:16`.
- **A null/empty style produces no node** (`tokenID` returns 0, `:427–428`; empty ids are not emitted). Plain paragraph text is simply absent from the tree.
- **Adjacent tokens with the identical class string merge into one node** (`:364–368`), gated by the `mergeTokens` option (default true, `:61`).

Two clarifications specific to this note:

- **Multi-class tokens are one space-joined string in one prop**, not several props. There is no per-class prop and no array. Read `node.type.prop(tokenClassNodeProp)?.split(" ")` and treat it as a set. `node.type.name` carries the same information with `_` separators and is a worse key.
- **`lineClassNodeProp` sits on a separate node** covering the line, emitted after the token nodes of that line (`:378`). A `tree.iterate` over a range therefore sees both kinds; `apps/obsidian/src/services/citekey-editor/extension.ts:173–175` already reads `tokenClassNodeProp ?? lineClassNodeProp` per node, which is the right shape.

The class strings are also what the DOM gets: `LineHighlighter.buildDeco` maps each token class to `cm-` + class and emits one `Decoration.mark` per node (`stream-parser.ts:513–520`). That is where `.cm-hmd-internal-link`, `.cm-formatting-link`, `.cm-link-alias` come from — and it is registered at `Prec.lowest` (`:531`), which matters in §5.

## 3. Exclusion for free — confirmed, with one exception

Running the tokenizer over each hostile context (method in §0) gives:

| Context | Interior nodes over `[[Note]]` | Link classes? |
| --- | --- | --- |
| `` `[[Note]]` `` (inline code) | `` ` `` → `formatting formatting-code inline-code`; `[[Note]]` → `inline-code` | **no** |
| fenced code block | `[[Note]]` → `hmd-codeblock` (line class `HyperMD-codeblock HyperMD-codeblock-bg parse-next`) | **no** |
| `    [[Note]] indented code` | `[[` → `formatting-link formatting-link-start hmd-indented-code inline-code`; rest → `hmd-indented-code inline-code` | opener only; **no `hmd-internal-link`** |
| `$[[Note]]$`, `$$[[Note]]$$` | `[[` → `bracket math`; `Note` → `math variable-2`; `]]` → `bracket math` | **no** |
| frontmatter (`key: [[Note]]` between `---`) | `hmd-frontmatter`, `hmd-frontmatter meta`, `atom hmd-frontmatter` | **no** |
| `[link]([[Note]])` (inside a Markdown URL) | `[[Note]]` → `string url` | **no** |
| `\[\[Note]]` (escaped) | `formatting-escape hmd-escape-backslash`, `escape hmd-escape-char` | **no** |
| `%%[[Note]]%%` (comment) | `[[` → `comment formatting-link formatting-link-start`; `Note` → **`comment hmd-internal-link`**; `]]` → `comment formatting-link formatting-link-end` | **yes** |

**Verdict: tree-based detection needs no masking pass — except for `%%` comments.** Code (inline, fenced, indented), math, frontmatter, Markdown-link URLs, and backslash escapes all lose the link classes outright, so a gate of "the node's class set contains `hmd-internal-link`" already excludes them. The `citekey-editor` exclusion list (`decorate.ts:22–32`) exists because a *regex* finds `@key` everywhere; a tree-driven wikilink detector needs no equivalent.

`%%…%%` is the one construct that keeps the link tokens and merely adds `comment` (`109784–109789`: the comment branch appends `" comment"` to every token, it does not suppress the link state). Whether to skip it is a **consistency** question, not a correctness one: the Citation Index derives wikilink occurrences from Obsidian's link cache and does no masking of its own (`apps/obsidian/src/services/citation-index/scan.ts:57–76`, "Wikilink occurrences derive from Obsidian's own link cache, which already omits links inside code, so they need no masking"). If the cache lists links inside `%%`, the sidebar counts them and the editor should style them; if it does not, the editor should skip `comment`. **Unverified** — a one-line runtime check (`app.metadataCache.getFileCache(f).links` on a note whose only wikilink is inside `%%`) settles it. Either way, put the decision behind the same predicate on both sides.

Two more exclusions come free from the tokenizer rather than from a class:

- **An unclosed or line-crossing `[[`** becomes `hmd-barelink link`, never `hmd-internal-link` (§1.2). No half-parsed link can be mistaken for a real one.
- **`[[]]`** yields no interior node, so an empty link produces an empty accumulated linkpath and is dropped by the same `if (…&& F)` guard Obsidian uses (`155862`).

## 4. How much of the document the tree covers

### 4.1 The parse is viewport-bounded, twice over

The stream parser deliberately stops just past the viewport (`cm-language/src/stream-parser.ts:222–242`):

```ts
advance() {
  let context = ParseContext.get()
  let parseEnd = this.stoppedAt == null ? this.to : Math.min(this.to, this.stoppedAt)
  let end = Math.min(parseEnd, this.chunkStart + C.ChunkSize)          // ChunkSize = 512
  let overbuffer = 5000;
  let viewportEnd = context.viewport.to + overbuffer;
  if (context) end = Math.min(end, viewportEnd)
  …
  if (context && this.parsedPos >= viewportEnd) {
    context.skipUntilInView(this.parsedPos - overbuffer, parseEnd)
    return this.finish()
  }
```

and it skips forward to the viewport when it starts far above it (`:213–218`, `C.MaxDistanceBeforeViewport = 1e5`). Above that, `Language`'s scheduler adds `Work.MaxParseAhead = 1e5` and a 20 ms budget per document change (`cm-language/src/language.ts:288–314`, `:537–541`).

Therefore: **`syntaxTree(state)` may be shorter than the document, and in a large note it usually is.** `syntaxTree` itself returns "the current (possibly incomplete) parse tree" (`language.ts:199–206`); `ensureSyntaxTree(state, upto, timeout = 50)` temporarily widens the parse viewport and does bounded work (`:211–219`); `syntaxTreeAvailable(state, upto)` answers the question without doing any (`:228–230`).

For a view plugin that only decorates `view.visibleRanges`, this is a non-issue **as long as the incomplete case is detected**, because the visible range is exactly the part that is parsed.

### 4.2 What Obsidian itself does

Obsidian's inline conceal plugin base class (`N3.prototype.update`, `155332–155346`):

```js
n.length < e.view.viewport.to || e.view.composing || e.view.plugin(n3)?.mousedown
  ? (this.decorations = this.decorations.map(e.changes))
  : (n != this.tree || e.viewportChanged || e.selectionSet ||
     DL(e.transactions, e3) || DL(e.transactions, KL) || DL(e.transactions, GL)) &&
    ((this.tree = n), (this.decorations = this.buildDeco(e.view)));
```

Read: **when the tree is shorter than the viewport, do not rebuild — map the old set through the changes.** Otherwise rebuild on tree identity change, viewport change, selection change, or one of three internal effects. It also freezes during IME composition and while `livePreviewState.mousedown` is true.

The whole-document widget `StateField` is the one that forces parsing, and it does so from a state field, not a view plugin: `xu(n.state, t.viewport.to + 2e3, 20)` — `ensureSyntaxTree(state, viewport.to + 2000, 20)` (`156144`).

The fork's own `LineHighlighter.update` is the same pattern in miniature (`cm-language/src/stream-parser.ts:468–476`):

```ts
let tree = syntaxTree(update.state)
if (tree.length < update.view.viewport.to || update.view.compositionStarted) {
  this.decorations = this.decorations.map(update.changes)
} else if (tree != this.tree || update.viewportChanged) {
  this.tree = tree
  this.decorations = this.buildDeco(update.view)
}
```

### 4.3 Evaluating `citekey-editor/extension.ts:66–72`

```ts
if (
  update.docChanged ||
  update.viewportChanged ||
  syntaxTree(update.state) !== syntaxTree(update.startState)
) {
  this.decorations = buildMarks(update.view);
}
```

Correct but strictly weaker than the two references above:

- **Missing the incomplete-tree bail.** When `syntaxTree(state).length < view.viewport.to`, a full rebuild reads a tree that has no nodes over part of the viewport. For the citekey feature that only loses gating (a `@key` inside a not-yet-parsed code block would be marked); for a wikilink feature it loses the *detection itself* — no nodes means no marks, and the marks reappear a tick later when the parse catches up. Visible flicker on a large note. Add the `tree.length < viewport.to → decorations.map(update.changes)` branch.
- **`docChanged` alone is not enough and not needed.** A doc change normally produces a new tree, so the tree-identity test already covers it; keeping `docChanged` costs an occasional extra rebuild and is harmless. Keeping it is the safer default, because `RangeSetBuilder` output is not mapped anywhere else.
- **`selectionSet` is correctly absent.** Obsidian rebuilds on selection because its decorations are selection-dependent (cursor reveal, [pandoc note §6.2](./pandoc-citekey-cm6-live-preview.md)). Plugin marks that hide nothing must not depend on the selection, so they must not rebuild on it.
- **Composition / `mousedown` freezing is optional here.** Obsidian freezes because a rebuild during IME or drag-select would replace *replace* decorations under the cursor. Marks have no such hazard; skipping the freeze only costs a little work.
- **Phase 2 needs one more trigger.** Resolution-aware classes depend on data outside the document (`metadataCache`), and no document or viewport change fires when a Literature Note is created or renamed. Obsidian solves this internally with a re-decorate `StateEffect` (`154132`, dispatched on `post-processor-change`, focus, and blur — `156195–156258`, `156407`). A plugin cannot dispatch that one but can define its own and dispatch it from a `metadataCache.on("resolve" | "changed")` / `NoteIndex` listener; the plugin's `ViewPlugin.update` then adds `update.transactions.some(tr => tr.effects.some(e => e.is(refreshEffect)))`.

## 5. Layering: where a plugin's marks land

### 5.1 Nesting order is precedence order, and it is inverted

`Decoration.mark`'s own doc comment states the contract (`cm-view/src/decoration.ts`, `static mark`):

> Nested mark decorations will cause nested DOM elements to be created. Nesting order is determined by precedence of the [facet](#view.EditorView^decorations), with the higher-precedence decorations creating the inner DOM nodes. Such elements are split on line breaks and on the boundaries of lower-precedence decorations.

The mechanism, end to end:

1. `DocView.updateDeco` materializes `state.facet(decorations)` **in facet-input order** into one array (`cm-view/src/docview.ts:492–513`). Functions (view plugins) and plain sets (state fields) go into the same array; nothing separates them.
2. `RangeSet.spans(this.decorations, …)` is called with that array (`cm-view/src/buildtile.ts:515`). Each set's index becomes its `rank`.
3. `SpanCursor.addActive` keeps the active mark list "organized by rank first, then by size" (`@codemirror/state` 6.5.0 `dist/index.js:3697–3708`).
4. `ContentBuilder.ensureMarks` walks that list **backwards**, appending each mark as a child of the previous (`cm-view/src/buildtile.ts:161–176`). So `active[active.length - 1]` — the *highest* rank, the *lowest* precedence — is the outermost element.

### 5.2 Obsidian's own ordering, and the resulting DOM

Extension assembly for a Markdown editor (`132122`): `[ getLocalExtensions(), LJ.of(getDynamicExtensions()), IJ ]`.

- `getLocalExtensions()` pushes the language itself, `DJ` (`133404`) — **in both modes**.
- `getDynamicExtensions()` (`132391`) pushes the live-preview extension `U3` only when `!sourceMode` (`132410–132422`), then appends `this.app.workspace.editorExtensions` — every `registerEditorExtension` contribution — **last** (`132440`).
- `IJ = MJ.of(PJ)` (`131043`) is the static base list, which contains `Mp`, the fork's `lineHighlighter`, wrapped in `Prec.lowest` (`36053`, `130987`; fork `stream-parser.ts:531`).

Inside `U3` the decoration providers are ordered `[…, W3, j3, n, …]` (`156421–156426`), where `W3` is the inline conceal `ViewPlugin` (`156281`), `j3` the task-line one (`156291`), and `n = H3(e, t)` the widget/embed `StateField` that also emits `is-unresolved`.

Ranks therefore run: `W3` (conceal + `cm-underline`) < `H3` (`is-unresolved`) < plugin extensions < `lineHighlighter` (forced last by `Prec.lowest`). Inverted for the DOM, a resolved-nothing wikilink in Live Preview renders as:

```html
<span class="cm-hmd-internal-link">          <!-- lineHighlighter, Prec.lowest → outermost -->
  <span class="zt-…">                        <!-- a plugin mark at default precedence -->
    <span class="is-unresolved">             <!-- H3 state field -->
      <span class="cm-underline" tabindex="-1" draggable="true">Note</span>   <!-- W3 -->
```

That nesting is independently confirmed by Obsidian's own stylesheet, which uses descendant selectors in exactly that direction: `.markdown-source-view.mod-cm6 .is-unresolved .cm-underline { … }` (`app.css:13447`) and `.markdown-source-view.mod-cm6 .cm-hmd-internal-link .cm-underline { cursor: var(--cursor-link) }` (`app.css:13463–13467`).

**Practical reading for #663:** a plugin mark registered the ordinary way (`registerEditorExtension`, no `Prec`) lands *outside* everything Obsidian draws on the wikilink and *inside* the `cm-*` token classes. Both of Obsidian's descendant-selector chains keep matching, because an extra element between ancestor and descendant does not break a descendant combinator. Do **not** reach for `Prec.highest`: it would move the plugin span inside `cm-underline`, i.e. inside the element Obsidian's click gate and `draggable` attribute live on.

### 5.3 What Obsidian draws on a wikilink, precisely

From `B3.prototype.buildDeco` (`155407–155565`), for a node's class set `g`:

```js
M = g.has("hmd-internal-link") && !g.has("link-has-alias") && !g.has("link-alias-pipe") && !g.has("hmd-embed"),
S = E || M,                                            // "underline this text"
T = g.has("formatting-embed") || g.has("hmd-embed"),
D = g.has("formatting-link") || g.has("link-has-alias") || g.has("link-alias-pipe"),   // "hide this"
P = g.has("formatting-link-end") || C,                 // snap-right on flush
```

| Span | Classes | Decoration |
| --- | --- | --- |
| `[[` | `formatting-link formatting-link-start` | `a3` — `Decoration.replace({})`, snap-left (`155549`) |
| plain target `Note` | `hmd-internal-link` | `c3` — `Decoration.mark({class:"cm-underline", …})` (`155556–155562`) |
| aliased target `Note` | `hmd-internal-link link-has-alias` | `a3` replace — hidden |
| `\|` | `hmd-internal-link link-alias-pipe` | `a3` replace — hidden |
| alias `Alias` | `hmd-internal-link link-alias` | `c3` `cm-underline` (it satisfies `M`) |
| `]]` | `formatting-link formatting-link-end` | `l3` replace, snap-right |
| whole `[[…]]` when the linkpath does not resolve | — | `h3` `Decoration.mark({class:"is-unresolved"})` over `[endOf"[[", endOfLastInteriorNode)` (`155868`) |
| subpath-only `[[#Heading]]` | — | the leading `#` is separately replaced and the underline starts one char later (`155558–155562`) |
| `![[…]]` (any embed) | `formatting-embed` / `hmd-embed` | the inline plugin **returns early** (`155505`, `155517–155519`); the whole construct is a widget/replace from the state field (`155863–155865`, `155737–155760`) |
| `[[]]` | — | explicit guard: a `formatting-link-start` immediately followed by `]]`, or a `formatting-link-end` immediately preceded by `[[`, is left alone (`155520–155531`) |

Two guarantees fall out:

- **A plugin cannot change conceal.** `buildDeco` reads only `state`, `view.hasFocus`, the selection ranges, the search-highlight field, and `this.tree` (`155407–155420`). It never inspects other decoration sets or the DOM. Adding marks is invisible to it.
- **Embeds are a different world.** For `![[…]]` the visible text is normally gone, replaced by a rendered widget. A mark over the interior renders nothing. This is fine for #663 by construction: the Citation Index reads `getFileCache(file)?.links` (`apps/obsidian/src/services/citation-index/service.ts:130`), which excludes embeds, so the editor must gate on `!hmd-embed` to stay consistent with the index.

### 5.4 A mark that overlaps a replace decoration

`RangeSet.spans` reports a replaced range through `iterator.point(from, to, deco, active, openStart, rank)`, and `active` comes from `SpanCursor.activeForPoint(to)` (`@codemirror/state` `dist/index.js:3338`, `:3764–3775`):

```js
for (let i = this.active.length - 1; i >= 0; i--) {
    if (this.activeRank[i] < this.pointRank) break;
    if (this.activeTo[i] > to || this.activeTo[i] == to && this.active[i].endSide >= this.point.endSide)
        active.push(this.active[i]);
}
```

and `ContentBuilder.addInlineWidget(tile, active, openStart)` wraps the replacement in exactly those marks (`cm-view/src/buildtile.ts:101–111`, called at `:536`). Two consequences, both derived from the side ordering in `cm-view/src/decoration.ts` (`MarkDecoration` opens at `Side.NonIncStart = 5e8`; `Decoration.replace` opens at `NonIncStart - 1` and closes at `NonIncEnd + 1`):

1. **A mark that starts exactly where a replace starts is not applied to it.** The replace sorts first, so it becomes `this.point` before the mark is ever added to `active`. Symmetrically, a mark ending exactly where a replace ends fails the `activeTo[i] == to && endSide >= point.endSide` test.
2. **A mark that strictly contains an interior replace does wrap it.** For an aliased wikilink, a mark over the whole inner text `Note|Alias` opens before the pipe's replacement and closes after it, so the zero-width replacement widget is emitted *inside* the plugin's span.

Net for #663: a mark over the full `[[…]]` and a mark over the inner text render identically in Live Preview for a plain wikilink, because the bracket replacements are excluded from both by rule 1. They differ (a) in Source mode and while the cursor reveals the construct, where the full-span mark also colours `[[` and `]]`, and (b) for aliased links, where any mark spanning the pipe swallows a zero-width widget — harmless for colour and text-decoration, visible if the class ever grows a `background`, `border`, or `padding`.

### 5.5 Click, hover, and drag are unaffected — with one hard rule

From [obsidian-clickable-token-pipeline §2](./obsidian-clickable-token-pipeline.md), re-checked against 1.13.4:

- Hover is delegated on `.cm-link, .cm-hmd-internal-link, .cm-footref` (`132052`), matched with the ancestor-inclusive `matchParent`. `.cm-hmd-internal-link` is the outermost span, so an extra plugin span underneath changes nothing.
- The Live Preview click gate (`132654–132670`) needs `matchParent(".cm-underline")` **and** `matchParent(".cm-hmd-internal-link")` or `.cm-link`. Both are ancestors of the text node either way.
- Drag works off `t.draggable` on the event target chain (`132700–132708`); `draggable="true"` sits on Obsidian's own `cm-underline` span (`154150`).
- **The hard rule** is the pre-lookup structural gate (`132641–132650`): the walk from event target up to `contentDOM` aborts on any element with `contentEditable === "false"` that has neither the `external-link` class nor a `draggable` attribute. A plain `<span class="…">` has `contentEditable === "inherit"` and passes. So: never set `contenteditable` on the mark, and do not add `draggable` — Obsidian already owns it here.

Do not add `cm-underline` either. The `citekey-editor` mark does (`apps/obsidian/src/services/citekey-editor/extension.ts:40`) because Obsidian withholds it from bare links and the click gate needs it. For a wikilink Obsidian already supplies it in Live Preview and deliberately withholds it in Source mode (the whole live-preview extension is absent, `132418–132422`); adding it would fabricate an affordance Obsidian chose not to give.

## 6. Matching an editor-side span against the index

### 6.1 Match on the linkpath, not on cache positions

`CitationOccurrence.position` for a wikilink is copied straight from `LinkCache.position` (`apps/obsidian/src/services/citation-index/scan.ts:70`), which is a `Pos` into the **last-saved file**. Two independent reasons that makes it unusable as an editor-side key:

1. **It lags the editor by seconds.** `TextFileView.requestSave` is a 2000 ms trailing debounce over `save` (`app.js:127186`; see [pandoc-citekey-index-metadatacache](./pandoc-citekey-index-metadatacache.md) §"Editor-side live parsing"), and the metadata cache re-parses only on `modify`. Every keystroke between saves shifts every later offset in the document, so a cache offset addresses the wrong text.
2. **Even in sync it is the wrong shape.** The index's per-file record is keyed by mtime + size (`service.ts:319–324`), the query API is `async getCitations(file)` (`service.ts:124`), and a decoration build must be synchronous. Awaiting inside a `ViewPlugin` is not an option.

The tree gives the linkpath directly (§1.4), and the *predicate* the index applies to it is already a synchronous free function:

```ts
// apps/obsidian/src/services/note-index/service.ts:57–65
export function resolveIndexedKey(linkpath: string, sourcePath: string, app: App): string | null {
  const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!dest) return null;
  return itemKeyFromFrontmatter(app.metadataCache.getFileCache(dest));
}
```

`CitationIndex.#resolve` calls exactly this for wikilink occurrences (`apps/obsidian/src/services/citation-index/service.ts:378–385`), and `groupCitations` drops a wikilink whose resolution is `null` (`apps/obsidian/src/services/citation-index/query.ts:52`). So **"this syntax-tree wikilink is a Citation" is `resolveIndexedKey(path, sourcePath, app) !== null`** — the same predicate, on the same inputs, with no index round-trip. `getFirstLinkpathDest` is Obsidian's own resolver (`app.js:90369–90380`) and is always current with the vault, unlike link *positions*.

The source path comes from `state.field(editorInfoField).file?.path` (`obsidian.d.ts:2603`; `editorViewField === editorInfoField`, `130853`).

Cost is bounded by the viewport: a handful of `getFirstLinkpathDest` + `getFileCache` calls per rebuild, both map lookups.

### 6.2 What "resolution-aware" can mean synchronously

Three states are decidable from the editor with no I/O:

| Linkpath resolves to | `resolveIndexedKey` | Obsidian draws | Ticket meaning |
| --- | --- | --- | --- |
| a Literature Note carrying an Indexed Key | non-`null` | `cm-underline` | **Citation** — style it |
| an existing note without an Indexed Key | `null` | `cm-underline` | ordinary wikilink — untouched |
| nothing (no such file) | `null` | `cm-underline` + `is-unresolved` | not a Citation — untouched |

That is one class, not two. The ticket's Phase 2 wording ("a linkpath resolving to a Literature Note's Indexed Key styles differently from one that does not") therefore needs a decision, and the honest options are:

- **(a) Two classes over the Citation set only**, where the second axis is whether the Indexed Key is *findable in the connected Zotero library*. That is a `@zotlit/db` lookup — asynchronous, exactly the shape [pandoc-citekey-cm6-live-preview §5 Phase 2](./pandoc-citekey-cm6-live-preview.md) anticipated. It needs a resolved/unresolved cache plus the `StateEffect` rebuild trigger from §4.3, and it should not block Phase 1.
- **(b) Two classes over every wikilink**, adding a "known citation linkpath that currently resolves to nothing" state. This requires the plugin to hold the set of linkpaths the index has ever seen as citations, and it will style a link that Obsidian is simultaneously marking `is-unresolved`. Cheap, but it re-introduces exactly the "editor disagrees with the index" risk that (a) avoids.

Recommendation: ship Phase 1 with the single `resolveIndexedKey !== null` gate and one class, and settle (a) vs (b) on the ticket before Phase 2. Whatever is chosen, keep the predicate in one exported function shared with `CitationIndex.#resolve`, so the sidebar and the editor can never disagree about what a Citation is.

### 6.3 Where the index is still needed

Nowhere, for #663 — and that is the point. The editor computes the Citation predicate locally and stays correct while the file is dirty; the `CitationIndex` keeps owning reference numbers, the References Sidebar, and the vault-wide view, where the save-time cache is the right source. The two meet at `resolveIndexedKey` and at the `citation.wikilink-citations` setting (`apps/obsidian/src/services/settings/schema.ts:80`), which gates both.

## 7. Live Preview versus Source mode

**Token emission is identical.** The `StreamLanguage` `DJ` is pushed by `buildLocalExtensions` (`133404`) with no mode condition, and `lineHighlighter` sits in the always-on base list `PJ` (`130987`). Every node, class string, and `cm-*` DOM class in §1 is present in both modes. A tree-driven detector therefore needs no per-mode branch to *find* wikilinks.

**Only the presentation differs.** `getDynamicExtensions` installs the entire live-preview extension `U3` only when `!sourceMode` (`132410–132422`), and `editorLivePreviewField` is initialized to `!sourceMode` on the same line (`132414`, field at `130854`; see [pandoc note §6.6](./pandoc-citekey-cm6-live-preview.md)). In Source mode there is no `a3`/`l3` replace, no `cm-underline`, no `is-unresolved`, and — per the click gate's first line, `if (n.sourceMode) return !0` (`132655`) — a different click path.

So one extension covers both modes, and the mode difference belongs in CSS, not in the decoration builder. The shipped citekey stylesheet already demonstrates the shape (`apps/obsidian/src/services/citekey-editor/style.css`): `.markdown-source-view.mod-cm6.is-live-preview …` versus `.markdown-source-view.mod-cm6:not(.is-live-preview) …`, keyed off the `is-live-preview` class Obsidian toggles on the editor element (`132412`).

**Reading mode is untouched by construction.** CM6 extensions run only in the editor; the rendered view is a different pipeline (the `MarkdownRenderer` anchor path, [clickable-token note §1.8](./obsidian-clickable-token-pipeline.md)). No opt-out is needed.

## 8. Implementation guidance for #663

### 8.1 Shape

**Provisioning: a `ViewPlugin`, at default precedence, behind the mutable-array toggle.** Marks change no vertical layout, so the provisioning rule allows the indirect path ([pandoc note §3](./pandoc-citekey-cm6-live-preview.md)), and the indirect path is what can read `view.visibleRanges`. Mirror `CitekeyEditor` (`apps/obsidian/src/services/citekey-editor/service.ts`): register one mutable `Extension[]` once, splice the extension in or out from the settings subscription, call `workspace.updateOptions()`. Gate on `citation.wikilink-citations` **and** the new editor toggle. No `Prec` wrapper (§5.2). No `eventHandlers` — unlike the citekey case, click and hover are Obsidian's and must stay Obsidian's.

**Pure core: two functions, no CodeMirror imports.**

```ts
/** One node of Obsidian's syntax tree, reduced to what the scan reads. */
export interface TokenNode { from: number; to: number; classes: readonly string[] }

/** One internal link found in a node run. Offsets are document offsets. */
export interface WikilinkSpan {
  isEmbed: boolean;
  /** `[endOf"[[", endOfLastInteriorNode)` — Obsidian's own extent for the link. */
  inner: { from: number; to: number };
  /** The alias text span, when the link has one. */
  alias: { from: number; to: number } | null;
  /** Accumulated interior text, alias split off, trimmed — the `parseLinktext` input. */
  linktext: string;
}

/** Streaming state machine over nodes in document order; mirrors app.js:155857–155871. */
export function scanWikilinks(nodes: Iterable<TokenNode>): WikilinkSpan[];

/** Which spans to mark, and with what. Pure; the caller supplies the predicate. */
export function wikilinkCitationMarks(
  spans: readonly WikilinkSpan[],
  classify: (span: WikilinkSpan) => string | null,
): { from: number; to: number; class: string }[];
```

`scanWikilinks` is testable with literal class strings copied from §1.2 — no editor, no vault, no mock. `wikilinkCitationMarks` is testable with a stub `classify`, exactly the way `citekeyMarks` takes an `isExcluded` callback (`apps/obsidian/src/services/citekey-editor/decorate.ts:52–66`) and `decorate.test.ts` exercises it. The impure shell — `syntaxTree(state).iterate` over `view.visibleRanges`, feeding `TokenNode`s in, and `resolveIndexedKey` behind `classify` — stays in `extension.ts`.

**The state machine** (one pass, no lookahead), from `155857–155871`:

- node has `formatting-link-start` → open a run; record `isEmbed = classes.has("formatting-embed")`, `innerFrom = node.to`.
- run open and node has `hmd-internal-link` → append `text += slice(node)`, `innerTo = node.to`; if `link-alias-pipe` and no alias yet, mark the alias as starting at `node.to`.
- run open and node lacks `hmd-internal-link` → if it has `formatting-link-end` and the accumulated text is non-empty, emit the span; close the run either way.

Alias splitting and normalization then follow `YE` (`65162`) and `parseLinktext`: split on the first `|`, back off one character when it is `\`-escaped, trim, NFC-normalize.

### 8.2 Decisions, with rationale

| Decision | Choice | Why |
| --- | --- | --- |
| **Span to mark** | `inner` — from the end of `[[` to the end of the last interior node | It is Obsidian's own extent for a wikilink, used both by the `is-unresolved` mark (`155868`) and by `getClickableTokenAt`'s `start`/`end` (`131823–131824`). It never begins at a replace boundary (§5.4 rule 1), it covers the visible text in both modes and both link forms, and it makes the plugin's CSS story the same as `.is-unresolved`'s. |
| **Alternative span** | mark `alias` when present, else `inner` | Slightly tighter: never spans the concealed pipe, so no zero-width widget lands inside the styled element (§5.4 rule 2). Take this if the class ever needs `background`, `border`, or `padding`. |
| **Gate** | `hmd-internal-link` present **and** `hmd-embed`/`formatting-embed` absent | Embeds are excluded from the index by construction (`service.ts:130` reads `links`, not `embeds`) and are replaced by widgets in Live Preview anyway (§5.3). |
| **`%%` comments** | follow whatever `metadataCache.links` does | Consistency with the sidebar beats a local judgement call; see §3 for the open check. |
| **Other exclusions** | none | Code, math, frontmatter, escapes, and Markdown-link URLs emit no `hmd-internal-link` (§3). No masking pass, no exclusion list. |
| **Matching** | `resolveIndexedKey(parseLinktext(linktext).path, sourcePath, app) !== null` | Synchronous, always current, and literally the predicate the index uses (§6.1). |
| **Precedence** | default | Puts the plugin span outside every Obsidian decoration on the link and inside `cm-hmd-internal-link`; both of Obsidian's descendant-selector chains and both DOM gates keep working (§5.2, §5.5). |
| **Rebuild triggers** | `tree.length < viewport.to → decorations.map(changes)`; else rebuild on tree identity change, `viewportChanged`, `docChanged`, or the plugin's own refresh effect | Matches `N3.update` (`155332–155346`) and `LineHighlighter.update` (fork `stream-parser.ts:468–476`); the refresh effect covers vault changes no editor transaction reports (§4.3). |
| **Never** | widgets, replace decorations, `atomicRanges`, `contenteditable`, `draggable`, `cm-underline`, `Prec.highest`, `ensureSyntaxTree` from the view plugin | Each one either violates the ticket's "marks only" constraint or steps on a gate Obsidian owns (§5.5). |

### 8.3 Sketch

```ts
const wikilinkCitationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    tree: Tree;

    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.decorations = build(view);
    }

    update(update: ViewUpdate): void {
      const tree = syntaxTree(update.state);
      if (tree.length < update.view.viewport.to) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (
        tree !== this.tree ||
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshCitations)))
      ) {
        this.tree = tree;
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
```

where `build` iterates `syntaxTree(state)` over each `view.visibleRanges` entry, collects `{ from, to, classes }` for every node with a `tokenClassNodeProp`, runs `scanWikilinks`, and asks `classify` — `resolveIndexedKey` against `state.field(editorInfoField).file?.path` — for each span's class.

One boundary detail: a wikilink may straddle a visible-range edge. `RangeSetBuilder` requires sorted, non-overlapping additions, so either extend each visible range to line boundaries before iterating (the shape `buildMarks` already uses at `apps/obsidian/src/services/citekey-editor/extension.ts:139–146`) or de-duplicate spans by `inner.from`. Since a wikilink never crosses a line (§1.2), whole-line extension is sufficient and keeps the scan single-pass.

## 9. Open questions and risks

- **`%%` comments in the link cache — Unverified.** §3 shows the editor tokenizer keeps `hmd-internal-link` inside `%%…%%`. Whether `CachedMetadata.links` lists such a link decides whether the editor should skip `comment`. One runtime check settles it; until then, both sides should route through one predicate so they cannot drift.
- **Phase 2's second class is underspecified.** §6.2 shows only one state is synchronously decidable as "Citation". Choose (a) an async Zotero-library axis with a refresh effect, or (b) a known-linkpath axis; do not let the implementation invent a third meaning.
- **The token vocabulary is a fork internal pinned to 1.13.4.** `hmd-internal-link`, `link-has-alias`, `link-alias-pipe`, `link-alias`, `formatting-embed`, `formatting-link-start`/`-end` carry no compatibility contract. Keep them in one module-level constant next to `scanWikilinks`, and design so an unknown vocabulary degrades to "no marks", never to visual corruption.
- **The nesting order is derived, not documented as API.** `Decoration.mark`'s doc comment states the precedence→nesting rule, but Obsidian's *relative* position (plugin extensions appended at `132440`, `lineHighlighter` at `Prec.lowest`) is an internal arrangement. If Obsidian ever wraps plugin extensions in a `Prec`, the plugin span could move inside `cm-underline`. Write the CSS so it does not depend on being the outer element (compound selectors on the plugin's own class, not descendant chains through Obsidian's).
- **Aliased links hide the linkpath.** Styling `[[Zotero/@smith2020|Smith 2020]]` colours the alias, which is the only visible text — correct, but it means the user sees citation styling on text that does not look like a citekey. Worth one sentence in the user docs.
- **Multi-pipe links.** `[[a|b|c]]` yields two `link-alias-pipe` nodes (§1.2); Obsidian splits on the first pipe, so `b|c` is the display text. The state machine must record only the *first* pipe as the alias boundary, matching `131807–131811`.
- **`getFirstLinkpathDest` cost inside the render path.** Bounded by the viewport today. If a note ever shows hundreds of wikilinks at once, memoize per `(linkpath, sourcePath)` and invalidate on the refresh effect.
