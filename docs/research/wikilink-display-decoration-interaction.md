# Wikilink Display Decoration and Obsidian's Own Interaction

What happens when a plugin puts a `Decoration.replace` widget over the inner text of a Literature Note wikilink in Live Preview, and what the widget must carry so Obsidian's own click, hover, and drag keep working. Covers the rank and geometry rules that decide which of Obsidian's spans wrap a plugin widget, the four DOM gates around the editor link handlers, the conceal/reveal grouping a plugin replace has to stay in step with, atomic ranges, and the Reading-mode counterpart.

Written for the re-scoped [#663](https://github.com/aidenlx/zotlit/issues/663), which moved from marks-only styling to **display decoration**: `[[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]]` must stop rendering as a raw path plus fragment. The settled invariant under test is: *decoration changes display only; click, hover, drag, and conceal interaction stay Obsidian's; cursor contact restores raw text; Source mode raw.*

**The invariant is satisfiable, but not the way the prior note assumed.** Nothing Obsidian draws on a wikilink wraps a plugin's replacement widget — not `cm-underline`, not `cm-hmd-internal-link` — and no `Prec` placement changes that, because the exclusion is geometric, not rank-based. The widget must carry the classes and attributes itself. §2.5 gives the exact recipe.

Primary sources:

- Obsidian's extracted runtime, `node_modules/.ob-rev-1.13.4/app.js` (a local extraction, not committed). All bare line numbers are into that file.
- `@codemirror/state` 6.5.0 — **source**, checked out at tag `6.5.0` from `https://code.haverbeke.berlin/codemirror/state` to `~/repo/zotlit-repo/cm-state`. 6.5.0 is what `obsidian@1.13.1` declares in `peerDependencies`. Cited `cm-state/src/<file>:<line>`.
- Obsidian's public CM forks, checked out locally: [`lishid/cm-view`](https://github.com/lishid/cm-view) at `~/repo/zotlit-repo/cm-view` (fork of `@codemirror/view` 6.43.7) and [`lishid/cm-language`](https://github.com/lishid/cm-language) at `~/repo/zotlit-repo/cm-language` (fork of `@codemirror/language` 6.12.3). Cited `cm-view/src/<file>:<line>`.
- This repo's own code, cited `path:line`.

Prior work in this repo, cited rather than repeated:

- [Wikilink editor styling on the HyperMD syntax tree](./wikilink-editor-styling-hmd-syntax-tree.md) — §1 (token inventory), §2 (the bridge), §3 (exclusions), §4 (viewport-bounded parse), §6 (index matching) stay valid unchanged. §5 (layering) and §8 (guidance) were derived under a marks-only scope; this note supersedes them for replaces, and corrects two of their claims (§1.2, §1.3 below).
- [Obsidian's clickable-token pipeline](./obsidian-clickable-token-pipeline.md) — §2 (the gates), §3 (`triggerClickableToken` dispatch).
- [Pandoc citation syntax in CodeMirror 6 Live Preview](./pandoc-citekey-cm6-live-preview.md) — §3 (provisioning rule), §6.1 (LP decoration architecture), §6.2 (cursor-reveal rules), §6.6 (rebuild signals).

## 0. Scope, versions, method

Analyzed runtime: **Obsidian 1.13.4**, the same extraction the three prior notes used, so every `app.js` line number stays comparable with them. The `obsidian` API package this workspace compiles against is 1.13.1, whose `peerDependencies` name `@codemirror/state` 6.5.0 and `@codemirror/view` 6.38.6; the local `cm-view` fork checkout is 6.43.7, one minor ahead, and its `buildtile.ts` / `Tile` naming differs from upstream's `buildview.ts` / `ContentView` while the algorithms match.

Minified names drift between releases. Re-derive them; do not copy them forward.

| Minified | Role | Definition |
| --- | --- | --- |
| `nn` / `$o` / `Si` / `Te` | `Decoration` / `EditorView` / `ViewPlugin` / `Prec` | export table `14560–14730` |
| `Ep` / `Mp` | Stream-token → `cm-*` mark highlighter / its `Prec.lowest(ViewPlugin)` | `35978–36051` / `36053–36064` |
| `kp` / `Cp` | `tokenClassNodeProp` / `lineClassNodeProp` | export table `14730` / `14721` |
| `DJ` | `StreamLanguage.define(hypermd)` | `130945–130963` |
| `PJ` / `IJ` | Static base extension array / `Compartment.of(PJ)` | `130964–131043` / `131043` |
| `LJ` | Dynamic-extension `Compartment` | `131044` |
| `N3` / `B3` / `W3` | LP inline conceal: base class / builder / its `ViewPlugin` | `155327–155349` / `155350–155607` / `156281–156290` |
| `V3` / `j3` | LP task-line decorator / its `ViewPlugin` | `155608–155638` / `156291–156300` |
| `H3` | LP widget/embed `StateField` factory (also emits `is-unresolved`) | `155639–156194` |
| `U3` | The composite live-preview extension | `156301–156550` |
| `a3` / `s3` / `l3` | `Decoration.replace({})` — snap-left / header-only / snap-right | `154147` / `154148` / `154149` |
| `c3` | `Decoration.mark({class:"cm-underline", attributes:{tabIndex:"-1",draggable:"true"}})` | `154150` |
| `h3` | `Decoration.mark({class:"is-unresolved"})` | `154152` |
| `i3` / `r3` | Inline-marker class set / "linkish" class set | `154137` / `154138–154145` |
| `ML` / `SL` / `xL` | Inclusive range overlap / any-selection-overlap / highlight-overlap | `85613–85615` / `85616–85621` / `85622–85627` |
| `XL` | Public `Editor.addHighlights` decoration `StateField` | `87115–87132` |
| `YE` / `GE` | wiki-inner-text → `{href,title,isAlias}` / `"#"`-split breadcrumb | `65162–65173` / `65153–65161` |
| `zW` | `resolveLinks` — the Reading-mode `is-unresolved` pass | `104005–104012` |

## 1. Layering: nothing of Obsidian's wraps a plugin replace

### 1.1 Rank is facet index; nesting is rank inverted

`DocView.updateDeco` materializes `state.facet(EditorView.decorations)` into one flat array (`cm-view/src/docview.ts:492–515`), and that array is handed to `RangeSet.spans(this.decorations, …)` (`cm-view/src/buildtile.ts:515`). **The index in that array is the rank** — `HeapCursor.from` assigns it directly (`cm-state/src/rangeset.ts:636–649`):

```ts
for (let i = 0; i < sets.length; i++) {
  for (let cur = sets[i]; !cur.isEmpty; cur = cur.nextLayer) {
    if (cur.maxPoint >= minPoint) heap.push(new LayerCursor(cur, skip, minPoint, i))
```

Facet order is precedence order. `Prec_ = {lowest: 4, low: 3, default: 2, high: 1, highest: 0}` (`cm-state/src/facet.ts:370`); `flatten` buckets by that number and concatenates bucket 0 first (`cm-state/src/facet.ts:514–515`, `:548–549`). So `Prec.highest` inputs land at the **front** of the array (lowest rank number) and `Prec.lowest` inputs at the **back** (highest rank number).

`ContentBuilder.ensureMarks` then walks the active-mark array **backwards**, appending each mark as the child of the previous (`cm-view/src/buildtile.ts:161–176`):

```ts
let parent: CompositeTile | null = this.curLine!
for (let i = marks.length - 1; i >= 0; i--) {
  …
  let tile = MarkTile.of(mark, …)
  parent.append(tile); parent = tile
}
```

`marks` is rank-ascending, so the **highest rank number (lowest precedence) is outermost** and the lowest rank number (highest precedence) is innermost. That is the contract `Decoration.mark`'s own doc comment states (`cm-view/src/decoration.ts:224–230`): "Nesting order is determined by precedence of the facet, with the higher-precedence decorations creating the inner DOM nodes."

A `Decoration.replace({widget})` reaches the DOM through `ContentBuilder.addInlineWidget` (`cm-view/src/buildtile.ts:101–111`, called at `:536`), which calls `ensureMarks(marks, openStart)` at `:106` exactly like a text tile. **A widget is wrapped by whatever marks reach it** — the question is only which marks reach it. A `Decoration.replace()` with no widget takes the same path with a `NullWidget` stand-in (`cm-view/src/buildtile.ts:528`, `:640–648`), so the rules below apply identically.

### 1.2 Obsidian's provider order in 1.13.4

The editor state is built from three top-level slots (`132122`):

```js
var i = [this.getLocalExtensions(), LJ.of(this.getDynamicExtensions()), IJ];
```

- **Slot 1** — the Markdown override of `getLocalExtensions` pushes the HyperMD `StreamLanguage` `DJ` raw (`133404`), in both modes.
- **Slot 2** — `getDynamicExtensions` (`132391–132443`) pushes the live-preview bundle `U3` only when not in Source mode (`132420–132421`), then appends every `registerEditorExtension` contribution **last** (`132440`):

  ```js
  e.push.apply(e, this.app.workspace.editorExtensions)
  ```

  That is a bare `push` — **plugin extensions get no `Prec` wrapper**. The backing array is filled by `Workspace.registerEditorExtension` (`150393–150395`), reached from `Plugin.registerEditorExtension` (`150606–150612`); `updateOptions` (`150033–150039`, `132455–132463`) reconfigures the `LJ` compartment, which re-runs `getDynamicExtensions` and so re-appends the array — the mutable-array toggle mechanism.
- **Slot 3** — `IJ = MJ.of(PJ)`, the static base list, which holds `Mp` at `130987` and `Prec.lowest(XL)` at `130988`.

Inside `U3` the decoration providers are pushed unwrapped at `156421–156430`: `W3` (inline conceal, `156281–156290`), `j3` (task lines, `156291–156300`), and the `H3` state field (`156136–156192`). The only `Prec` calls inside `U3` are `Prec.high` around two arrow-key keymaps (`156334`, `156452`) — nothing to do with decorations.

**Correction to [the prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §5.2.** `cm-hmd-internal-link` does not come from a "lineHighlighter". It comes from a generic legacy-mode token highlighter, class `Ep` (`35978–36051`), which reads `tokenClassNodeProp` off each syntax node and builds one mark per node (`36027–36043`):

```js
var f = d.split(" "),
  v = { class: f.map(function (e) { return "cm-" + e; }).join(" ") };
h = t.tokenCache[d] = nn.mark(v);
```

That plugin — and only that plugin — produces every `cm-*` token class in the editor DOM. It is registered as `Mp = Prec.lowest(ViewPlugin.define(Ep, …))` (`36053–36064`). The `Prec.lowest` half of the prior claim is confirmed; the provider's identity is not what the prior note said. It emits line classes *and* token marks, and it is markdown-agnostic.

Ranks therefore run, low number to high:

| Rank order | Provider | Precedence | DOM position |
| --- | --- | --- | --- |
| earlier | `W3` — conceal replaces + `c3` `cm-underline` | default | innermost of Obsidian's |
| ↓ | `j3` — task lines | default | |
| ↓ | `H3` — widgets, embeds, `h3` `is-unresolved` | default | |
| ↓ | **plugin extensions** | default (unwrapped) | |
| ↓ | `Prec.lowest(XL)` — public highlights | lowest | |
| latest | `Mp`/`Ep` — every `cm-*` token mark | lowest | outermost |

That ordering matches the prior note's §5.2 conclusion for **marks**, and Obsidian's own stylesheet confirms the resulting nesting through its descendant selectors (`app.css:13447`, `13463–13467`). For a **replace**, §1.3 makes the ordering almost irrelevant.

### 1.3 The exact-coincidence rule refutes the `Prec` fix

`RangeSet.spans` reports a replaced range through `point(from, to, deco, active, openStart, rank)`, where `active` comes from `SpanCursor.activeForPoint` (`cm-state/src/rangeset.ts:808–817`):

```ts
activeForPoint(to: number) {
  if (!this.active.length) return this.active
  let active = []
  for (let i = this.active.length - 1; i >= 0; i--) {
    if (this.activeRank[i] < this.pointRank) break
    if (this.activeTo[i] > to || this.activeTo[i] == to && this.active[i].endSide >= this.point!.endSide)
      active.push(this.active[i])
  }
  return active.reverse()
}
```

The rank test at `:812` is real — `this.active` is rank-ascending (`addActive`, `:748–757`), so the loop excludes every mark ranked below the point. But **rank ≥ pointRank is necessary, not sufficient**, and reading it as the whole rule is wrong. Two earlier gates decide most real cases, and neither consults rank.

The reason is a deliberate ±1 offset in the side constants (`cm-view/src/decoration.ts:171–185`, `:247–257`, `:280–292`, `:364–373`). For a default, non-inclusive mark and a default, non-inclusive replace:

| | `startSide` | `endSide` |
| --- | --- | --- |
| `Decoration.mark` | `NonIncStart` = `5e8` | `NonIncEnd` = `-6e8` |
| `Decoration.replace` | `NonIncStart - 1` = `499999999` | `NonIncEnd + 1` = `-599999999` |

The replace always sorts **before** an equal-position mark opening, and always **after** an equal-position mark closing — by exactly one, for any rank. `LayerCursor.compare` (`cm-state/src/rangeset.ts:622–625`) only reaches its rank tie-break when `from` **and** `startSide` are equal, which these two never are. So:

- **Start coincidence.** `SpanCursor.next` dequeues the replace first, takes the "new point" branch (`:790–798`), and calls `forward(to, endSide)` at `:797` before the mark's opening event is ever visited. `LayerCursor.gotoInner` (`:564–583`) then skips the mark's queued entry outright when its own `(to, endSide)` sorts before the target. `addActive` never runs.
- **End coincidence.** A mark that opened earlier is purged by `forward` (`:735–739`) — `activeTo - pos` is 0, and the `endSide` tie-break `-6e8 - (-599999999) = -1 < 0` triggers `removeActive`. This happens *before* `RangeSet.spans` calls `activeForPoint` (`:389–390`).

Truth table, plugin replace at `[2,6)` versus an Obsidian mark:

| Case | Mark range | Mark rank vs. point | Wraps the widget? | Why |
| --- | --- | --- | --- | --- |
| a | `[2,6)` — identical | any | **No** | Mark never opens; skipped by `gotoInner` (`:580–583`) |
| b | `[0,8)` — strict superset | ≥ point | **Yes** | Survives `forward`, passes `:812` |
| c | `[0,8)` — strict superset | < point | **No** — mark splits around the widget | `:811–812` breaks out; matches the documented "split on the boundaries of lower-precedence decorations" (`cm-view/src/decoration.ts:229–230`) |
| d | `[2,7)` — same start, longer end | any | **No** | Point wins the start race; the mark opens at position 6 and covers only `[6,7)` |
| e | `[1,6)` — earlier start, same end | any | **No** | Purged by `forward` (`:736–737`) before `activeForPoint` runs |

**A default mark wraps a default replace only when it is a strict superset on both ends *and* its rank is ≥ the point's.** An inclusive mark (`inclusiveStart`/`inclusiveEnd`) would survive the side tests, but a plugin cannot change the inclusivity of Obsidian's marks.

### 1.4 Applying it: the widget gets no Obsidian span at all

The scan span for a wikilink is `inner` = `[endOf"[[", endOfLastInteriorNode)` — Obsidian's own extent, used by `is-unresolved` (`155868`) and by `getClickableTokenAt`'s `start`/`end` (`131823–131824`). For `[[Note]]` that is `[2,6)`.

From [the prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §1.2, the interior of a plain wikilink is **one** syntax node carrying `hmd-internal-link`, and the opening `[[` carries **no** `hmd-internal-link` (fact 1 there). Subpaths are not tokenized (fact 4), so `literatures/wang#cite:locator=7` is a single node too. Therefore:

| Obsidian decoration | Range for `[[Note]]` | Rank vs. plugin | Wraps a plugin replace over `[2,6)`? |
| --- | --- | --- | --- |
| `c3` `cm-underline` (`W3`, `155562`) | `[2,6)` — identical | lower | **No** — case (a), and case (c) even if it were wider |
| `cm-hmd-internal-link` (`Ep`, `36030–36034`) | `[2,6)` — identical | higher | **No** — case (a) |
| `cm-formatting-link …` on `[[` | `[0,2)` | higher | n/a — disjoint |
| `h3` `is-unresolved` (`155868`) | `[2,6)` — identical | lower | **No** — cases (a) and (c); excluded by scope anyway |
| `a3` / `l3` bracket replaces (`155544–155548`) | `[0,2)` / `[6,8)` | lower | n/a — disjoint points |

**Result: a plugin `Decoration.replace` over `inner` renders a bare widget with no Obsidian classes on it or above it.** Both halves of Obsidian's click gate fail, hover delegation fails, and drag has no `draggable` attribute to latch onto.

Two consequences for the candidate fixes the handoff listed:

- **`Prec` placement (fix b) is refuted.** The exclusion for `cm-hmd-internal-link` is geometric — case (a), decided in the heap merge before rank is consulted. No precedence level changes it. `cm-underline` is additionally blocked by rank (case c), and lowering the plugin below `W3` would put the plugin span inside the very element the gate looks for, which the prior note already warned against for marks.
- The same reasoning applies to Obsidian's own bracket replaces: `a3` over `[0,2)` coincides with the `cm-formatting-link` mark over `[0,2)`, so Obsidian's own concealed brackets also lose their token marks. This is normal CodeMirror behavior, not a plugin-specific hazard.

## 2. The interaction gates, and what the widget must carry

### 2.1 Four gates, on three code paths

Obsidian registers its editor link handlers as **plain DOM listeners on the editor element**, not through CodeMirror's `domEventHandlers` (`132039–132040`, `132052–132056`, `132057`):

```js
132039  o.addEventListener("click", r.onEditorClick.bind(r)),
132040  o.addEventListener("mousedown", r.onEditorClick.bind(r), { capture: !0 }),
132052  o.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref", r.onEditorLinkMouseover.bind(r)),
132057  o.addEventListener("dragstart", r.onEditorDragStart.bind(r)),
```

`o` is the editor element wrapping `cm.contentDOM`. `HTMLElement.prototype.on` is Obsidian's delegation helper (`obsidian.d.ts:207`); `matchParent` (`obsidian.d.ts:89`) is ancestor-**inclusive**, so a single element carrying a class satisfies a `matchParent` test for it. Neither helper is present in `app.js` — both are injected by Obsidian's DOM-extension bootstrap outside the bundle.

**Gate 1 — the structural walk** (`onEditorClick`, `132640–132650`). From the event target up to `contentDOM`, abort on any element with `contentEditable === "false"` that has neither the `external-link` class nor a `draggable` attribute. This is the gate that normally kills clicks inside replaced widgets, and the `draggable` clause is the escape hatch.

**Gate 2 — the class gate** (`132654–132670`), applied *after* the token lookup:

```js
if ("internal-link" === l.type) {
  if (!r.matchParent(".cm-underline")) return !1;
  if (r.matchParent(".cm-hmd-internal-link")) return !0;
  if (r.matchParent(".cm-link")) return !0;
}
```

Both are needed for a plain left-click. `c = sy.isModEvent(e)` (`132653`) short-circuits the whole function at `132656`, so Mod-click and middle-click never reach the class test; Source mode short-circuits at `132655`.

**Gate 3 — hover delegation** (`132052–132056`): `.cm-link, .cm-hmd-internal-link, .cm-footref`. `cm-underline` is not in this list. The handler (`132685–132698`) uses the delegate-matched element only as `targetEl` in the `hover-link` payload.

**Gate 4 — drag** (`132700–132718`): `if (t.instanceOf(HTMLElement) && t.draggable)` on `e.targetNode`, then a `contentDOM` containment check and a `t === n || t.parentNode === n` rejection. `draggable="true"` and `tabIndex="-1"` live on `c3` (`154150`), the mark that no longer renders over a replaced range.

### 2.2 CodeMirror forces `contenteditable="false"` on the widget root

`cm-view/src/tile.ts:480–486`:

```ts
static of(widget: WidgetType, view: EditorView, length: number, flags: TileFlag, dom?: HTMLElement | null) {
  if (!dom) {
    dom = widget.toDOM(view)
    if (!widget.editable) dom.contentEditable = "false"
  }
  return new WidgetTile(dom, length, widget, flags)
}
```

The element that gets it is **the element `toDOM()` returned** — not a wrapper CodeMirror adds. `WidgetType.editable` defaults to `false` (`cm-view/src/decoration.ts:158–159`) and is marked `@internal`, so the assignment is unconditional in practice and **clobbers anything `toDOM()` set**. It runs only on first creation; a cached DOM node keeps whatever it has.

So gate 1 will fire on the widget root unless the root also carries `draggable`. Supplying `draggable="true"` clears gate 1 and satisfies gate 4 at the same time — the same pairing Obsidian itself uses on `c3`.

Children of the widget root are unaffected: an element without its own `contenteditable` attribute reports `contentEditable === "inherit"`, so the walk passes through them and reaches the root.

### 2.3 Target resolution is DOM-blind

All three handlers derive the link from the **document position**, never from DOM text:

- `getClickableTokenAt(posAtMouse(e))` at `132651` (click), `132687` (hover), `132706` (drag).
- `posAtMouse` is `posAtCoords(clientX, clientY)` (`87372–87374`), and the CM6-backed `posAtCoords` calls `view.posAtCoords({x, y}, false)` (`131270–131274`) — **coordinates, not `event.target`**.
- `getClickableTokenAt` (`131744–131826`) reads `syntaxTree(state)`, classifies nodes by `tokenClassNodeProp`, and slices text with `Text.sliceString`. It never touches the DOM. Its other callers — four keyboard commands (`147874`, `147901`, `147928`, `147968`), the mobile link popover (`132556`), and the context menu (`132859`) — fire with no mouse event at all, which independently proves the DOM-independence.
- `triggerClickableToken` (`132521–132546`) then calls `openLinkText(token.text, path, paneType)`.

So a replaced range still resolves to the correct link. `posAtCoords` treats a widget as one opaque box and applies a midpoint rule — left half resolves to the widget's `from`, right half to its `to` (`cm-view/src/cursor.ts:350–355`, `:387`). Both endpoints of `inner` land on a node `getClickableTokenAt` recognizes: `inner.from` is inside the interior node, and `inner.to` is the start of `]]`, which the `formatting-link` + literal-bracket branch at `131782–131784` accepts and then walks left from. `posAtDOM` behaves differently — it returns `tile.posAtStart` unconditionally for anything inside a widget (`cm-view/src/docview.ts:283–319`, widget branch at `:317`) — but no link handler uses it.

### 2.4 `WidgetType.ignoreEvent` does not gate Obsidian's handlers

`WidgetType.ignoreEvent` defaults to `true` (`cm-view/src/decoration.ts:106–146`), and `eventBelongsToEditor` (`cm-view/src/input.ts:447–455`) uses it to drop any event whose target sits under a non-hidden widget, before `handleEvent` dispatches (`:99–100`). That gate covers **only** handlers registered through CodeMirror's own machinery (`EditorView.domEventHandlers` / `eventObservers`, wired at `cm-view/src/input.ts:117–126`).

Obsidian's link handlers are not registered that way — they are `addEventListener` calls on the editor element (§2.1), one level above `contentDOM`. Events from inside the widget bubble to them normally. **`ignoreEvent` is therefore not a gate a display-decoration plugin has to clear**, and leaving it at the default is correct: it keeps CodeMirror's own selection handling out of the widget without affecting Obsidian.

### 2.5 The recipe

One element, carrying everything Obsidian would have supplied:

```ts
class CitationWidget extends WidgetType {
  constructor(
    readonly text: string,
    /** `tokenClassNodeProp` of the interior node, e.g. `["hmd-internal-link", "quote"]`. */
    readonly tokenClasses: readonly string[],
  ) { super(); }

  eq(other: CitationWidget): boolean {
    return other.text === this.text
      && other.tokenClasses.join(" ") === this.tokenClasses.join(" ");
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    // Exactly what Ep would have emitted for this node (app.js:36030-36034),
    // plus the mark Obsidian's click gate needs (c3, app.js:154150).
    el.className = [
      ...this.tokenClasses.map((cls) => `cm-${cls}`),
      "cm-underline",
      "zt-citation",
      "zt-literature-note-link",
    ].join(" ");
    el.tabIndex = -1;
    el.draggable = true;
    el.textContent = this.text;
    return el;
  }
}
```

Why each piece:

| Piece | Clears | Source |
| --- | --- | --- |
| `cm-` prefixed token classes | gate 2 second half (`cm-hmd-internal-link`), gate 3, and theme styling that keys off contextual classes like `cm-quote` | `36030–36034` |
| `cm-underline` | gate 2 first half | `132660` |
| `draggable="true"` | gate 1 and gate 4 | `132649`, `132702`, `154150` |
| `tabIndex="-1"` | parity with `c3`; keeps the widget out of the tab order | `154150` |
| own class | plugin styling with no dependency on being inside or outside an Obsidian span | — |

Deriving the `cm-*` classes from the replaced node rather than hard-coding `cm-hmd-internal-link` reproduces precisely what `Ep` would have drawn, including contextual classes the node picked up from enclosing constructs ([prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §1.3), which the replace otherwise deletes.

Keep the root as the only draggable element. If styling needs inner spans, they inherit nothing for `draggable` (the IDL property is not inherited), and while `dragstart` is fired at the drag source rather than at a descendant, an inner element that fires it would fail the `t.draggable` test at `132702`.

`cm-underline` carries CSS (`app.css:13453–13484`, [clickable-token note](./obsidian-clickable-token-pipeline.md) §2.5). Its colour and cursor rules are **descendant** selectors — `.cm-hmd-internal-link .cm-underline` — so an element carrying both classes matches only the bare `.cm-underline` underline rule, not the link colour or `cursor: var(--cursor-link)`. Set those on the plugin's own class.

### 2.6 Fix (c), plugin-owned handlers, is unnecessary

The settled invariant says interaction stays Obsidian's, and §2.5 keeps it there: navigation, hover preview, drag payload, context menu, and the four keyboard commands all run Obsidian's code against Obsidian's syntax tree. Registering `eventHandlers` on the widget — the shape `citekey-editor` uses (`apps/obsidian/src/services/citekey-editor/extension.ts:100–110`) — would duplicate `triggerClickableToken`'s dispatch, including its 100 ms `setTimeout` and its file-creating behavior for unresolved links (`132521–132546`, [clickable-token note](./obsidian-clickable-token-pipeline.md) §3.2). `citekey-editor` needs its own handlers because Obsidian's tokenizer emits nothing for a bare `@key`; a wikilink has a real `internal-link` token, so there is nothing to fill in.

## 3. Overlap matrix with Obsidian's own decorations

For `[[Note]]` at offsets `0…8`, with the plugin replace over `inner = [2,6)`:

| Obsidian decoration | Range | Kind | Interaction |
| --- | --- | --- | --- |
| `a3` replace on `[[` | `[0,2)` | point | Disjoint. Both points are emitted; the brackets stay concealed and the widget renders after them. |
| `l3` replace on `]]` | `[6,8)` | point | Disjoint, same as above. |
| `c3` `cm-underline` | `[2,6)` | mark | Dropped for this range by §1.3 case (a). The plugin supplies the class. |
| `cm-hmd-internal-link` token mark | `[2,6)` | mark | Dropped, case (a). The plugin supplies it. |
| `h3` `is-unresolved` | `[2,6)` | mark | Out of scope: the feature decorates only links that resolve to a Literature Note ([prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §6.1). Were it in scope it would be dropped, case (a). |
| Aliased-link replaces on target and pipe | `[2,6)`, `[6,7)` | points | Out of scope: an explicit alias wins and gets no display decoration (settled Q6). Confirmed non-issue — the plugin never emits a decoration on an aliased link. |
| Embed widget field | whole `![[…]]` | block/point | Out of scope (settled Q7). `B3` returns early for embeds (`155505`, `155517–155519`) and `H3` replaces the whole construct (`155863–155865`). |
| `Prec.lowest(XL)` search-match highlight | varies | mark | Ranked above the plugin, so it wraps only when strictly containing the widget (case b). A search match usually covers more than the inner text, so it wraps; when it coincides exactly it is dropped, and the reveal path (§4) takes over anyway. |

Two overlapping **points** from different sets never both replace the same range — but this matrix has no such case: Obsidian's bracket replaces are disjoint from `inner`, and the only replace it puts on `inner` itself belongs to the aliased-link path, which the feature excludes.

**Line breaks.** A `ViewPlugin`-provided replace that spans a line break throws at draw time (`cm-view/src/buildtile.ts:516–522`):

```ts
if (to > this.view.state.doc.lineAt(from).to)
  throw new RangeError("Decorations that replace line breaks may not be specified via plugins")
```

Wikilinks never cross a line ([prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §1.1, §1.2), so the constraint is satisfied by construction — but the throw is real, not advisory, and any future "citation run" grouping across lines would hit it.

## 4. Cursor reveal: match the group, not the span

### 4.1 What Obsidian actually tests

The reveal predicate, built once per `buildDeco` call (`155409–155416`):

```js
n = e.hasFocus ? t.selection.ranges : [],
i = t.field(XL),
r = YL.get("obsidian-search-match-highlight"),
o = function (e, t) { return SL(n, e, t) || xL(i, r, e, t); },
```

`ML` is inclusive at both ends (`85613–85615`), so a collapsed cursor exactly on either boundary reveals.

Decorations are **buffered into a group** and the predicate is applied to the group's aggregate extent, not to each decoration (`155423–155449`):

```js
p = function (e) {                       // flush
  if (c) {
    if (o(i, r))                         // revealed
      for (…) { (h = n[t]).always && s.add(h.from, h.to, h.deco); }
    else {                               // concealed
      if (c.length > 1) { var a = c.last(); a.deco === a3 && (a.deco = l3); }
      for (…) { s.add(h.from, h.to, h.deco); }
    }
    c = null;
  }
  ((i = e), (r = e));
};
```

**On reveal, decorations are not added at all** — only `.always`-flagged ones survive, and `a3`/`c3`/`l3` carry no such flag. So a revealed wikilink has no `cm-underline` either, and plain left-click on it is dead by Obsidian's own design. A plugin that reveals in step inherits that behavior, which is the correct parity.

The group grows only across nodes that extend it. The adjacency guard is at `155464`:

```js
if (((i === r && c) || p(i), c)) {
```

— flush unless the current node starts exactly at the group end *and* itself carries a token class. The group end advances at `155547`:

```js
(w || O) && ((r = s), k || O)
```

where `w` is computed from the two class sets at `155487–155493`: `i3 = {em, strong, inline-code, strikethrough, highlight}` (`154137`) and the linkish set `r3 = {link, image, hmd-internal-link, hmd-embed, formatting-link, footref}` (`154138–154145`).

### 4.2 What that means for a wikilink

For `see [[Note]] end` — `[[` at `[4,6)`, `Note` at `[6,10)`, `]]` at `[10,12)`:

- `[[` carries `formatting-link` → in `r3` → group opens at 4, `r = 6`.
- `Note` starts at 6 = `r`, carries `hmd-internal-link` → in `r3` → `r = 10`, and the `S` branch at `155562` emits `c3`.
- `]]` starts at 10 = `r`, carries `formatting-link` → `r = 12`, `P` true → `l3`.
- The following space has no token class → flush of group `[4,12]`.

**A caret anywhere in `4…12` inclusive reveals the whole construct** — from immediately before `[[` to immediately after `]]`.

Two cases where the group is **wider than one wikilink**:

- **`[[A]][[B]]` with no separator.** The second `[[` starts exactly where the first `]]` ended and carries a token class, so the adjacency guard holds and no flush happens between them. Both links share one group and reveal together.
- **Emphasis and other `i3` members abutting the link**, e.g. `**[[Note]]**`. The mechanism is identical — `strong` is in `i3` — provided the CM5 markdown mode tags the `**` delimiters with a class in `i3`. That last step is **unverified**: the emphasis tokenizer's exact class output was not traced. The grouping mechanism itself is fully verified; only whether this particular construct triggers it is open.

### 4.3 The rule for the plugin

**Test the selection against the group extent, not against the replace range.** Using the replace range alone produces a half-reveal: with the caret at offset 4 or 5, Obsidian shows `[[` and `]]` while the plugin still shows its prettified interior — `[[@wang2020, p. 7]]`, which is worse than either end state.

There is no exported hook: `B3`/`W3` is private, and a plugin's own adjacency to Obsidian's concealed constructs does not merge into Obsidian's grouping — Obsidian's group is computed inside one tree walk over its own nodes.

Practical fidelity ladder:

1. **Minimum viable** — reveal when the selection overlaps `[openerNode.from, closerNode.to]` inclusive, i.e. the whole `[[…]]`. Exact for a wikilink surrounded by plain text, which is the common case.
2. **Faithful** — during the same token scan that finds wikilinks, also track the group boundary using the verified `r = s` rule: extend across nodes whose class set intersects `r3` or `i3`, break when a node does not start at the running group end or carries no token class. Covers `[[A]][[B]]` and the emphasis case.
3. **Exact** — replicate the special-case branches at `155469–155531` as well. Not worth it; the residual divergence only ever shows as a one-keystroke visual flicker at a construct boundary.

Recommendation: ship level 2. Pin `i3`/`r3` in one module-level constant next to the scan, alongside the token vocabulary the prior note already requires there, and design so an unknown class degrades to "flush the group early" (reveal a narrower region) rather than to a wrong decoration.

### 4.4 Rebuild triggers

A selection-dependent `ViewPlugin` **must** rebuild on `update.selectionSet`. This reverses the marks-only advice in [the prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §8.2.

There is no doc comment demanding it, but the mechanism does. `ViewPlugin.define`'s `decorations` wiring is a thin read of a stored field (`cm-view/src/extension.ts:216–219`):

```ts
if (deco) ext.push(decorations.of(view => {
  let pluginInst = view.plugin(plugin)
  return pluginInst ? deco(pluginInst) : Decoration.none
}))
```

`DocView.updateDeco` re-reads it on every update (`cm-view/src/docview.ts:99`), but nothing recomputes the field — only the plugin's own `update` does. `ViewUpdate.selectionSet` is `this.transactions.some(tr => tr.selection)` (`cm-view/src/extension.ts:489–492`).

Mirror `N3.prototype.update` (`155332–155346`) for the rest: rebuild on tree change, `docChanged`, `viewportChanged`, `selectionSet`, or the plugin's own refresh effect; map instead of rebuilding when `syntaxTree(state).length < view.viewport.to`, during IME composition, or while `livePreviewState.mousedown` is true.

## 5. Atomic ranges

`EditorView.atomicRanges` (`cm-view/src/extension.ts:308`, doc at `cm-view/src/editorview.ts:1100–1109`) affects:

- `moveByChar` / `moveByGroup` / `moveVertically` and the commands built on them (`cm-view/src/editorview.ts:679`, `:686`, `:720`, via `skipAtoms`);
- reading back native browser edits and selections inside `contentEditable`, which covers native backspace (`cm-view/src/domchange.ts:179`, `:231`);
- clamping a mouse-drag-derived selection (`cm-view/src/input.ts:403–409`).

It does **not** gate `click` events, does not block programmatic `dispatch({selection})`, and has nothing to do with `ignoreEvent`.

Obsidian claims atomicity for exactly two things: folded ranges (`100520`, installed at `133471`) and image-embed widgets flagged `isImageEmbed` (`156432–156446`). Its concealed **text** is deliberately not atomic — the cursor-snap logic in `B3.prototype.update` (`155356–155405`) handles traversal instead.

**Recommendation for #663: no atomic ranges.** With reveal-on-contact (§4), the caret reveals the raw text the moment it reaches the group boundary, so it never has to traverse hidden text and there is nothing for atomicity to skip; adding it would fight the reveal by preventing the very selection state that triggers it. This is a different situation from #664's citekey widgets, which sit over text Obsidian does not conceal and have no reveal group to inherit — the trade-off there is genuinely open.

If the design ever moves to a permanently-concealed replace with no reveal, the choice becomes atomic ranges versus replicating the `a3`/`l3` snap-out contract. That decision belongs to the user, not to this note.

## 6. Reading mode

Reading mode is a different pipeline and a much easier one. Everything below is verified in the runtime; no live-vault check was needed.

**The anchor is built by the parser, before any post-processor runs.** The wikilink tokenizer emits a hast node at `70306–70315`:

```js
var p = { className: "internal-link", href: c, dataHref: c };
… h && ((p["aria-label"] = GE(c)), (p["data-tooltip-position"] = "top")),
  e(r[0])({ type: "ilink", href: c, title: u,
    data: { hName: "a", hProperties: p, hChildren: [{ type: "text", value: u }] } })
```

So the anchor carries `class="internal-link"`, `href`, and `data-href` — both set to the same resolved target — plus `aria-label` and `data-tooltip-position` only when the link is aliased. There is no `target` and no `rel`; internal links never navigate the browser.

`t.render` (`104176–104230`) appends the fully built DOM at `104202` and only then enters the post-processor loop at `104223`. `registerPostProcessor`'s `sortOrder` (`103195–103202`) orders processors relative to each other and nothing else. **Any `registerMarkdownPostProcessor` callback, at any `sortOrder`, sees the anchors already present.**

**The display text is `"#"`-split, and it is where the ugly rendering comes from.** `YE` (`65162–65173`) takes the alias when there is one; otherwise the title is `GE(target)` (`65153–65161`):

```js
function GE(e) {
  return e.split("#").filter(function (e) { return !!e; }).join(" > ").trim();
}
```

That is the whole rule — no basename shortening anywhere in this path. So `[[literatures/Hensher2011#cite:mode=author-in-text&locator=62]]` renders as `literatures/Hensher2011 > cite:mode=author-in-text&locator=62`, confirming the observation the re-scoping session started from. `[[#Heading]]` renders as `Heading` alone, because the empty leading segment is filtered out.

**Nothing recomputes the text afterwards.** The only later pass over `a.internal-link` is `resolveLinks` (`104005–104012`), which toggles the `is-unresolved` class and touches nothing else; it runs once after the post-processors (`104115`) and again on a 500 ms debounce wired to `vault` modify/delete and `metadataCache.changed` (`104019–104027`, `104036–104038`). A full rebuild only happens through `queueRender`, i.e. when the source markdown re-parses.

**Click and hover read attributes, not text** (`103263–103292`):

```js
function o(n) {
  var r = n.getAttr("data-href") || n.getAttr("href");
  return r && e.belongsToMe(n, t, i) ? { href: r, displayText: n.getText().trim() } : null;
}
```

`onInternalLinkClick(e, t, n)` and `onInternalLinkMouseover(e, t, n)` (`103925–103927`, `103984–103990`) declare three parameters and drop the fourth, so `displayText` never reaches navigation or hover.

**So a post-processor may replace an anchor's text children while keeping `class`, `href`, and `data-href` intact, and navigation and hover stay correct.** Two leaks to document:

- `onInternalLinkDrag` (`103921–103924`) forwards `displayText` into `dragManager.dragLink(e, href, path, displayText)`, so a link dragged out of Reading mode carries the *replaced* text as its alias.
- The context menu's Copy item copies `t.getText()` (`103947–103948`), i.e. the replaced text, not the target.

Both are acceptable — arguably desirable, since the replaced text is the citation the author means — but they are behavior changes and belong in the ticket.

The shipped `citekey-reading` service is the shape to follow (`apps/obsidian/src/services/citekey-reading/service.ts:119–121`, `:168–188`): one post-processor registered for the plugin's lifetime, toggles read per render rather than by registering and unregistering, and a `previewMode.rerender(true)` sweep when the toggle or the data changes (`:289–296`). Its `render.ts` deliberately excludes anchors from the citekey scan — `EXCLUDED_SELECTOR` includes `a` (`apps/obsidian/src/services/citekey-reading/render.ts:11–12`) with the comment "a wikilink in reading mode stays plain Obsidian". That comment, and `apps/obsidian/CONTEXT.md:172`, become wrong when #663 ships and must be amended.

## 7. Implementation guidance

**Provisioning: a `ViewPlugin` at default precedence, behind the mutable-array toggle.** An inline replace over a single line is legal from a `ViewPlugin` ([pandoc note](./pandoc-citekey-cm6-live-preview.md) §3; enforced at `cm-view/src/buildtile.ts:516–522`), and only the indirect path can read `view.visibleRanges`. No `Prec` wrapper — §1.3 shows it buys nothing. Mirror `CitekeyEditor` (`apps/obsidian/src/services/citekey-editor/service.ts`) for the register-once, splice-on-settings, `workspace.updateOptions()` pattern.

**Reuse the scan.** `scanWikilinks` from [the prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §8.1 stays as specified and still produces both the display decoration and the citation styling class (settled Q1a). Two additions to its output:

- the interior node's `tokenClassNodeProp` classes, for the widget's `cm-*` reconstruction (§2.5);
- the opener `from` and closer `to`, and the running conceal-group boundary (§4.3), for the reveal test.

**Emit one replace, not a replace plus a mark.** A plugin mark over `inner` alongside a plugin replace over `inner` is case (a) against the plugin's own point, from the same set and therefore the same rank — dropped. The class belongs on the widget.

**Decisions, with rationale:**

| Decision | Choice | Why |
| --- | --- | --- |
| Replace span | `inner` — end of `[[` to end of the last interior node | Obsidian's own extent (`155868`, `131823–131824`); leaves the bracket replaces disjoint (§3) |
| Widget DOM | one `<span>` carrying reconstructed `cm-*` classes, `cm-underline`, `tabindex="-1"`, `draggable="true"` | Clears all four gates (§2.5); nothing of Obsidian's wraps it (§1.4) |
| Precedence | default, unwrapped | Rank cannot fix the geometric exclusion (§1.3) |
| Reveal test | selection overlap, inclusive both ends, against the conceal **group** extent, gated on `view.hasFocus` | Matches `o(i, r)` at `155414–155416`, `85613–85615`; a narrower extent half-reveals (§4.3) |
| Rebuild triggers | tree change, `docChanged`, `viewportChanged`, **`selectionSet`**, plugin refresh effect; map while the parse is short, during composition, and while `livePreviewState.mousedown` | `155332–155346`; `selectionSet` is mandatory for a reveal-capable set (§4.4) |
| Atomic ranges | none | Reveal-on-contact makes them redundant and counterproductive (§5) |
| `WidgetType.eq` | compare display text and the reconstructed class list | Avoids redraws; Obsidian caches widget instances the same way (`156301–156550`) |
| Event handlers | none | Interaction stays Obsidian's (§2.6) |
| Source mode | no extension at all | The whole live-preview bundle is absent (`132418–132422`); raw text is the settled Q5 answer |
| Reading mode | one lifetime post-processor over `a.internal-link`; replace text children only, keep every attribute | §6 |

## 8. Open questions and risks

- **The widget's classes are a reconstruction of a private mechanism.** `Ep`'s `"cm-" + class` join (`36030–36034`) is an internal of Obsidian's `cm-language` fork, and `cm-underline`'s role in the click gate (`132660`) is an internal of `app.js`. If either changes, the widget silently loses its click affordance. Mitigation: keep the class list in one module-level constant, and add a runtime smoke test through the `/obsidian-debug` flow that asserts a plain left-click on a decorated wikilink opens the note.
- **`posAtCoords` at the widget's right edge — unverified end to end.** §2.3 derives that a click in the right half resolves to `inner.to`, and that `getClickableTokenAt` at that position takes the `formatting-link` + literal-`]]` branch (`131782–131784`). The derivation is sound but was not exercised at runtime. One click on the right half of a decorated link settles it; if it fails, the fallback is to bias the widget's rendered width or to accept that the right half behaves like the closing bracket.
- **The emphasis-adjacency reveal case is unverified.** §4.2 shows the grouping mechanism fully, but not whether the CM5 markdown mode tags `**` delimiters with a class in `i3`. A one-line tokenizer probe (the harness described in [the prior note](./wikilink-editor-styling-hmd-syntax-tree.md) §0) settles it. Level-2 grouping (§4.3) is correct either way; only the size of the residual divergence changes.
- **Reading-mode drag and copy carry the replaced text** (§6). Behavior change, needs a ticket line and one sentence in the user docs.
- **`WidgetType.editable` is `@internal`.** Overriding it is possible at runtime but the getter may be stripped from the published `.d.ts`. The recipe in §2.5 does not need it — `draggable` clears gate 1 — so no plugin code should depend on it.
- **The `is-unresolved` and aliased-link cases are excluded by decision, not by mechanism.** Both would be case (a) drops if the scope ever widened. Whoever changes settled Q6 should re-read §3 first.
- **Widget cost inside the render path.** One `WidgetType` instance and one `getFirstLinkpathDest` per decorated link per rebuild, bounded by the viewport. `eq` keeps the DOM stable across rebuilds; without a correct `eq`, every `selectionSet` rebuild would recreate every widget, which is the one way this design becomes slow.
- **Phase B parity.** Settled Q13 ends at a fragment-carrying wikilink rendering exactly like the equivalent `[@citekey]` cluster through #664's pipeline. That is an async, cache-backed display string in the same widget; nothing in this note changes for it except that the refresh effect (§4.4) becomes load-bearing rather than optional.
