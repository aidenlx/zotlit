import { type SQLitePreparedQuery } from "drizzle-orm/sqlite-core";

import { type NodeDatabaseClient } from "@/client/node";

const cache = new WeakMap<
  NodeDatabaseClient,
  Record<string, SQLitePreparedQuery<any>>
>();

export function cachedPrepared<T extends SQLitePreparedQuery<any>>(
  db: NodeDatabaseClient,
  key: string,
  build: (db: NodeDatabaseClient) => T,
): T {
  let dbCache = cache.get(db);
  if (!dbCache) {
    dbCache = {};
    cache.set(db, dbCache);
  }
  const cached = dbCache[key];
  if (cached) return cached as T;
  const stmt = build(db);
  dbCache[key] = stmt;
  return stmt;
}
