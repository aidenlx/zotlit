# Tailwind-first

Styling is a `zt:` utility on the element that needs it. `/obsidian-css` carries the
tokens, the native wrappers, and the `.zt-root` preflight.

- `style` carries data; the class list carries declarations. A runtime value is a `--zt-*`
  custom property a utility reads back (`zt:border-s-(--zt-annot-color)`), a finite state is
  a `data-*` attribute a `zt:data-*:` variant reads, and a state a descendant reads travels
  by `group` / `peer`.
- A stylesheet earns its load where a utility cannot reach: a descendant selector over
  DOM another owner renders, a custom property exposed for user snippets, or a rule that
  must outrank Obsidian's unlayered CSS. A comment above the block names which one.
- Those blocks live beside the code that owns them and are imported from it: a feature's
  `style.css` in `views/<view>/` or `services/<service>/`, and a shared component's own
  stylesheet in `components/` named after it — `components/chooser.css` for
  `components/chooser.tsx`. `src/zt-main.css` takes the Tailwind entry and the styles that
  belong to no single owner.
