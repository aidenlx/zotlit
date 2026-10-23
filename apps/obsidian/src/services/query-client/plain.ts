// Held Reads for callers outside Effect, on the plugin's runtime.
import type {
  QueryClient,
  QueryFunction,
  QueryKey,
} from "@tanstack/query-core";

import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

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
  // ManagedRuntime cannot be reused after disposal. Its Scope closes before
  // finalizers run, so pending consumers also see the released contract.
  const closed = () => runtime.scope.state._tag === "Closed";
  const runSync = <T>(effect: Effect.Effect<T>, released: () => T): T =>
    closed() ? released() : runtime.runSync(effect);
  // Runtime disposal interrupts callers before closing the layer. Preserve
  // the plain read contract for that release, as for a removed query.
  const runRead = async <T>(
    effect: Effect.Effect<T, unknown>,
    released: () => T,
  ) => {
    if (closed()) return released();
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    if (exit.cause.reasons.every(Cause.isInterruptReason)) return released();
    throw Cause.squash(exit.cause);
  };
  return {
    client: queries.client,
    invalidate: (key) => runSync(queries.invalidate(key), () => {}),
    update: (key, next) => runSync(queries.update(key, next), () => {}),
    keysUnder: (prefix) => runSync(queries.keysUnder(prefix), () => []),
    peek: (key) => runSync(queries.peek(key), () => null),
    ask: (key, queryFn) => runRead(queries.ask(key, queryFn), () => null),
    read: (key, queryFn, signal) =>
      runRead(queries.read(key, queryFn, signal), () => null),
    readFresh: (key, queryFn, signal) =>
      runRead(queries.readFresh(key, queryFn, signal), () => {
        throw new DOMException("Held read released", "AbortError");
      }),
    watch: (prefix, on) => runSync(queries.watch(prefix, on), () => () => {}),
    subscribe: (callback) => {
      if (closed()) return () => {};
      const seen = runtime.runSync(queries.current);
      let active = true;
      const fiber = runtime.runFork(
        Stream.dropWhile(queries.changes, (next) => next === seen).pipe(
          Stream.runForEach((change) =>
            Effect.sync(() => {
              if (active) callback(change);
            }),
          ),
        ),
      );
      // interruptWhen forks the upstream subscription. Drain its startup
      // through SchedulerDispatcher.flush before a caller can change two keys;
      // SubscriptionRef's latest-value replay cannot recover a missed change.
      fiber.currentDispatcher.flush();
      return () => {
        active = false;
        fiber.interruptUnsafe();
      };
    },
  };
}
