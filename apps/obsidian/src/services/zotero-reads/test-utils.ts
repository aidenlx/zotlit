// Test support: ZoteroReads over `:memory:` fixture databases, for the service and its consumers.
import { Effect, Stream } from "effect";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { layerRcRef } from "./connection";
import type { ConnectionOpener } from "./connection";
import type { ZoteroReadsClient } from "./in-process";
import { inProcessClient, ZoteroReadsService } from "./service";

/**
 * An opener over fresh `:memory:` fixture databases. Open #N runs `seed(N)`;
 * a `null` seed fails that open. `log` records opens and closes in order.
 */
export function memoryOpener(seed: (open: number) => string | null) {
  const log: string[] = [];
  let opened = 0;
  const open: ConnectionOpener = () => {
    const id = ++opened;
    const sql = seed(id);
    if (sql === null) throw new Error(`source #${id} is not readable`);
    const client: NodeDatabaseClient = createClient(":memory:");
    const sqlite = client.$client;
    createFixtureSchema(sqlite);
    sqlite.exec(sql);
    const close = sqlite.close.bind(sqlite);
    sqlite.close = () => {
      log.push(`close #${id}`);
      close();
    };
    log.push(`open #${id}`);
    return client;
  };
  return { open, log };
}

/**
 * An opener that serves `client` itself, for a fixture that also reads the
 * client directly. The connection leaves `client` open; its owner closes it.
 */
export function sharedClientOpener(
  client: NodeDatabaseClient,
): ConnectionOpener {
  // The connection closes `$client` on release; queries never read it.
  const shared = Object.create(client, {
    $client: { value: { close() {} } },
  }) as NodeDatabaseClient;
  return () => shared;
}

/**
 * A {@link ZoteroReadsService} on the in-process adapter over `opener`.
 * `wrap` lets a test observe or gate the client its consumers call; the
 * client opens once `opening` settles.
 */
export function inProcessReadsService(
  opener: ConnectionOpener,
  wrap: (client: ZoteroReadsClient) => ZoteroReadsClient = (client) => client,
  opening: Promise<void> = Promise.resolve(),
): ZoteroReadsService {
  return new ZoteroReadsService({
    client: Effect.andThen(
      Effect.promise(() => opening),
      Effect.map(inProcessClient(layerRcRef(opener)), wrap),
    ),
  });
}

/**
 * A reads stand-in whose `state` the test sets. Its reads run on the
 * in-process adapter over an empty `:memory:` fixture database, so a suite
 * that stubs the `@zotlit/db` queries answers through the real handlers.
 */
export function stubbedReads(): Pick<
  ZoteroReadsService,
  "ready" | "acquireRead"
> &
  AsyncDisposable & { state: ZoteroReadsService["state"] } {
  const service = inProcessReadsService(memoryOpener(() => "").open);
  return {
    state: "ready",
    get ready() {
      return service.ready;
    },
    acquireRead: () => service.acquireRead(),
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

/** One recorded call: the operation and the payload it carried. */
export interface RecordedCall {
  readonly operation: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A `wrap` for {@link inProcessReadsService} that records the payload of each
 * call to `operations` in `calls`, and each Snapshot id the client opens in
 * `snapshots`.
 */
export function recordCalls(operations: readonly (keyof ZoteroReadsClient)[]): {
  wrap: (client: ZoteroReadsClient) => ZoteroReadsClient;
  calls: RecordedCall[];
  snapshots: string[];
} {
  const calls: RecordedCall[] = [];
  const snapshots: string[] = [];
  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => {
    const wrapped: Record<string, unknown> = {
      ...client,
      Snapshot: (payload?: object, options?: object) =>
        (
          client.Snapshot as (
            payload?: object,
            options?: object,
          ) => Stream.Stream<string, unknown>
        )(payload, options).pipe(
          Stream.tap((id) => Effect.sync(() => snapshots.push(id))),
        ),
    };
    for (const operation of operations) {
      const call = client[operation] as (
        payload: object,
        options?: object,
      ) => unknown;
      wrapped[operation] = (payload: object, options?: object) => {
        calls.push({
          operation,
          payload: payload as Record<string, unknown>,
        });
        return call(payload, options);
      };
    }
    return wrapped as unknown as ZoteroReadsClient;
  };
  return { wrap, calls, snapshots };
}
