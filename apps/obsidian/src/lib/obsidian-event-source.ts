// The event side of an Obsidian capability tag: one listener per Obsidian event
// name, all publishing into one PubSub for the source.
import type { Events } from "obsidian";

import { Effect, PubSub, Stream } from "@/lib/effect";

/** An Obsidian object that emits events: the vault, the metadata cache, the workspace. */
export type ObsidianEventEmitter = Pick<Events, "on" | "offref">;

/**
 * The PubSub of one Obsidian source, for a capability tag's layer
 * (`MetadataCache`, `Vault`, `Workspace`). Build it on the layer's Scope, then
 * `listen` once for each Obsidian event name the tag exposes. Each listener
 * maps Obsidian's arguments to one member of the tag's tagged union and
 * publishes it at once, inside Obsidian's callback, so the order across event
 * names stays as Obsidian emitted them. The listener is removed when the Scope
 * closes; the PubSub shuts down with it, which ends every consumer's Stream.
 *
 * Consumers read `stream`, narrow it with `filterTag`, and handle it with
 * `forkEach` (both `@/lib/effect-stream`): a consumer started on its layer's
 * Scope attaches before that layer returns. The PubSub does not replay.
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
    toEvent: (...args: Args) => Event,
  ) =>
    Effect.acquireRelease(
      // Obsidian's base Events API erases event-specific argument types.
      Effect.sync(() =>
        source.on(name, (...args: unknown[]) => {
          PubSub.publishUnsafe(bus, toEvent(...(args as Args)));
        }),
      ),
      (ref) => Effect.sync(() => source.offref(ref)),
    );

  return {
    listen,
    /** Each event from when the consumer's Stream starts, in Obsidian's order. */
    stream: Stream.fromPubSub(bus),
  };
});
