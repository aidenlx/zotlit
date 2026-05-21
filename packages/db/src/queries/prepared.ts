import { type SQLitePreparedQuery } from "drizzle-orm/sqlite-core";

import { type DatabaseClient } from "@/client";

const cache = new WeakMap<
  DatabaseClient,
  Record<string, SQLitePreparedQuery<any>>
>();

export function cachedPrepared<T extends SQLitePreparedQuery<any>>(
  db: DatabaseClient,
  key: string,
  build: (db: DatabaseClient) => T,
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
