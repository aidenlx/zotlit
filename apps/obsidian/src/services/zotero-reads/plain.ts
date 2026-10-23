/** Database reads for views and legacy services, on the plugin runtime. */
import { Cause, Effect, Exit, Scope, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";

import { DbUnavailable } from "./rpc";
import { ZoteroReads } from "./service";
import type {
  ZoteroReadLease,
  ZoteroReadsApi,
  ZoteroReadsEvents,
  ZoteroReadsState,
} from "./service";

export interface PlainZoteroReads extends ZoteroReadsState {
  readonly reads: ZoteroReadsApi;
  readonly snapshot: ZoteroReads["Service"]["snapshot"];
  acquireRead(): Promise<ZoteroReadLease>;
  refresh(): Promise<void>;
  notifyExternalChange(): void;
  subscribe(callback: (state: ZoteroReadsState) => void): () => void;
  on<K extends keyof ZoteroReadsEvents>(
    event: K,
    callback: ZoteroReadsEvents[K],
  ): () => void;
}

const leakedLeases = new FinalizationRegistry<() => Promise<void>>(
  (close) => void close(),
);

export function plainZoteroReads(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>,
): PlainZoteroReads {
  const service = runtime.runSync(ZoteroReads);
  const context = runtime.runSync(Effect.context<never>());
  const read = Effect.runSyncWith(context);
  const closed = () => runtime.scope.state._tag === "Closed";
  const listen = <A>(
    stream: Stream.Stream<A>,
    callback: (value: A) => void,
  ) => {
    if (closed()) return () => {};
    let active = true;
    const fiber = runtime.runFork(
      Stream.runForEach(stream, (value) =>
        Effect.sync(() => {
          if (active) callback(value);
        }),
      ),
    );
    // Attach before returning: neither state replay nor an event feed can
    // recover two changes made before a late subscription starts.
    fiber.currentDispatcher.flush();
    return () => {
      active = false;
      fiber.interruptUnsafe();
    };
  };
  return {
    get state() {
      return read(service.current).state;
    },
    get error() {
      return read(service.current).error;
    },
    get moved() {
      return read(service.current).moved;
    },
    get activeReadMode() {
      return read(service.current).activeReadMode;
    },
    reads: service.reads,
    snapshot: service.snapshot,
    acquireRead: async () => {
      if (closed())
        throw new DbUnavailable({ message: "ZoteroReads is closed" });
      const { scope, close } = openScope();
      try {
        const exit = await runtime.runPromiseExit(
          Scope.provide(service.snapshot, scope),
        );
        if (Exit.isFailure(exit)) {
          if (closed())
            throw new DbUnavailable({ message: "ZoteroReads is closed" });
          throw Cause.squash(exit.cause);
        }
        const reads = exit.value;
        const token = {};
        leakedLeases.register(reads, close, token);
        return {
          reads,
          [Symbol.asyncDispose]: () => {
            leakedLeases.unregister(token);
            return close();
          },
        };
      } catch (error) {
        await close();
        throw error;
      }
    },
    refresh: async () => {
      if (closed()) return;
      const exit = await runtime.runPromiseExit(service.refresh());
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        throw Cause.squash(exit.cause);
    },
    notifyExternalChange: () => {
      if (!closed()) runtime.runFork(service.notifyExternalChange());
    },
    subscribe: (callback) => {
      const seen = read(service.current);
      return listen(
        Stream.dropWhile(service.changes, (next) => next === seen),
        callback,
      );
    },
    on: (event, callback) =>
      listen(service.events, (change) => {
        if (change._tag !== event) return;
        switch (change._tag) {
          case "degraded":
          case "refresh-failed":
            (callback as ZoteroReadsEvents["degraded"])(change.error);
            break;
          case "refreshing":
            (callback as ZoteroReadsEvents["refreshing"])(change.active);
            break;
          default:
            (callback as () => void)();
        }
      }),
  };
}
