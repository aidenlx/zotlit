# Native Popover Machinery for Custom Hover Content

Whether Obsidian's own popover machinery can host the concise citation popover — a formatted bibliography entry plus three action buttons — on all four rendered-citation surfaces, and through which hook. Covers the `hover-link` contract and the Page Preview core plugin's Mod gate, the `HoverPopover` lifecycle for non-file content, the CSS and placement facts a custom layout has to plan against, and the per-surface integration each of the four surfaces needs.

Written for [#747](https://github.com/aidenlx/zotlit/issues/747), the native-machinery research ticket of the [Concise citation hover popover](https://github.com/aidenlx/zotlit/issues/746) map.

**Verdict: native machinery is feasible. The hook is `new HoverPopover(parent, targetEl, waitTime)` constructed directly, with `hoverEl` filled by ZotLit — not the `hover-link` event.** `hover-link` is a *request for a file preview*; it can only ever produce a Literature Note page preview, so it stays as-is for the Mod-key half of the gesture. The concise popover is a second, ZotLit-owned `HoverPopover` on the bare-hover half. §5 gives the verdict in full, §6 the residual risks. No blocker was found that opens the custom-tooltip door.

Primary sources:

- Obsidian's extracted runtime, `node_modules/.ob-rev-1.13.7/app.js`, `app.css`, `enhance.js`, `i18n.js` (a local extraction, not committed). All bare line numbers are into `app.js`; other files are named.
- The public type declarations, `packages/obsidian-api/obsidian.d.ts` at 1.13.1 (the submodule) — byte-identical in the cited ranges to the `obsidian` package `apps/obsidian` resolves. Cited `obsidian.d.ts:<line>`.
- This repo's own code, cited `path:line`.
- Community plugin source, read from GitHub and from the local checkout at `~/repo/zotlit-repo/obsidian-pandoc-reference-list`.

Prior work in this repo, cited rather than repeated:

- [Wikilink display decoration and Obsidian's own interaction](./wikilink-display-decoration-interaction.md) — the geometry rules that decide what wraps a plugin widget, and the four DOM gates around the editor link handlers.
- [Obsidian's clickable-token pipeline](./obsidian-clickable-token-pipeline.md) — §2 (the gates), §3 (`triggerClickableToken` dispatch).

## 0. Scope, versions, method

Analyzed runtime: **Obsidian 1.13.7**, extracted from the auto-updated per-user archive. The `obsidian` API package this workspace compiles against is **1.13.1**; the cited declaration ranges are identical between them. Substituting a patch release within `1.13.x` is the reuse rule the `obsidian-asar-extract` skill sets out.

Minified names drift between releases. Re-derive them; do not copy them forward.

| Minified | Role | Definition |
| --- | --- | --- |
| `U$` | `HoverPopover` | class `124156–124357`; export `14996` |
| `M$` | `PopoverState` | enum `124096–124101`; export `15023` |
| `mg` | `Component` | `40448`; export `14979` |
| `oJ` | Page Preview's `HoverPopover` subclass | `130684–130781` (`})(U$)`) |
| `N$` / `B$` | Module registries — pending (`Showing`) / shown popovers | `124102` / `124103` |
| `z$` / `q$` / `W$` / `j$` | Outside-click capture handler / mouse-position recorder / 500 ms poll / listener installer | `124106` / `124128` / `124131` / `124149` |
| `H$` | Last mouse position `{x, y, doc}` | `124105` |
| `Dv` | `isBoundaryCrossing(event, el)` — the re-entry guard | `38818` |
| `dm` | `positionElementNear(rect, el, opts)` — the flip engine | `39422–39479` |
| `jv` | Touch/pen-origin guard | `38894–38900` |
| `uy` | `Keymap` | export `15000` |
| `W1` | Embed loader (`.load({...})`) | `137422` |
| The Page Preview core plugin | id `page-preview`, `defaultOn = true` | `179176` / `179179` |

## 1. The `hover-link` contract

### 1.1 The payload

`hover-link` is a workspace event. Every emitter in the runtime builds the same object; the Page Preview plugin destructures exactly these fields (`179210–179218`):

```js
var t = this, n = e.event, i = e.source, r = e.hoverParent,
    o = e.targetEl, a = e.linktext, s = e.sourcePath,
    l = void 0 === s ? "" : s, c = e.state;
```

| Field | Type | Use |
| --- | --- | --- |
| `event` | `MouseEvent` | touch-origin guard, Mod-key read, mouse-position seed |
| `source` | `string` | the registry key that selects the Mod-key preference |
| `hoverParent` | `HoverParent` | the object whose `hoverPopover` the popover writes itself into |
| `targetEl` | `HTMLElement \| null` | the anchor element; `null` falls back to the cursor position |
| `linktext` | `string` | the link to resolve — an opaque string |
| `sourcePath` | `string` | resolution context; defaults to `""` |
| `state` | `EphemeralState \| undefined` | scroll/line position to open the preview at |

There is no field for custom content, and no return value or cancellation channel — `Events.trigger` is fire-and-forget. `hover-link` is **not** in the typed `Workspace.on` overloads; `obsidian.d.ts` mentions it only in the doc comment on `registerHoverLinkSource` (`obsidian.d.ts:4976`).

ZotLit already emits this shape (`apps/obsidian/src/services/citekey-navigation/shell.ts:57-62`), minus `state`.

### 1.2 The source registry and its settings row

`registerHoverLinkSource` is a two-line writer on `Workspace` (`150407–150409`):

```js
(t.prototype.registerHoverLinkSource = function (e, t) {
  ((this.hoverLinkSources[e] = t), this.trigger("hover-link-sources-changed"));
}),
```

The registry (`workspace.hoverLinkSources`, initialized `147382`) feeds one settings toggle per source, built declaratively (`179339–179362`):

```js
t.push({ name: i.display, control: { type: "toggle", key: n, defaultValue: i.defaultMod } });
```

They sit under the heading `"Require {{key}} to trigger page preview on hover"` (`i18n.js:1591`). The toggle **key is the source id**, and the saved value lives in the Page Preview plugin's own data, read via `t.loadData()` at enable (`179199`). So `defaultMod` is only a default — the user owns the live value, and ZotLit cannot read or write it through any public API.

The four sources the workspace registers for itself (`148591–148605`):

| Source id | Display | `defaultMod` |
| --- | --- | --- |
| `search` | Search, Backlinks, and Outgoing links | `true` |
| `preview` | Reading view | **`false`** |
| `editor` | Editing view | `true` |
| `tab-header` | Tab header | `true` |

Six more core plugins register their own, all `defaultMod: true`: `graph` (`139212`), `bases` (`164050`), `bookmarks` (`165720`), `file-explorer` (`175389`), `outline` (`178668`), `properties` (`179459`). `preview` is the **only** source in the whole runtime that previews on bare hover.

**Reading-mode internal links preview on bare hover by default.** That is the single most consequential fact for the wikilink surfaces (§4.2).

ZotLit registers one source, `zotlit-citekey`, with `defaultMod: false` (`apps/obsidian/src/services/citekey-editor/service.ts:118-121`).

### 1.3 The Mod gate, and why it does not partition the gesture

`onHoverLink` (`179210–179271`) resolves the requirement in this order (`179224–179229`):

```js
(Object.hasOwn(this.options, i)
  ? (h = this.options[i])
  : this.app.workspace.hoverLinkSources.hasOwnProperty(i) &&
    (h = this.app.workspace.hoverLinkSources[i].defaultMod),
```

`h` starts `true`, so an **unregistered source requires Mod**. Saved user setting wins; `defaultMod` is the fallback.

The decisive behavior is what happens when Mod is required but not held. It does **not** bail. It installs a deferred-Mod watch on the document (`179231–179269`): a `keydown` listener that fires the preview if Mod is pressed, cancelled by a 2 s `debounce` on `mousemove`, by moving off the target, by a plain keystroke, by `mouseleave`, or by a click.

```js
h && !uy.isModifier(n, "Mod")
```

...opens that branch; the unconditional `this.onLinkHover(...)` at `179270` is the immediate path.

So the Mod gate is evaluated at trigger time, but **re-checked for 2 seconds afterwards**. Hover-then-press-Mod works. This is good news for the split gesture and bad news for anyone hoping the gate alone separates the two popovers: the gate decides *when* the native preview appears, never *whether some other content* appears instead. Nothing about `hover-link` can yield non-file content.

Two further guards run before it (`179220–179222`):

- `jv(n)` (`38894–38900`) rejects non-mouse pointer types and events within 400 ms of a touch — a desktop-only feature is unaffected.
- `event.relatedTarget` must be absent, a non-`HTMLElement`, or shown — the same re-entry guard ZotLit already mirrors (`citekey-navigation/citation.ts:125-126`).

And `onLinkHover` dedupes against the parent (`179286`):

```js
return (o = e.hoverPopover) && o.state !== M$.Hidden && t && o.targetEl === t ? [2] : ...
```

A parent already showing a popover **for the same target** is left alone.

### 1.4 What Page Preview does with it, and what a disabled plugin changes

The listener is registered in `onEnable` through the plugin's own component (`179193`):

```js
t.registerEvent(e.workspace.on("hover-link", this.onHoverLink, this)),
```

`registerEvent` means disabling the plugin detaches it. **Nothing else in the runtime listens to `hover-link`** — it is the only `on("hover-link", ...)` in `app.js`. With Page Preview disabled, every `hover-link` trigger is inert.

What survives disabling:

- `registerHoverLinkSource` still writes to `workspace.hoverLinkSources` (`150407`) — it is a `Workspace` method, unrelated to the plugin. The settings row simply has no tab to appear in.
- `HoverPopover` is app core, not plugin code: the class is defined at `124156` and exported at `14996`, far from the plugin block at `179176`. `new HoverPopover(...)` works regardless.

Page Preview is `defaultOn = true` (`179179`), but the concise popover must not depend on it. Because ZotLit constructs its own popover, it does not.

## 2. `HoverPopover` for non-file content

### 2.1 The class is content-agnostic

The constructor (`124157–124185`) creates an **empty, detached** div:

```js
var a = (o.hoverEl = createDiv("popover hover-popover")),
```

That is the only `hover-popover` string in `app.js`. Nothing in the base class ever writes into it. The file preview is a **populate step in a subclass**, `oJ.create` (`130712–130722`):

```js
(u = new t(i, r, o, a)), [4, sleep(Math.max(0, u.waitTime - 100))]
...
(h = u.hoverEl.createDiv()),
(p = u.embed = W1.load({ app: n, linktext: s, sourcePath: l, containerEl: h, state: c, depth: 0 }))
```

then `u.watchResize(h)`, `u.addChild(p)`, and after the content lands, `u.state === M$.Shown && u.position()` (`130777`, `130774`).

Obsidian Publish does the same against the **base class directly** (`124400–124412`) — construct, `hoverEl.createDiv()`, fill, re-`position()`. That is the exact shape ZotLit needs, written by Obsidian itself.

The public surface is small but sufficient (`obsidian.d.ts:3476-3491`): a public constructor, `hoverEl`, `state`, and `Component` inheritance.

### 2.2 Lifecycle

`PopoverState` (`124096–124101`): `Showing=0, Shown=1, Hiding=2, Hidden=3`. In `obsidian.d.ts:5193` the enum is **declared with no members**, so `PopoverState.Hidden` needs a module augmentation.

The constructor arms `timer = setTimeout(show, waitTime)` (default 300, `124158`/`124180`). `show()` (`124244–124265`) aborts to `hide()` if the target left the DOM, then positions, calls `onShow()`, `this.load()`, and fades in over 80 ms.

`onShow` / `onHide` are the whole `HoverParent` contract (`124287–124294`):

```js
onShow() { var e = this.parent; (e.hoverPopover && e.hoverPopover.hide(), (e.hoverPopover = this), Qg()); }
onHide() { var e = this.parent; e.hoverPopover === this && (e.hoverPopover = null); }
```

Assigning a new popover to a parent **hides the parent's previous one**. A `HoverParent` holds exactly one popover at a time.

That looks like free mutual exclusion between the concise popover and the native page preview, but it is not — the dedupe in §1.3 runs first and wins. See §2.7.

`hide()` (`124266–124286`) detaches `hoverEl`, removes the target listeners, cascades to nested popovers, then calls `unload()`. Since `show()` calls `load()`, `Component.register` is the React teardown hook:

```ts
popover.register(() => root.unmount());
```

`hoverEl` contents are **not** emptied by `detach()` — only `unload()` callbacks clean up.

### 2.3 Placement, and how to read it

`position()` (`124295–124333`) appends to the body of the target's window and delegates the layout to `dm`:

```js
(n.parentElement !== s.body && s.body.appendChild(n),
 dm(e, n, { gap: 10, preventOverlap: !0, horizontalAlignment: l ? "right" : "left" }));
```

`dm` (`39442–39455`) prefers below, falls back to above, and clamps `maxHeight` when neither fits. It records the outcome only as inline style (`39475–39476`):

```js
((t.style.top = null !== T ? "".concat(T, "px") : ""),
 (t.style.bottom = null !== D ? "".concat(D, "px") : ""));
```

**No `is-above` / `mod-top` class or attribute is set.** The readable signal is:

- `hoverEl.style.bottom !== ""` → placed **above** the target → the button row belongs at the popover's **bottom** edge.
- `hoverEl.style.top !== ""` → placed **below** → button row at the **top** edge.

That satisfies the map's cursor-proximal button row, but only if ZotLit reads the style after `position()` and flips a class of its own. The clean seam is a `position()` override in a `HoverPopover` subclass that calls `super.position()` and then stamps the class — `position()` is real (`124295`) but undeclared, so this needs augmentation.

One trap: a target taller than 300 px latches to the cursor instead of the target rect and memoizes it into `this.staticPos` (`124303–124306`). Inline citation anchors never reach that branch; a multi-line wrapped citation run could, on a small font size, exceed it only in pathological cases.

**Scroll is not tracked.** There is no scroll listener in the module. The popover is `position: absolute` on `body` and does not follow the target. What closes it is the 500 ms poll (`124131–124147`): `elementFromPoint(lastMousePos)` → `detect()` → `transition()`. Once the scrolled target is no longer under the cursor, the hide begins. The parity reference closes on scroll explicitly instead (§3); the native behavior is a delayed close, which is acceptable but visibly different.

For async content, `watchResize(el)` (`124334–124351`) re-runs `position()` on resize while `Shown`, and **self-disconnects after 10 callbacks**. That is what makes a React root that renders after the popover opens land in the right place.

### 2.4 Interactivity: buttons and clicks survive

Three mechanisms keep the popover alive, all in `shouldShowSelf` (`124203–124208`):

```js
return this.onTarget || this.onHover || this.isFocused || e.contains(e.doc.activeElement);
```

- **`onHover`** — set by `mouseover`/`mouseout` listeners the constructor puts on `hoverEl` (`124174–124179`). Moving the pointer from the citation onto the popover keeps it open; this is the hover bridge, free.
- **`e.contains(activeElement)`** — focus anywhere inside `hoverEl` keeps it open indefinitely.
- **`isFocused`** — set only by `setIsFocused(true)` (`124224–124226`). This is core's pinning primitive; there is no `isPinned` field on this class in 1.13.7. Page Preview sets it when entering edit mode (`130725`) and Bases for its new-item popover (`127755`).

Clicks inside do not dismiss. The global capture handler `z$` (`124106–124127`) exempts them:

```js
(s = a[o]).isFocused || s.hoverEl.contains(i) ||
  s.childHovers.some(function (e) { return e.hoverEl.contains(i); }) || r.push(s);
```

...and defers the actual hides by 5 ms (`124119–124126`), so ZotLit's own click handlers run first. The three action buttons work with no extra machinery.

**There is no Escape handler and no window `blur` handler** in the module. Dismissal is purely pointer-driven plus outside-click. A popover that should close on Escape needs a `Scope` pushed onto `app.keymap`, which is what Page Preview does for its edit mode (`130726–130728`).

### 2.5 Nesting works by DOM containment

`childHovers` (`124209–124218`) treats any shown popover whose `targetEl` lives inside this `hoverEl` as a child. `shouldShowChild` keeps the outer alive while the inner is; `z$` extends outside-click immunity to children; `hide()` cascades to them (`124281–124284`). Popover-in-popover needs no explicit wiring — a link inside the concise popover that triggers `hover-link` produces a nested page preview, and both stay open.

### 2.6 CSS the content must plan against

From `app.css`:

```css
.popover { display: flex; position: absolute; z-index: var(--layer-popover);
           max-height: var(--popover-max-height); }              /* 9314–9325, 95vh at 2589 */
.popover.hover-popover { overflow: hidden; max-width: 80vw;
                         min-height: 30px; width: fit-content; } /* 9326–9334 */
.popover.hover-popover > * { width: var(--popover-width); }      /* 9339–9341, 450px at 2587 */
```

Three consequences for the concise popover:

1. **Every direct child is forced to 450 px.** A React root mounted as a direct child of `hoverEl` inherits that width. Either accept it as the popover width, or override `width` on the host element.
2. **`overflow: hidden` on the popover itself.** The map wants stacked multi-item entries **unclipped**. Since `dm` clamps `maxHeight` when the popover fits neither above nor below (`39477`), a tall stack in a cramped viewport gets clipped, not scrolled. ZotLit's own content container must carry `overflow-y: auto` so the clamp produces a scroll region rather than lost text.
3. `.is-editing` (`9335–9338`) is Page Preview's own class, not a base behavior — free to ignore.

The plugin's React roots already follow `container.addClass("zt-root")` + `createRoot(container)` (e.g. `apps/obsidian/src/views/cited-by/view.tsx:46,91`), and `.zt-root` carries the scoped Tailwind preflight (`apps/obsidian/src/zt-main.css:134-138`). A `hoverEl.createDiv()` host marked `zt-root` fits that convention unchanged.

### 2.7 The dedupe trap: the two popovers must not share a parent *and* a target

The one genuine trap in the whole design. `onLinkHover` bails **before** constructing anything (`179286`):

```js
return (o = e.hoverPopover) && o.state !== M$.Hidden && t && o.targetEl === t ? [2] : [4, oJ.create({...})]
```

So if ZotLit's concise popover is assigned to the same `hoverParent` **and** carries the same `targetEl`, and is not `Hidden`, then a subsequent Mod press is a **silent no-op** — `oJ.create` never runs and the page preview never appears. The parent-swap in §2.2 cannot save it, because nothing gets far enough to call `onShow`.

The deferred-Mod watch of §1.3 makes this the *normal* sequence, not an edge case: bare hover opens the concise popover, the user then presses Mod, and the native preview is suppressed by its own dedupe.

Two ways out, both cheap:

- **Distinct parent.** Trigger `hover-link` with a dedicated `HoverParent` — a plain `{ hoverPopover: null }` object is enough (`Obsidian-Bases-Canvas` ships exactly that, §3). The dedupe reads a different parent and passes. The concise popover then has to be hidden by ZotLit, since the two no longer displace each other.
- **Hide first.** Call `concisePopover.hide()` immediately before triggering `hover-link` on the Mod branch. `hide()` sets `state = Hidden` synchronously (`124271`), so the dedupe passes on the same parent.

The second is simpler and keeps one parent per surface. Either way, **this is an explicit step the spec must call out** — it does not fall out of the machinery for free.

## 3. How other plugins do it

**The parity reference, Pandoc Reference List, hand-rolls everything and touches none of this.** `~/repo/zotlit-repo/obsidian-pandoc-reference-list/src/tooltip.ts` (239 lines) creates `el.doc.body.createDiv({cls: 'pwc-tooltip'})` (line 67), positions it by hand in a `setTimeout` with manual viewport flips (lines 106–118), reimplements the hover bridge with two debounce timers and an `isHoveringTooltip` flag (lines 89–94, 151–185), and closes on a capture-phase `scroll` listener (line 126). A repo-wide search finds no `hover-link`, `HoverPopover`, or `registerHoverLinkSource`. Its content is the citeproc `.csl-entry` HTML, with a `.pwc-entry-btns` row of `clickable-icon` actions injected per entry — and multi-key citations are **clipped to 100 characters** via `text-clipper` (line 58). ZotLit's map deliberately departs there by stacking full entries unclipped.

Wiring is per-surface, the same split ZotLit faces: `EditorView.domEventHandlers(...)` for Live Preview (`src/editorExtension.ts:69-71`) and per-element `pointerover` binding in the post-processor for reading mode (`src/markdownPostprocessor.ts:100`).

Everything that file does by hand, §2 shows `HoverPopover` already doing.

**Hover Editor is a cautionary tale, not a template.** It "extends" `HoverPopover` through a `nosuper()` shim that skips the native constructor entirely (`src/popover.ts:51-61`), reimplements every method, and monkey-patches the Page Preview instance prototype to hijack `onLinkHover` outright, then disable/enable-cycles the plugin to rebind handlers (`src/main.ts:417-469`). It bails when Page Preview is disabled. It carries ~15 `monkey-around` patches and ~189 lines of `declare module "obsidian"`. It exposes **no hook** for other plugins to put DOM in a popover. Its existence tells us the popover's *construction* is stable public API while its *behavior* is undeclared internals — which matches §2.

**Four plugins do exactly what this ticket proposes**, confirming the native route for non-file content:

- `RyotaUshio/obsidian-pdf-plus` (`src/bib.ts:86-101`) — `new HoverPopover(hoverParent, targetEl, 200)`, `hoverEl.addClass(...)`, `hoverEl.createDiv()`, then `addChild(new BibliographyDom(...))`. A **BibTeX citation card with no vault file** — the closest analogue to this feature that exists.
- `levirs565/obsidian-dendron-tree` (`src/custom-resolver/link-hover.ts`) — the lifecycle-correct recipe: dedupe against `parent.hoverPopover`, re-check `state` after async content, re-`position()` once it lands.
- `Quorafind/Obsidian-Bases-Canvas` — a **synthetic parent**, `{ hoverPopover: null }`, with no view behind it.
- `PKM-er/Obsidian-Surfing` — an Electron `<webview>` inside `hoverEl`, plus the `targetEl: null` + static-position path.

## 4. Integration per surface

The four surfaces split cleanly in two, by who emits the hover.

### 4.1 The citekey surfaces — ZotLit already owns the gesture

`citekey-editor` and `citekey-reading` both route through `attachCitationNavigation` / the extension's own `mouseover` handling, and call `triggerCitekeyHover` themselves (`citekey-navigation/citation.ts:159-165`, `citekey-editor/extension.ts:268-274`). The re-entry guard, the single-work resolution, and the `hoverParent` lookup are already in place. Nothing needs interception here: the bare-hover branch that today calls `triggerCitekeyHover` gains a sibling that constructs the concise popover instead.

Live Preview citations are `Decoration.replace` widgets whose `ignoreEvent()` returns `true` and which own every gesture on their own element (`citekey-editor/extension.ts:519-522`), so the widget element is a valid `targetEl` with a stable lifetime for the hover.

`hoverParent` is already resolved per surface — the `editorInfoField` value in the editor, the containing `MarkdownView` in reading mode (`citekey-reading/service.ts:192-197`, `#viewOf` at 211). Both satisfy `HoverParent`, and both can host the concise popover — subject to the dedupe rule in §2.7.

### 4.2 The wikilink surfaces — Obsidian owns the gesture, and it must be intercepted

`wikilink-editor` and `wikilink-reading` deliberately keep Obsidian's own link element so that "click, hover, drag, and conceal interaction stay Obsidian's" (`wikilink-editor/service.ts:40`, `wikilink-reading/render.ts:85`, and the glossary at `apps/obsidian/CONTEXT.md:214,218`). Reading mode keeps the native `<a class="internal-link">` with its `href`/`data-href` and appends ZotLit's hooks (`wikilink-reading/render.ts:109-110`). That promise is exactly what the map says the spec rewrites — and the mechanism is the crux of this ticket.

Both of Obsidian's emitters are **delegated bubble-phase listeners on a container**:

Reading mode (`103436–103439`), inside `registerDomEvents`:

```js
t.on("mouseover", "a.internal-link", function (e, t) {
  var i = o(t);
  i && n.onInternalLinkMouseover(e, t, i.href, i.displayText);
}),
```

...which triggers with `source: "preview"` and `hoverParent: this.info` (`104132–104141`).

Editor (`132186–132190`), on the CM6 content element:

```js
o.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref",
     r.onEditorLinkMouseover.bind(r)),
```

...which triggers with `source: "editor"` and `hoverParent: this.owner` (`132814–132828`).

`HTMLElement.prototype.on(type, selector, listener, options)` is Obsidian's delegation helper (`enhance.js:427-441`, installed at `enhance.js:457`). It ends in `this.addEventListener(type, wrapper, options)` — and both call sites pass **no options**, so both are plain bubble-phase listeners on the container.

**Therefore a `mouseover` listener on the citation element itself that calls `event.stopPropagation()` prevents Obsidian's handler from ever running.** The event never reaches the container. This is standard DOM behavior, needs no monkey-patching, and is the only interception the wikilink surfaces require. ZotLit already attaches per-element listeners on the rendered citation (`citekey-navigation/citation.ts:57-59`), so the seam exists.

Two caveats:

- Reading mode's `preview` source has `defaultMod: false` (`148595–148597`). Without the interception, bare hover over a Literature Note wikilink shows the native page preview **today**. Suppression is mandatory there, not optional.
- The editor's `editor` source has `defaultMod: true`, so bare hover currently shows nothing — but the deferred-Mod watch (§1.3) means an un-suppressed emission still arms a 2 s window. Suppressing the emission avoids reasoning about that interaction at all.

Suppressing Obsidian's emission means ZotLit must re-supply the Mod-key half itself, by triggering `hover-link` under its own source id when Mod is held. That is the same `triggerCitekeyHover` call the citekey surfaces already make, so the four surfaces converge on one code path — which is what the existing single-source-id design was built for (`citekey-navigation/intent.ts:5-10`).

## 5. Verdict

**Native machinery is feasible. The hook is direct `HoverPopover` construction.**

The recommended shape, all of it grounded above:

1. **Bare hover → ZotLit's own popover.** On the surface's existing `mouseover` handler, `new HoverPopover(hoverParent, targetEl, waitTime)`, `hoverEl.createDiv()` marked `zt-root`, mount the shared React renderer into it, `popover.register(() => root.unmount())`, `popover.watchResize(host)`, and `popover.position()` once content lands. §2.1, §2.2, §2.3.
2. **Mod hover → the native page preview, unchanged.** Keep triggering `hover-link` under `zotlit-citekey` when Mod is held — but **hide the concise popover first**, or the native preview's own dedupe suppresses it silently. §2.7.
3. **The wikilink surfaces additionally `stopPropagation()`** on their own `mouseover` to suppress Obsidian's delegated emission, and re-emit under `zotlit-citekey` for the Mod half. §4.2.
4. **The button row reads placement from `hoverEl.style.bottom`** after `position()` and flips a class. §2.3.
5. **The content container carries `overflow-y: auto`** so a clamped `maxHeight` scrolls rather than clips. §2.6.

Page Preview being disabled degrades this correctly: the concise popover still works (it never touches the plugin), and only the Mod-key page preview goes silent — the same thing that happens to Obsidian's own links. §1.4.

Nothing here requires monkey-patching. The undeclared surface ZotLit relies on is small and needs one `declare module "obsidian"` augmentation: `PopoverState`'s members, and `position()`, `hide()`, `targetEl`, `setIsFocused()`, `watchResize()` on `HoverPopover`. All are real (`124188–124351`) and all are relied on by multiple shipping community plugins (§3).

## 6. Residual risks

- **The dedupe trap.** §2.7. The only finding that changes the shape of the implementation rather than just its details: the concise popover must be hidden before the Mod-key `hover-link` fires, or the native preview is silently suppressed. Cheap to handle, easy to miss.
- **No Escape or blur dismissal.** §2.4. If the spec wants Escape to close the popover, it must push a `Scope` — Page Preview's own edit mode is the pattern (`130726–130728`).
- **Scroll closes late, not immediately.** §2.3. The popover does not follow the target; the 500 ms poll notices the pointer is no longer over it. The parity reference closes on scroll instantly. If the difference matters, ZotLit can add its own capture-phase scroll listener, as Pandoc Reference List does.
- **The Mod-key preference is user-owned and unreadable.** §1.2. A user who turns the `zotlit-citekey` toggle off makes the page preview race the concise popover on bare hover. The effective value lives in `.obsidian/page-preview.json` and on the plugin instance's `options` (`179226`) — both internal, neither exposed. The deterministic fix is for ZotLit to test `Keymap.isModifier(event, "Mod")` itself and only trigger `hover-link` on the Mod branch, which the surfaces already compute (`citekey-navigation/shell.ts:31`). That trades away the free hover-then-Mod window of §1.3. The spec should choose deliberately.
- **Undeclared API drift.** §5. The augmentation pins ZotLit to internals that carry no compatibility promise. The exposure is small and widely shared, but it is real, and the minified names in §0 must be re-derived against any future runtime.
- **The 300 px target-height cursor latch.** §2.3. Not reachable by inline citations in practice, but it silently changes the anchor if it ever is.
- **`.popover.hover-popover > *` forces 450 px.** §2.6. The concise popover's width is Obsidian's decision unless ZotLit overrides it — a design question the prototype ticket should settle, not an obstacle.
