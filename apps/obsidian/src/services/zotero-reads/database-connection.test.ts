import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { DatabaseError } from "@/services/database/service";
import type { DatabaseEvents } from "@/services/database/service";

import { layerDatabaseService } from "./database-connection";
import type { DatabaseConnectionSource } from "./database-connection";
import { DbUnavailable } from "./rpc";
import { inProcessClient, ZoteroReadsService } from "./service";

/**
 * A DatabaseService stand-in over one fixture client that counts open leases.
 * Its refresh keeps the DatabaseService rule: a failure throws only when no
 * client serves, and otherwise lands in `error`.
 */
class FakeDatabase implements DatabaseConnectionSource, Disposable {
  readonly emitter = createNanoEvents<DatabaseEvents>();
  readonly client: NodeDatabaseClient;
  state: "loading" | "ready" | "degraded" = "ready";
  error: DatabaseError | null = null;
  leases = 0;
  refreshes = 0;
  pushes = 0;
  refreshError: DatabaseError | null = null;
  ready: Promise<void> = Promise.resolve();

  constructor() {
    this.client = createClient(":memory:");
    createFixtureSchema(this.client.$client);
    this.client.$client.exec(`
      insert into libraries (libraryID, type, version, clientVersion)
        values (1, 'user', 1, 0);
    `);
  }

  on<K extends keyof DatabaseEvents>(event: K, cb: DatabaseEvents[K]) {
    return this.emitter.on(event, cb);
  }

  async acquireRead() {
    if (this.state === "degraded") {
      throw new DatabaseError("degraded", this.error);
    }
    this.leases += 1;
    let released = false;
    return {
      client: this.client,
      [Symbol.dispose]: () => {
        if (released) return;
        released = true;
        this.leases -= 1;
      },
    };
  }

  async refresh() {
    this.refreshes += 1;
    if (!this.refreshError) {
      this.error = null;
      return;
    }
    if (this.state === "degraded") {
      throw new DatabaseError("degraded", this.refreshError);
    }
    this.error = this.refreshError;
  }

  [Symbol.dispose]() {
    this.client.$client.close();
  }

  notifyExternalChange() {
    this.pushes += 1;
  }
}

function serviceOver(db: FakeDatabase) {
  return new ZoteroReadsService({
    client: inProcessClient(layerDatabaseService(db)),
  });
}

describe("layerDatabaseService", () => {
  it("reads under a DatabaseService lease and releases it after the read", async () => {
    const db = new FakeDatabase();
    await using service = serviceOver(db);
    await service.ready;

    const libraries = await Effect.runPromise(
      (await service.ready).reads.Libraries({}),
    );

    expect(libraries).toMatchObject([{ libraryID: 1 }]);
    expect(db.leases).toBe(0);
  });

  it("a Snapshot holds one DatabaseService lease until it ends", async () => {
    const db = new FakeDatabase();
    await using service = serviceOver(db);
    await service.ready;

    {
      using lease = await service.acquireRead();
      await Effect.runPromise(lease.reads.Libraries({}));
      expect(db.leases).toBe(1);
    }

    await expect.poll(() => db.leases).toBe(0);
  });

  it("starts from the DatabaseService state and relays its events", async () => {
    const db = new FakeDatabase();
    db.error = new DatabaseError(
      "refresh-failed",
      new Error("database is locked"),
    );
    await using service = serviceOver(db);
    await service.ready;
    expect(service.state).toBe("ready");
    expect(service.error?.message).toBe("database is locked");

    const seen: string[] = [];
    service.on("changed", () => seen.push("changed"));
    service.on("refreshing", (active) => seen.push(`refreshing ${active}`));
    service.on("refresh-failed", (error) =>
      seen.push(`refresh-failed ${error.message}`),
    );
    service.on("db-file-missing", () => seen.push("db-file-missing"));
    service.on("degraded", (error) => seen.push(`degraded ${error.message}`));

    db.emitter.emit("refreshing", true);
    db.emitter.emit(
      "refresh-failed",
      new DatabaseError("refresh-failed", new Error("no such file")),
    );
    db.emitter.emit("db-file-missing");
    db.emitter.emit("refreshing", false);
    db.emitter.emit("changed");
    db.emitter.emit(
      "degraded",
      new DatabaseError("degraded", new Error("not a database")),
    );

    await expect
      .poll(() => seen)
      .toEqual([
        "refreshing true",
        "refresh-failed no such file",
        "db-file-missing",
        "refreshing false",
        "changed",
        "degraded not a database",
      ]);
    expect(service.state).toBe("degraded");
  });

  it("relays events the DatabaseService raises during its first open", async () => {
    const db = new FakeDatabase();
    const opening = Promise.withResolvers<void>();
    db.ready = opening.promise;
    db.state = "loading";
    await using service = serviceOver(db);
    await service.ready;
    const seen: string[] = [];
    service.on("db-file-missing", () => seen.push("db-file-missing"));
    service.on("changed", () => seen.push("changed"));

    db.emitter.emit("db-file-missing");
    db.state = "ready";
    db.emitter.emit("changed");
    opening.resolve();

    await expect.poll(() => seen).toEqual(["db-file-missing", "changed"]);
    expect(service.state).toBe("ready");
  });

  it("forwards refresh and external change signals to the DatabaseService", async () => {
    const db = new FakeDatabase();
    await using service = serviceOver(db);
    await service.ready;

    await service.refresh();
    service.notifyExternalChange();
    await expect.poll(() => db.pushes).toBe(1);
    expect(db.refreshes).toBe(1);
  });

  it("rejects a refresh that fails, also when the previous client keeps serving", async () => {
    using db = new FakeDatabase();
    await using service = serviceOver(db);
    await service.ready;
    db.refreshError = new DatabaseError(
      "refresh-failed",
      new Error("database is locked"),
    );

    await expect(service.refresh()).rejects.toMatchObject({
      _tag: "DbUnavailable",
      message: "database is locked",
    });

    db.state = "degraded";
    await expect(service.refresh()).rejects.toBeInstanceOf(DbUnavailable);
  });
});
