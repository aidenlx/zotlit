# Enhancing Obsidian's native graph views with ZotLit citation data

Source study for adding citation edges and Cited Work Nodes to the core
`graph` and `localgraph` views, 2026-09-11. It answers how to make the added
elements visually distinct, filterable, highlightable and hover-previewable.
This report records source observations. It does not claim a runtime test.

This continues `docs/research/obsidian-graph-view-reuse.md`, which lives on the
local-only branch `research/obsidian-graph-view-reuse` and is read with:

```sh
git show research/obsidian-graph-view-reuse:docs/research/obsidian-graph-view-reuse.md
```

The design under study is that report's **strategy C** — wrap `renderer.setData`
per live graph leaf and add data — extended below with the ordering problem it
creates (section h).

Four kinds have to stay apart on screen:

| Kind | Node id | Backing | Native analogue |
| --- | --- | --- | --- |
| Literature Note | vault path | real `.md`, frontmatter `zotero-key` | ordinary note node, `type: ""` |
| Cited Work Node | `@smith2020` | none | unresolved node, `type: "unresolved"` |
| Wikilink edge | — | already in `resolvedLinks` | native link |
| Citekey edge | — | ZotLit Citation Index only | none |

## Sources and version

The runtime is **1.13.4**, read from
`/Users/aidenlx/repo/zotlit-repo/zotlit-v2/node_modules/.ob-rev-1.13.4/app.js`
and `sim.js` in the same directory. Citations below are `app.js:<line>` against
that file. Public signatures come from `packages/obsidian-api/obsidian.d.ts`.
User-facing feature names come from the official help page,
`/Users/aidenlx/repo/obsidian-help/en/Plugins/Graph view.md`. Community plugin
citations name a file and the commit that was read.

| Plugin | Commit | Repository |
| --- | --- | --- |
| Extended Graph | `c1aab34bdd2251f0dd1ad1193c16381f190acf36` | `ElsaTam/obsidian-extended-graph` |
| folders2graph | `2c14aa563c7e13fc6993cacd16332a36ec0f9f5c` | `ratibus11/folders2graph` |
| Graph-Link-Types | `18aa21e9793e7b48e81db7475a86da4d671e12f9` | `natefrisch01/Graph-Link-Types` |

Minified names (`h$` renderer, `s0` engine, `l$` node, `c$` link, `p$` local
narrowing) are an analysis aid. The minifier keeps property and method names, so
nothing below needs a minified identifier at run time.

---

## (a) How a link is drawn, and how to colour one

### Facts

`GraphLink` (`app.js:122181`) owns two PIXI display objects, built once in
`initGraphics`:

- `this.line` — a `PIXI.Sprite(PIXI.Texture.WHITE)` inside a per-link
  `PIXI.Container` (`this.px`), added to `renderer.hanger` (`app.js:122192`).
  The container is rotated to the source→target angle and the sprite is
  stretched: `n.width = Math.max(0, M - S - x)`, `n.height = g`, where `g` is
  `renderer.fLineSizeMult / renderer.scale` (`app.js:122295`).
- `this.arrow` — a `PIXI.Graphics` triangle, also on `hanger`, drawn once as a
  four-point path and thereafter only moved, rotated, scaled and tinted
  (`app.js:122196`).

Every frame, `GraphLink.render()` recomputes colour and alpha from the
**renderer**, never from the link:

```js
var s = r.getHighlightNode(),
    l = o === s || a === s,        // o = source, a = target
    c = QQ;                        // QQ = 0.2, the dim alpha
(s && !l) || (c = 1);
var h = r.colors.line;
l && (h = r.colors.lineHighlight);
```

(`app.js:122239`–`122247`.) The tint is then written as a per-frame lerp,
`n.tint = ZQ(n.tint, h.rgb)` (`app.js:122294`), and the arrow takes
`i.tint = f.rgb` from `r.colors.arrow` (`app.js:122303`). `ZQ` blends 90 % old
value with 10 % new (`app.js:121935`), which is why link colour eases rather
than snaps.

**There is no per-link colour in the data.** `GraphData` carries colour only on
nodes: `setData` reads `y.color` per node and assigns `f.color`
(`app.js:122886`–`122894`); the link branch constructs `new c$(this, f, C)` with
no colour argument (`app.js:122912`). The renderer's `colors` map has exactly
eleven roles, all resolved from CSS classes (`app.js:121978`):
`fill`, `fillFocused`, `fillTag`, `fillUnresolved`, `fillAttachment`, `arrow`,
`circle`, `line`, `text`, `fillHighlight`, `lineHighlight`.

So per-link styling needs one of three techniques.

### Technique A1 — Proxy the `line` sprite's `tint` setter (Extended Graph)

Extended Graph installs a `Proxy` on `link.line` whose `set` trap rewrites
`tint` writes. Core code still runs unchanged; the value it writes is replaced
on the way in.

```ts
ExtendedGraphInstances.proxysManager.registerProxy<typeof link.line>(
    this.coreElement, 'line', {
        set(target, p, newValue, receiver) {
            if (p === 'tint') newValue = getStrokeColor() ?? newValue;
            return Reflect.set(target, p, newValue, receiver);
        },
    }
);
```

(`exg/src/graph/extendedElements/extendedGraphLink.ts:255`.) Returning
`undefined` from `getStrokeColor` lets the core value through, which is how
Extended Graph yields to the highlight colour:

```ts
isHighlighted(): boolean {
    if (this.instances.settings.noLineHighlight) return false;
    return this.coreElement.source === this.coreElement.renderer.getHighlightNode()
        || this.coreElement.target === this.coreElement.renderer.getHighlightNode();
}
```

(`exg/src/graph/extendedElements/extendedGraphLink.ts:169`.) It unregisters the
proxy on the sprite's `destroyed` event and inside a wrapped `clearGraphics`
(`extendedGraphLink.ts:94`, `:267`), because the renderer destroys and rebuilds
these sprites freely.

