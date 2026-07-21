import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { type IndexSignature, type Library } from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { DatabaseError } from "@/services/database/service";
import { type Settings } from "@/services/settings/service";

import { readConnectionStatus } from "./connection";

const CLIENT = {} as NodeDatabaseClient;

function settingsWith(libraryID: number): Settings {
  return { "zotero.citation-library": libraryID } as Settings;
}

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
      settings: { loaded: Promise.resolve(settingsWith(1)) },
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
      settings: { loaded: Promise.resolve(settingsWith(1)) },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toEqual({ status: "missing" });
    expect(loadLibraries).not.toHaveBeenCalled();
    expect(loadIndexSignature).not.toHaveBeenCalled();
  });

  it("ready + user library → connected with library: null", async () => {
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
      settings: { loaded: Promise.resolve(settingsWith(1)) },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toEqual({
      status: "connected",
      path: "/opt/zotero-data",
      library: null,
      itemCount: 42,
    });
    expect(loadIndexSignature).toHaveBeenCalledWith(CLIENT, 1);
  });

  it("ready + group library → connected with the group's name", async () => {
    const loadLibraries = vi.fn((): Library[] => [
      { libraryID: 2, type: "group", groupID: 99, name: "Shared Library" },
    ]);
    const loadIndexSignature = vi.fn(
      (): IndexSignature => ({ count: 7, checksum: 0 }),
    );

    const result = await readConnectionStatus({
      db: {
        state: "ready",
        ready: Promise.resolve(),
        client: CLIENT,
        error: null,
      },
      zoteroPref: { dataDir: "/opt/zotero-data" },
      settings: { loaded: Promise.resolve(settingsWith(2)) },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toMatchObject({
      status: "connected",
      library: "Shared Library",
    });
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
      settings: { loaded: Promise.resolve(settingsWith(1)) },
      loadLibraries,
      loadIndexSignature,
    });

    expect(result).toMatchObject({ path: "~/Zotero" });
  });
});
