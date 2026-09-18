# Tailwind-first

Styling is a `zt:` utility on the element that needs it. `/obsidian-css` carries the
tokens, the native wrappers, and the `.zt-root` preflight.

- A stylesheet earns its load where a utility cannot reach: a descendant selector over
  DOM another owner renders, a custom property exposed for user snippets, or a rule that
  must outrank Obsidian's unlayered CSS. A comment above the block names which one.
- Those blocks live in the owning feature's `style.css` — `views/<view>/`,
  `services/<service>/` — imported from the code that owns them. `src/zt-main.css` takes
  the Tailwind entry and the styles that belong to no single feature.
