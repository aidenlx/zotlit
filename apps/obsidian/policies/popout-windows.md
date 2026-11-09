# Pop-out windows

- Use `node.doc` / `node.win` for window-local DOM and timers; use `activeDocument` / `activeWindow` only when focus owns the operation. Outside tests the package lint rejects global timers such as `window.setTimeout` and bare `requestAnimationFrame`; background work that stands in no window is listed by name in `oxlint.config.ts`.
- Observe sizes with `observeResize` from `@/lib/observe-resize`. A `ResizeObserver` reports only elements in the window whose constructor made it, so the main window's never reports an element in a pop-out; the package lint rejects the global `ResizeObserver`.
- Use `node.instanceOf(NodeType)` and `event.instanceOf(EventType)` for DOM and UI-event checks. The package lint rejects global DOM/event constructors on the right of `instanceof`.
- Extend `HoverPopover` from `@/lib/hover-popover` for a popover; see [Hover popovers](hover-popover.md).
- Rebind migrated renderers with `onWindowMigrated`; move roots and overlay portals to the destination document.
- Verify window-sensitive behavior in both the main window and a pop-out. See [Obsidian's pop-out guide](https://obsidian.md/blog/how-to-update-plugins-to-support-pop-out-windows/).