The lerp still applies, so an overridden tint converges over a few frames rather
than appearing instantly. Width cannot be reached this way — `n.width` is
written unconditionally from `fLineSizeMult`, which is a renderer-wide display
setting.

### Technique A2 — Hide the core line, draw your own (Extended Graph)

`this.coreElement.line.renderable = false`
(`exg/src/graph/extendedElements/extendedGraphLink.ts:90`) suppresses the core
sprite; Extended Graph then draws curves, multi-colour segments and arrows in a
container it re-parents onto `renderer.hanger` (`extendedGraphLink.ts:243`).
This is the only route to a different line **shape** (dashed, curved, thicker).

### Technique A3 — Own PIXI objects on `renderer.px.stage` (Graph-Link-Types)

Graph-Link-Types never touches core link objects. It adds its own `Graphics` to
the **stage** (screen space, not `hanger`), and repositions them itself in a
`requestAnimationFrame` loop:

```ts
const graphics = new Graphics();
graphics.lineStyle(3 / Math.sqrt(renderer.nodeScale), color);
graphics.zIndex = 0;
renderer.px.stage.addChild(graphics);
```

(`glt/src/linkManager.ts:383`.) Because the stage is unscaled, it converts world
coordinates itself from `renderer.panX`, `renderer.panY` and `renderer.scale`
(`glt/src/linkManager.ts:258`). It bundles its own `pixi.js` 7.3.3
(`glt/package.json`) rather than using the global `PIXI` the runtime already
loads (`app.js:123150`, `fm("/lib/pixi.min.js?7.2.4")`).

The world-to-screen transform the runtime itself uses is
`screen_css = (world * scale + pan) / devicePixelRatio`, derived from the
viewport computation `T = -panX / x`, `A = T + (width / x) * devicePixelRatio`
(`app.js:122736`–`122740`).

### Technique A4 — Reuse `hanger` with a per-frame hook

`renderer.renderCallback` is the animation-frame body (`app.js:122682`). It ends
with `n.idleFrames++, n.queueRender()` (`app.js:122778`) and the whole body is
gated on `!(n.idleFrames > 60)` (`app.js:122683`), so the loop parks about one
second after the last `changed()`. Extended Graph proxies `renderCallback`
(`exg/src/graph/graphEventsDispatcher.ts:253`) instead of running its own rAF
loop; that keeps a plugin overlay in step with the core frame and idle when the
graph is idle.

### Recommendation for edge kinds

The two ZotLit edge kinds differ in origin, not geometry, so **A1 on the tint
setter is enough** and is by far the cheapest. Give the citekey edge a distinct
tint and leave wikilink edges untouched, yielding to `lineHighlight` exactly as
Extended Graph does. Reserve A2/A3 for a later dashed-line treatment.

---

## (b) How a node gets its colour

### Facts

`GraphNode.getFillColor()` is a fixed precedence chain (`app.js:122149`):

```js
if (t.getHighlightNode() === this) return t.colors.fillHighlight;
if ("focused" === n) { var r = t.colors.fillFocused; if (r.a > 0) return r; }
else {
  if (i) return i;                                    // i = this.color
  if ("tag" === n) return t.colors.fillTag;
  if ("unresolved" === n) return t.colors.fillUnresolved;
  if ("attachment" === n) return t.colors.fillAttachment;
}
return t.colors.fill;
```

Order: **highlight → focused → explicit `node.color` → type role → default.**
The `colors` map is filled by `testCSS()`, which creates a throwaway
`div.graph-view.color-fill-*` per role and reads its computed `color` and
`opacity` (`app.js:123050`). Theme support is therefore free, and
`engine.onCssChange` re-runs it on `css-change` (`app.js:139485`).

An unknown `type` string falls through to `colors.fill`. folders2graph
nevertheless uses custom types (`"f2g_node"`, `"f2g_heading_node"`) and patches
the **shared node prototype** to colour them
(`f2g/src/graph/NodePrototypePatcher.ts:5`, `:110`), guarded by a
`proto.__f2gPatched` flag because the prototype is shared across every leaf
(`NodePrototypePatcher.ts:104`).

`node.color` is a plain data field. `setData` copies it in and reacts to
changes:

```js
if (i.hasOwnProperty(g)) {
  var b = y.color || null;
  ((f = i[g]).color !== b && ((f.color = b), (u = !0)),
   f.type !== y.type && ((f.type = y.type), (u = !0)));
} else { ((f = new l$(this, g, y.type)).color = y.color || null), ... }
```

(`app.js:122886`–`122894`.) So setting `color: { a, rgb }` on our added node data
needs **no patching at all** and survives every re-render, because our
`setData` wrapper writes it on every pass.

### Can the engine's colour-group pass overwrite it?

No, for two independent reasons.

1. **Ordering.** The engine's only colour write is inside the vault scan:
   `isBoolean(T) || (D.color = T)` (`app.js:139600`), where `T` is the filter
   predicate's return — `true` for a plain pass, or a `{a, rgb}` object when a
   colour group matched. That happens before `setData` is called
   (`app.js:139689`), so a wrapper on `setData` always runs last and wins.
2. **Reachability.** `T` comes from `fileFilter[path]`, filled by
   `setQuery` → `EP(app, requiredInputs, queue, cb)` over `vault.getFiles()`
   (`app.js:139516`–`139520`). Every key is a real file path.

### Can a file-less node ever match a colour group? — No

`CP.match(file, content)` needs a `TFile`: it reads `e.extension`, `e.name`,
`e.path` and calls `metadataCache.getFileCache(e)` (`app.js:74779`–`74786`). The
filter predicate confirms the split (`app.js:139645`–`139655`):

```js
!o || ("" === n
  ? t === s.localFile || (a.hasOwnProperty(t) ? a[t] : !e.hasFilter)
  : "tag" === n ? o.every(e => !!e.color || !!e.query.matchTag(t))
  : "attachment" !== n || o.every(e => !!e.color || !!e.query.matchFilepath(t)))
```

