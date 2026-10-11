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
// Obsidian's `activeWindow` to it. Focus moves apply one at a time, in the
// order they are asked for, so the last one asked wins. A popout opens with
// `showInactive` in place of Obsidian's `show`, and `window.focus()` and
// `electronWindow.focus()` move only the emulation: each would take the OS
// focus and put the window in front. A walk that needs a new popout active calls
// its `window.focus()`. The run thus leaves the OS focus to the developer and to
// runs in other worktrees.
//
// Both settings belong to a window's `webContents` and last until Obsidian
// restarts. A popout is its own window that inherits nothing, so the vault's
// windows are covered again whenever the workspace opens one.

import { obEval } from "./obsidian-cli.ts";

/** Global the restore function lives on in the vault window between calls. */
const RESTORE = "__ztRestoreBackgroundThrottling";

/**
 * Turns background throttling off for `vaultId`'s main window and every popout
 * it has or opens, shows each popout it opens without the OS focus, and moves
 * focus emulation to the window `window.focus()` or `electronWindow.focus()`
 * last raised, starting with the main window. Calling it again replaces the
 * earlier call's hooks.
 */
export async function keepRendering(vaultId: string): Promise<void> {
  const reply = await obEval(
    vaultId,
    `(async()=>{
      window.${RESTORE}?.();
      const remote=require('@electron/remote');
      const main=remote.getCurrentWebContents();
      const vaultContents=()=>[main,...remote.webContents.getAllWebContents().filter((contents)=>contents.opener?.top?.processId===main.mainFrame.processId&&contents.opener?.top?.routingId===main.mainFrame.routingId)];
      const previous=main.getBackgroundThrottling();
      const apply=()=>{for(const contents of vaultContents())contents.setBackgroundThrottling(false);};
      let focused;
      let focusedWin;
      let switching=Promise.resolve();
      const emulateFocus=(win)=>{
        focusedWin=win;
        const run=switching.then(async()=>{
          if(win!==focusedWin)return;
          const next=win.require('@electron/remote').getCurrentWebContents();
          if(focused!==next){
            const last=focused;focused=next;
            if(last&&!last.isDestroyed())await last.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false});
            if(!next.debugger.isAttached())next.debugger.attach('1.3');
            await next.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
          }
          if(activeWindow!==win)win.dispatchEvent(new win.FocusEvent('focus'));
        });
        switching=run.catch(()=>{});
        return run;
      };
      const raised=new Map();
      const followFocus=(win)=>{
        if(raised.has(win))return;
        const focus=win.focus;const shown=win.electronWindow;raised.set(win,{focus,shown,osFocus:shown?.focus});
        win.focus=()=>void emulateFocus(win);
        if(shown)shown.focus=()=>void emulateFocus(win);
        win.document.hasFocus=()=>win===focusedWin;
      };
      const refs=[
        app.workspace.on('window-open',(_workspaceWindow,win)=>{apply();followFocus(win);const shown=win.electronWindow;if(shown)shown.show=()=>shown.showInactive();}),
        app.workspace.on('window-close',(_workspaceWindow,win)=>{raised.delete(win);if(win===focusedWin)void emulateFocus(window);}),
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
        for(const [win,{focus,shown,osFocus}] of raised){win.focus=focus;if(shown)shown.focus=osFocus;delete win.document.hasFocus;}
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
