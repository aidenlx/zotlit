// Reloads a vault's whole Obsidian window, so the plugin loads the way it does
// at Obsidian startup.

import { keepRendering } from "./background-throttling.ts";
import { cli, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";

/** Global the old window holds until the reload replaces it. */
const OLD_WINDOW = "__ztWindowBeforeReload";

/**
 * Reloads `vaultId`'s window (`app:reload`) and resolves when the new window
 * has its layout ready, ZotLit loaded, and its CLI commands registered.
 *
 * Use it for bugs that only appear when the plugin loads during Obsidian
 * startup. A plugin loaded then subscribes to vault events before Obsidian's
 * metadata cache does, so its `rename` handlers run before the cache moves the
 * renamed path. A plugin reload (`plugin:reload`, the plugin toggle) subscribes
 * after the cache and hides such bugs.
 *
 * Pending ZotLit settings are flushed first, as a plugin reload does on
 * unload. The window's {@link keepRendering} hooks die with it, so they are
 * taken down before the reload and put back after it.
 */
export async function reloadWindow(vaultId: string): Promise<void> {
  await obEval(
    vaultId,
    "(app.plugins.plugins.zotlit?.services.settings.flush()??Promise.resolve()).then(()=>true)",
  );
  // The reload goes after the reply, so this call is answered by the old
  // window; the marker tells that window from the new one.
  const scheduled = await obEval(
    vaultId,
    `(()=>{window.__ztRestoreBackgroundThrottling?.();window.${OLD_WINDOW}=true;setTimeout(()=>app.commands.executeCommandById('app:reload'));return true;})()`,
  );
  if (scheduled !== "true") {
    throw new Error(`could not reload the window of ${vaultId}: ${scheduled}`);
  }
  // Mid-reload calls go unanswered or answer the old window; obEvalUntil
  // counts both as "not ready yet".
  const ready = await obEvalUntil(
    vaultId,
    `String(!window.${OLD_WINDOW}&&app.workspace.layoutReady&&app.plugins.plugins.zotlit?._loaded===true&&!!app.plugins.plugins.zotlit.services)`,
    { expected: "true", tries: 120 },
  );
  if (!ready) {
    throw new Error(
      `the window of ${vaultId} did not come back with ZotLit loaded`,
    );
  }
  // A window answers `eval` before its command registry is built.
  const commands = await waitFor(async () => {
    const state = await cli([`vault=${vaultId}`, "plugins:restrict"]).catch(
      () => "",
    );
    return state === "on" || state === "off";
  });
  if (!commands) {
    throw new Error(`the window of ${vaultId} never registered its commands`);
  }
  await keepRendering(vaultId);
}
