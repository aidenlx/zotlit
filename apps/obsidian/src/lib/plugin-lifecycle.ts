// A plugin that knows Obsidian has unloaded it, for an onload that a disable
// interrupts.
import { Plugin } from "obsidian";

/**
 * A plugin that knows when Obsidian has unloaded it.
 *
 * Obsidian runs a plugin's registered cleanups once, as it unloads. An async
 * `onload` that a disable interrupts goes on to register commands, views and
 * handlers; on a plain `Plugin` their cleanups never run, and the next
 * instance finds the names taken (#1786). Here a registration after the
 * unload runs its cleanup at once, and {@link unloaded} tells `onload` to
 * stop. Obsidian makes a new instance for each load, so the flag stays set.
 */
export class UnloadAwarePlugin extends Plugin {
  #unloaded = false;

  /** Whether Obsidian has unloaded this instance. */
  protected get unloaded(): boolean {
    return this.#unloaded;
  }

  override register(...[callback]: Parameters<Plugin["register"]>): void {
    if (this.#unloaded) callback();
    else super.register(callback);
  }

  override unload(): void {
    super.unload();
    this.#unloaded = true;
  }
}
