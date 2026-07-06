import { relations } from "@drizzle/relations";
import { type Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";

export interface DatabaseOptions {
  connection?: DatabaseSyncOptions;
  jit?: boolean;
  logger?: boolean | Logger;
}

export type NodeDatabaseClient = ReturnType<typeof createClient>;

export function createClient(url: string, options?: DatabaseOptions) {
  const sqlite = new DatabaseSync(url, options?.connection ?? {});
  return drizzle({
    client: sqlite,
    relations,
    jit: options?.jit,
    logger: options?.logger,
  });
}
