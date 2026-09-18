# UI testing

Unit tests cover pure logic — data in, data out. A rendered surface is proved in
the running app, and components stay unmounted.

- Test the decision, not the drawing: store transitions, and the modules that
  answer which entries exist, which state applies, and why a control is blocked
  (`views/annot-view/presentation.ts`, `views/annot-view/card-controls.ts`). A
  rendering question moves into a module of that kind first, and that module
  takes the test.
- Prove a rendered surface — Preact tree and vanilla DOM builder alike — with
  `/obsidian-debug`: build, reload, then assert `getComputedStyle` or
  `getBoundingClientRect` in the worktree's Development Vault. The running app
  is the only place Obsidian's unlayered CSS, menus, tooltips and focus exist.
- happy-dom supplies the DOM globals a logic module needs. A mounted tree proves
  the tree the test built.
