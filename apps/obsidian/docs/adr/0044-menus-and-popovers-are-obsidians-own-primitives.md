# Menus and popovers are Obsidian's own primitives

Every menu and popover ZotLit shows is Obsidian's own `Menu` or popover, built imperatively from presentation data and shown from the gesture that opened it. This holds inside a Preact tree as much as in vanilla DOM: the Annotation View's toolbar, its Attachment picker, and an Annotation card's colour and tag menus each call an action that builds a `Menu`, the same way the card's overflow menu and the pane menu already did.

[ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md) reached the same conclusion for the three surfaces inside Obsidian's PDF reader. This ADR carries it to every remaining surface, so no headless menu or popover library is used anywhere.

## Considered Options

- **A headless menu library dressed in Obsidian's classes** (rejected): the popup has to wear Obsidian's `.menu` class to inherit theme chrome, which puts it in a cascade fight with the app's own `.menu` rules. `app.css` sets `.menu { position: fixed; max-height: 100% }` at specificity 0-1-0; a `:where(.zt-menu)` override sits at 0-0-0 and loses. The popup then returns to `position: fixed`, leaves the positioner's flow so the positioner measures 0px tall, and — because the positioner carries a `transform`, making it the containing block — resolves `max-height: 100%` against zero. Measured in a running Obsidian 1.14.2: a 150 × **2** px box, four entries in the DOM, `overflow: hidden` clipping every one. The library also brings a second positioning engine beside Obsidian's, its own dismissal rules, and a portal that has to be told which window it is in.
- **Winning the cascade fight** (rejected): raising the override to `.menu.zt-menu` restores the menu, and was verified to. It leaves ZotLit permanently tracking two `.menu` properties Obsidian may change in any release, and leaves the second positioning engine and portal in place.
- **Obsidian's own `Menu`** (chosen): Obsidian owns placement, viewport clamping, dismissal, theme, chrome, and the window the gesture came from. No override, no portal, no positioner, and one fewer dependency. The Annotation View already renders the same Follow Mode entries into a native `Menu` in `pane-menu.ts`, so the entries were renderer-agnostic before this change.

## Consequences

- `presentation.ts` stays the source of the entries, and the number of renderers over it drops from two to one. A menu is built where the other imperative shell work lives — `actions.tsx` for the Annotation View — and the component calls the action with its own event.
- A menu opened from a control is anchored under the control, by `lib/menu.ts`'s `showMenuAtButton`: `setParentElement(trigger)` plus a `showAtPosition` built from the trigger's rect and its own `doc`. This is what Obsidian's own `ViewHeader.onMoreOptions` does, and every member of it is public API. `showAtMouseEvent` stays for a genuine right-click, such as an Annotation Card's context menu.
- Anchoring to the element rather than the pointer is what makes a keyboard-activated control work: a click synthesised that way carries `clientX`/`clientY` of `0`, which `showAtMouseEvent` reads as the window's top-left corner. `setParentElement` also marks the trigger `has-active-menu` while the menu stands, so a theme can show it pressed.
- Passing the trigger's own `doc` puts the menu in the trigger's window; Obsidian otherwise falls back to `activeDocument`, which is the focused window rather than necessarily that one. A popout host needs no container wiring.
- A native `MenuItem` carries no tooltip, so a blocked entry states its reason in a `setIsLabel(true)` line beside it — `menus.ts` for the Follow Mode's pin, `actions.tsx` for the card's delete. See [policies/tooltips.md](../../policies/tooltips.md).
- A checked entry is `setChecked(true)`, which is the radio semantics the Follow Mode, the Attachment picker, and the colour swatches need.
- `@base-ui/react` leaves the plugin's dependencies, and `components/obsidian/menu.tsx`, its `menu.css`, and `menu-container.tsx` are removed with it. The workspace catalog keeps the entry: `apps/docs` is an ordinary web app and builds its own UI on it.
- The `zt-menu` theme hook is retired: a ZotLit menu is an Obsidian menu, which a theme reaches through `.menu`. The public theme-hooks reference drops its row in the same change.
- A rendered menu is verified by driving the real Obsidian — `packages/e2e` opens the Follow Mode menu and asserts its entries are inside the popup's own box, which is the assertion the collapsed popup failed.