Only `""` (markdown) nodes consult `fileFilter`, and only real files are ever in
it. `"tag"` gets `matchTag`, `"attachment"` gets `matchFilepath` — both synthetic
one-field matches (`app.js:74791`, `app.js:74795`). Anything else, `"unresolved"`
included, short-circuits `"attachment" !== n` to `true` and is **never filtered
and never coloured** by a group. That is native behaviour: unresolved nodes
ignore the search box today.

**Conclusion:** a Cited Work Node cannot be coloured by a colour group under any
query. `node.color` in the data is the only route.

### Query syntax that does work, for Literature Notes

Groups are documented as "type a search term for the notes you want to add to
the group" (`Graph view.md`, *Groups*), and the box parses the full search
grammar. Two operators matter.

**Path.** `path:` is in the operator table with `exclusive: true`
(`app.js:74663`) and its matcher reads only the `filepath` string, with
`requiredInputs() → {}` (`app.js:74334`, `:74343`) — no file content is loaded.
`path:Literature/` is therefore a cheap, correct group query for a
path-prefix convention. It is a substring test, not an anchor.

**Frontmatter property.** `[` opens the property matcher; the parser rejects
nesting and accepts an optional `:value` (`app.js:74132`–`74150`). The matcher
enumerates `cache.frontmatter` keys and matches each against the key pattern
(`app.js:73827`–`73838`); with no value it records a hit on key presence alone
(`app.js:73864`, `a.push({ key: c })`). So:

| Query | Behaviour |
| --- | --- |
| `["zotero-key"]` | quoted key → exact-string matcher (`GA`), matches the property `zotero-key` only |
| `[zotero-key]` | bare key → substring matcher (`YA`), also matches `zotero-key-extra`, `my-zotero-key` |
| `["zotero-key":ABCD]` | key plus a value match |

**Use the quoted form.** Both need `cache.frontmatter`, which exists for markdown
files only.

### Can colour groups be injected programmatically? — Yes

`colorGroups` is registered as an option listener on the Groups section
(`app.js:140077`):

```js
n.optionListeners.colorGroups = function (e) {
  return (Array.isArray(e) && (n.setColorQueries(e), n.engine.requestUpdateSearch()),
          n.getColoredQueries());
};
```

`engine.setOptions({ colorGroups: [{ query, color: { a: 1, rgb } }] })` therefore
creates the group rows, prefills the query text, sets the swatch and re-runs the
search (`app.js:139863`). The user never types a query. The cost is that the row
is a **real, user-editable, user-deletable group** that also lands in the
persisted options — so a "ready-made group" is a suggestion, not an invariant.

There is no "match by plugin predicate" hook: `setQuery` builds `CP` matchers
from strings only (`app.js:139501`), and a matcher whose `matcher` field is
falsy is dropped (`app.js:139503`).

### Recommendation for node kinds

| Node kind | Technique | Why |
| --- | --- | --- |
| Cited Work Node | `color: {a, rgb}` in our `setData` data | only route; zero patching; survives re-render |
| Literature Note | `color: {a, rgb}` in our `setData` data | consistent with the above; a group could not be enforced |

Read the two RGB values from CSS custom properties on a probe element, mirroring
`testCSS` (`app.js:123050`), so themes and dark mode stay correct. Skip our
colour when the incoming node already carries one — that is a user colour group
the engine set at `app.js:139600`, and overriding it would silently break the
documented Groups feature.

---

## (c) Highlight

### Facts

There is exactly one highlight, and it is hover.
The help page states it as "Hover over each circle to highlight that note's
connections" (`Graph view.md`).

`renderer.getHighlightNode()` returns `this.dragNode || this.highlightNode`
(`app.js:123001`). `highlightNode` is set by the PIXI `pointerover` handler and
cleared by `pointerout` (`app.js:122551`, `:122559`); it is also cleared by a
distance check at the end of every frame (`app.js:122781`–`122792`) and reset to
`null` whenever the local graph changes file (`app.js:139316`).

Three visual consequences follow, all inside per-frame `render()`:

| Element | With a highlight node | Source |
| --- | --- | --- |
| Hovered node fill | `colors.fillHighlight`, ahead of everything | `app.js:122154` |
| Hovered node ring | extra `PIXI.Graphics` circle in `colors.circle` | `app.js:122135`–`122144` |
| Hovered node text | alpha forced to 1, label pushed down 15 px | `app.js:122111`, `:122114` |
| Neighbour node | full alpha; others fade to `QQ = 0.2` | `app.js:122104`–`122110` |
| Incident link | `colors.lineHighlight` at alpha 1 | `app.js:122247` |
| Other links | `colors.line` at `QQ = 0.2` | `app.js:122241` |

Neighbourhood is read from the node's own adjacency: `this.forward` /
`this.reverse`, maintained by `setData` (`app.js:122910`–`122915`). **A citation
edge added through our `setData` wrapper participates automatically** — it
becomes a real `GraphLink` and appears in both maps, so hovering a Literature
Note dims everything except its citekey neighbours with no extra work.

### Highlighting a whole class of elements

Nothing in the core supports "highlight all X". Extended Graph builds it from
PIXI filters and an overlay:

- **Outline a set.** A `@pixi/filter-outline` `OutlineFilter` pushed onto
  `node.circle.filters` (`exg/src/graph/sets/nodesSet.ts:40`,
  `exg/src/graph/extendedElements/extendedGraphNode.ts:454`). Three are kept —
  selection, search result, open file — each with its own colour, the selection
  one seeded from `renderer.colors.fillHighlight.rgb`.
- **Dim the rest.** A `NodeShape` graphics child named `"opacity-layer"`, filled
  with the background colour, `alpha` toggled between `0` and `0.8`
  (`exg/src/graph/graphicElements/nodes/nodeGraphicsWrapper.ts:92`, `:213`,
  `:217`). This is an overlay, not an alpha change, so it does not fight the
  per-frame alpha lerp at `app.js:122110`.
- **Suppress link highlight** by rewriting the palette in place:
  `renderer.colors.lineHighlight = renderer.colors.line`
  (`exg/src/graph/graphEventsDispatcher.ts:385`), restored on unload.

