// Test support: ZoteroReads over `:memory:` fixture databases, for the service and its consumers.
import { Effect } from "effect";

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
