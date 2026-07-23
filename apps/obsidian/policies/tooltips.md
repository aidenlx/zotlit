# Tooltips

Obsidian renders an element's `aria-label` as its hover tooltip (global `pointerover` delegation) — there is no separate tooltip prop. In React/JSX, spread `tooltipAttrs(text, options)` from `@/lib/utils`; imperative DOM uses Obsidian's `setTooltip` / `Setting.setTooltip`.