The palette-rewrite trick generalises: `renderer.colors` is a plain object read
fresh every frame, so a plugin can temporarily change any of the eleven roles.
`testCSS()` rebuilds it wholesale on `css-change` (`app.js:139485`), which will
discard such an override — re-apply on that event.

### Recommendation for highlight

Hover highlight needs **no work**: adding real edges gives ZotLit the native
behaviour. For "show me all citation edges", the cheapest honest answer is the
tint proxy from (a) — a permanently distinct colour reads better than a
transient highlight, and costs one technique instead of three. Defer the
OutlineFilter/opacity-layer machinery.

---

## (d) Plugin controls in the graph controls panel

### Facts

`engine.controlsEl` is `renderer.containerEl.createDiv("graph-controls")`,
built in the engine constructor (`app.js:139389`). Four sections append
themselves to it: **Filters** (`c0`, `app.js:139925`), **Groups**
(`u0`, `app.js:140072`), **Display** (`p0`) and **Forces** (`f0`). All four
extend one base (`l0`, `app.js:139876`) that adds
`graph-control-section mod-<id>`, a collapsible header, and a
`collapse-<id>` option listener.

Every row is a public `Setting` (`_b`) with a `mod-toggle` class. The Filters
rows follow one shape (`app.js:140039` for *Existing files only*):

```js
new _b(r).setName(J1.optionShowExistingFilesOnly())
  .setTooltip(J1.optionShowExistingFilesOnlyDescription())
  .setClass("mod-toggle")
  .addToggle(e => e.setValue(t.options.hideUnresolved)
    .registerOptionListener(i.optionListeners, "hideUnresolved")
    .onChange(e => { t.options.hideUnresolved = e; t.render(); t.onOptionsChange(); }));
```

Three things happen per change: write `engine.options`, call `engine.render()`,
call `engine.onOptionsChange()`.

### Persistence

`engine.getOptions()` builds a flat object by asking each section's
`optionListeners` (`app.js:139851`, `:139914`), plus `scale` and `close`.
`engine.setOptions(o)` feeds it back and calls `render()` (`app.js:139863`).
Two different destinations:

| View | Path | Source |
| --- | --- | --- |
| `graph` | `onOptionsChange` → core plugin `instance.options` → `saveOptions()` (its `data.json`) | `app.js:139242` |
| `localgraph` | `getState`/`setState` carry `options` → workspace layout | `app.js:139272`, `:139276` |

**A plugin key round-trips if, and only if, it is registered as an option
listener**, because `getOptions` enumerates `optionListeners`, not
`engine.options` (`app.js:139914`). Adding
`engine.filterOptions.optionListeners["zotlitCitations"] = v => { … }` therefore
gives ZotLit free persistence in both destinations. Unknown keys placed straight
on `engine.options` are dropped at save time.

### How Extended Graph injects UI

It does not touch the internal section class. It finds the panel by class and
hand-rolls the same DOM:

```ts
this.graphControls = view.contentEl.querySelector(".graph-controls") as HTMLElement;
this.root = this.graphControls.createDiv(
    `tree-item graph-control-section mod-extended-graph-${sectionID}`);
```

(`exg/src/ui/graphControl/GCSection.ts:20`.) It implements its own collapse, and
removes the root in `onunload` (`GCSection.ts:57`). It also reaches the core
Filters rows by selector to observe them —
`.graph-control-section.mod-filter .checkbox-container`
(`exg/src/graph/graphEventsDispatcher.ts:443`).

### Are the native options readable when our wrapper runs? — Yes

`engine.options` is a live object on the engine, always current: each toggle
writes it before calling `render()`. Extended Graph reads exactly this set —
`showTags`, `showAttachments`, `hideUnresolved`, `showOrphans`, `localJumps`,
`localForelinks`, `localBacklinks` — plus
`engine.filterOptions.search.getValue()` for the search text
(`exg/src/graph/graphEventsDispatcher.ts:393`–`:411`). From a leaf, the engine is
`view.dataEngine` (`graph`) or `view.engine` (`localgraph`)
(`app.js:139172`, `:139257`).

### Does an option change rebuild from scratch? — Yes, every time

`engine.render()` re-scans `metadataCache.getCachedFiles()` and builds a brand
new `{ nodes, numLinks }` on every call (`app.js:139564`–`139639`). Nothing is
incremental. `setData` then diffs that against the live node list and reuses
`GraphNode` objects by id (`app.js:122860`). Consequences:

- **The wrapper must re-add on every call.** There is no "add once" state.
- Node positions and identity survive, because the diff is by id.
- Any per-instance patch on a `GraphLink` or `GraphNode` object is lost when
  that object is removed. Extended Graph handles this by re-installing on
  `initGraphics` and unregistering on `clearGraphics`/`destroyed`
  (`exg/src/graph/extendedElements/extendedGraphNode.ts:130`,
  `extendedGraphLink.ts:94`).

`render()` is called from: every option toggle (`app.js:140030`), `setOptions`
(`app.js:139871`), `setQuery` when the query empties (`app.js:139510`), the
search queue's `onStop` and its 333 ms `beforePause` throttle
(`app.js:139516`, `:139545`), `onFileOpen` (`app.js:139740`), the timelapse
animation (`app.js:139700`), `metadataCache.on("resolved")` via `view.update`
(`app.js:139182`, `:139293`), and the local graph's `update` (`app.js:139316`).

### Recommendation for the panel

Add one **Filters**-shaped row for the citekey edges, matching the
*Tags* / *Attachments* / *Existing files only* pattern:

1. Build a `Setting` with `.setClass("mod-toggle")` into
   `engine.filterOptions.childrenEl`, so it inherits the section's styling and
   collapse state.
2. Register `optionListeners["zotlitCitations"]` on `filterOptions` so it
   persists in the core plugin's `data.json` and in the local graph's leaf state.
3. `onChange`: write our flag, then `engine.render()` and
   `engine.onOptionsChange()`, exactly as the native rows do.

