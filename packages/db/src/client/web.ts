import { relations } from "@drizzle/relations";
import { type Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { type ClientConfig, type DatabasePath } from "sqlocal";
import { SQLocalDrizzle } from "sqlocal/drizzle";

export interface DatabaseOptions {
  connection?: Omit<ClientConfig, "databasePath">;
  jit?: boolean;
  logger?: boolean | Logger;
}

type DatabaseClient = ReturnType<typeof _createClient>["db"];

function _createClient(databasePath: DatabasePath, options?: DatabaseOptions) {
  const sqlocal = new SQLocalDrizzle({ databasePath, ...options?.connection });
  const db = drizzle(sqlocal.driver, sqlocal.batchDriver, {
    relations,
    jit: options?.jit,
    logger: options?.logger,
  });
  return { db, sqlocal };
}

export type SQLocalDatabaseClient = DatabaseClient & {
  $client: SQLocalDrizzle;
};

export function createClient(
  databasePath: DatabasePath,
  options?: DatabaseOptions,
): SQLocalDatabaseClient {
  const { db, sqlocal } = _createClient(databasePath, options);
  (db as SQLocalDatabaseClient).$client = sqlocal;
  return db as SQLocalDatabaseClient;
}
