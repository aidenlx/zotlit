# Modal layout: pinned title and buttons, scrolling body

Obsidian ships a modal mode for a dialog whose body can outgrow the window: the title and the button row stay put and only the content scrolls. Reach for it whenever a `Modal` has a form or list of unbounded height plus action buttons.

## The pattern

Two DOM facts make it work, and both are Obsidian's own (verified in Obsidian 1.14.0):

1. `modalEl` carries `mod-scrollable-content`.
2. The buttons live in a `.modal-button-container` that is a **sibling after** `.modal-content` inside `.modal`, never inside it.

```ts
override onOpen(): void {
  this.modalEl.classList.add("mod-scrollable-content");
  this.setTitle("…");
  this.contentEl.classList.add("zt-root");
  // …fill contentEl…
  const footer = this.modalEl.createDiv({ cls: "modal-button-container" });
  new ButtonComponent(footer).setButtonText("Save").setCta();
  new ButtonComponent(footer).setButtonText("Cancel");
}
```

For a React body, render the footer's buttons through `createPortal(…, footer)` from the same root, so one tree owns both regions.

Resulting DOM, in order:

```
.modal-container
└── .modal.mod-scrollable-content        display:flex; flex-direction:column; padding:0; overflow:hidden; max-height:var(--dialog-max-height)
    ├── .modal-close-button
    ├── .modal-header > .modal-title     padding: var(--size-4-4) var(--size-4-4) 0
    ├── .modal-content                   flex:1 1 auto; overflow:auto; padding: 0 var(--size-4-4) var(--size-4-4)
    └── .modal-button-container          margin-top:0; border-top: var(--border-width) solid var(--background-modifier-border); padding: var(--size-4-4)
```

The `.modal` is a flex column capped at `--dialog-max-height` (85vh), so the body grows with its content until that cap and then scrolls; the title and footer sit outside the scroll box. The footer's rules are `.modal.mod-scrollable-content .modal-button-container`, so the class on `modalEl` is what turns the plain flex-end button row into a pinned, bordered footer.

## What to leave alone

- The footer keeps the plain button row's `justify-content: flex-end; gap: var(--size-4-2); flex-wrap: wrap`. Order the buttons as Obsidian does: the `mod-cta` action first, then Cancel. A `.mod-secondary` button is pushed to the start on desktop.
- Padding moves from `.modal` onto the title, content, and footer under this mode. Keep `contentEl` free of extra horizontal padding.
- `.modal` width stays `--dialog-width` (560px). Widen only via a scoped class on `modalEl`; a `zt:` width utility loses to Obsidian's unlayered `.modal` rule.
- `mod-scrollable-content` is unrelated to `mod-sidebar-layout` (the community-browser two-pane modal). Combine neither with the other.