Native toggles ZotLit can lean on rather than duplicate:

| Native row | Effect on Cited Work Nodes injected as `unresolved` | Source |
| --- | --- | --- |
| **Existing files only** | hides them, for free | `app.js:139612`, `if (!l && …)` where `l = options.hideUnresolved` |
| **Orphans** | drops any that lost every edge | `app.js:139663` |
| **Search files** | leaves them alone, like native unresolved nodes | `app.js:139652` |

---

## (e) Hover and the Citation Popover

### Facts

The graph core plugin registers its hover source once, at plugin enable:

```js
e.workspace.registerHoverLinkSource("graph", { display: this.name, defaultMod: !0 });
```

(`app.js:139082`; unregistered at `app.js:139093`.) The engine fires the event
from `onNodeHover` (`app.js:139827`):

```js
if ("" === n || "focused" === n || "attachment" === n) {
  if (o && o.state !== w$.Hidden && a === t) { o.onTarget = !0; return void o.transition(); }
  this.lastHoverLink = t;
  r.workspace.trigger("hover-link",
    { event: e, source: "graph", hoverParent: this, targetEl: null, linktext: t });
}
```

Five facts fall out:

1. **Only three node types fire it.** `"unresolved"` and `"tag"` are excluded.
   A Cited Work Node typed `"unresolved"` therefore produces **no native
   preview** — the suppression question answers itself.
2. `hoverParent` is the **engine**, which carries `hoverPopover` and
   `lastHoverLink` fields for the purpose (`app.js:139377`, `:139376`).
3. `targetEl` is `null`. In Page preview's `onHoverLink`, a null `targetEl`
   makes the deferred "wait for Mod" branch bail out with `if (!o) return`
   (`app.js:179174`). Combined with `defaultMod: true`, that means the graph
   previews only when Mod is already held at hover time.
4. `sourcePath` is omitted, defaulting to `""` (`app.js:179157`).
5. `onNodeUnhover` only calls `hoverPopover.transition()` (`app.js:139845`);
   the popover object is owned by Page preview.

The renderer calls these via `onPointerOver` / `onPointerOut`
(`app.js:122551`, `:122559`), which the engine binds once in its constructor
(`app.js:139385`) and never reassigns.

### What ZotLit has today

`triggerCitekeyHover` sends the same event under ZotLit's own source id:

```ts
workspace.trigger("hover-link", { ...link, source: CITEKEY_HOVER_SOURCE });
```

(`apps/obsidian/src/services/citekey-navigation/shell.ts:77`;
`CITEKEY_HOVER_SOURCE = "zotlit-citekey"` at
`apps/obsidian/src/services/citekey-navigation/hover.ts:12`.) The id is
registered once for the plugin's lifetime with `defaultMod: true`
(`apps/obsidian/src/services/citekey-editor/service.ts:163`), and
`CitekeyHoverLink` requires `hoverParent`, a non-null `targetEl`, `linktext` and
`sourcePath` (`shell.ts:57`–`:66`). `registerHoverLinkSource` is public
(`obsidian.d.ts:4980`), as are `HoverParent` (`:3464`) and `HoverPopover`
(`:3476`).

The Citation Popover takes the same two anchors and **requires a real element**:

```ts
constructor(parent: HoverParent, targetEl: HTMLElement) {
  super(parent, targetEl, WAIT_TIME);
```

(`apps/obsidian/src/services/citation-popover/popover.ts:34`.) `WAIT_TIME` is
300 ms, Obsidian's own delay.

### The gap: a graph node has no DOM element

The graph is one WebGL canvas. Nothing per-node exists in the DOM, which is why
the core passes `targetEl: null`.

Two ways to close it:

- **Anchor element.** Create one zero-size absolutely-positioned div inside
  `renderer.containerEl` (already `position: relative`, `app.js:122403`) and move
  it to the hovered node's screen position,
  `(node.x * scale + panX) / devicePixelRatio`, before constructing the popover.
  This is the only route that satisfies `CitationHoverPopover`'s signature and
  gives Obsidian's positioner something real to flip above/below — which
  `CitationHoverPopover.position()` reads back from the inline style
  (`popover.ts:73`).
- **`HoverPopover` static position.** `HoverPopover`'s fourth constructor
  parameter is `staticPos?: Point | null` (`obsidian.d.ts:3490`), which would
  accept a null `targetEl`. Using it means changing `CitationHoverPopover`'s
  constructor.

### Recommendation for hover

Wrap `renderer.onNodeHover` per renderer instance, after the engine has assigned
it. Then:

| Hovered node | Action |
| --- | --- |
| Cited Work Node (`unresolved`, citekey id) | position the anchor, show ZotLit's Citation Popover for that citekey, and **do not** call through — the core would ignore it anyway |
| Literature Note (`""`, has `zotero-key`) | honour the existing Hover Action setting (`hoverPreferences`, `hover.ts:26`): `page-preview` calls through to the core; `popover` shows ZotLit's and skips the core call |
| Anything else | call through unchanged |

Use the engine as `hoverParent` — it already implements the contract and its
`transition()` on unhover keeps dismissal consistent. Keep the existing
`zotlit-citekey` source id so Page preview stays one settings row, exactly as
`citekey-editor/service.ts:163` intends. Pair the wrap with
`renderer.onNodeUnhover` so the anchor is retired.

---

## (f) Click and right-click

### Facts

`GraphEngine.onNodeClick` (`app.js:139743`):

```js
var i = this.app;
if ("tag" !== n) i.workspace.openLinkText(t, "", sy.isModEvent(e));
else { var r = i.internalPlugins.getEnabledPluginById("global-search");
       r && r.openGlobalSearch("tag:" + t); }
```

There is **no special case for `"unresolved"`** — it takes the `openLinkText`
branch like every other node. And `openLinkText` **creates a file** when the
link path does not resolve (`app.js:79603`):

```js
(s = i.metadataCache.getFirstLinkpathDest(o, t)), … s ? … : [3, 2]
case 2: (u = null), o.contains("/") || (u = i.fileManager.getNewFileParent(t, e)),
        [4, i.fileManager.createNewFile(u, o)]
```

