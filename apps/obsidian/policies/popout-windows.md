# Pop-out windows

- Use `node.doc` / `node.win` for window-local DOM and timers; use `activeDocument` / `activeWindow` only when focus owns the operation.
- Use `node.instanceOf(NodeType)` and `event.instanceOf(EventType)` for DOM and UI-event checks. The package lint rejects global DOM/event constructors on the right of `instanceof`.
- Rebind migrated renderers with `onWindowMigrated`; move roots and overlay portals to the destination document.
- Verify window-sensitive behavior in both the main window and a pop-out. See [Obsidian's pop-out guide](https://obsidian.md/blog/how-to-update-plugins-to-support-pop-out-windows/).
