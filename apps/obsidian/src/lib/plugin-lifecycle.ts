// A plugin that knows Obsidian has unloaded it, for an onload that a disable
// interrupts.
import { Plugin } from "obsidian";

import { getLogger } from "@/lib/log";
import { releaseKeyDescription } from "@/lib/plugin-release-key";

const logger = getLogger("plugin-lifecycle");

/**
 * How long a start-up waits for the previous instance's release. A release
 * that takes longer must not keep the plugin off until the window reloads.
 */
export const PREVIOUS_RELEASE_WAIT_MS = 10_000;

/**
 * Where an unloaded instance leaves the promise of its release. Obsidian
 * evaluates main.js anew for each load, so module state starts empty; the App
 * outlives every instance of the plugin.
 */
const releaseKey = (id: string) => Symbol.for(releaseKeyDescription(id));

/**
 * A plugin that knows when Obsidian has unloaded it.
 *
 * Obsidian runs a plugin's registered cleanups once, as it unloads. An async
 * `onload` that a disable interrupts goes on to register commands, views and
 * handlers; on a plain `Plugin` their cleanups never run, and the next
 * instance finds the names taken (#1786). Here a registration after the
 * unload runs its cleanup at once, and {@link unloaded} tells `onload` to
 * stop. Obsidian makes a new instance for each load, so the flag stays set.
 * {@link waitForPreviousAndHoldRelease} starts the next instance only once the old
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
   * all it held. It also registers this instance's own release as the first
   * entry of `stack`, so the release resolves only after every other entry
   * of `stack` has disposed; {@link unload} hands that release to the next
   * instance.
   *
   * Obsidian makes the next instance as soon as it unloads one, while the
   * old onload may still build and its runtime still close. Without the
   * wait, the old runtime removes the new instance's commands by id, takes
   * zotlit:* names before it, and holds the Live Updates port (#1786). Call it
   * first on the onload stack: the stack disposes its own entries last.
   *
   * The wait ends after {@link PREVIOUS_RELEASE_WAIT_MS} at most; a start-up
   * that goes on without the release logs a warning.
   */
  protected async waitForPreviousAndHoldRelease(
    stack: AsyncDisposableStack,
  ): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    stack.defer(resolve);
    this.#released = promise;
    const previous: unknown = Reflect.get(
      this.app,
      releaseKey(this.manifest.id),
    );
    if (!(previous instanceof Promise)) return;
    let timer: number | undefined;
    const timedOut = await Promise.race([
      previous.then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = window.setTimeout(
          () => resolveTimeout(true),
          PREVIOUS_RELEASE_WAIT_MS,
        );
      }),
    ]);
    window.clearTimeout(timer);
    if (timedOut)
      logger.warn(
        "Starting before the previous instance released what it held",
        // The timer fired, so the wait took the whole bound.
        { pluginId: this.manifest.id, elapsedMs: PREVIOUS_RELEASE_WAIT_MS },
      );
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
