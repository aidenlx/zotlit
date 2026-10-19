import { expect, it, vi } from "vitest";

import { Effect } from "@/lib/effect";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

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
  const { client, requests } = localApiClient(
    { item: () => attachment() },
    { key: "remembered-key" },
  );
  await using _owned = client;
  await client.ready;
  await client.probe();
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
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
    const { client, credentials } = localApiClient(
      { item: () => attachment(), write: () => write() },
      { key: "remembered-key" },
    );
    await using _owned = client;
    await client.ready;
    await client.probe();
    const refused = vi.fn();
    const changed = vi.fn();
    client.on("write-refused", refused);
    client.on("server-changed", changed);
    await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
    await client.probe();
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
    const { client, requests } = localApiClient(
      { item: () => attachment() },
      authorized ? { key: "remembered-key" } : {},
    );
    await using _owned = client;
    await client.ready;
    if (probe) await client.probe();
    const count = requests.length;
    await client.writeLastRead(key, serverID, NOW);
    expect(requests).toHaveLength(count);
  },
);

it("does not write after a source change while reading the attachment", async () => {
  const read = Promise.withResolvers<Response>();
  let serverID = SERVER_ID;
  const { client, requests } = localApiClient(
    {
      item: () => read.promise,
      root: () => rootOk({ "Zotero-Server-ID": serverID }),
    },
    { key: "remembered-key" },
  );
  await using _owned = client;
  await client.ready;
  await client.probe();
  const writing = client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  serverID = "BBBBBBBBBBBB";
  await client.probe();
  read.resolve(attachment());
  await writing;
  expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
});

it("silently adopts a source discovered by a rejected background write", async () => {
  let serverID = SERVER_ID;
  const { client } = localApiClient(
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
  await using _owned = client;
  await client.ready;
  await client.probe();
  const notice = vi.fn();
  client.on("server-changed", notice);
  client.on("write-refused", notice);
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  expect(client.state).toMatchObject({
    kind: "available",
    source: { serverID: "BBBBBBBBBBBB" },
  });
  expect(notice).not.toHaveBeenCalled();
});

it("skips a remembered key removed since the probe before any data request", async () => {
  const { client, requests, credentials } = localApiClient(
    { item: () => attachment() },
    { key: "remembered-key" },
  );
  await using _owned = client;
  await client.ready;
  await client.probe();
  await credentials.forget();
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  expect(requests).toHaveLength(1);
  expect(client.state).toMatchObject({ authorized: false });
});

it("keeps a newer Zotero read when an older Use finishes later", async () => {
  const { client, requests } = localApiClient(
    { item: () => attachment(1789574000) },
    { key: "remembered-key" },
  );
  await using _owned = client;
  await client.ready;
  await client.probe();
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
});

it("leaves a closed Zotero alone after an unavailable probe", async () => {
  const { client, requests } = localApiClient(
    { root: unreachable },
    { key: "remembered-key" },
  );
  await using _owned = client;
  await client.ready;
  await client.probe();
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  expect(requests).toHaveLength(1);
});

it.each([null, "BBBBBBBBBBBB"])(
  "skips a database whose server identity is %s",
  async (serverID) => {
    const { client, requests } = localApiClient(
      { item: () => attachment() },
      { key: "remembered-key" },
    );
    await using _owned = client;
    await client.ready;
    await client.probe();
    const reads = {
      acquireRead: async () => ({
        reads: { DatabaseIdentity: () => Effect.succeed({ serverID }) },
        [Symbol.asyncDispose]: async () => {},
      }),
    } as unknown as ZoteroReadsService;
    await writeReadUse({ reads, api: client }, ATTACHMENT_KEY, NOW);
    expect(requests).toHaveLength(1);
  },
);

it("contains a database failure without delaying local reading", async () => {
  const { client, requests } = localApiClient({}, { key: "remembered-key" });
  await using _owned = client;
  await client.ready;
  await client.probe();
  const reads = {
    acquireRead: async () => {
      throw new Error("closed database");
    },
  } as unknown as ZoteroReadsService;
  await expect(
    writeReadUse({ reads, api: client }, ATTACHMENT_KEY, NOW),
  ).resolves.toBeUndefined();
  expect(requests).toHaveLength(1);
});

it("keeps the newest read when two writes overlap at the same object version", async () => {
  const firstWrite = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();
  let stored = 0;
  const { client } = localApiClient(
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
  await using _owned = client;
  await client.ready;
  await client.probe();
  const older = client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  await firstStarted.promise;
  const newer = client.writeLastRead(
    ATTACHMENT_KEY,
    SERVER_ID,
    NOW.add({ seconds: 30 }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  firstWrite.resolve();
  await Promise.all([older, newer]);
  expect(stored).toBe(1789573971);
});

it("does not send a read after the client is disposed", async () => {
  const { client, requests } = localApiClient(
    { item: () => attachment() },
    { key: "remembered-key" },
  );
  await client.ready;
  await client.probe();
  await client[Symbol.asyncDispose]();
  await client.writeLastRead(ATTACHMENT_KEY, SERVER_ID, NOW);
  expect(requests).toHaveLength(1);
});
