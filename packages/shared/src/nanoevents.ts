/**
 * Tiny event emitter, in-house port of `nanoevents` with added `.once` support.
 *
 * Original implementation © 2016 Andrey Sitnik <andrey@sitnik.ru>, MIT License.
 * Source: https://github.com/ai/nanoevents
 *
 */

interface EventsMap {
  [event: string]: any;
}

interface DefaultEvents extends EventsMap {
  [event: string]: (...args: any) => void;
}

export interface Unsubscribe {
  (): void;
}

export interface Emitter<Events extends EventsMap = DefaultEvents> {
  /**
   * Calls each of the listeners registered for a given event.
   *
   * @param event The event name.
   * @param args The arguments for listeners.
   */
  emit<K extends keyof Events>(
    this: this,
    event: K,
    ...args: Parameters<Events[K]>
  ): void;

  /**
   * Event names in keys and arrays with listeners in values.
   */
  events: Partial<{ [E in keyof Events]: Events[E][] }>;

  /**
   * Add a listener for a given event.
   *
   * @param event The event name.
   * @param cb The listener function.
   * @returns Unbind listener from event.
   */
  on<K extends keyof Events>(this: this, event: K, cb: Events[K]): Unsubscribe;

  /**
   * Add a listener that fires at most once for a given event. The listener is
   * removed before it is invoked, so re-entrant `emit` calls from inside the
   * listener will not re-trigger it.
   *
   * @param event The event name.
   * @param cb The listener function.
   * @returns Unbind listener from event (no-op once the listener has fired).
   */
  once<K extends keyof Events>(
    this: this,
    event: K,
    cb: Events[K],
  ): Unsubscribe;
}

/**
 * An interface for mixins that expose `on`/`once` (without the emitter bound
 * to `this`).
 */
export interface EmitterMixin<Events extends EventsMap = DefaultEvents> {
  on<K extends keyof Events>(event: K, cb: Events[K]): Unsubscribe;
  once<K extends keyof Events>(event: K, cb: Events[K]): Unsubscribe;
}

/**
 * Create event emitter.
 */
export const createNanoEvents = <
  Events extends EventsMap = DefaultEvents,
>(): Emitter<Events> => ({
  events: {},
  emit(event, ...args) {
    const callbacks = this.events[event] || [];
    for (let i = 0, length = callbacks.length; i < length; i++) {
      callbacks[i]!(...args);
    }
  },
  on(event, cb) {
    (this.events[event] ||= []).push(cb);
    return () => {
      this.events[event] = this.events[event]?.filter((i) => cb !== i);
    };
  },
  once(event, cb) {
    const wrapper = ((...args: Parameters<typeof cb>) => {
      unbind();
      (cb as (...args: Parameters<typeof cb>) => void)(...args);
    }) as typeof cb;
    const unbind = this.on(event, wrapper);
    return unbind;
  },
});
