# Patching the Zotero reader across the chrome/content boundary

## Summary

To observe a Zotero reader's annotation selection (which has no API), patch
`reader._internalReader._updateState` by **plain property assignment**:

```ts
const original = internal._updateState;
internal._updateState = function (this, state, init) {
  const ret = original.call(this, state, init);
  /* read post-update state, push if changed */
  return ret;
};
// restore: internal._updateState = original;
```

Do **not** use `monkey-around`'s `around()` here. It corrupts the reader. The
reason is the chrome/content compartment boundary, explained below.

## Why a hook is needed

Annotation selection never leaves the reader iframe — no `Zotero.Notifier`
event, no `registerEventListener` type, no host callback. The authoritative set
is `_internalReader._state.selectedAnnotationIDs` (annotation **keys**), and the
single write path for `_state` is the reducer
`_updateState(state) { this._state = { ...this._state, ...state }; … }`
(`reader.js:493`/`:496`). Wrapping `_updateState` therefore observes every
selection change — sidebar click, view click, keyboard, tool switch, deselect —
including the case a DOM `MutationObserver` on the sidebar misses: deselecting
while the sidebar is hidden/closed (no row to mutate → no event).

## The compartment boundary

The plugin runs in Zotero's **chrome** (parent) compartment. The reader runs in
the **content** compartment of its iframe. `reader._internalReader` is the
content-side reader object, obtained chrome-side via `wrappedJSObject`:

```js
// chrome/content/zotero/xpcom/reader.js:220
this._internalReader = this._iframeWindow.wrappedJSObject.createReader(…);
```

Gecko interposes a **security membrane** between the two compartments. Values
passed across it are wrapped (Xray or opaque), and some operations on
cross-compartment objects are forbidden outright. Plain reads of content data
from chrome work (e.g. `internal._state.selectedAnnotationIDs` is a `string[]`).
A plain function assignment also works: storing a chrome function on the content
object, which the reader then calls, and forwarding the content arguments back to
the original content function — the arguments round-trip intact. This is verified
working (see Evidence).

## Why `monkey-around` breaks it

`monkey-around@3.0.0`'s `around1` does more than assign — it **reparents
prototypes** to wire up its self-dedupe / auto-remove feature:

```js
// node_modules/monkey-around/dist/index.mjs
let current = createWrapper(original);
if (inherited) Object.setPrototypeOf(current, inherited); // chrome wrapper proto ← content fn
Object.setPrototypeOf(wrapper, current);                   // chrome fn proto ← chrome wrapper
obj[method] = wrapper;
```

`inherited`/`original` is the **content** `_updateState` function;
`current`/`wrapper` are **chrome** functions. So `around()` builds a prototype
chain that crosses the membrane (chrome function → content function). When the
reader later drives `_updateState` during PDF initialization — content code
calling through this frankenstein chain with content objects — the membrane
rejects a property access and the reader throws:

```
Uncaught (in promise) Error: Permission denied to access property "length"
    onSetPageLabels resource://zotero/reader/reader.js
    _initProcessedData …  _handleDocumentInit …  (PDF document load)
```

`onSetPageLabels` (`reader.js:1343`) calls `this._updateState({ pageLabels })`;
the corrupted call path makes `pageLabels` unreadable downstream, line 597's
`_render()` never runs, and **the PDF never renders** (no `PDFViewerApplication`,
zero canvases). Plain assignment, which never touches prototypes, is unaffected.

`monkey-around` is the right tool inside the Obsidian app (`apps/obsidian`),
where everything shares one compartment. It is the wrong tool for reaching into
the Zotero reader iframe from chrome.

## Evidence (RDP, Zotero 9.0.4)

Verified live over the dev server's Remote Debugging Protocol
(`/zotero-rdp-debug`):

- **Plain assignment, end-to-end:** with the sidebar closed
  (`sidebarOpen: false`), selecting then deselecting an annotation POSTs both
  `{ selected: [3] }` and `{ selected: [] }` to the capture server. The reopened
  PDF renders normally (`pagesCount: 28`, canvases present).
- **`monkey-around`:** the reader fails to initialize the PDF after this patch is
  installed; the user-reported `Permission denied to access property "length"`
  originates in `onSetPageLabels` during PDF document init.
- **`_updateState` is the sole `_state` writer:** the only assignments to
  `this._state` in `reader.js` are the constructor (`:158`) and the reducer
  (`:496`).
- **Measurement caveat:** `PDFViewerApplication` lives in a **nested** iframe
  inside `reader._iframeWindow`, not on it. And calling a content method that
  marshals content data (e.g. `_initProcessedData`) directly from a chrome RDP
  eval throws the same membrane error even *unpatched* — so that error in an RDP
  session is not by itself proof the patch is at fault. Confirm reader health by
  the nested-iframe `pagesCount` / canvas count after a **natural** open.

## Takeaways

- Read content reader state from chrome freely; it round-trips.
- Patch content reader methods by **plain assignment** + restore-on-dispose.
- Never apply `monkey-around` (or any prototype-reparenting wrapper) to a
  content-compartment object from chrome.
- Detect reader recreation by `_internalReader` identity (reload builds a new
  one) and re-patch.

See also: `src/notify/annot-select.ts` (the live hook),
`reference_zotero_reader_internals` memory.