**Clicking an un-intercepted Cited Work Node would create `@smith2020.md` in the
vault.** This is a correctness bug, not a polish item.

`onNodeRightClick` (`app.js:139751`) resolves the id to a file first —
`metadataCache.getFirstLinkpathDest(t, "")` — and does nothing at all when that
returns null, so a Cited Work Node has no native context menu. For a real file
it builds a `Menu` with sections `title, open, action, info, info.copy, view,
view.linked, system, "", danger`, adds a title item and *Open in new tab*, fires

```js
this.app.workspace.trigger("file-menu", a, o, "graph-context-menu", this.view.leaf);
```

(`app.js:139804`) and appends *Delete file*. **`"graph-context-menu"` is the
source string** a `file-menu` listener must test to add ZotLit items to a
Literature Note's graph menu — that is a fully public API
(`obsidian.d.ts`, `Workspace.on("file-menu", …)`).

The click path itself: the renderer fires `onNodeClick` from the stage
`pointerup` handler when the pointer did not drag more than 5 px
(`app.js:122513`–`122520`), and `GraphNode.onClick` routes button 2 and
`rightclick` to `onNodeRightClick` (`app.js:122010`–`122016`).

### How to intercept

The engine assigns all four callbacks **once**, in its constructor
(`app.js:139385`–`139388`), and never reassigns them. A per-renderer wrapper is
therefore stable for the life of the renderer:

```ts
const core = renderer.onNodeClick;
renderer.onNodeClick = (evt, id, type) => {
  if (isCitedWorkNode(id, type)) { openZotLitTarget(id, evt); return; }
  core?.call(renderer, evt, id, type);
};
```

folders2graph solves the same problem the wrong way for our purposes: it
replaces `app.workspace.openLinkText` for the whole application and guards with
"is the most recent leaf a graph view"
(`f2g/src/graph/GraphInteractions.ts:221`, `:232`). That is app-wide blast
radius for a per-leaf need. Wrap the renderer callback instead.

### Recommendation for clicks

Wrap `onNodeClick` and `onNodeRightClick` per renderer. On a Cited Work Node,
run ZotLit's own action — `apps/obsidian/CONTEXT.md` states it as creating the
Literature Note — and never call through, so the note is created from ZotLit's
template rather than as an empty `@smith2020.md`. Register one public
`file-menu` listener filtered on `"graph-context-menu"` for extra Literature
Note actions.

---

## (g) Applying and removing the wrapper

### Facts

There is **no event for "a graph renderer was created"**. Both views build the
renderer in their constructor (`app.js:139172`, `:139257`); `GraphView.onload`
then loads the engine and applies the saved options (`app.js:139185`), and
`LocalGraphView.load` does the same (`app.js:139294`). A plugin sees neither.

All three prior-art plugins converge on the same discovery loop.

| Plugin | Discovery | Source |
| --- | --- | --- |
| folders2graph | `active-leaf-change` + `layout-change`, both non-forced | `f2g/src/Main.ts:224`, `:230` |
| Extended Graph | `onLayoutReady` once, then `layout-change` | `exg/src/main.ts:46`, `exg/src/graphsManager.ts:142` |
| Graph-Link-Types | `layout-change`, plus a polling `setInterval` fallback | `glt/src/main.ts:108`, `:183` |

Each then enumerates leaves — `getLeavesOfType("graph")` and
`getLeavesOfType("localgraph")` (`exg/src/main.ts:476`) — and reads
`leaf.view.renderer`.

Idempotence is the whole problem, and each solves it with a marker:

- folders2graph stores the original as `renderer.originalSetData` and skips a
  renderer that already has one (`f2g/src/Main.ts:372`,
  `f2g/src/graph/GraphDataInjector.ts:180`).
- Extended Graph keeps a `coreTargets` map keyed by proxy and refuses to
  double-wrap (`exg/src/proxysManager.ts:23`).
- folders2graph's prototype patch is flagged `proto.__f2gPatched`
  (`f2g/src/graph/NodePrototypePatcher.ts:104`).

Two guards worth copying:

```ts
private __isReadyGraphLeaf(leaf): leaf is GraphLeafWithCustomRenderer {
    return !!leaf && !!leaf.view && leaf.view.getViewType() === "graph" && !!leaf.view.renderer;
}
```

(`f2g/src/Main.ts:412`.) The renderer can be briefly undefined when
`active-leaf-change` beats view initialisation. And Extended Graph's
`if (!this.app.internalPlugins.getPluginById("graph")?._loaded) return;`
(`exg/src/main.ts:466`) — the graph core plugin can be disabled.

### Teardown

folders2graph's unload is the reference (`f2g/src/Main.ts:292`–`:320`): per
graph leaf, restore `setData` from `originalSetData` and delete the marker,
unpatch the prototype, snapshot `dataEngine.getOptions()`, `view.unload()` then
`view.load()`, and re-apply the snapshot — because the view's own `onload`
resets engine options to the global graph options (`app.js:139185`), which would
otherwise wipe a graph bookmark's configuration.

For a `setData`-only wrapper a full view reload is heavier than needed:
restoring the original and calling `engine.render()` re-pushes clean data
through the original path. Reload only if a prototype patch is also in play.

`renderer.destroy()` terminates the sim worker and destroys graphics
(`app.js:122446`). It is called from both views' `onClose` (`app.js:139195`,
`:139302`), so a leaf that closes takes its renderer with it — a plugin holding a
renderer reference must not resurrect it. Note also the guideline
`obsidianmd/no-view-references-in-plugin`: keep no view or renderer instance on
the plugin object; key a `WeakMap` off the renderer instead.

### Recommendation for lifecycle

`onLayoutReady` once, then `layout-change` and `active-leaf-change`. Per leaf of
type `graph` or `localgraph` with a mounted renderer, install if a marker is
absent. Store originals in a `WeakSet`/`WeakMap` keyed by renderer. On unload,
restore every original and call `engine.render()` once per leaf.

