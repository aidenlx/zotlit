# Hover popovers

A popover of the plugin extends `PopoutAwareHoverPopover` from `@/lib/popout-aware-hover-popover`. Obsidian's `HoverPopover` arms its show and hide timers on `activeWindow` and cancels them on the main window; while a popout owns focus the cancel misses, and a popover hidden before its delay opens again, unloaded and empty. The base follows the [pop-out window policy](popout-windows.md) by cancelling each timer on the window that armed it. Lint blocks the value import of `HoverPopover` from `obsidian`; import it as a type where a field or a parent needs the name.
