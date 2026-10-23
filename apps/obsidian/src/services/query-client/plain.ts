// Held Reads for callers outside Effect, on the plugin's runtime.
import type {
  QueryClient,
  QueryFunction,
  QueryKey,
} from "@tanstack/query-core";

import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import { QueryClients } from "./service";
import type { Held, HeldReadChange, HeldReadEvents } from "./service";

export interface PlainQueryClients {
  readonly client: QueryClient;
  invalidate(key: QueryKey): void;
  update<T>(key: QueryKey, next: (held: T) => T): void;
  keysUnder(prefix: QueryKey): QueryKey[];
  peek<T>(key: QueryKey): Held<T> | null;
  ask<T>(key: QueryKey, queryFn: QueryFunction<T>): Promise<T | null>;
  read<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal?: AbortSignal,
  ): Promise<T | null>;
  readFresh<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  watch<T>(prefix: QueryKey, on: HeldReadEvents<T>): () => void;
  /** Settlements after this call, until the returned unsubscribe is called. */
  subscribe(callback: (change: HeldReadChange) => void): () => void;
}

export function plainQueryClients(
  runtime: ManagedRuntime.ManagedRuntime<QueryClients, never>,
): PlainQueryClients {
  const queries = runtime.runSync(QueryClients.use(Effect.succeed));
  // Runtime disposal interrupts callers before closing the layer. Preserve
  // the plain read contract for that release, as for a removed query.
  const runRead = <T>(effect: Effect.Effect<T, unknown>, released: () => T) =>
    runtime.runPromiseExit(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      if (exit.cause.reasons.every(Cause.isInterruptReason)) return released();
      throw Cause.squash(exit.cause);
    });
  return {
    client: queries.client,
    invalidate: (key) => runtime.runSync(queries.invalidate(key)),
    update: (key, next) => runtime.runSync(queries.update(key, next)),
    keysUnder: (prefix) => runtime.runSync(queries.keysUnder(prefix)),
    peek: (key) => runtime.runSync(queries.peek(key)),
    ask: (key, queryFn) => runRead(queries.ask(key, queryFn), () => null),
    read: (key, queryFn, signal) =>
      runRead(queries.read(key, queryFn, signal), () => null),
    readFresh: (key, queryFn, signal) =>
      runRead(queries.readFresh(key, queryFn, signal), () => {
        throw new DOMException("Held read released", "AbortError");
      }),
    watch: (prefix, on) => runtime.runSync(queries.watch(prefix, on)),
    subscribe: (callback) => {
      const seen = runtime.runSync(queries.current);
      return subscribe(
        runtime,
        Stream.dropWhile(queries.changes, (next) => next === seen),
        callback,
      );
    },
  };
}
