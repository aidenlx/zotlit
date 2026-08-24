import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { IndexSignature, Library } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { DatabaseError } from "@/services/database/service";

import { readConnectionStatus } from "./connection";

const CLIENT = {} as NodeDatabaseClient;

describe("readConnectionStatus", () => {
  it("db not ready → missing, without touching the injected queries", async () => {
    const loadLibraries = vi.fn(() => {
      throw new Error("must not be called");
    });
    const loadIndexSignature = vi.fn(() => {
      throw new Error("must not be called");
    });

    const result = await readConnectionStatus({
      db: {
        state: "degraded",
        ready: Promise.resolve(),
        client: CLIENT,
        error: null,
      },
      zoteroPref: { dataDir: "/opt/zotero-data" },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toEqual({ status: "missing" });
    expect(loadLibraries).not.toHaveBeenCalled();
    expect(loadIndexSignature).not.toHaveBeenCalled();
  });

  it("ready but last refresh failed → missing, without touching the queries", async () => {
    const loadLibraries = vi.fn(() => {
      throw new Error("must not be called");
    });
    const loadIndexSignature = vi.fn(() => {
      throw new Error("must not be called");
    });

    const result = await readConnectionStatus({
      db: {
        state: "ready",
        ready: Promise.resolve(),
        client: CLIENT,
        error: new DatabaseError("refresh-failed"),
      },
      zoteroPref: { dataDir: "/opt/zotero-data" },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toEqual({ status: "missing" });
    expect(loadLibraries).not.toHaveBeenCalled();
    expect(loadIndexSignature).not.toHaveBeenCalled();
  });

  it("ready → connected with the item count of the one library", async () => {
    const loadLibraries = vi.fn((): Library[] => [
      { libraryID: 1, type: "user", groupID: null, name: null },
    ]);
    const loadIndexSignature = vi.fn(
      (): IndexSignature => ({ count: 42, checksum: 0 }),
    );

    const result = await readConnectionStatus({
      db: {
        state: "ready",
        ready: Promise.resolve(),
        client: CLIENT,
        error: null,
      },
      zoteroPref: { dataDir: "/opt/zotero-data" },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toEqual({
      status: "connected",
      path: "/opt/zotero-data",
      itemCount: 42,
    });
    expect(loadIndexSignature).toHaveBeenCalledWith(CLIENT, 1);
  });

  it("totals every library the database holds, whatever the library scope is", async () => {
    const loadLibraries = vi.fn((): Library[] => [
      { libraryID: 1, type: "user", groupID: null, name: null },
      { libraryID: 2, type: "group", groupID: 99, name: "Shared Library" },
      { libraryID: 3, type: "group", groupID: 100, name: "Reading Group" },
    ]);
    const counts = new Map([
      [1, 42],
      [2, 7],
      [3, 3],
    ]);
    const loadIndexSignature = vi.fn(
      (_client: NodeDatabaseClient, libraryID: number): IndexSignature => ({
        count: counts.get(libraryID) ?? 0,
        checksum: 0,
      }),
    );

    const result = await readConnectionStatus({
      db: {
        state: "ready",
        ready: Promise.resolve(),
        client: CLIENT,
        error: null,
      },
      zoteroPref: { dataDir: "/opt/zotero-data" },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toMatchObject({ status: "connected", itemCount: 52 });
  });

  it("abbreviates a data dir under the home directory to ~", async () => {
    const loadLibraries = vi.fn((): Library[] => []);
    const loadIndexSignature = vi.fn(
      (): IndexSignature => ({ count: 0, checksum: 0 }),
    );

    const result = await readConnectionStatus({
      db: {
        state: "ready",
        ready: Promise.resolve(),
        client: CLIENT,
        error: null,
      },
      zoteroPref: { dataDir: join(homedir(), "Zotero") },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toMatchObject({ path: "~/Zotero", itemCount: 0 });
  });
});
