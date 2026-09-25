# The surfaces inside the PDF reader are vanilla DOM on Obsidian's popover

The capability indicator described below is amended by [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md): a labeled enable-editing action guides setup, and ordinary read-only use carries no permission warning.

Every other ZotLit surface is a Preact root. The three surfaces ZotLit puts inside Obsidian's native PDF reader are not: the Annotation Marks on each page, the Creation Toolbar in the reader's own toolbar slot, and the Mark Popup are vanilla DOM, and the Mark Popup is Obsidian's `HoverPopover` on the plugin's popout-aware base. No Preact root lives in the reader.

## Considered Options

- **Preact for the Annotation Marks** (rejected): PDF.js `reset()` removes every child of a page that is not on its keep-list on zoom, rotation, and page recycle, so each render is a full rebuild from data. A diff has nothing to reconcile, and a Preact root would need a re-append trick to survive the wipe.
- **A Preact root in the reader's toolbar slot** (rejected): six flat controls (tool, colour, visibility, Editing Capability) need one render function that sets classes, `aria-pressed`, `aria-disabled`, and tooltips. A component tree is more machinery than the surface needs.
- **A headless popover library for the Mark Popup** (rejected): a second positioning engine beside Obsidian's, its own dismissal rules to override, and a portal to manage. The selection prototype had to fix two dismissal defects in it. [ADR 0044](0044-menus-and-popovers-are-obsidians-own-primitives.md) rejects the same library for the same reasons on every other surface.
- **Vanilla DOM on Obsidian's own primitives** (chosen): the Annotation Mark renderer is already a tested pure function, the toolbar reuses `clickable-icon`, `setTooltip`, and `Menu`, and Obsidian owns the popup's placement, viewport clamping, theme, and chrome.

## Consequences

- Annotation Marks are rebuilt per `pagerendered`. They are paint: `pointer-events: none`, hit-tested by geometry, with `is-selected` as the only mutable state. The overlay SVG is the one node ZotLit mounts under a PDF.js-owned element, and it is disposable by design.
- The Creation Toolbar's nodes go into `.pdf-toolbar-right` as bare `clickable-icon` elements with layout utilities and no `.zt-root`, so no preflight reaches Obsidian's toolbar. The binding's disposer removes them; Obsidian's `empty()` on unload also clears them, so removal is idempotent.
- The Mark Popup extends `PopoutAwareHoverPopover` directly. It is constructed with `targetEl: null`, `waitTime: 0`, and a `staticPos`, then pinned with `setIsFocused(true)`, because a fresh `HoverPopover` always waits its delay before the first `show()` and only `isFocused` keeps it open with no target. Mouse-out never closes it; the binding calls `hide()` from the selection state and the hit test's outside-press rule. Retargeting is a new `staticPos` plus `position()`. Its content row carries `.zt-root`.
- The popup's anchor is a virtual point, the bottom-centre of the selected Annotation Mark's union rect (or the fresh text selection's), recomputed on `pagerendered` and on container scroll, because `reset()` can wipe the mark while the popup is open. Obsidian prefers placement below and falls back above.
- The per-view binding is the popup's `HoverParent`, so Obsidian's Page Preview on the PDF view keeps its own `hoverPopover`.
- The Editing Capability affordance is "one copy table and icon map, two renderers": a pure module the reader renders with its vanilla function and the Annotation View renders in its Preact toolbar. The cooldown countdown is a `setInterval` under the binding's disposer in the reader and an effect in the view.
- Reader surfaces publish through the Reader Session; no reader code imports Preact. A Preact root inside `hoverEl`, the citation popover's pattern, stays available if the popup row grows, at no lifecycle risk.

## Amendment: Mark Handles and the selected mark's body take the pointer

While editing is live, the Mark Handles of the selected Annotation Mark and the body of a selected image or ink mark take pointer events. A Geometry Edit captures the pointer from the press, and each grip shows the cursor of what a press there does, so these nodes carry `pointer-events: all`. Which grip a press takes is still decided from geometry, as a mark click is. This is the one exception to "Annotation Marks are paint": every other mark, and every mark while editing is not live, stays `pointer-events: none`, so text selection and PDF links under an unselected mark keep their path, and the body of a selected highlight or underline stays the text selection's.

## Amendment: several Annotation Marks can be selected

With the Card Selection owned by the Annotation View ([ADR 0061](0061-the-annotation-view-owns-its-card-selection.md)), the reader paints `is-selected` on every mark in a Card Selection of several. The Mark Popup and the Mark Handles stay for a single selected mark, so the popup's anchor is still one mark's union rect. The PDF gains no multi-select gesture: a mark click selects that mark alone. The reader's colour keys and Delete act on every selected mark, and ↑/↓ reduce a selection of several to one mark.

## Amendment: the Mark Popup's tag section is a Preact island

Accepted 2026-09-25. Annotation Tags are shown and edited inline in the Annotation Card and in the Mark Popup through one composition, `TagsInput` from `@zotlit/ui` ([root ADR 0061](../../../../docs/adr/0061-shared-ui-parts-are-unstyled-compositions-in-zotlit-ui.md)). The Mark Popup renders its tag section, the chips and the inline editor, as a Preact root in its own element under the popup column: the pattern held available above. The row, the comment view, and the comment sheet stay vanilla DOM, and the Annotation Marks and the Creation Toolbar have no Preact. The island mounts when the tag section appears and unmounts when the popup rebuilds its content or hides, under the binding's disposer.

A vanilla builder shared the way the comment sheet is shared was rejected. The same parts also serve the Workbench's Match conditions, which is a React tree on the web and a Preact tree in Obsidian, so only a JSX composition has one copy of the key, focus, and duplicate rules for all three consumers. The reader rule narrows from "no reader code imports Preact" to "only the Mark Popup's tag section imports Preact".
