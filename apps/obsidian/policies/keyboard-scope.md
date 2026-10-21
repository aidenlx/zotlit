# Keyboard scope

A key that more than one layer can claim — a completion list, a Signature Hint, a suggester or popup inside a Chooser page, modal, popover or view — is registered on an Obsidian `Scope`: push `new Scope(parent)` with `app.keymap.pushScope` (the editor's own window in a pop-out) when the layer opens, return `false` from the handler that consumes the key, and pop it on close, blur, unmount and window migration. The innermost open layer owns the key; the layers beneath need no knowledge of it. Follow `src/components/chooser.tsx` and `src/views/query-view/card-focus.ts`.

A key only the focused element handles — Escape clearing its own search box — stays an element `keydown` handler.

Reviewer checks:

- A surface's key handler that inspects the DOM to decide whether some other layer is open (`aria-haspopup`, a marker attribute, `closest(...)`, a class) is a Scope missing in that other layer.
- Each pushed Scope is popped on every exit path and follows the editor's window in a pop-out.
- Workbench code stays headless ([ADR 0044](../docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)): it exposes open/close and the commands; the Obsidian adapter pushes the Scope.
