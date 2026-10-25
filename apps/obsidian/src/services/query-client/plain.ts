// Held Reads for callers outside Effect, on the plugin's runtime.
import type {
  QueryClient,
  QueryFunction,
  QueryKey,
} from "@tanstack/query-core";
import { Cause, Effect, Exit } from "effect";
import type { ManagedRuntime, Stream } from "effect";

import { effectBridge } from "@/lib/effect-bridge";

import { QueryClients } from "./service";
import type { Held, HeldReadChange, HeldReadEvents } from "./service";

export interface PlainQueryClients {
  readonly changes: Stream.Stream<HeldReadChange>;
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
}

export function plainQueryClients(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<QueryClients, never>,
    "runSync" | "runPromiseExit" | "runFork" | "scope"
  >,
): PlainQueryClients {
  // ManagedRuntime cannot be reused after disposal. Its Scope closes before
  // finalizers run, so pending consumers also see the released contract.
  const bridge = effectBridge(runtime);
  const queries = runtime.runSync(QueryClients.use(Effect.succeed));
  const runSync = <T>(effect: Effect.Effect<T>, released: () => T): T =>
    bridge.closed() ? released() : bridge.runSync(effect);
  // Runtime disposal interrupts callers before closing the layer. Preserve
  // the plain read contract for that release, as for a removed query. The
  // caller's signal interrupts the read's wait and rejects with its reason.
  const runRead = async <T>(
    effect: Effect.Effect<T, unknown>,
    released: () => T,
    signal?: AbortSignal,
  ) => {
    if (bridge.closed()) return released();
    const exit = await bridge.runPromiseExit(
      effect,
      signal === undefined ? undefined : { signal },
    );
    if (Exit.isSuccess(exit)) return exit.value;
    if (signal?.aborted && Cause.hasInterruptsOnly(exit.cause))
      throw signal.reason;
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
      runRead(queries.read(key, queryFn), () => null, signal),
    readFresh: (key, queryFn, signal) =>
      runRead(
        queries.readFresh(key, queryFn),
        () => {
          throw new DOMException("Held read released", "AbortError");
        },
        signal,
      ),
    watch: (prefix, on) => runSync(queries.watch(prefix, on), () => () => {}),
    changes: queries.changes,
  };
}
