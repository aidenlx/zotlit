# Theme hooks

- Declare public theme hooks in the shared registry; name stable semantic roles and states with the `zt-` prefix.
- Reuse one hook across Source mode, Live Preview, and Reading view when its meaning is the same. Promise class meaning and activation; keep DOM shape and native classes private.
- Use low-specificity defaults backed by Obsidian variables, so direct theme selectors override them without `!important`.
- Add literal-name contract tests for every promised surface, and update the public theme-hooks reference in the same change.
