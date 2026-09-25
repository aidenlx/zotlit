# DevTools over CDP

`packages/scripts/scripts/obsidian-cdp.ts` (written `obsidian-cdp.ts` below) reaches Obsidian
over the Chrome DevTools Protocol: console-style `eval` with top-level `await`, any raw CDP
method, and a full DevTools URL. Its `--help` is the contract — commands, window selection,
the launch command, and main-process scope.

1. **Contract** — run `obsidian-cdp.ts --help`. Done when you know which target holds the
   state: the main process, a vault's main window, or a popout or settings window.
2. **Main process** — use `--main`. It opens the main process's inspector from a vault window,
   so the running Obsidian serves it as is. Skip to step 5.
3. **Debugging port** — windows answer only when Obsidian started with the debugging port.
   Obsidian is shared with other worktree sessions: ask the user before you quit and relaunch
   it. Done when `obsidian-cdp.ts windows` lists the windows.
4. **Target** — pick the window from the `windows` list. Done when an `eval` of
   `app.vault.adapter.basePath` (or `document.title` for a settings window) names the window
   you mean.
5. **Inspect** — `eval` for values, `send` for any other CDP domain (DOM, CSS, Network,
   Profiler, HeapProfiler, Debugger), `inspect` for a DevTools URL the user opens in Chrome.
   For snapshots, clicks, and screenshots, attach agent-browser to the same port; run
   `agent-browser skills get electron` first.
6. **Restore** — once the work is done, close every door you opened: an open inspector or
   debugging port lets any local process drive Obsidian.
   - After `--main`, close the main-process inspector:
     `packages/scripts/scripts/obsidian-cli.ts vault=<id> eval code='require("@electron/remote").require("inspector").close()||"closed"'`.
     Done when it prints `=> closed`.
   - After step 3, start Obsidian normally again. Done when `obsidian-cdp.ts windows` reports
     no endpoint.
