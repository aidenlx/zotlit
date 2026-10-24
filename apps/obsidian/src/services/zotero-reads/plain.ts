/** Database reads for views and legacy services, on the plugin runtime. */
import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import { isScopeClosed } from "@/lib/effect-scope";

import { acquireReadLease } from "./lease";
import type { DbUnavailable } from "./rpc";
import { ZoteroReads } from "./service";
import type {
  ZoteroReadLease,
  ZoteroReadsApi,
  ZoteroReadsState,
} from "./service";

export interface PlainZoteroReads extends ZoteroReadsState {
  readonly changes: Stream.Stream<ZoteroReadsState>;
  readonly "refresh-requested": Stream.Stream<void>;
  readonly changed: Stream.Stream<void>;
  readonly degraded: Stream.Stream<DbUnavailable>;
  readonly "refresh-failed": Stream.Stream<DbUnavailable>;
  readonly refreshing: Stream.Stream<boolean>;
  readonly "db-file-missing": Stream.Stream<void>;
  readonly reads: ZoteroReadsApi;
  readonly snapshot: ZoteroReads["Service"]["snapshot"];
  acquireRead(): Promise<ZoteroReadLease>;
  refresh(): Promise<void>;
  notifyExternalChange(): void;
}

export function plainZoteroReads(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>,
): PlainZoteroReads {
  const bridge = effectBridge(runtime);
  const service = runtime.runSync(ZoteroReads);
  const context = runtime.runSync(Effect.context<never>());
  const read = Effect.runSyncWith(context);
  const closed = () => isScopeClosed(runtime.scope);
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
    get dbFileMissing() {
      return read(service.current).dbFileMissing;
    },
    get activeReadMode() {
      return read(service.current).activeReadMode;
    },
    reads: service.reads,
    snapshot: service.snapshot,
    acquireRead: () => acquireReadLease(service, bridge),
    refresh: async () => {
      if (closed()) return;
      const exit = await runtime.runPromiseExit(service.refresh());
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        throw Cause.squash(exit.cause);
    },
    notifyExternalChange: () => {
      if (!closed()) runtime.runFork(service.notifyExternalChange());
    },
    changes: service.changes,
    "refresh-requested": service.events.pipe(
      Stream.filter((event) => event._tag === "refresh-requested"),
      Stream.map(() => undefined),
    ),
    changed: service.events.pipe(
      Stream.filter((event) => event._tag === "changed"),
      Stream.map(() => undefined),
    ),
    degraded: service.events.pipe(
      Stream.filter((event) => event._tag === "degraded"),
      Stream.map((event) => event.error),
    ),
    "refresh-failed": service.events.pipe(
      Stream.filter((event) => event._tag === "refresh-failed"),
      Stream.map((event) => event.error),
    ),
    refreshing: service.events.pipe(
      Stream.filter((event) => event._tag === "refreshing"),
      Stream.map((event) => event.active),
    ),
    "db-file-missing": service.events.pipe(
      Stream.filter((event) => event._tag === "db-file-missing"),
      Stream.map(() => undefined),
    ),
  };
}
