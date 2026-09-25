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
// raises, as the OS does for an active app. The run thus leaves the OS focus to
// the developer and to runs in other worktrees.
//
// Both settings belong to a window's `webContents` and last until Obsidian
// restarts. A popout is its own window that inherits nothing, so the vault's
// windows are covered again whenever the workspace opens one.

import { obEval } from "./obsidian-cli.ts";

/** Global the restore function lives on in the vault window between calls. */
const RESTORE = "__ztRestoreBackgroundThrottling";

/**
 * Turns background throttling off for `vaultId`'s main window and every popout
 * it has or opens, and moves focus emulation to the window `window.focus()`
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
      const emulateFocus=async(win)=>{
        const next=win.require('@electron/remote').getCurrentWebContents();
        if(focused===next)return;
        const last=focused;focused=next;focusedWin=win;
        if(last&&!last.isDestroyed())await last.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false});
        if(!next.debugger.isAttached())next.debugger.attach('1.3');
        await next.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      };
      const raised=new Map();
      const followFocus=(win)=>{
        if(raised.has(win))return;
        const focus=win.focus;raised.set(win,focus);
        win.focus=function(){void emulateFocus(win);return focus.call(this);};
      };
      const refs=[
        app.workspace.on('window-open',(_workspaceWindow,win)=>{apply();followFocus(win);}),
        app.workspace.on('window-close',(_workspaceWindow,win)=>{raised.delete(win);if(win===focusedWin)void emulateFocus(window);}),
      ];
      apply();
      followFocus(window);
      app.workspace.iterateAllLeaves((leaf)=>followFocus(leaf.getContainer().win));
      await emulateFocus(window);
      window.${RESTORE}=()=>{
        for(const ref of refs)app.workspace.offref(ref);
        for(const [win,focus] of raised)win.focus=focus;
        for(const contents of vaultContents()){contents.setBackgroundThrottling(true);if(contents.debugger.isAttached())contents.debugger.detach();}
        main.setBackgroundThrottling(previous);
        delete window.${RESTORE};
      };
      return String(vaultContents().every((contents)=>!contents.getBackgroundThrottling())&&document.hasFocus());
    })()`,
  );
  if (reply !== "true") {
    throw new Error(
      `background throttling or focus emulation failed in ${vaultId}: ${reply}`,
    );
  }
}
