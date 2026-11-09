# Hover popovers

A popover of the plugin extends `HoverPopover` from `@/lib/hover-popover`, which follows the [pop-out window policy](popout-windows.md) where Obsidian's own `HoverPopover` does not:

- **Timers.** Obsidian arms the show and hide timers on `activeWindow` and cancels them on the main window; while a popout owns focus the cancel misses, and a popover hidden before its delay opens again, unloaded and empty. The base cancels each timer on the window that armed it.
- **Window.** Obsidian places a popover with no target in `activeDocument` each time it positions it, so the popover follows focus into another window. The base keeps such a popover in its home document: override `homeDocument()` with the document of the view it hangs over, as the Mark Popup does; without one it stays in the document of its first placement. A popover with a target stands in the target's window.

Lint blocks the value import of `HoverPopover` from `obsidian`; import it as a type where a field or a parent needs the name.
