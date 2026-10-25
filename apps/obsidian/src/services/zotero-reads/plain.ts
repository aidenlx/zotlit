/** Database reads for views and legacy services, on the plugin runtime. */
import type { ManagedRuntime, Stream } from "@/lib/effect";
import { effectBridge, valueOr } from "@/lib/effect-bridge";

import {
  changed,
  dbFileMissing,
  degraded,
  refreshFailed,
  refreshing,
  refreshRequested,
} from "./events";
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
  return {
    get state() {
      return bridge.runSync(service.current).state;
    },
    get error() {
      return bridge.runSync(service.current).error;
    },
    get moved() {
      return bridge.runSync(service.current).moved;
    },
    get dbFileMissing() {
      return bridge.runSync(service.current).dbFileMissing;
    },
    get activeReadMode() {
      return bridge.runSync(service.current).activeReadMode;
    },
    reads: service.reads,
    snapshot: service.snapshot,
    acquireRead: () => acquireReadLease(service, bridge),
    refresh: async () => {
      if (bridge.closed()) return;
      valueOr(await bridge.runPromiseExit(service.refresh()), undefined);
    },
    notifyExternalChange: () => {
      if (!bridge.closed()) runtime.runFork(service.notifyExternalChange());
    },
    changes: service.changes,
    "refresh-requested": refreshRequested(service),
    changed: changed(service),
    degraded: degraded(service),
    "refresh-failed": refreshFailed(service),
    refreshing: refreshing(service),
    "db-file-missing": dbFileMissing(service),
  };
}
