// Keeps a vault's windows rendering while they are hidden, minimized, or
// covered. Chromium throttles a background window: `requestAnimationFrame`
// never fires and `document.visibilityState` reads "hidden", so a plugin path
// that waits a frame (a Mark landing, an ink stroke) never finishes in a window
// the run does not show. Turning Electron's background throttling off keeps
// frames coming at full rate in every such state.
//
// The setting belongs to each window's `webContents` and lasts until Obsidian
// restarts. A popout is its own window that inherits nothing, so the vault's
// windows are covered again whenever the workspace opens one.

import { obEval } from "./obsidian-cli.ts";

/** Global the restore function lives on in the vault window between calls. */
const RESTORE = "__ztRestoreBackgroundThrottling";

/**
 * Turns background throttling off for `vaultId`'s main window and every popout
 * it has or opens. Calling it again replaces the earlier call's hook.
 */
export async function keepRendering(vaultId: string): Promise<void> {
  const reply = await obEval(
    vaultId,
    `(()=>{window.${RESTORE}?.();const remote=require('@electron/remote');const main=remote.getCurrentWebContents();const vaultContents=()=>[main,...remote.webContents.getAllWebContents().filter((contents)=>contents.opener?.top?.processId===main.mainFrame.processId&&contents.opener?.top?.routingId===main.mainFrame.routingId)];const previous=main.getBackgroundThrottling();const apply=()=>{for(const contents of vaultContents())contents.setBackgroundThrottling(false);};const ref=app.workspace.on('window-open',apply);apply();window.${RESTORE}=()=>{app.workspace.offref(ref);for(const contents of vaultContents())contents.setBackgroundThrottling(true);main.setBackgroundThrottling(previous);delete window.${RESTORE};};return String(vaultContents().every((contents)=>!contents.getBackgroundThrottling()));})()`,
  );
  if (reply !== "true") {
    throw new Error(`background throttling stayed on in ${vaultId}: ${reply}`);
  }
}
