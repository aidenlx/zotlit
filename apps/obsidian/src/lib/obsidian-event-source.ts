// The event side of an Obsidian capability tag: one listener per Obsidian event
// name, all publishing into one PubSub for the source. The pattern is in
// policies/events.md.
import type { Events } from "obsidian";

import { Effect, PubSub, Stream } from "@/lib/effect";

/** An Obsidian object that emits events: the vault, the metadata cache, the workspace. */
export type ObsidianEventEmitter = Pick<Events, "on" | "offref">;

/**
 * Register `callback` for the Obsidian event `name` on `source`, for the life
 * of the current Scope: the one registration both `obsidianEventSource` and
 * `obsidianEvents` (`@/lib/effect-obsidian-events`) make.
 */
export function obsidianListener(
  source: ObsidianEventEmitter,
  name: string,
  callback: (...args: unknown[]) => void,
) {
  return Effect.acquireRelease(
    Effect.sync(() => source.on(name, callback)),
    (ref) => Effect.sync(() => source.offref(ref)),
  );
}

/**
 * The PubSub of one Obsidian source, for a capability tag's layer. Build it on
 * the layer's Scope, then `listen` once for each Obsidian event name the tag
 * exposes. Each listener maps Obsidian's arguments to one member of the tag's
 * tagged union and publishes it inside Obsidian's callback, so the order across
 * names stays. The PubSub shuts down with the Scope, which ends every
 * consumer's Stream. It does not replay.
 */
export const obsidianEventSource = Effect.fnUntraced(function* <
  Event extends { readonly _tag: string },
>() {
  const bus = yield* PubSub.unbounded<Event>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));

  /** Register one Obsidian event name; the registration lives on the Scope. */
  const listen = <Args extends unknown[]>(
    source: ObsidianEventEmitter,
    name: string,
    // Obsidian's base Events API erases event-specific argument types.
    toEvent: (...args: Args) => Event,
  ) =>
    obsidianListener(source, name, (...args) => {
      PubSub.publishUnsafe(bus, toEvent(...(args as Args)));
    });

  return {
    listen,
    /** Each event from when the consumer's Stream starts, in Obsidian's order. */
    stream: Stream.fromPubSub(bus),
  };
});