---

## (h) Ordering: injection versus local narrowing and the orphan sweep

### The problem, stated precisely

`GraphEngine.render()` is one monolithic method (`app.js:139552`–`139690`). Its
phases, with the node map's state at each:

```
139564  IIFE: scan getCachedFiles(), read resolvedLinks / unresolvedLinks /
        getTags() / getCache(), apply the filter predicate      -> c = {nodes, numLinks}
139662  s.localFile && (c = p$(c, s))          local BFS narrowing, depth/fore/back/inter
139663  s.showOrphans || (orphan sweep)(c)     delete nodes with no live edge
139684  currentFocusFile -> node.type = "focused"
139689  return (r.setData(c), u)               <-- a setData wrapper runs HERE
```

A wrapper on `setData` sees the map only after `p$` has already thrown away
everything outside the local neighbourhood. So in the local graph:

- The depth BFS never traverses a citation edge. Depth 2 from a Literature Note
  never reaches a note that shares a citekey with it.
- `localForelinks` / `localBacklinks` never see citation direction.
- The orphan sweep already ran, so a Cited Work Node we add cannot rescue a node
  the sweep deleted, and our own additions are never orphan-swept.
- `numLinks` is wrong, which mis-scales the timelapse animation
  (`app.js:139701`).

`p$` (`app.js:123104`) is a module-local function, not a method — it cannot be
wrapped on the engine instance. The scan is an inline IIFE with no name. There is
no engine method between the two.

### The seams, and what each buys

**Seam 1 — wrap `renderer.setData`.** Post-narrowing. Edges are drawn and the
adjacency is correct for hover highlight, so (a), (c) and (e) all work. Local
narrowing, orphan logic and `numLinks` do not. Lowest coupling: one property on
one instance.

**Seam 2 — wrap `engine.render` wholesale.** You must reimplement `p$` and the
orphan sweep, both of which are copyrighted logic you would be re-deriving from
a minified read. High effort, and it breaks whenever either changes.

**Seam 3 — swap `engine.app` for the duration of one `render()` call.** This is
the seam that works. `render()` reads the app once, at the top:

```js
var e = this, t = this, n = t.app, i = t.view, r = t.renderer,
    o = t.searchQueries, a = t.fileFilter, s = t.options,
```

(`app.js:139552`–`139560`), and passes `n.metadataCache` as the IIFE's first
argument (`app.js:139641`). The IIFE reads exactly six things from it:
`resolvedLinks`, `unresolvedLinks`, `vault`, `getTags()`, `getCachedFiles()`,
`getCache(path)`, `isUserIgnored(path)` (`app.js:139565`–`139631`).

So a wrapper on `engine.render` can set `engine.app` to an object whose
`metadataCache` is a facade — real cache, with `resolvedLinks` and
`unresolvedLinks` augmented by ZotLit's citation edges — call through, and
restore in a `finally`. `render()` is synchronous through to `setData`, so no
other code observes the swap.

This is **strategy D from the prior report, scoped to one synchronous call on
one engine instance** instead of mutating the app-wide `metadataCache`. The
prior report's objection — "the blast radius is the whole application" — does not
apply, because nothing outside this one call frame ever reads the facade.

Everything then falls into place:

| Behaviour | Result with seam 3 |
| --- | --- |
| Local depth BFS | traverses citation edges; `p$` copies node types via `r$` (`app.js:121972`) |
| `localForelinks` / `localBacklinks` | apply to citation direction |
| Depth expansion through Cited Work Nodes | permitted — `o$ = { tag: !0 }` blocks tag nodes only (`app.js:121977`, used at `app.js:123121`) |
| Orphan sweep | includes our edges, so a note whose only link is a citation stops being an orphan |
| **Existing files only** | hides Cited Work Nodes for free, via `if (!l && …)` at `app.js:139612` |
| `numLinks` | correct |
| Search filter | see below |

### Should `fileFilter` apply to Cited Work Nodes? — No

Injecting them through `unresolvedLinks` types them `"unresolved"`
(`app.js:139618`, `d[I] = i$("unresolved")`), and the filter predicate lets any
non-`""`/`"tag"`/`"attachment"` type through unconditionally
(`app.js:139652`). That matches how Obsidian already treats unresolved links:
the search box narrows notes, not link targets. It is also the only consistent
choice, since (b) established that a file-less node can never be matched by a
`CP` matcher anyway.

Literature Notes are ordinary markdown nodes and keep the native filter and
colour-group behaviour unchanged. That is the desired asymmetry.

### Cost of seam 3

- Wraps `engine.render`, a method the runtime calls from ten sites (listed in
  (d)) — all of which then get the citation data, which is what we want.
- Depends on `render()` reading `this.app` once at the top. If a future build
  read `this.app.metadataCache` again mid-scan it would still work; if it
  captured `metadataCache` at construction time it would not.
- Depends on the six-method read surface of `metadataCache` staying a superset
  of what the facade forwards. Forward by `Proxy` with a `get` trap rather than
  by enumeration, so unknown reads pass through to the real cache.
- The facade must synthesise `resolvedLinks` entries as
  `Record<sourcePath, Record<targetPath, number>>` and `unresolvedLinks` the same
  shape, merged with the real ones — the scan only ever iterates keys
  (`app.js:139605`, `:139614`), so the count value is unread.

### Combining the seams

Seams 1 and 3 are complementary, not alternatives:

- **Seam 3** puts the *edges and nodes* into the graph so structure, narrowing,
  orphan logic and the native **Existing files only** row are all correct.
- **Seam 1** is still the place to stamp `node.color` on our nodes (b), because
  it runs after the engine's own colour pass and cannot be overwritten.

That is one wrapper on `engine.render` plus one on `renderer.setData`, per leaf.

---

## Coupling-risk ranking

Ordered by risk; "surface" names what breaks if Obsidian changes it.

