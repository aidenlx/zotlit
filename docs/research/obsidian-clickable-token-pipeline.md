# Obsidian's Clickable-Token Pipeline

What `Editor.getClickableTokenAt` and `MarkdownEditView.triggerClickableToken` are wired into, and therefore what ZotLit's `citekey-click` monkey patch inherits for free today. Covers the ten runtime consumers of the token lookup, the two distinct DOM gates that surround it (a class gate *before* the hover call, a different class gate *after* the click call), the dispatch table `triggerClickableToken` implements, and what a synthetic `internal-link` token does and does not buy.

Primary source is Obsidian's extracted runtime, `node_modules/.ob-rev-1.13.4/app.js` (and `app.css`, `enhance.js` from the same extraction). Line numbers are into that file. The `.d.ts` cross-reference is `packages/obsidian-api/obsidian.d.ts` (API 1.13.1). Everything below is source-verified unless a claim is explicitly marked **Inference** or **Unverified**.

Prior work in this repo, not repeated here:

- [Pandoc citation syntax in CodeMirror 6 Live Preview](./pandoc-citekey-cm6-live-preview.md) — the decoration side: how `[@key]` tokenizes, which token classes gate a decorator, how to build over `visibleRanges`. Its §6.5 sketched the click gate; this document supersedes and corrects that sketch.
- [`apps/docs/content/docs/concepts/how-citekey-links-work.mdx`](../../apps/docs/content/docs/concepts/how-citekey-links-work.mdx) — the shipped user-facing behavior. Two of its claims are corrected in §4.4.

## 0. Scope, versions, class map

Analyzed runtime: **Obsidian 1.13.4** (`node_modules/.ob-rev-1.13.4/package.json`, `"version": "1.13.4"`). This matches the plugin's `minAppVersion` floor. The installed desktop app is 1.13.3 and the compiled-against `obsidian` API package is 1.13.1; the 1.13.4 extraction was reused (patch substitution within the same minor).

Minified names drift between releases. Re-derive them, do not copy them forward.

| Minified | Role | Definition | Public name |
| --- | --- | --- | --- |
| `vO` | Public `Editor` base class | export table `app.js:14986` | `Editor` |
| `OJ` | Concrete CM6 editor; owns `getClickableTokenAt` | `131045`, closes `})(vO)` at `132018` | — (instance is `Editor`) |
| `RJ` | Base markdown edit view; owns `triggerClickableToken`, all DOM handlers | `132020` | ~ `MarkdownEditView` |
| `NJ` | Intermediate edit view (`})(RJ)` at `133517`) | `133298` | — |
| `Z3` | Edit view used by `MarkdownView.editMode` (`})(NJ)` at `157840`) | `157605` | — |
| `$J` | Edit view used by embedded/hover editors (`})(NJ)` at `134331`) | `134222` | — |
| `e5` | `MarkdownView` | `157842`, export table `15008` | `MarkdownView` |
| `VW` | Rendered-anchor link handler (the *other* link pipeline) | `103916` | — |
| `CW` | Markdown renderer registry; `registerDomEvents` | `103263` | — |
| `sy` | `Keymap` | `isModifier` `55040`, `isModEvent` `55059` | `Keymap` |
| `c3` | `Decoration.mark({class:"cm-underline", …})` | `154150` | — |

Consequence for the patch site: `Object.getPrototypeOf(view.editMode)` is **`Z3.prototype`**, not `RJ.prototype`. `monkey-around` reads the inherited `triggerClickableToken` through the chain and writes an *own* property onto `Z3.prototype`. Embedded editors built on `$J` (`134502`: `this.editMode = this.addChild(new $J(this))`, inside `JJ` at `134412`) keep the unpatched `RJ.prototype` implementation. `getClickableTokenAt`, by contrast, is patched on `OJ.prototype`, which every edit view shares (`RJ` constructor: `r.editor = new OJ(r)`). The patch is therefore **asymmetric**: token *production* is global, token *interception* is markdown-view-only. See §4.3.

## 1. Consumer inventory of `Editor.getClickableTokenAt`

`getClickableTokenAt` is defined at `app.js:131744` on `OJ.prototype`. There are exactly **ten** call sites in the whole runtime (`rg -c` over every bundled `.js`: only `app.js` matches).

| # | Line | Caller | Feature it powers |
| --- | --- | --- | --- |
| 1 | `132556` | `RJ.prototype.updateLinkPopup` (`132547`) | Mobile "Follow link" popover, Source mode only |
| 2 | `132651` | `RJ.prototype.onEditorClick` (`132613`) | Mouse click, middle-click, mobile tap |
| 3 | `132687` | `RJ.prototype.onEditorLinkMouseover` (`132685`) | Hover page preview (`hover-link` event) |
| 4 | `132706` | `RJ.prototype.onEditorDragStart` (`132700`) | Drag a link out of the editor |
| 5 | `132859` | `RJ.prototype.onContextMenu` (`132719`) | Right-click / long-press editor menu |
| 6 | `147824` | workspace `editor-menu` subscriber (registered `147820`) | "Rename block ID" menu item (`blockid` tokens only) |
| 7 | `147874` | command `editor:follow-link` (`147866`) | Alt+Enter — follow link under cursor |
| 8 | `147901` | command `editor:open-link-in-new-leaf` (`147892`) | Mod+Enter — open in new tab |
| 9 | `147928` | command `editor:open-link-in-new-window` (`147919`) | Mod+Alt+Shift+Enter — open in new window |
| 10 | `147968` | command `editor:open-link-in-new-split` (`147959`) | Mod+Alt+Enter — open to the right |

