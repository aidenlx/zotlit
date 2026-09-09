# Tooltips

Obsidian renders an element's `aria-label` as its hover tooltip (global `pointerover` delegation) — there is no separate tooltip prop. In React/JSX, spread `tooltipAttrs(text, options)` from `@/lib/utils`; imperative DOM uses Obsidian's `setTooltip` / `Setting.setTooltip`.

Reserve `aria-label` for the controls a tooltip belongs on. A container — a region, a tab strip, a group, an editor's content — carries its accessible name on `aria-labelledby`, pointing at a heading it already shows or at a hidden element holding the name, so the name reaches assistive technology and the pointer passes over quietly.