| # | Technique | Surface touched | Scope | Risk | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Patch `metadataCache` app-wide (strategy D) | `app.metadataCache` | whole app | **Highest** | Rejected in the prior report; superseded by #6 |
| 2 | Replace `workspace.openLinkText` | public API, globally | whole app | **High** | folders2graph's approach (`GraphInteractions.ts:221`); use #10 instead |
| 3 | Patch the `GraphNode` / `GraphLink` prototype | shared across every leaf | all graph leaves | High | folders2graph guards with `__f2gPatched`; unnecessary once `node.color` is used |
| 4 | Reimplement `p$` and the orphan sweep | copied internal logic | one engine | High | Effort plus re-derivation of undocumented logic |
| 5 | Rewrite `renderer.colors` roles | renderer palette | one renderer | Medium-high | `testCSS()` on `css-change` discards it (`app.js:123050`) |
| 6 | Swap `engine.app` for one `render()` call (seam 3) | `engine.render`, `engine.app`, six `metadataCache` reads | one engine, one call frame | **Medium** | The only seam that reaches narrowing and orphan logic |
| 7 | Own PIXI objects on `px.stage` with own rAF | `px.stage`, `panX/panY/scale`, `nodeScale` | one renderer | Medium | Graph-Link-Types; needs its own coordinate maths and PIXI bundle |
| 8 | Proxy `renderer.renderCallback` | `renderCallback` | one renderer | Medium | Extended Graph; per-frame, idles with the graph |
| 9 | Proxy `link.line` `tint` setter | `link.line`, `clearGraphics`, `destroyed` | one link object | Medium-low | Extended Graph; must re-install after every rebuild |
| 10 | Wrap `renderer.onNodeClick` / `onNodeRightClick` / `onNodeHover` | four assignable callbacks | one renderer | **Low** | Assigned once in the engine constructor (`app.js:139385`), never reassigned |
| 11 | Wrap `renderer.setData` (seam 1) | one method on one instance | one renderer | **Low** | Three plugins do it; documented in the prior report |
| 12 | `node.color` / `node.type` in the data | `GraphData` shape | data only | **Low** | No patching; `getFillColor` reads it first (`app.js:122159`) |
| 13 | Register an `optionListeners` key on `filterOptions` | `engine.filterOptions.optionListeners` | one engine | Low | Buys persistence in both destinations (`app.js:139914`) |
| 14 | Build a `Setting` row into `.graph-controls` | class selector plus public `Setting` | one view's DOM | **Lowest** | Extended Graph's approach (`GCSection.ts:20`) |
| 15 | `engine.setOptions({ colorGroups })` | one documented option key | one engine | Lowest | Creates real, user-editable groups |
| 16 | `file-menu` listener on `"graph-context-menu"` | fully public API | app-wide, filtered | **None** | `app.js:139804` |
| 17 | `workspace.trigger("hover-link", …)` under ZotLit's source id | fully public API | per event | **None** | Already ZotLit's pattern (`shell.ts:77`) |

---

## Recommended set

The minimum that delivers distinct edge kinds with a toggle filter, distinct
node kinds by colour, highlight, and a hover popover. Facts above; this section
is judgement.

### Core — six techniques

| Goal | Technique | Rank |
| --- | --- | --- |
| Citation edges exist, and participate in narrowing, orphan logic and *Existing files only* | Wrap `engine.render`, swap `engine.app` for a `metadataCache` facade for that one call, inject into `resolvedLinks` (note→note) and `unresolvedLinks` (note→citekey) | #6 |
| Node colours | Wrap `renderer.setData`; stamp `color: {a, rgb}` on our nodes, skipping any node that already carries one | #11 + #12 |
| Citekey edges look different | Proxy the `line` sprite's `tint` setter, yielding to `lineHighlight` | #9 |
| Filter toggle | One `mod-toggle` `Setting` row in the Filters section, plus an `optionListeners` key for persistence | #14 + #13 |
| Highlight | Nothing. Real edges give the native hover behaviour (`app.js:122099`, `:122247`) | — |
| Hover popover | Wrap `renderer.onNodeHover` / `onNodeUnhover`; position an anchor div in `renderer.containerEl`; keep the `zotlit-citekey` source id | #10 + #17 |

### Mandatory, not optional

Wrap `renderer.onNodeClick` (#10). Without it, a click on a Cited Work Node
calls `openLinkText("@smith2020", "", …)`, which creates `@smith2020.md` in the
vault (`app.js:139745` → `app.js:79603`). This is data loss prevention, not
polish.

### Deliberately excluded

| Technique | Why not |
| --- | --- |
| Prototype patches (#3) | `node.color` in the data reaches the same result with no shared state |
| `OutlineFilter` + opacity-layer highlight-all | Two extra PIXI dependencies; a permanent distinct colour reads better |
| Own PIXI overlay (#7) | Only needed for dashed or curved lines; defer |
| `engine.setOptions({ colorGroups })` (#15) | The group row is user-editable and user-deletable, so it cannot carry an invariant. Worth offering as an explicit "add a colour group for my Literature Notes" command with the query `["zotero-key"]` or `path:<folder>`, never as automatic setup |
| Replacing `workspace.openLinkText` (#2) | App-wide blast radius for a per-leaf need |

### Lifecycle contract

Install on `onLayoutReady` and re-check on `layout-change` and
`active-leaf-change`. Per leaf of type `graph` or `localgraph`, guard on
`view.renderer` being mounted and on the graph core plugin being loaded. Mark
installed renderers in a `WeakSet` and store originals in a `WeakMap` keyed by
renderer, never on the plugin object. On unload, restore `engine.render`,
`renderer.setData` and the four `onNode*` callbacks, unregister every `line`
proxy, remove the Filters row and the `optionListeners` key, and call
`engine.render()` once per leaf to push clean data.

### Version caveat

Every observation is from Obsidian **1.13.4**. The medium-risk items — #6's
assumption that `render()` reads `this.app` once at the top, and #9's dependence
on the `line` sprite's lifecycle — are the two to re-verify on each Obsidian
minor. Guard both, log the failure path, and degrade to a notice rather than to
a broken graph.
