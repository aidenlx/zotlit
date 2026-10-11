import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { DbUnavailable } from "./rpc";
import type { ChangeEvent } from "./rpc";
import { inProcessReadsService, memoryOpener } from "./test-utils";

/** Open #N reports the user library at `version: N`, so a read shows which connection answered. */
const versioned = (open: number) => `
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', ${open}, 0);
`;

const libraryVersion = (libraries: readonly { version: number }[]) =>
  libraries[0]!.version;

describe("ZoteroReadsService", () => {
  it("answers single reads through the unbound interface", async () => {
    const { open } = memoryOpener(versioned);
    await using service = inProcessReadsService(open);
    await service.ready;

    const libraries = await Effect.runPromise(
      (await service.ready).reads.Libraries({}),
    );

    expect(libraries).toMatchObject([{ libraryID: 1, type: "user" }]);
    await expect.poll(() => service.state).toBe("ready");
    expect(service.error).toBeNull();
  });

  it("a lease reads one connection across a refresh and releases it on dispose", async () => {
    const { open, log } = memoryOpener(versioned);
    await using service = inProcessReadsService(open);
    await service.ready;

    {
      await using lease = await service.acquireRead();
      await expect.poll(() => service.state).toBe("ready");
      const changed: string[] = [];
      service.on("changed", () => changed.push("changed"));
      await service.refresh();
      await expect.poll(() => changed).toEqual(["changed"]);

      const pinned = await Effect.runPromise(lease.reads.Libraries({}));
      const current = await Effect.runPromise(
        (await service.ready).reads.Libraries({}),
      );
      expect(libraryVersion(pinned)).toBe(1);
      expect(libraryVersion(current)).toBe(2);
      expect(log).toEqual(["open #1", "open #2"]);
    }

    await expect.poll(() => log).toContain("close #1");
  });

  it("a failed refresh rejects with DbUnavailable and keeps the current connection serving", async () => {
    const { open } = memoryOpener((n) => (n === 2 ? null : versioned(n)));
    await using service = inProcessReadsService(open);
    await service.ready;
    await Effect.runPromise((await service.ready).reads.Libraries({}));
    const failures: DbUnavailable[] = [];
    service.on("refresh-failed", (error) => failures.push(error));

    await expect(service.refresh()).rejects.toBeInstanceOf(DbUnavailable);

    await expect.poll(() => failures).toHaveLength(1);
    expect(service.state).toBe("ready");
    expect(service.error).toBe(failures[0]);
    const libraries = await Effect.runPromise(
      (await service.ready).reads.Libraries({}),
    );
    expect(libraryVersion(libraries)).toBe(1);
  });

  it("a source that cannot open degrades the service and fails a lease", async () => {
    const { open } = memoryOpener(() => null);
    await using service = inProcessReadsService(open);
    await service.ready;
    const degraded: DbUnavailable[] = [];
    service.on("degraded", (error) => degraded.push(error));

    await expect(service.acquireRead()).rejects.toBeInstanceOf(DbUnavailable);

    await expect.poll(() => service.state).toBe("degraded");
    expect(degraded).toHaveLength(1);
    expect(service.error).toBeInstanceOf(DbUnavailable);
  });

  it("degrades when the change stream is lost", async () => {
    const { open } = memoryOpener(versioned);
    await using service = inProcessReadsService(open, {
      wrap: (client) => ({
        ...client,
        // The seed arrives, then the stream ends as a lost worker's would.
        Changes: ((...args: Parameters<typeof client.Changes>) =>
          Stream.take(
            client.Changes(...args) as Stream.Stream<unknown>,
            1,
          )) as typeof client.Changes,
      }),
    });
    const degraded: DbUnavailable[] = [];
    service.on("degraded", (error) => degraded.push(error));
    await service.ready;

    await expect.poll(() => service.state).toBe("degraded");
    expect(degraded).toHaveLength(1);
    expect(service.error).toBeInstanceOf(DbUnavailable);
  });

  it("names the Read Mode of the serving connection, none before one serves", async () => {
    const { open } = memoryOpener(versioned);
    let mode: "copy" | "immutable" = "copy";
    await using service = inProcessReadsService(open, {
      wrap: (client) => ({
        ...client,
        // The source reports the mode each new connection opened with.
        Changes: ((...args: Parameters<typeof client.Changes>) =>
          Stream.map(
            client.Changes(...args) as Stream.Stream<ChangeEvent, unknown>,
            (event) =>
              event._tag === "changed" ||
              (event._tag === "state" && event.state === "ready")
                ? { ...event, readMode: mode }
                : event,
          )) as typeof client.Changes,
      }),
    });
    await service.ready;
    expect(service.activeReadMode).toBeNull();

    await Effect.runPromise((await service.ready).reads.Libraries({}));
    await expect.poll(() => service.activeReadMode).toBe("copy");

    mode = "immutable";
    await service.refresh();
    await expect.poll(() => service.activeReadMode).toBe("immutable");
  });

  it("closes the connection when the service is disposed", async () => {
    const { open, log } = memoryOpener(versioned);
    const service = inProcessReadsService(open);
    await service.ready;
    await Effect.runPromise((await service.ready).reads.Libraries({}));

    await service[Symbol.asyncDispose]();

    expect(log).toEqual(["open #1", "close #1"]);
  });
});
