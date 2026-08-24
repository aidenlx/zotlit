# The Companion hand-injects chrome only where Zotero offers no registry

> **Status: accepted.**

Every Companion UI surface until now went through a Zotero plugin registry —
`MenuManager`, `ItemTreeManager`, `Reader.registerEventListener`,
`PreferencePanes` — and `main.ts` recorded that no subsystem needed
window-scoped teardown. The Database Status control breaks that: Zotero
exposes no registry for a standalone item-pane sidenav button, so the
Companion builds a `toolbarbutton` with `document.createXULElement` and
appends it into `#zotero-view-item-sidenav` itself. The rule this sets is
narrow — use a registry wherever one exists, hand-inject only where none
does, and own the node's removal on disposal.

## Considered Options

- **`Zotero.ItemPaneManager.registerSection`**, the only sanctioned route to a
  sidenav button. It forces a real item-pane section body with per-item render
  hooks, and places the button inside the sidenav's `_buttonContainer`, where
  pin, drag, reorder and order-persistence all act on it. Database freshness
  is a window-level fact with no item to render, so the section would have
  existed solely to earn its button.
- **A `toolbarbutton` in `#zotero-tabs-toolbar`**, beside the sync button.
  Also hand-injected, so it concedes the same rule while giving up adjacency
  to Locate — the control this one is modelled on.
- **No control at all**, leaving the checkpoint invisible and the stale-data
  how-to reachable only from the docs site.

## Consequences

- The node is appended as a `.pin-wrapper` sibling **outside**
  `_buttonContainer`, mirroring where Zotero puts its own Locate button. Every
  pin, drag, reorder and persist loop is scoped to `_buttonContainer`, so none
  of them enumerate it. Injecting inside that container would silently occupy
  a slot in the reorder index.
- `onMainWindowUnload` stops being a no-op, and `main.ts` now models
  per-window state. Disposal removes the node from every still-open window and
  looks up rather than touches closed ones, the rule `active-reader.ts` and
  `application-blur.ts` already follow.
- The button styles itself with `class="btn"`, `custom="true"` and two inline
  CSS custom properties, so the Companion still ships no stylesheet. This
  depends on core SCSS that is not plugin API; a Zotero redesign of the
  sidenav would break the look before it breaks the function.
- `itemPaneSidenav.js` is identical in Zotero 9.0.3 and 10.0, so this needs no
  version branch today. That is a fact about two releases, not a guarantee.
- Injection is verified live over RDP rather than in Vitest. A fake faithful
  enough to prove placement would have to reproduce `connectedCallback`,
  `.pin-wrapper` layout and `render()`'s selector passes, and would then be
  testing the fake.
