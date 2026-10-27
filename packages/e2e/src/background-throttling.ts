// Keeps a vault's windows rendering and focused while they are hidden,
// minimized, covered, or behind another app. Chromium throttles a background
// window: `requestAnimationFrame` never fires and `document.visibilityState`
// reads "hidden", so a plugin path that waits a frame (a Mark landing, an ink
// stroke) never finishes in a window the run does not show. Turning Electron's
// background throttling off keeps frames coming at full rate in every such
// state. Chromium also holds back focus events while another app is in front,
// so CodeMirror and the workspace never see an element take focus. CDP focus
// emulation gives one window of the vault the focus it has while the developer
// works in it: the main window first, then each window that `window.focus()`
// or Obsidian's `electronWindow.focus()` raises, as the OS does for an active
// app. Only that window answers `document.hasFocus()` with true, whichever
// window holds the OS focus, and it gets the `focus` event that moves
// Obsidian's `activeWindow` to it. When that window, or the one `activeWindow`
// names, closes, the focus goes back to the main window, as the OS gives it to
// another window of the app. A closed window cannot ask for the focus, and a
// move still applying when its window closed ends without its `focus` event.
// Turning focus emulation on in a window sends it a `focus` event of
// Chromium's own, which can reach a popout after it closed; the main window
// takes that event's place. Either event would leave `activeWindow` on the
// closed window, and Obsidian's `navigator.clipboard` and timers through
// `activeWindow` would fail from then on. Focus moves apply one at a time, in the
// order they are asked for, so the last one asked wins. A window answers true
// once its move has applied, not when it is asked for: until then Chromium
// holds back the focus events of the elements focused in it, and CodeMirror
// takes the caret the browser puts at the start of a field for the user's. A popout opens with
// `page.showBehind` in place of Obsidian's `show`, and `window.focus()` and
// `electronWindow.focus()` move only the emulation: each would take the OS
// focus and put the window in front. A walk that needs a new popout active calls
// its `window.focus()`. The run thus leaves the OS focus to the developer and to
// runs in other worktrees.
//
// Both settings belong to a window's `webContents` and last until Obsidian
// restarts. A popout is its own window that inherits nothing, so the vault's
// windows are covered again whenever the workspace opens one.
//
// Every vault window the run sets up passes through here, after each reload
// too, so this also gives the window its in-memory clipboard.

type RunWindow = Window &
  typeof globalThis & {
    electronWindow: import("electron").BrowserWindow;
  };

import { installMemoryClipboard } from "./memory-clipboard.ts";
import { obRun } from "./obsidian-cli.ts";

/**
 * Prepares the vault window `vaultId` for a run, after it opens and after each
 * reload. It installs the window's in-memory clipboard
 * ({@link installMemoryClipboard}), which stays for the life of the window. It turns
 * background throttling off for the main window and every popout it has or
 * opens, shows each popout it opens behind other apps' windows and without the
 * OS focus, and moves focus emulation to the window `window.focus()` or
 * `electronWindow.focus()` last raised, starting with the main window. Calling
 * it again replaces the earlier call's hooks.
 */
