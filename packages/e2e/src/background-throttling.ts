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
// {@link showBehind} in place of Obsidian's `show`, and `window.focus()` and
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

import { MEMORY_CLIPBOARD } from "./memory-clipboard.ts";
import { obEval } from "./obsidian-cli.ts";

/**
 * Eval code that shows the Electron window `win` names and leaves the OS focus
 * and the developer's windows alone. `showInactive` keeps the focus but puts the
 * window in front of every other app's windows on macOS; `blur` there orders it
 * behind them. A minimized window comes back from the Dock in front for the
 * length of the animation, so it stays transparent until it is restored and
 * ordered back. Restore a minimized window with this, not `restore()`.
 * `prepareRunWindow` keeps a covered window rendering.
 */
export const showBehind = (win: string): string =>
  `((w)=>{if(process.platform!=='darwin'){w.showInactive();return;}if(!w.isMinimized()){w.showInactive();w.blur();return;}const opacity=w.getOpacity();w.setOpacity(0);w.once('restore',()=>{w.blur();setTimeout(()=>w.setOpacity(opacity),100);});w.showInactive();})(${win});`;

/** Global the restore function lives on in the vault window between calls. */
const RESTORE = "__ztRestoreBackgroundThrottling";

/**
 * Prepares the vault window `vaultId` for a run, after it opens and after each
 * reload. It installs the window's in-memory clipboard
 * ({@link MEMORY_CLIPBOARD}), which stays for the life of the window. It turns
 * background throttling off for the main window and every popout it has or
 * opens, shows each popout it opens behind other apps' windows and without the
 * OS focus, and moves focus emulation to the window `window.focus()` or
 * `electronWindow.focus()` last raised, starting with the main window. Calling
 * it again replaces the earlier call's hooks.
 */
export async function prepareRunWindow(vaultId: string): Promise<void> {
  const reply = await obEval(
    vaultId,
    `(async()=>{
      ${MEMORY_CLIPBOARD};
      window.${RESTORE}?.();
      const remote=require('@electron/remote');
      const main=remote.getCurrentWebContents();
      const vaultContents=()=>[main,...remote.webContents.getAllWebContents().filter((contents)=>contents.opener?.top?.processId===main.mainFrame.processId&&contents.opener?.top?.routingId===main.mainFrame.routingId)];
      const previous=main.getBackgroundThrottling();
      const apply=()=>{for(const contents of vaultContents())contents.setBackgroundThrottling(false);};
      let focused;
      let focusedWin;
      let appliedWin;
      let switching=Promise.resolve();
      const open=(win)=>!win.closed&&raised.has(win);
      const emulateFocus=(win)=>{
        if(!open(win))return switching;
        focusedWin=win;
        const run=switching.then(async()=>{
          if(win!==focusedWin||!open(win))return;
          const next=win.require('@electron/remote').getCurrentWebContents();
          if(focused!==next){
            const last=focused;focused=next;
            appliedWin=undefined;
            if(last&&!last.isDestroyed())await last.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
            if(!open(win))return;
            if(!next.debugger.isAttached())next.debugger.attach('1.3');
            await next.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
          }
          if(!open(win))return;
          if(activeWindow!==win)win.dispatchEvent(new win.FocusEvent('focus'));
          if(win===focusedWin)appliedWin=win;
        });
        switching=run.catch(()=>{});
        return run;
      };
      const raised=new Map();
      const followFocus=(win)=>{
        if(raised.has(win))return;
        const focus=win.focus;const shown=win.electronWindow;
        const strayFocus=()=>{if(!raised.has(win)&&activeWindow===win)window.dispatchEvent(new FocusEvent('focus'));};
        raised.set(win,{focus,shown,osFocus:shown?.focus,strayFocus});
        if(win!==window)win.addEventListener('focus',strayFocus);
        win.focus=()=>void emulateFocus(win);
        if(shown)shown.focus=()=>void emulateFocus(win);
        win.document.hasFocus=()=>win===appliedWin;
      };
      const refs=[
        app.workspace.on('window-open',(_workspaceWindow,win)=>{apply();followFocus(win);const shown=win.electronWindow;if(shown)shown.show=()=>{${showBehind("shown")}};}),
        app.workspace.on('window-close',(_workspaceWindow,win)=>{raised.delete(win);if(win===focusedWin||win===activeWindow)void emulateFocus(window);}),
      ];
      apply();
      followFocus(window);
      app.workspace.iterateAllLeaves((leaf)=>followFocus(leaf.getContainer().win));
      await emulateFocus(window);
      // Obsidian can request popout focus from a focus handler. Wait for the
      // last request, including requests queued while the previous one ran.
      let settled;
      do{settled=switching;await settled;}while(settled!==switching);
      window.${RESTORE}=()=>{
        for(const ref of refs)app.workspace.offref(ref);
        for(const [win,{focus,shown,osFocus,strayFocus}] of raised){win.focus=focus;if(shown)shown.focus=osFocus;win.removeEventListener('focus',strayFocus);delete win.document.hasFocus;}
        for(const contents of vaultContents()){contents.setBackgroundThrottling(true);if(contents.debugger.isAttached())contents.debugger.detach();}
        main.setBackgroundThrottling(previous);
        delete window.${RESTORE};
      };
      return String(vaultContents().every((contents)=>!contents.getBackgroundThrottling())&&focusedWin.document.hasFocus()&&activeWindow===focusedWin);
    })()`,
  );
  if (reply !== "true") {
    throw new Error(
      `background throttling or focus emulation failed in ${vaultId}: ${reply}`,
    );
  }
}
