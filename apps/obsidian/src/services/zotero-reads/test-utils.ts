import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

// Test support: ZoteroReads over `:memory:` fixture databases, for the service and its consumers.
import { Effect, Layer, Stream } from "@/lib/effect";
import type { Scope } from "@/lib/effect";

import { layerRcRef } from "./connection";
import type { Connection, ConnectionOpener } from "./connection";
import type { HandlersOptions } from "./handlers";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import type { SnapshotId } from "./rpc";
import { ZoteroReadsService } from "./service";

/** The handler layer on this runtime over `connection`, for the caller's scope. */
export const inProcessClient = Effect.fnUntraced(function* (
  connection: Layer.Layer<Connection>,
  options?: HandlersOptions,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const services = yield* Layer.build(connection);
  return yield* Effect.provideContext(makeInProcessClient(options), services);
});

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

export interface InProcessReadsOptions {
  /** Lets a test observe or gate the client its consumers call. */
  wrap?: (client: ZoteroReadsClient) => ZoteroReadsClient;
  /** The client opens once this settles. */
  opening?: Promise<void>;
  /** Options for the handler layer. */
  handlers?: HandlersOptions;
}

/** A {@link ZoteroReadsService} on the in-process adapter over `opener`. */
export function inProcessReadsService(
  opener: ConnectionOpener,
  {
    wrap = (client) => client,
    opening = Promise.resolve(),
    handlers,
  }: InProcessReadsOptions = {},
): ZoteroReadsService {
  return new ZoteroReadsService({
    client: Effect.andThen(
      Effect.promise(() => opening),
      Effect.map(inProcessClient(layerRcRef(opener), handlers), wrap),
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

/**
 * `service` with `state` fixed, for a suite that tests a consumer's state
 * gate. Every other member is the service's own.
 */
export function withState<S extends ZoteroReadsService>(
  service: S,
  state: ZoteroReadsService["state"],
): S {
  return new Proxy(service, {
    get(target, property) {
      if (property === "state") return state;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
  snapshots: SnapshotId[];
} {
  const calls: RecordedCall[] = [];
  const snapshots: SnapshotId[] = [];
  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => {
    const wrapped: Record<string, unknown> = {
      ...client,
      Snapshot: (payload?: object, options?: object) =>
        (
          client.Snapshot as (
            payload?: object,
            options?: object,
          ) => Stream.Stream<SnapshotId, unknown>
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

/** A regular Item {@link seedWorksSql} writes into My Library. */
export interface SeededWork {
  readonly itemID: number;
  readonly key: string;
  /** My Library (1) when omitted; seed any other library's rows first. */
  readonly libraryID?: number;
  /** One of {@link SEEDED_ITEM_TYPES}; a journal article when omitted. */
  readonly itemType?: (typeof SEEDED_ITEM_TYPES)[number];
  readonly title?: string;
  readonly citationKey?: string;
  readonly date?: string;
  /** Authors as `[firstName, lastName]`, in order. */
  readonly creators?: readonly (readonly [string, string])[];
}

/** An Attachment {@link seedWorksSql} hangs from a seeded Item. */
export interface SeededAttachment {
  readonly itemID: number;
  readonly key: string;
  readonly parentItemID: number;
  readonly path: string | null;
  readonly linkMode: number;
}

/** The regular item types {@link seedWorksSql} declares, by type id from 1. */
const SEEDED_ITEM_TYPES = ["journalArticle", "letter", "book"] as const;
/** The item type id {@link seedWorksSql} gives Attachments. */
export const ATTACHMENT_TYPE_ID = 99;
const SEEDED_FIELD_IDS = { title: 10, citationKey: 11, date: 12 } as const;

const quoteSql = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * SQL for a fixture database (after `createFixtureSchema`) holding My Library
 * with `works` and `attachments` beneath them, for a suite that reads works
 * through ZoteroReads over seeded rows.
 */
export function seedWorksSql(
  works: readonly SeededWork[],
  attachments: readonly SeededAttachment[] = [],
): string {
  const types = SEEDED_ITEM_TYPES.map(
    (name, index) => `(${index + 1}, '${name}')`,
  ).join(", ");
  const primaries = SEEDED_ITEM_TYPES.map(
    (_, index) => `(${index + 1}, 1, 1)`,
  ).join(", ");
  return [
    "insert into libraries (libraryID, type) values (1, 'user');",
    `insert into itemTypes (itemTypeID, typeName) values ${types}, (${ATTACHMENT_TYPE_ID}, 'attachment');`,
    "insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0), (11, 'citationKey', 0), (12, 'date', 0);",
    "insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');",
    `insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField) values ${primaries};`,
    worksSql(works, attachments),
  ].join("\n");
}

/**
 * SQL that adds `works` and `attachments` to a database {@link seedWorksSql}
 * seeded. Row ids derive from each Item's id, so works added apart never clash.
 */
export function worksSql(
  works: readonly SeededWork[],
  attachments: readonly SeededAttachment[] = [],
): string {
  const stamp = "'2024-01-01 00:00:00'";
  const sql: string[] = [];
  for (const work of works) {
    const typeID =
      SEEDED_ITEM_TYPES.indexOf(work.itemType ?? "journalArticle") + 1;
    sql.push(
      `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${work.itemID}, ${typeID}, ${stamp}, ${stamp}, ${work.libraryID ?? 1}, ${quoteSql(work.key)});`,
    );
    for (const field of ["title", "citationKey", "date"] as const) {
      const value = work[field];
      if (value === undefined) continue;
      const valueID = work.itemID * 10 + SEEDED_FIELD_IDS[field] - 10;
      sql.push(
        `insert into itemDataValues (valueID, value) values (${valueID}, ${quoteSql(value)});`,
        `insert into itemData (itemID, fieldID, valueID) values (${work.itemID}, ${SEEDED_FIELD_IDS[field]}, ${valueID});`,
      );
    }
    for (const [index, [firstName, lastName]] of (
      work.creators ?? []
    ).entries()) {
      const creatorID = work.itemID * 10 + index;
      sql.push(
        `insert into creators (creatorID, firstName, lastName, fieldMode) values (${creatorID}, ${quoteSql(firstName)}, ${quoteSql(lastName)}, 0);`,
        `insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (${work.itemID}, ${creatorID}, 1, ${index});`,
      );
    }
  }
  for (const attachment of attachments) {
    sql.push(
      `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${attachment.itemID}, ${ATTACHMENT_TYPE_ID}, ${stamp}, ${stamp}, 1, ${quoteSql(attachment.key)});`,
      `insert into itemAttachments (itemID, parentItemID, linkMode, path) values (${attachment.itemID}, ${attachment.parentItemID}, ${attachment.linkMode}, ${attachment.path === null ? "null" : quoteSql(attachment.path)});`,
    );
  }
  return sql.join("\n");
}

/** SQL that removes every work and attachment {@link worksSql} added. */
export const CLEAR_WORKS_SQL = `
  delete from itemAttachments;
  delete from itemCreators;
  delete from creators;
  delete from itemData;
  delete from itemDataValues;
  delete from items;
`;

/**
 * SQL for a fixture database whose user library holds one journal article per
 * key: "A study of nothing" (2020) by Ann Zeta, account user 1. Every key
 * names the same work, for a suite that cites works by Indexed Key.
 */
export function citedWorkSeed(keys: readonly string[]): string {
  const items = keys
    .map(
      (key, i) =>
        `(${i + 1}, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${key}')`,
    )
    .join(", ");
  const data = keys
    .map((_, i) => `(${i + 1}, 10, 1), (${i + 1}, 12, 2)`)
    .join(", ");
  const creators = keys.map((_, i) => `(${i + 1}, 1, 1, 0)`).join(", ");
  return `
    insert into libraries (libraryID, type, version, clientVersion)
      values (1, 'user', 1, 1);
    insert into settings (setting, key, value) values ('account', 'userID', 1);
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (12, 'date', 0);
    insert into itemDataValues (valueID, value)
      values (1, 'A study of nothing'), (2, '2020');
    insert into creators (creatorID, firstName, lastName, fieldMode)
      values (1, 'Ann', 'Zeta', 0);
    insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
    insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
      values (1, 1, 1);
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values ${items};
    insert into itemData (itemID, fieldID, valueID) values ${data};
    insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
      values ${creators};
  `;
}
