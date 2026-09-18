# Tailwind-first

Styling is a `zt:` utility on the element that needs it. `/obsidian-css` carries the
tokens, the native wrappers, and the `.zt-root` preflight.

- A themeable runtime value reaches its utility as a custom property, with a `data-*`
  attribute for its condition: `style={{ "--zt-annot-color": hex }}`, `data-annot-color`,
  `zt:data-annot-color:border-s-(--zt-annot-color)`. `style` keeps what no stylesheet can
  predict — a measured position, a progress width.
- A stylesheet earns its load where a utility cannot reach: a descendant selector over
  DOM another owner renders, a custom property exposed for user snippets, or a rule that
  must outrank Obsidian's unlayered CSS. A comment above the block names which one.
- Those blocks live in the owning feature's `style.css` — `views/<view>/`,
  `services/<service>/` — imported from the code that owns them. `src/zt-main.css` takes
  the Tailwind entry and the styles that belong to no single feature.
