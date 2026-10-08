# The picker

The control that switches variants. It sits over the thing being judged, so build the spec below and leave it alone.

## Deliberately outside the design system

Never style the picker with the project's tokens, fonts or colors. One that looks native to the product becomes part of what you are looking at.

One dark neutral surface, the system font stack and no project variables. It does not follow the theme, because dark reads as chrome over both light and dark pages.

## Behavior

- It sets a `__variant` search param and reads the active variant back from it. The URL is the source of truth, so every variant is a link.
- Left and right arrows step through the variants. Number keys 1–9 jump to the first nine directly.
- `H` hides and shows the picker, for screenshots and screen recordings.
- Key handling ignores events with a modifier key, events already `defaultPrevented` and events from inputs, textareas, selects and contenteditable elements.
- The active button carries `aria-pressed="true"`, and the container carries a label.
- Switching is instant, with no transition, and keeps the scroll position.
- The active variant does not reset on resize. Never render the picker conditionally on viewport width.

## Structure

One button per variant, in the order **Name the axis before writing code** listed them.

```html
<nav class="variant-picker" aria-label="Variants">
  <button type="button" data-variant="quiet" aria-pressed="true">Quiet</button>
  <button type="button" data-variant="editorial" aria-pressed="false">Editorial</button>
  <button type="button" data-variant="dense" aria-pressed="false">Dense</button>
</nav>
```

## Placement and styling

Fixed, bottom centre, above everything the page can stack. On a narrow viewport it stays 16px from each edge and scrolls sideways, so every variant stays reachable. Arrow keys scroll the active button into view. Where the piece sits at the bottom of the viewport, move the picker to top centre and say so.

```css
.variant-picker {
  all: unset;
  position: fixed;
  bottom: max(24px, env(safe-area-inset-bottom));
  left: 50%;
  translate: -50% 0;
  z-index: 9999;
  display: flex;
  gap: 2px;
  max-width: calc(100vw - 32px);
  overflow-x: auto;
  scrollbar-width: none;
  padding: 4px;
  border-radius: 999px;
  background: rgb(20 20 20 / 0.9);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.25);
  font: 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
}

.variant-picker button {
  all: unset;
  flex: none;
  padding: 7px 14px;
  border-radius: 999px;
  font: inherit;
  color: rgb(255 255 255 / 0.6);
  cursor: pointer;
}

.variant-picker button:hover {
  color: rgb(255 255 255 / 0.85);
}

.variant-picker button[aria-pressed="true"] {
  background: rgb(255 255 255 / 0.14);
  color: rgb(255 255 255);
}

.variant-picker button:focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.7);
  outline-offset: 2px;
}
```

`all: unset` keeps the project's global button and nav styles out. In a framework, keep the class names and the structure and change only the rendering syntax.