The DOM listeners that feed consumers 2–5 are all registered in the `RJ` constructor on `editorEl` (the `.markdown-source-view.mod-cm6` div), `app.js:132040–132057`:

```js
o.addEventListener("click", r.onEditorClick.bind(r)),
o.addEventListener("mousedown", r.onEditorClick.bind(r), { capture: !0 }),
td.isIosApp && (Hv(o, r.onEditorClick.bind(r)), cg(o, 3, …)),
o.addEventListener("contextmenu", r.onContextMenu.bind(r)),
o.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref", r.onEditorLinkMouseover.bind(r)),
o.addEventListener("dragstart", r.onEditorDragStart.bind(r)),
```

### 1.1 Click (consumer 2)

`onEditorClick` is bound to **both** `click` (bubble) and `mousedown` (capture). The type filter at `132615–132622` keeps them disjoint:

- Desktop: `click` with `button === 0`, or `mousedown` with `button === 1` (middle-click must fire on mousedown so the browser's autoscroll never starts).
- Android: `mousedown` of any button (`td.isAndroidApp && "mousedown" === e.type`).
- iOS: a trusted `click`, or the *synthetic* untrusted `click` that `Hv` (`38827`) manufactures from a touch sequence — that path passes `e.target` as the second argument `t`, which is why the filter reads `"click" === e.type && !e.isTrusted && !!t`. `Hv` requires the touch to end within 600 ms and to move less than 5 px.

Modifier → `newLeaf` mapping comes from `Keymap.isModEvent` (`55059`):

| Gesture | `isModEvent` result | Effect |
| --- | --- | --- |
| Middle-click (`button === 1`) | `"tab"` | new tab |
| Mod | `"tab"` | new tab |
| Mod+Alt | `"split"` | split right |
| Mod+Alt+Shift | `"window"` | new popout window |
| plain left click | `false` | reuse current tab |

Two mode-dependent twists:

- **Source mode requires a modifier to follow anything.** `132625`: `(!this.sourceMode || i)` where `i = isModifier(e,"Mod") || button === 1`. A plain left-click in Source mode never reaches `getClickableTokenAt`.
- **Source-mode Mod-click is downgraded to "same tab".** `132672–132676`: `this.sourceMode && "tab" === c && 1 !== e.button && !isModifier(e,"Shift") && (c = !1)`. So Mod-click in Source mode opens in place; middle-click and Mod+Shift-click still open a tab.
- In Live Preview, Alt-click and Shift-click without Mod are dropped entirely (`132626`: `… || (!e.altKey && !e.shiftKey)`).

On success: `this.triggerClickableToken(l, c)` then `e.preventDefault()` (`132677–132678`).

### 1.2 Hover page preview (consumer 3)

```js
// app.js:132685
(t.prototype.onEditorLinkMouseover = function (e, t) {
  if (Sv(e, t)) {
    var n = this.editor.getClickableTokenAt(this.editor.posAtMouse(e)),
      i = "footref" === (null == n ? void 0 : n.type);
    ("internal-link" === (null == n ? void 0 : n.type) || i) &&
      this.app.workspace.trigger("hover-link", {
        event: e, source: "editor", hoverParent: this.owner, targetEl: t,
        linktext: i ? "#[^".concat(n.text, "]") : n.text, sourcePath: this.path,
      });
  }
}),
```

- Only `internal-link` and `footref` tokens fire the event. `external-link`, `tag`, `blockid` do not.
- `Sv` (`38803`) is a re-entry guard: `relatedTarget` must be outside the matched element.
- `hoverParent` is `this.owner` — the `MarkdownView` (or whatever owns the edit view), which is the `HoverParent` the popover attaches its `hoverPopover` to.
- `sourcePath` is `RJ.prototype.path` (`132098`): `this.owner.file?.path || ""`.
- `source` is the string `"editor"`.

Consumer of the event is the **page-preview core plugin**, `app.js:179134` (`workspace.on("hover-link", this.onHoverLink, this)`), handler at `179151`:

- `zv(n)` (`38879`) suppresses preview for touch-derived mouse events.
- Mod-gating: `Object.hasOwn(this.options, source) ? this.options[source] : workspace.hoverLinkSources[source]?.defaultMod`, default `true` (`179166–179171`). `"editor"` is never registered in `hoverLinkSources` (that registry is populated only by `registerHoverLinkSource`, `150357`), and the plugin's settings tab enumerates only that registry (`179281`). **Inference:** so `Object.hasOwn(options, "editor")` is normally false and the editor's hover preview fires *without* Mod, matching observed behavior.
- `onLinkHover` (`179219`) builds a `HoverPopover` via `tJ.create` (`130556`), which loads an embed with `V1.load({ linktext, sourcePath, … })` (`137295`).

### 1.3 Drag (consumer 4)

```js
// app.js:132700
(t.prototype.onEditorDragStart = function (e) {
  var t = e.targetNode;
  if (t.instanceOf(HTMLElement) && t.draggable) {
    …
    var i = this.editor.getClickableTokenAt(this.editor.posAtMouse(e));
    if (!i) return;
    if ("internal-link" === i.type)
      this.app.dragManager.onDragStart(e,
        this.app.dragManager.dragLink(e, i.text, this.path, i.displayText));
```

**The `draggable` attribute on the DOM element is a hard precondition.** The only thing that sets it inside the editor content is Obsidian's own `cm-underline` mark, whose spec is `{ class: "cm-underline", attributes: { tabIndex: "-1", draggable: "true" } }` (`154150`). No `cm-underline`, no drag.

`dragManager.dragLink(evt, linktext, sourcePath, displayText)` (`88139`) resolves the link with `getFirstLinkpathDest`, writes an `obsidian://` URL into `dataTransfer` when it resolves (otherwise the raw linktext), and returns a drag payload `{ type: "link", icon: "lucide-link", title: displayText || file.getShortName(), linktext, sourcePath, file }`.

### 1.4 Context menu (consumer 5)

`onContextMenu` (`132719`) builds the editor menu. At `132859` it calls `getClickableTokenAt(posAtMouse)`, but first nulls the token when the right-click landed directly on a `.cm-line` element (`132860–132864`) — i.e. on plain text rather than a token span. Then, per token type:

- `internal-link` **or** `external-link` → adds an "Edit link" item that selects `token.start .. token.end` in the document (`132868–132877`). The token range is used verbatim, so a synthetic token with a wrong range mis-selects.
- `internal-link` → `app.workspace.handleLinkContextMenu(menu, token.text, this.path)` (`132879`). That method (`150252`) resolves `getFirstLinkpathDest(gD(linktext).path, sourcePath)` and then adds "Open in new tab" / "Open to the right" / "Rename…" and fires the `file-menu` workspace event with source `"link-context-menu"`. **When the link does not resolve it instead adds a "Create file" item** (`150304–150313`).
- `external-link` / `external-ref-link` → `handleExternalLinkContextMenu` (`150318`).
- `tag` → "Edit tag".
- `footref` → footnote-specific items.

After the token block the view fires `workspace.trigger("editor-menu", menu, editor, this.owner)` at `133223`, then `menu.showAtMouseEvent(e)` at `133224`.

### 1.5 "Rename block ID" (consumer 6)

A workspace-level `editor-menu` subscriber (`147820`) calls `getClickableTokenAt(editor.getCursor())` and adds a rename item only for `type === "blockid"`. Irrelevant to citekeys, listed for completeness.

### 1.6 The four commands (consumers 7–10)

All four share the shape

```js
var t = i.activeEditor;           // Workspace.activeEditor, getter at 149106
if (t && t.editor) {
  var n = t.editor, r = t.editMode,
      o = n.getClickableTokenAt(n.getCursor());
  if (o) return (e || r.triggerClickableToken(o, <newLeaf>), !0);
}
```

with `<newLeaf>` being `false` / `"tab"` / `"window"` / `"split"`, and default hotkeys `Alt+Enter`, `Mod+Enter`, `Mod+Alt+Shift+Enter`, `Mod+Alt+Enter`. The window and split variants are gated on `td.canPopoutWindow` / `td.canSplit`.

Two properties worth noting:

- These use the **cursor**, not the mouse, and they **bypass every DOM class gate**. A patched `getClickableTokenAt` alone makes all four work on a citekey, in Live Preview and Source mode alike.
- `Workspace.activeEditor` (`149106`) is `this._activeEditor ?? this.getActiveViewOfType(MarkdownView)`. When `_activeEditor` is an embedded editor (hover editor, canvas card), `editMode` is a `$J` instance — unpatched. See §4.3.

### 1.7 Mobile "Follow link" popover (consumer 1)

`updateLinkPopup` (`132547`) runs only when `td.isMobile && this.sourceMode`. It is scheduled by a 300 ms debounce (`132257`) on focus / doc / selection change. It calls `getClickableTokenAt(cursor "from")` and, for any non-`footref` token, renders a `.follow-link-popover.tappable` div above the token with type-specific text ("Follow link" / "Open link" / "Search tag"). Tapping it calls `triggerClickableToken(token, evt.shiftKey || evt.button === 1)` (`132587`); hovering it fires a second `hover-link` with the same payload shape (`132593`).

### 1.8 The other link pipeline in the same DOM

Not a `getClickableTokenAt` consumer, but it lives inside the same CM6 content element and matters for §6. The `RJ` constructor also runs

```js
// app.js:132038
CW.registerDomEvents(a.contentDOM, new VW(r.owner)),
```

`CW.registerDomEvents` (`103263`) installs delegated handlers on the **CM6 content DOM** for `a.internal-link`, `a.footnote-link`, `a.external-link`, `a.tag`, `img,video`:

| Event | Selector | Handler on `VW` |
| --- | --- | --- |
| `click` / `auxclick` (button 0 or 1) | `a.internal-link` | `onInternalLinkClick` → `preventDefault()`, `openLinkText(href, path, Keymap.isModEvent(e))` (`103925`) |
| `dragstart` | `a.internal-link` | `onInternalLinkDrag` → `dragManager.dragLink` (`103921`) |
| `contextmenu` | `a.internal-link` | `onInternalLinkRightClick` → Copy + `handleLinkContextMenu` (`103929`) |
| `mouseover` | `a.internal-link` | `hover-link` with `source: "preview"`, `hoverParent: this.info` (`103984`) |

The href is read from `data-href` first, then `href` (`103265`); `displayText` is the anchor's trimmed text. `belongsToMe` (`103321`) walks up to the registered root, so any anchor nested anywhere inside `contentDOM` qualifies. Today this pipeline serves rendered widgets (embeds, callout contents) inside Live Preview.

## 2. The gates

The spec's phrase "the underline class Obsidian's click handler requires" is real but describes only one of three gates, and click and hover do **not** use the same one.

### 2.1 Hover: a class gate *before* the call

Hover preview never reaches `getClickableTokenAt` unless the delegated selector matches:

```js
o.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref", r.onEditorLinkMouseover.bind(r)),  // 132052
```

`HTMLElement.prototype.on` (`enhance.js:427–441`) is delegation implemented as `evt.target.matchParent(selector, evt.currentTarget)`, and `matchParent` (`enhance.js:253`) is **ancestor-inclusive**: it tests the element itself first, then walks parents up to the boundary. The matched element is passed as the handler's second argument and becomes `targetEl` in the `hover-link` payload.

`cm-underline` is **not** in the hover selector. Hover already works for `[@key]` today because Obsidian's own tokenizer gives the bracket span `cm-link` (§2.4).

### 2.2 Click: structural gates *before*, a class gate *after*

`onEditorClick` performs no class test before the lookup. Its pre-conditions (`132615–132650`) are:

1. Event type / button / platform filter (`132615–132622`).
2. Source-mode-and-modifier filter (`132625–132626`), see §1.1.
3. In Live Preview, abort if a non-collapsed selection contains the target (`132631–132639`) — so click-to-follow does not fight text selection.
4. `if (r !== o && r.parentNode !== o)` (`132640`), where `o` is `cm.contentDOM`. `.cm-line` elements are the direct children of `contentDOM`, so **a click on bare, unspanned line text is ignored**; the target must be at least one level deeper, i.e. inside a token span.
5. No ancestor with `contentEditable === "false"` that lacks both the `external-link` class and a `draggable` attribute (`132641–132650`) — this is what stops clicks inside replaced widgets.

Only then `getClickableTokenAt(posAtMouse(e))` runs (`132651`). The **class gate is applied afterwards**, between the lookup and the dispatch (`132654–132670`):

```js
(function () {
  if (n.sourceMode) return !0;
  if (c) return !0;                                   // any Mod / middle-click gesture
  if (!r.instanceOf(HTMLElement)) return !1;
  if ("tag" === l.type) return !0;
  if ("internal-link" === l.type) {
    if (!r.matchParent(".cm-underline")) return !1;
    if (r.matchParent(".cm-hmd-internal-link")) return !0;
    if (r.matchParent(".cm-link")) return !0;
  }
  if ("external-link" === l.type || "external-ref-link" === l.type) {
    if (r.matchParent(".external-link")) return !0;
    if (!r.matchParent(".cm-underline")) return !1;
    if (r.matchParent(".cm-url")) return !0;
    if (r.matchParent(".cm-link")) return !0;
  }
  return !1;
})() && (…, this.triggerClickableToken(l, c), e.preventDefault());
```

For an `internal-link` token in Live Preview a plain click needs **both**:

- an ancestor-or-self matching `.cm-underline`, **and**
- an ancestor-or-self matching `.cm-hmd-internal-link` **or** `.cm-link`.

Because `matchParent` is inclusive, a single element carrying both classes satisfies both tests. Mod-click and Source mode short-circuit the whole function.

### 2.3 Who produces `cm-underline`

`c3 = Decoration.mark({ class: "cm-underline", attributes: { tabIndex: "-1", draggable: "true" } })` (`154150`). It is emitted from exactly three places in the live-preview decoration builder `B3.buildDeco`:

| Line | Condition | Covers |
| --- | --- | --- |
| `155538` | `D && g.has("link") && g.has("url")` | display text of a markdown link `[text](url)` and autolinks |
| `155562` | branch `S`, i.e. `E \|\| M` where `E = link && !url && !formatting`, `M = hmd-internal-link && !link-has-alias && !link-alias-pipe && !hmd-embed` | wikilink target / plain `link` content |
| `155563` | `L = g.has("url") && !g.has("string")` | bare URL |

The whole live-preview extension is only installed when `!sourceMode` (`132418–132422`), so `cm-underline` **does not exist in Source mode at all** — which is consistent with Source mode short-circuiting the gate.

The `draggable: "true"` attribute on the same mark is what enables §1.3.

### 2.4 What classes `[@key]` actually gets

Confirmed against the prior research (§6.3–6.4 of `pandoc-citekey-cm6-live-preview.md`) and re-verified here:

- HyperMD's barelink branch (`109984–109999`) sets `hmdLinkType = BARELINK` for a `[...]` span not followed by `(`, `[`, ` [`, or `:`; the class table `vU` maps `BARELINK → "hmd-barelink"` (`109390`), and the class is appended to every token while the link state is live.
- Resulting tokens: `[` and `]` carry `formatting formatting-link hmd-barelink link`; the inner text carries `hmd-barelink link`. Adjacent tokens with identical class strings merge, so `[@a; @b]` yields **one** `<span class="cm-hmd-barelink cm-link">` covering `@a; @b`.
- `155534` explicitly withholds all live-preview treatment from barelinks: `g.has("hmd-barelink") && !g.has("hmd-footnote") && (k = O = !1)` forces both "is formatting" and "should decorate" false, so branch `S` at `155562` never runs for them. **No `cm-underline`, no `draggable`.**

Net today, in Live Preview: hover on `[@key]` passes the `.cm-link` gate and works; plain left-click fails the `.cm-underline` gate and does nothing; Mod-click bypasses the gate and works. In Source mode: plain click is filtered out at step 2, Mod-click works.

### 2.5 CSS attached to `cm-underline`

Adding the class is not visually neutral (`app.css:13453–13484`):

```css
.markdown-source-view.mod-cm6 .cm-underline { text-decoration-line: var(--link-decoration); text-decoration-thickness: var(--link-decoration-thickness); }
.markdown-source-view.mod-cm6 .cm-hmd-internal-link .cm-underline,
.markdown-source-view.mod-cm6 .cm-link .cm-underline,
.markdown-source-view.mod-cm6 .cm-url .cm-underline { cursor: var(--cursor-link); }
.markdown-source-view.mod-cm6 .cm-link .cm-underline,
.markdown-source-view.mod-cm6 .cm-url .cm-underline { color: var(--link-external-color); text-decoration-line: var(--link-external-decoration); }
```

Two consequences for a citekey mark:

1. The link-colour rules are **descendant** selectors (`.cm-link .cm-underline`). A single element carrying both classes matches only the bare `.cm-underline` rule, not the coloured ones. An element *nested inside* Obsidian's `.cm-link` span picks up `--link-external-color` — external-link colouring on a citation key. Choose deliberately.
2. `cursor: var(--cursor-link)` also needs the descendant relationship, so a self-styled mark must set the pointer cursor itself.

## 3. `triggerClickableToken` dispatch

Two implementations exist.

### 3.1 `RJ.prototype.triggerClickableToken` (`132521`) — the one every consumer uses

```js
(t.prototype.triggerClickableToken = function (e, t) {
  var n = this;
  if ("internal-link" === e.type)
    setTimeout(function () { n.app.workspace.openLinkText(e.text, n.path, t); }, 100);
  else if ("external-link" === e.type || "external-ref-link" === e.type) {
    var i = this.getClickableTokenHref(e);
    if (!i) return;
    Yv(i) ? (!0 === t ? window.open(i, "tab") : !1 === t ? window.open(i) : window.open(i, t))
          : new xw(md.interface.msgFailedToOpenHref({ href: i }));
  } else if ("tag" === e.type) {
    var r = e.text; r.startsWith("#") || (r = "#" + r);
    var o = this.app.internalPlugins.getEnabledPluginById("global-search");
    o && o.openGlobalSearch("tag:" + r);
  }
}),
```

| Token `type` | Behavior |
| --- | --- |
| `internal-link` | after a **100 ms `setTimeout`**, `app.workspace.openLinkText(token.text, this.path, newLeaf)` |
| `external-link` | `getClickableTokenHref` returns `token.text`; opened with `window.open` |
| `external-ref-link` | href resolved from the file cache's `referenceLinks` by id (`132507–132519`) |
| `tag` | `#`-normalized, handed to the `global-search` core plugin |
| `blockid` | **nothing** — falls through |
| `footref` | **nothing** — falls through (footnote hovering is handled by the `hover-link` path only) |

The 100 ms delay exists so the click finishes and the editor settles before the workspace changes leaves. **Inference** — no comment in the minified source states the reason.

`this.path` is `RJ.prototype.path` (`132098`): `this.owner.file?.path || ""`. That is the `sourcePath` used for link resolution.

### 3.2 `internal-link` resolution: text → file

`Workspace.openLinkText(linktext, sourcePath, newLeaf, openViewState)` (`149653`) is one line: `this.getLeaf(newLeaf).openLinkText(linktext, sourcePath, openViewState)`.

`WorkspaceLeaf.openLinkText` (`79603`) does:

1. `gD(linktext)` splits `path` from `subpath` (`#heading`, `#^block`).
2. `metadataCache.getFirstLinkpathDest(path, sourcePath)`.
3. **If it resolves**: `openFile(file, { state, eState: { subpath } })`.
4. **If it does not resolve**: `fileManager.getNewFileParent(sourcePath, linktext)` (only when the path has no `/`), then `fileManager.createNewFile(parent, path)`, then opens it in `mode: "source"` (`79617–79626`).

So an unresolvable `internal-link` token **creates a file**. That is Obsidian's normal "click an unresolved wikilink" behavior, and it is exactly what ZotLit's `CREATE_MARKER` interception exists to prevent.

### 3.3 `e5.prototype.triggerClickableToken` (`158445`) — MarkdownView's copy

Same three branches (`internal-link` / `external-link` / `tag`), but uses `this.file.path` as `sourcePath` and lacks the `external-ref-link` case. **No internal call site was found in 1.13.4** — all ten consumers reach the `RJ` chain. Treat it as legacy or plugin-facing surface. ZotLit does not patch it, and does not need to.

## 4. What a synthetic `internal-link` token buys

Given a token `{ type: "internal-link", text, start, end }` produced by the patched `getClickableTokenAt`.

### 4.1 Works automatically when `text` is a resolvable vault path

| Behavior | Requires | Notes |
| --- | --- | --- |
| Alt+Enter / Mod+Enter / Mod+Alt+Enter / Mod+Alt+Shift+Enter commands | token only | no DOM gate at all (§1.6) |
| Mod-click, Mod+Alt-click, Mod+Alt+Shift-click, middle-click | token only | modifier gate short-circuits the class gate |
| Source-mode Mod-click | token only | |
| Hover page preview | token + `.cm-link` ancestor | already satisfied by `cm-hmd-barelink cm-link` |
| Right-click menu: "Edit link", "Open in new tab", "Open to the right", "Rename…", `file-menu` event | token only (target must not be a bare `.cm-line`) | `handleLinkContextMenu` re-resolves `token.text` |
| Mobile Source-mode "Follow link" popover | token only | |
| Plain left-click in Live Preview | token + `.cm-underline` **and** (`.cm-hmd-internal-link` or `.cm-link`) ancestor | **fails today** |
| Drag the link out of the editor | token + `targetNode.draggable === true` | **fails today** |

### 4.2 Downstream code that reads the document/DOM instead of the token

- The click class gate (`132654–132670`) and the hover delegation selector (`132052`) read **DOM classes**, not the token.
- Drag reads the **`draggable` DOM attribute** (`132701`).
- "Edit link" selects `token.start .. token.end` in the **document** (`132875`) — a wrong range mis-selects text.
- `handleLinkContextMenu`, `dragLink`, `openLinkText`, and the hover embed all re-resolve `token.text` through `metadataCache.getFirstLinkpathDest` against `sourcePath`. They never see the token again.
- Native tokens carry a `displayText` field (`131822`); ZotLit's synthetic tokens omit it, so `dragLink`'s drag title falls back to the resolved file's short name (or the raw linktext when unresolved).

### 4.3 Leaks of the current patch — behaviors it inherited but did not want

These follow from the code paths above. All are source-verified; none has been runtime-confirmed.

1. **Hover on an unresolved citekey offers to create a file named after the citekey.** `findCitekeyToken` returns `{ type: "internal-link", text: token.citekey, citekey: CREATE_MARKER }` when there are zero or several note matches. Hover does not consult `triggerClickableToken`; it fires `hover-link` with `linktext = "<citekey>"`. Page preview calls `V1.load` (`137295`), which cannot resolve the path and falls back to `N1` (`137152`), the unresolved-embed class. `N1.loadFile` renders `mod-empty` with the text `"<citekey>" is not created yet.` and installs `onClick` → `app.workspace.openLinkText(linktext, sourcePath, Keymap.isModEvent(e))` (`137157–137162`). Clicking that popover therefore **creates a vault file named after the raw citekey**, bypassing ZotLit's create-then-open flow entirely.
2. **Right-click on an unresolved citekey shows "Create file"** with the same effect (`150304–150313`).
3. **Dragging a create-marker token transfers the raw citekey** as the linktext (`88139`, `a = t` when `getFirstLinkpathDest` fails) — currently unreachable because barelinks are not `draggable`, but it becomes reachable the moment a `cm-underline`-equivalent mark with `draggable: "true"` is added.
4. **Embedded editors are half-patched.** `getClickableTokenAt` is patched on the shared `OJ.prototype`, but `triggerClickableToken` is patched on `Z3.prototype` only. In a hover editor or canvas card (`$J`, `134222`), a Mod-click on `[@key]` produces the synthetic token and then runs the *unpatched* `RJ.prototype.triggerClickableToken` → `openLinkText(citekey, …)` → file creation.
5. **The `editor-menu` event sees a different picture.** Because `getClickableTokenAt` is patched globally, every workspace `editor-menu` subscriber (including other plugins) observes an `internal-link` token where the document has plain bracketed text.

### 4.4 Corrections to the shipped user docs

`apps/docs/content/docs/concepts/how-citekey-links-work.mdx` says:

- *"Zero or multiple direct matches do not provide hover preview."* — Contradicted by §4.3.1: a popover does appear, showing the "not created yet" placeholder for the raw citekey. **Unverified at runtime**, but the code path has no branch that would suppress it.
- *"Obsidian's editor already displays bracketed text as a link, and that display is what ZotLit's hook builds on."* — Precise form: the HyperMD stream mode tags `[...]` as `hmd-barelink link`, producing `<span class="cm-hmd-barelink cm-link">`. That span satisfies the **hover** delegation selector and the second half of the click class gate, but Obsidian deliberately withholds `cm-underline` from barelinks (`155534`), so the first half of the click gate fails. What the hook builds on is the `cm-link` class, not a link *display*; the styling is generic syntax highlighting, not link styling.
- *"Click navigation opens that note directly."* — True for Mod-click (any mode) and for middle-click; **not** true for a plain left-click in Live Preview, and plain left-click is filtered out in Source mode before the token lookup. Reconcile the page with the runtime.

## 5. Public-API mapping

| Internal (`app.js` 1.13.4) | Public `obsidian.d.ts` | Status |
| --- | --- | --- |
| `OJ.prototype.getClickableTokenAt` (`131744`) | — | **Private.** No declaration anywhere in `obsidian.d.ts`. |
| clickable-token object shape | — | **Private.** `ClickableToken` is not exported. Native internal-link tokens additionally carry `displayText` (`131822`). |
| `RJ.prototype.triggerClickableToken` (`132521`) | `MarkdownEditView` (`obsidian.d.ts:3906`) declares only `app`, `hoverPopover`, ctor, `clear`, `get`, `set`, `file`, `getSelection`, `getScroll`, `applyScroll` | **Private.** |
| `MarkdownView.editMode` (`157853`) | — | **Private.** No `editMode` in `obsidian.d.ts`. |
| `Editor.posAtMouse` (`87372`) / `posAtCoords` | — | **Private.** |
| `Workspace.openLinkText` (`149653`) | `openLinkText(linktext, sourcePath, newLeaf?, openViewState?)` (`7914`) | **Public.** |
| `WorkspaceLeaf.openLinkText` (`79603`) | not declared on `WorkspaceLeaf` | Private; reachable through the public `Workspace.openLinkText`. |
| `Workspace.getLeaf` (`149653` call) | `getLeaf(newLeaf?)` (`7892`) | **Public.** |
| `Workspace.handleLinkContextMenu` (`150252`) | `handleLinkContextMenu(menu, linktext, sourcePath, leaf?)` (`8050`) | **Public.** |
| `Workspace.handleExternalLinkContextMenu` (`150318`) | not declared | Private. |
| `sy.isModEvent` (`55059`) | `Keymap.isModEvent(evt)` (`3661`) | **Public**, returns `PaneType \| boolean`. |
| `sy.isModifier` (`55040`) | `Keymap.isModifier(evt, modifier)` | **Public.** |
| `"tab" \| "split" \| "window"` | `PaneType` (`4770`) | **Public.** |
| `workspace.trigger("hover-link", …)` (`132690`) | no typed `on('hover-link', …)` overload; only `trigger(name: string, …data: unknown[])` (`2829`) | Emitting is public-by-convention; the payload shape is undocumented. |
| `registerHoverLinkSource` (`150357`) | `Workspace.registerHoverLinkSource(id, info)` (`4980`) + `HoverLinkSource` (`3444`) | **Public.** Note `"editor"` is *not* registered. |
| `hoverParent` / popover | `HoverParent` (`3464`), `HoverPopover` (`3476`) | **Public.** |
| `app.dragManager.dragLink` / `onDragStart` (`88139`) | — | **Private.** |
| `app.internalPlugins.getEnabledPluginById` | — | **Private** (ZotLit already declares it). |
| `CW.registerDomEvents` (`103263`) / `VW` (`103916`) | — | **Private**, but the *contract* (`a.internal-link[data-href]`) is the same one `MarkdownRenderer` output uses and is de facto stable. |
| `workspace.on("editor-menu", …)` (`133223` trigger) | `on('editor-menu', callback)` (`8128`) | **Public.** |
| `Decoration.mark({ tagName, class, attributes })` | `@codemirror/view` `MarkDecorationSpec` (`cm-view/src/decoration.ts:7–38`, `tagName` at `:27`, defaults to `"span"` at `:289`) | **Public** CM6 API. |

### Declarations in `apps/obsidian/src/typings/obsidian-ex.d.ts` that die with the patch

If the replacement stops calling into the clickable-token pipeline entirely, these four become dead:

- `interface ClickableToken { type; text; start; end }`
- `interface Editor { getClickableTokenAt(pos): ClickableToken | null }`
- `interface MarkdownEditView { triggerClickableToken(token, newLeaf): void }`
- `interface MarkdownView { editMode?: MarkdownEditView }` — used only to reach `triggerClickableToken` and to find a patchable prototype (`service.ts` `firstLoadedMarkdownView`).

Everything else in that file (`MetadataCache.initialized`, `App.plugins/internalPlugins/setting/commands`, the settings-modal cluster, `MenuItem.setSubmenu`, `EditorSuggest.suggestions`) is unrelated.

**Caveat:** they become dead only under a design that does *not* keep a `getClickableTokenAt` hook. See §6.1 — the "underline class alone" design does not work.

## 6. Implications for retiring `citekey-click`

### 6.1 The load-bearing correction

**Adding `cm-underline` to a mark decoration is necessary but not sufficient.** The class gate at `132654–132670` runs *after* `getClickableTokenAt` and is only reached inside `if (l)` at `132652`. For a barelink, the unpatched `getClickableTokenAt` returns `null` (`131827–131839`: the `link` branch scans forward for a `string url` token, finds none, sets `I = -1`, and every later branch — `url`, `hashtag`, `blockid`, `footref` — fails). With `l === null` the gate function is never invoked and no dispatch happens, no matter what classes the span carries.

`getClickableTokenAt` reads `syntaxTree(state)` and `tokenClassNodeProp` (`131750–131765`; export table: `syntaxTree: () => Su` at `14727`, `tokenClassNodeProp: () => kp` at `14730`). **Decorations cannot influence it.** There is no public or private hook to add token classes to Obsidian's HyperMD stream parser.

So the mark-decoration design has exactly three viable routings, and the spec must pick one:

**(A) Keep a `getClickableTokenAt` hook, add the mark for the gate.** Minimal change from today: the mark supplies `cm-underline` (plain left-click in Live Preview) and `draggable: "true"` (drag), and the existing `Editor` patch keeps supplying the token. Retires only the `triggerClickableToken` patch — and retiring that one re-opens leak §4.3, because `openLinkText` would then create a citekey-named file. Realistically this means keeping *both* patches and adding the mark.

**(B) Render an `<a class="internal-link" data-href="…">` and inherit the rendered-anchor pipeline.** CM6's `MarkDecorationSpec.tagName` (`cm-view/src/decoration.ts:27`) lets a mark wrap the text in an arbitrary element *without replacing it*:

```ts
Decoration.mark({ tagName: "a", class: "internal-link", attributes: { "data-href": notePath } })
```

Any such anchor inside `cm.contentDOM` is picked up by the delegated handlers installed at `132038` (§1.8) and gets click + modifier mapping, right-click menu, drag, and hover — with `source: "preview"` instead of `"editor"` — with **no Obsidian internals patched**. Costs and unknowns:

- ZotLit cannot intercept the click: `VW.onInternalLinkClick` (`103925`) calls `openLinkText` directly and does not check `defaultPrevented`, and it is registered at edit-view construction, so a later ZotLit listener runs after it. The create-a-note case would need a separate mechanism (e.g. only emit `data-href` for citekeys that already have a note, and handle the rest with ZotLit's own handler on a differently-classed span).
- **Unverified:** how an inline `<a>` inside `contenteditable` behaves for caret movement, text selection, IME, and native dragstart. Obsidian itself only ever puts anchors inside `contentEditable="false"` widgets. This needs a runtime probe before the spec commits.

**(C) Own the interaction outright.** A ZotLit mark plus `EditorView.domEventHandlers` / a plugin-level `mousedown` handler, re-implementing modifier→`PaneType` via the public `Keymap.isModEvent`, hover via `workspace.trigger("hover-link", …)` + `registerHoverLinkSource("zotlit-citekey", …)`, context menu via the public `editor-menu` event + `Workspace.handleLinkContextMenu`, and drag via `dataTransfer`. Most code, zero internals except the `hover-link` payload shape, and full control over the create-note branch.

### 6.2 Behavior ledger

Each row is a behavior the current monkey patch inherits, and what happens to it under a mark-decoration replacement.

| # | Inherited behavior | Source | Under (A) mark + keep hooks | Under (B) `a.internal-link` mark | Under (C) own handlers |
| --- | --- | --- | --- | --- | --- |
| 1 | Mod-click → new tab | `132653`, `55059` | native | native (`103925`) | reimplement with `Keymap.isModEvent` |
| 2 | Mod+Alt → split, Mod+Alt+Shift → window, middle-click → tab | `55059` | native | native | reimplement |
| 3 | Plain left-click in Live Preview | `132660` | **gained** by adding `cm-underline` | native | reimplement |
| 4 | Source-mode Mod-click, downgraded to same-tab | `132625`, `132672` | native | native, but **no downgrade** — Mod-click opens a tab | decide explicitly |
| 5 | Hover page preview | `132685`, `179151` | native (already works via `.cm-link`) | native, `source` changes `"editor"` → `"preview"` | reimplement: `trigger("hover-link", …)` + `registerHoverLinkSource` |
| 6 | Hover Mod-gating honoured by the Page-preview plugin | `179166` | native, source `"editor"` (unlisted in settings) | native, source `"preview"` | **gained**: a registered source appears in Page-preview settings |
| 7 | Drag link out of the editor | `132700` | needs `draggable: "true"` **and** `cm-underline` on the mark | native if dragstart fires on the anchor (**unverified**) | reimplement via `dataTransfer` |
| 8 | Right-click: "Edit link" + open-in-tab/split + Rename + `file-menu` | `132872`, `150252` | native | native (`103929`) | reimplement via `editor-menu` + public `handleLinkContextMenu` |
| 9 | `editor:follow-link` (Alt+Enter) and the three open-in-* commands | `147866`–`147959` | native, no DOM gate | **lost** — commands read `getClickableTokenAt`, not the DOM | **lost** unless ZotLit ships its own commands |
| 10 | Mobile Source-mode "Follow link" popover | `132547` | native | **lost** | **lost** unless reimplemented |
| 11 | Mobile tap-to-follow (Android mousedown / iOS synthetic click) | `132616`–`132619`, `38827` | native once `cm-underline` is present | native (plain DOM click) | reimplement |
| 12 | Create-then-open interception for unknown citekeys | `service.ts` `#patch` | requires keeping the `triggerClickableToken` patch | **must** be reimplemented (`onInternalLinkClick` cannot be intercepted) | native to the design |
| 13 | Link colouring / `cursor: pointer` | `app.css:13453` | comes with `cm-underline`; the *external*-link colour applies when nested inside `.cm-link` (§2.5) | `internal-link` class is styled in reading-mode CSS; verify inside the editor | fully self-styled |
| 14 | Unresolved-citekey "not created yet" popover that creates a citekey-named file | §4.3.1 | still present — **should be suppressed** | present unless `data-href` is withheld for unresolved keys | absent by construction |
| 15 | Embedded/hover/canvas editors see the synthetic token but not the interception | §4.3.4 | still present | uniform (mark applies wherever the decoration runs) | uniform |

Rows 9 and 10 are the biggest at-risk behaviors: **the four "open link under cursor" commands and the mobile follow-link popover read the token, never the DOM.** No decoration can restore them; only a `getClickableTokenAt` hook or ZotLit-owned commands can.

Row 14 is the biggest *latent defect* the retirement should fix rather than carry forward.

### 6.3 Concrete gate recipe if the mark stays in the design

For a plain left-click on `[@key]` in Live Preview to route natively, the decoration must put, on the citekey span or any ancestor of the click target within the editor:

- class `cm-underline` — required by `132660`;
- class `cm-hmd-internal-link` or `cm-link` — already supplied by Obsidian's `cm-hmd-barelink cm-link` token span, so nothing to add;
- attribute `draggable="true"` — required by `132701` if drag should work.

Because `matchParent` is inclusive, one element carrying `cm-underline` (nested anywhere inside the existing `.cm-link` span, or carrying both classes itself) satisfies the gate. Style it with a ZotLit-owned class to avoid the external-link colour rule (§2.5).

Precedence note: the plugin's decorations arrive as a later facet input than Obsidian's (`getDynamicExtensions` pushes the live-preview extension at `132421` and plugin extensions at `132440`). Whether CM6 nests the plugin's mark inside or outside Obsidian's highlight span, and therefore whether `.cm-link .cm-underline` matches, is **unverified**; use `Prec` if the nesting order matters, or sidestep it by self-styling.

## 7. Open questions

- **Runtime confirmation of §4.3.1** — hover an unresolved `[@key]` in a live vault and check whether the "not created yet" popover appears and whether clicking it creates a file. The code path is unambiguous but has not been exercised.
- **Inline `<a>` inside `contenteditable`** (route B) — caret traversal, selection, IME, and whether `dragstart` fires with the anchor as `targetNode`. Needs a probe before committing.
- **CM6 mark nesting order** vs. Obsidian's syntax-highlight marks (§6.3).
- **`e5.prototype.triggerClickableToken`** (`158445`) has no caller in 1.13.4. If a future release routes something through it, a `Z3.prototype`-only patch would miss it — another argument for leaving the patch behind.
- **Docs reconciliation** — three statements in `how-citekey-links-work.mdx` need updating (§4.4) regardless of which route the spec takes.
