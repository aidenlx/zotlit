import { BOOTSTRAP_REASONS } from "./lib/bootstrap-reasons";
import type { BootstrapReason } from "./lib/bootstrap-reasons";
import { attachFluentToWindow } from "./lib/l10n";
import { logger, setupLogging } from "./lib/logger";
import { registerMenus } from "./menus";
import { registerNoteStatus } from "./note-status";
import type { NoteStatus } from "./note-status";
import { registerNotify } from "./notify";
import { registerPrefPane } from "./prefs";

export interface PluginData {
  id: string;
  version: string;
  rootURI: string;
}

/**
 * Subsystems are registered against `#stack` and torn down LIFO.
 *
 * Per-window state isn't modelled yet — `MenuManager` and
 * `Reader.registerEventListener` are app-global, so no current subsystem
 * needs window-scoped teardown.
 */
export class ZotLitZotero {
  readonly #data: PluginData;
  #stack: AsyncDisposableStack | null = null;
  #noteStatus: NoteStatus | null = null;

  constructor(data: PluginData) {
    this.#data = data;
  }

  async startup(reason: BootstrapReason): Promise<void> {
    const stack = new AsyncDisposableStack();
    this.#stack = stack;
    void stack.use(await setupLogging());
    // Plugin-FTL → window binding doesn't happen automatically. At
    // first-startup the main window typically isn't open yet so this loop
    // is empty and `onMainWindowLoad` handles it; on runtime
    // install/enable the window is already open and would otherwise miss
    // its FTL link until the next restart.
    for (const win of Zotero.getMainWindows()) {
      attachFluentToWindow(win);
    }
    await registerPrefPane(this.#data.id);
    stack.use(await registerMenus(this.#data.id));
    stack.use(registerNotify());
    this.#noteStatus = stack.use(await registerNoteStatus(this.#data.id));
    logger.info("startup", {
      version: this.#data.version,
      id: this.#data.id,
      reason: BOOTSTRAP_REASONS[reason],
    });
  }

  async shutdown(reason: BootstrapReason): Promise<void> {
    logger.info("shutdown", { reason: BOOTSTRAP_REASONS[reason] });
    await this.#stack?.[Symbol.asyncDispose]();
    this.#stack = null;
    this.#noteStatus = null;
  }

  onMainWindowLoad(window: Window): void {
    attachFluentToWindow(window);
    this.#noteStatus?.attachWindow(window);
  }

  onMainWindowUnload(_window: Window): void {}
}
