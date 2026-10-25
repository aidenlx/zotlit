import { Effect } from "effect";
import { expect, it, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import {
  ATTACHMENT_KEY,
  localApiClient,
  NOW,
  rootOk,
  SERVER_ID,
  keyRejected,
  staleVersionPatch,
  unreachable,
  writeAccepted,
  serverChanged,
} from "./__fixtures__";
// Failure modes: wrong source or group; revoked authorization; stale object;
// out-of-order reads; closed Zotero; rejected writes; notices from a reprobe.
import { writeReadUse } from "./last-read";
import type { ZoteroLocalApi } from "./service";

// RECORDED shape: Paired Zotero on 2026-10-19 omitted lastRead before the
// first read, then returned numeric Unix seconds. Object version is set to 7
// here to keep it distinct from the response's library version.
function attachment(lastRead?: number) {
  return new Response(
    JSON.stringify({
      key: ATTACHMENT_KEY,
      version: 7,
      library: { type: "user", id: 0 },
      data: {
        key: ATTACHMENT_KEY,
        version: 7,
        itemType: "attachment",
        ...(lastRead === undefined ? {} : { lastRead }),
      },
    }),
    { headers: rootOk().headers },
  );
}

it("writes the exact read instant with the attachment object version and source precondition", async () => {
  const { service, bridge, requests, disposable } = await localApiClient(
    { item: () => attachment() },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(requests.map(({ method, url }) => [method, url.pathname])).toEqual([
    ["GET", "/api/"],
    ["GET", "/api/users/0/items/RGRPDF24"],
    ["PATCH", "/api/users/0/items/RGRPDF24"],
  ]);
  expect(JSON.parse(requests[2]!.body!)).toEqual({
    version: 7,
    lastRead: 1789573941,
  });
  expect(requests[2]!.headers.get("zotero-server-id")).toBe(SERVER_ID);
  expect(requests[2]!.headers.get("zotero-api-key")).toBe("remembered-key");
});

it.each([keyRejected, staleVersionPatch, unreachable, serverChanged])(
  "keeps a rejected read write silent",
  async (write) => {
    const { service, bridge, credentials, disposable } = await localApiClient(
      { item: () => attachment(), write: () => write() },
      { key: "remembered-key" },
    );
    await using _owned = disposable;
    await bridge.runPromise(service.probe);
    const refused = vi.fn();
    const changed = vi.fn();
    bridge.subscribe(service.writeRefusals, refused);
    bridge.subscribe(service.serverChanges, changed);
    await bridge.runPromise(
      service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
    );
    await bridge.runPromise(service.probe);
    expect(refused).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(credentials.record?.key).toBe(
      write === keyRejected ? undefined : "remembered-key",
    );
  },
);

it.each([
  {
    name: "group",
    key: `${ATTACHMENT_KEY}g42`,
    serverID: SERVER_ID,
    authorized: true,
    probe: true,
  },
  {
    name: "database-only",
    key: ATTACHMENT_KEY,
    serverID: "different-db",
    authorized: true,
    probe: true,
  },
  {
    name: "unauthorized",
    key: ATTACHMENT_KEY,
    serverID: SERVER_ID,
    authorized: false,
    probe: true,
  },
  {
    name: "unprobed",
    key: ATTACHMENT_KEY,
    serverID: SERVER_ID,
    authorized: true,
    probe: false,
  },
])(
  "skips $name without a data request or authorization dialog",
  async ({ key, serverID, authorized, probe }) => {
    const { service, bridge, requests, disposable } = await localApiClient(
      { item: () => attachment() },
      authorized ? { key: "remembered-key" } : {},
    );
    await using _owned = disposable;
    if (probe) await bridge.runPromise(service.probe);
    const count = requests.length;
    await bridge.runPromise(service.writeLastRead(key, serverID, NOW));
    expect(requests).toHaveLength(count);
  },
);

it("does not write after a source change while reading the attachment", async () => {
  const read = Promise.withResolvers<Response>();
  let serverID = SERVER_ID;
  const { service, bridge, requests, disposable } = await localApiClient(
    {
      item: () => read.promise,
      root: () => rootOk({ "Zotero-Server-ID": serverID }),
    },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  const writing = bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  serverID = "BBBBBBBBBBBB";
  await bridge.runPromise(service.probe);
  read.resolve(attachment());
  await writing;
  expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
});

it("silently adopts a source discovered by a rejected background write", async () => {
  let serverID = SERVER_ID;
  const { service, bridge, disposable } = await localApiClient(
    {
      item: () => attachment(),
      root: () => rootOk({ "Zotero-Server-ID": serverID }),
      write: () => {
        serverID = "BBBBBBBBBBBB";
        return serverChanged();
      },
    },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  const notice = vi.fn();
  bridge.subscribe(service.serverChanges, notice);
  bridge.subscribe(service.writeRefusals, notice);
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(bridge.runSync(service.state)).toMatchObject({
    kind: "available",
    source: { serverID: "BBBBBBBBBBBB" },
  });
  expect(notice).not.toHaveBeenCalled();
});

it("skips a remembered key removed since the probe before any data request", async () => {
  const { service, bridge, requests, credentials, disposable } =
    await localApiClient(
      { item: () => attachment() },
      { key: "remembered-key" },
    );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  await credentials.forget();
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(requests).toHaveLength(1);
  expect(bridge.runSync(service.state)).toMatchObject({ authorized: false });
});

it("keeps a newer Zotero read when an older Use finishes later", async () => {
  const { service, bridge, requests, disposable } = await localApiClient(
    { item: () => attachment(1789574000) },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
});

it("leaves a closed Zotero alone after an unavailable probe", async () => {
  const { service, bridge, requests, disposable } = await localApiClient(
    { root: unreachable },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(requests).toHaveLength(1);
});

it.each([null, "BBBBBBBBBBBB"])(
  "skips a database whose server identity is %s",
  async (serverID) => {
    await using bridge = openTestBridge();
    const writeLastRead = vi.fn(() => Effect.void);
    const reads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
      snapshot: Effect.succeed({
        DatabaseIdentity: () => Effect.succeed({ serverID }),
      } as never),
    });
    const api = stubService<ZoteroLocalApi["Service"]>("ZoteroLocalApi", {
      state: Effect.succeed({
        kind: "available",
        source: { kind: "zotero-local-api", serverID: SERVER_ID },
        authorized: true,
      }),
      writeLastRead,
    });
    await writeReadUse(
      { reads, bridge, api },
      { attachmentKey: ATTACHMENT_KEY, instant: NOW, serverID: SERVER_ID },
    );
    expect(writeLastRead).not.toHaveBeenCalled();
  },
);

it("contains a database failure without delaying local reading", async () => {
  await using bridge = openTestBridge();
  const writeLastRead = vi.fn(() => Effect.void);
  const reads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.die(new Error("closed database")),
  });
  const api = stubService<ZoteroLocalApi["Service"]>("ZoteroLocalApi", {
    state: Effect.succeed({
      kind: "available",
      source: { kind: "zotero-local-api", serverID: SERVER_ID },
      authorized: true,
    }),
    writeLastRead,
  });
  await expect(
    writeReadUse(
      { reads, bridge, api },
      { attachmentKey: ATTACHMENT_KEY, instant: NOW, serverID: SERVER_ID },
    ),
  ).resolves.toBeUndefined();
  expect(writeLastRead).not.toHaveBeenCalled();
});

it("keeps the newest read when two writes overlap at the same object version", async () => {
  const firstWrite = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();
  let stored = 0;
  const { service, bridge, disposable } = await localApiClient(
    {
      item: () => attachment(stored),
      write: async ({ body }) => {
        const { lastRead } = JSON.parse(body!) as { lastRead: number };
        if (lastRead === 1789573941) {
          firstStarted.resolve();
          await firstWrite.promise;
        }
        stored = lastRead;
        return writeAccepted();
      },
    },
    { key: "remembered-key" },
  );
  await using _owned = disposable;
  await bridge.runPromise(service.probe);
  const older = bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  await firstStarted.promise;
  const newer = bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW.add({ seconds: 30 })),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  firstWrite.resolve();
  await Promise.all([older, newer]);
  expect(stored).toBe(1789573971);
});

it("does not send a read after the client is disposed", async () => {
  const { service, bridge, requests, disposable } = await localApiClient(
    { item: () => attachment() },
    { key: "remembered-key" },
  );
  await bridge.runPromise(service.probe);
  await disposable[Symbol.asyncDispose]();
  await bridge.runPromise(
    service.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW),
  );
  expect(requests).toHaveLength(1);
});
