# Keyboard scope

A key that more than one layer can claim — a completion list, a Signature Hint, a suggester or popup inside a Chooser page, modal, popover or view — is registered on an Obsidian `Scope`: push `new Scope(parent)` with `app.keymap.pushScope` (the editor's own window in a pop-out) when the layer opens, return `false` from the handler that consumes the key, and pop it on close, blur, unmount and window migration. The innermost open layer owns the key; the layers beneath need no knowledge of it. Follow `src/components/chooser.tsx` and `src/views/query-view/card-focus.ts`.

A key only the focused element handles — Escape clearing its own search box — stays an element `keydown` handler.

## CodeMirror editors

A CodeMirror 6 editor's keys are its own: bind them in its `keymap`, with `preventDefault`, as Obsidian's Markdown editor binds undo through CodeMirror's `historyKeymap` and puts no command on Mod+Z on desktop. Obsidian pushes no Scope as an editor takes focus. The surface that holds the editor holds the Scope, and that Scope hears every key before CodeMirror does.

- A popup the editor opens, such as a completion list or a Signature Hint, owns its keys on a Scope it pushes. Its arrows, Enter and Escape answer `false` so CodeMirror never sees them, and answer nothing while composing.
- A surface Scope that claims a chord the editor binds as well (Mod+Z, Mod+A, Escape) yields it when focus is in a text field, as the Template Workbench view's undo does. A command hotkey under `app.scope` takes its chord even inside the editor, so pick editor chords that no hotkey holds.
- An element handler around the editor runs after CodeMirror, and leaves a key the editor took: it returns on `event.defaultPrevented`, as Obsidian's `Modal` does for Escape. When two histories step on one key, they undo each other.

Reviewer checks:

- A surface's key handler that inspects the DOM to decide whether some other layer is open (`aria-haspopup`, a marker attribute, `closest(...)`, a class) is a Scope missing in that other layer.
- Each pushed Scope is popped on every exit path and follows the editor's window in a pop-out.
- A Scope pushed over an Obsidian `Menu` goes on as the menu loads, a timer after it shows, as a child of the menu (`menu.addChild`), or it ends up beneath the menu's own.
- An element handler around a CodeMirror editor that acts on a key without checking `defaultPrevented` handles the key a second time.
- Workbench code stays headless ([ADR 0044](../docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)): it exposes open/close and the commands; the Obsidian adapter pushes the Scope.
