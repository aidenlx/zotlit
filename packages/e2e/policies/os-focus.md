# OS focus

The End-to-end Run leaves the OS focus where it is: the developer and runs in other worktrees use the same desktop in parallel. Focus inside a vault is CDP focus emulation, owned by `keepRendering` (`src/background-throttling.ts`).

- Open a vault through `vaultScript` (`src/vault-script.ts`), which passes `--inactive` to `obsidian-vault.ts`.
- Show a window with `showInactive`; `raiseWindow` (`src/reader-gestures.ts`) brings back a hidden or minimized one. Keep window-activating calls — `BrowserWindow.show()` / `focus()` / `moveTop()`, `app.focus()` — out of the suite and its helpers.
- Move focus between a vault's windows through the calls `keepRendering` hooks (`window.focus()`, `electronWindow.focus()`); a hook moves only the emulation.
- Read the focused window from Obsidian's `activeWindow` / `activeDocument`: a modal opens there, which can be a popout rather than the main `document`.