export async function prepareRunWindow(vaultId: string): Promise<void> {
  await installMemoryClipboard(vaultId);
  const reply = await obRun(vaultId, async ({ app, page }) => {
    window.__ztRestoreBackgroundThrottling?.();
    const remote =
      require("@electron/remote") as typeof import("@electron/remote");
    const main = remote.getCurrentWebContents();
    const vaultContents = () => [
      main,
      ...remote.webContents
        .getAllWebContents()
        .filter(
          (contents) =>
            contents.opener?.top?.processId === main.mainFrame.processId &&
            contents.opener?.top?.routingId === main.mainFrame.routingId,
        ),
    ];
    const previous = main.getBackgroundThrottling();
    const apply = () => {
      for (const contents of vaultContents())
        contents.setBackgroundThrottling(false);
    };
    let focused: import("electron").WebContents | undefined;
    let focusedWin: RunWindow | undefined;
    let appliedWin: RunWindow | undefined;
    let switching = Promise.resolve();
    const open = (win: RunWindow) => !win.closed && raised.has(win);
    const emulateFocus = (win: RunWindow): Promise<void> => {
      if (!open(win)) return switching;
      focusedWin = win;
      const run = switching.then(async () => {
        if (win !== focusedWin || !open(win)) return;
        const next = (
          win.require("@electron/remote") as typeof import("@electron/remote")
        ).getCurrentWebContents();
        if (focused !== next) {
          const last = focused;
          focused = next;
          appliedWin = undefined;
          if (last && !last.isDestroyed())
            await last.debugger
              .sendCommand("Emulation.setFocusEmulationEnabled", {
                enabled: false,
              })
              .catch(() => {});
          if (!open(win)) return;
          if (!next.debugger.isAttached()) next.debugger.attach("1.3");
          await next.debugger.sendCommand(
            "Emulation.setFocusEmulationEnabled",
            { enabled: true },
          );
        }
        if (!open(win)) return;
        if (activeWindow !== win)
          win.dispatchEvent(new win.FocusEvent("focus"));
        if (win === focusedWin) appliedWin = win;
      });
      switching = run.catch(() => {});
      return run;
    };
    const raised = new Map<
      RunWindow,
      {
        focus: () => void;
        shown: RunWindow["electronWindow"];
        osFocus: () => void;
        strayFocus: () => void;
      }
    >();
    const followFocus = (win: RunWindow) => {
      if (raised.has(win)) return;
      const focus = win.focus;
      const shown = (win as RunWindow).electronWindow;
      const strayFocus = () => {
        if (!raised.has(win) && activeWindow === win)
          window.dispatchEvent(new FocusEvent("focus"));
      };
      raised.set(win, { focus, shown, osFocus: shown?.focus, strayFocus });
      if (win !== window) win.addEventListener("focus", strayFocus);
      win.focus = () => void emulateFocus(win);
      if (shown) shown.focus = () => void emulateFocus(win);
      win.document.hasFocus = () => win === appliedWin;
    };
    const refs = [
      app.workspace.on("window-open", (_workspaceWindow, win) => {
        apply();
        followFocus(win as RunWindow);
        const shown = (win as RunWindow).electronWindow;
        if (shown)
          shown.show = () => {
            page.showBehind(shown);
          };
      }),
      app.workspace.on("window-close", (_workspaceWindow, win) => {
        raised.delete(win as RunWindow);
        if (win === focusedWin || win === activeWindow)
          void emulateFocus(window as RunWindow);
      }),
    ];
    apply();
    followFocus(window as RunWindow);
    app.workspace.iterateAllLeaves((leaf) =>
      followFocus(leaf.getContainer().win as RunWindow),
    );
    await emulateFocus(window as RunWindow);
    // Obsidian can request popout focus from a focus handler. Wait for the
    // last request, including requests queued while the previous one ran.
    let settled;
    do {
      settled = switching;
      await settled;
    } while (settled !== switching);
    window.__ztRestoreBackgroundThrottling = () => {
      for (const ref of refs) app.workspace.offref(ref);
      for (const [win, { focus, shown, osFocus, strayFocus }] of raised) {
        win.focus = focus;
        if (shown) shown.focus = osFocus;
        win.removeEventListener("focus", strayFocus);
        Reflect.deleteProperty(win.document, "hasFocus");
      }
      for (const contents of vaultContents()) {
        contents.setBackgroundThrottling(true);
        if (contents.debugger.isAttached()) contents.debugger.detach();
      }
      main.setBackgroundThrottling(previous);
      delete window.__ztRestoreBackgroundThrottling;
    };
    return String(
      vaultContents().every(
        (contents) => !contents.getBackgroundThrottling(),
      ) &&
        focusedWin!.document.hasFocus() &&
        activeWindow === focusedWin,
    );
  });
  if (reply !== "true") {
    throw new Error(
      `background throttling or focus emulation failed in ${vaultId}: ${reply}`,
    );
  }
}
