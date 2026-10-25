// ZotLit Query for views and legacy code: the QueryService tag behind Promises.
import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";

import type { QueryViewOutcome, QueryViewRequest } from "./query-view";
import type { QueryService } from "./service";

/** {@link QueryService} for callers outside Effect. */
export interface QueryHandle {
  /**
   * Run the typed query of a Query View. An abort of `signal`, or the unload,
   * stops the query and gives `cancelled`.
   * @throws An internal error.
   */
  run(
    request: QueryViewRequest,
    signal: AbortSignal,
  ): Promise<QueryViewOutcome>;
  /**
   * The custom fields of the active Zotero source, by name; none when
   * `signal` aborts first.
   * @throws An internal error.
   */
  customFieldNames(signal: AbortSignal): Promise<readonly string[]>;
  /** `callback` runs on each Use recorded after this call. */
  on(event: "changed", callback: () => void): () => void;
  /** Typed queries of a Query View started; dev builds only, for the End-to-end Run. */
  readonly viewRuns: number;
  /** The jobs that have not settled. */
  readonly runningJobs: number;
}

export function bindQuery(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "subscribe">,
  query: QueryService["Service"],
): QueryHandle {
  return {
    run: (request, signal) =>
      bridge
        .runPromiseExit(query.run(request), { signal })
        .then((exit) => valueOr(exit, { kind: "cancelled" })),
    customFieldNames: (signal) =>
      bridge
        .runPromiseExit(query.customFieldNames, { signal })
        .then((exit) => valueOr(exit, [])),
    on: (_event, callback) => bridge.subscribe(query.changed, () => callback()),
    get viewRuns() {
      return bridge.runSync(query.viewRuns);
    },
    get runningJobs() {
      return bridge.runSync(query.runningJobs);
    },
  };
}
