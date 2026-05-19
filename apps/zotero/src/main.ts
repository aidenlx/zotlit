import {
  BOOTSTRAP_REASONS,
  type BootstrapReason,
} from "./lib/bootstrap-reasons";
import { logger, setupLogging } from "./lib/logger";

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

  constructor(data: PluginData) {
    this.#data = data;
  }

  async startup(reason: BootstrapReason): Promise<void> {
    const stack = new AsyncDisposableStack();
    this.#stack = stack;
    void stack.use(await setupLogging());
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
  }

  onMainWindowLoad(_window: Window): void {}

  onMainWindowUnload(_window: Window): void {}
}
