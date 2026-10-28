// A plugin that knows Obsidian has unloaded it, for an onload that a disable
// interrupts.
import { Plugin } from "obsidian";

/**
 * Where an unloaded instance leaves the promise of its release. Obsidian
 * evaluates main.js anew for each load, so module state starts empty; the App
 * outlives every instance of the plugin.
 */
const releaseKey = (id: string) => Symbol.for(`zotlit/obsidian/release/${id}`);

/**
 * A plugin that knows when Obsidian has unloaded it.
 *
 * Obsidian runs a plugin's registered cleanups once, as it unloads. An async
 * `onload` that a disable interrupts goes on to register commands, views and
 * handlers; on a plain `Plugin` their cleanups never run, and the next
 * instance finds the names taken (#1786). Here a registration after the
 * unload runs its cleanup at once, and {@link unloaded} tells `onload` to
 * stop. Obsidian makes a new instance for each load, so the flag stays set.
 * {@link afterPreviousInstance} starts the next instance only once the old
 * one has released all it held.
 */
export class UnloadAwarePlugin extends Plugin {
  #unloaded = false;
  #released?: Promise<void>;

  protected get unloaded(): boolean {
    return this.#unloaded;
  }

  /**
   * Wait until the instance Obsidian unloaded before this one has released
   * all it held, and release this instance as `stack` disposes.
   *
   * Obsidian makes the next instance as soon as it unloads one, while the
   * old onload may still build and its runtime still close. Without the
   * wait, the old runtime removes the new instance's commands by id, takes
   * zotlit:* names before it, and holds the Live Updates port (#1786). Call it
   * first on the onload stack: the stack disposes its own entries last.
   */
  protected async afterPreviousInstance(
    stack: AsyncDisposableStack,
  ): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    stack.defer(resolve);
    this.#released = promise;
    const previous: unknown = Reflect.get(
      this.app,
      releaseKey(this.manifest.id),
    );
    if (previous instanceof Promise) await previous;
  }

  override register(...[callback]: Parameters<Plugin["register"]>): void {
    if (this.#unloaded) callback();
    else super.register(callback);
  }

  override unload(): void {
    // Set first: a cleanup that throws ends Obsidian's unload early.
    this.#unloaded = true;
    // An instance unloaded before its start-up began leaves the previous
    // instance's release for the next one to wait for.
    if (this.#released)
      Reflect.set(this.app, releaseKey(this.manifest.id), this.#released);
    super.unload();
  }
}
