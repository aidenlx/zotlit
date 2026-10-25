import { Hono } from "hono/tiny";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import { Stream } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import { subscribe } from "@/lib/effect-stream";

import { buildLocalServer } from "./__fixtures__";

const SOURCE_ID = "a1b2c3d4";

const companionHeaders = {
  [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
  [SOURCE_ID_HEADER]: SOURCE_ID,
};

/** Resolve the port once the listener binds one. */
async function whenListening(
  service: Awaited<ReturnType<typeof buildLocalServer>>,
): Promise<number> {
  const bound = service.runtime.runSync(service.server.effectivePort);
  if (bound !== null) return bound;
  return await new Promise<number>((resolve) => {
    const off = subscribe(
      service.runtime,
      Stream.drop(service.server.effectivePortChanges, 1),
      (port) => {
        if (port === null) return;
        off();
        resolve(port);
      },
    );
  });
}

/** Resolve once the listener has closed. */
async function whenClosed(
  service: Awaited<ReturnType<typeof buildLocalServer>>,
): Promise<void> {
  if (service.runtime.runSync(service.server.effectivePort) === null) return;
  await new Promise<void>((resolve) => {
    const off = subscribe(
      service.runtime,
      Stream.drop(service.server.effectivePortChanges, 1),
      (port) => {
        if (port !== null) return;
        off();
        resolve();
      },
    );
  });
}

it("serves without taking over the window's Request and Response", async () => {
  const nativeRequest = globalThis.Request;
  const nativeResponse = globalThis.Response;
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
    },
    stack,
  );
  const port = await whenListening(service);
  expect(port).toBeGreaterThan(0);

  // The globals are the window's own, and WebAssembly streaming brand-checks
  // the native `Response`: a swapped-in class breaks the Pandoc engine.
  expect(globalThis.Request).toBe(nativeRequest);
  expect(globalThis.Response).toBe(nativeResponse);

  const res = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ keys: ["ABCD2345"] });
});

it("keeps the listener up for the Workbench while Live updates is off", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.live-update": false,
      "server.workbench": true,
      "server.port": 0,
    },
    stack,
  );
  const port = await whenListening(service);

  expect(service.runtime.runSync(service.server.effectivePort)).toBe(port);
  // The port is open, and Live Update alone refuses.
  expect(service.runtime.runSync(service.server.available)).toBe(false);
  const refused = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(refused.status).toBe(404);

  // Turning Live updates back on answers again on the same port: the toggle
  // gates the routes, so nothing rebinds.
  service.runtime.runSync(
    service.settings.update({ "server.live-update": true }),
  );
  expect(service.runtime.runSync(service.server.available)).toBe(true);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(port);
  const answered = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(answered.status).toBe(200);
});

it("binds the next free port when the configured one is taken", async () => {
  await using holders = new AsyncDisposableStack();
  let port: number;
  // Keep every candidate in the ten-port search inside the TCP port range.
  do {
    const holder = holders.use(createServer());
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.listen(0, "127.0.0.1", resolve);
    });
    port = (holder.address() as AddressInfo).port;
  } while (port > 65535 - 9);
  await using serviceStack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": port,
    },
    serviceStack,
  );
  const bound = await whenListening(service);

  // The held port is skipped for one inside the range of ten. Which one is not
  // pinned: a parallel test worker can hold the very next port too.
  expect(bound).toBeGreaterThan(port);
  expect(bound).toBeLessThanOrEqual(port + 9);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(bound);
  const res = await fetch(`http://127.0.0.1:${bound}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("unloads cleanly when no port in the range can bind", async () => {
  const stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
      // An address this machine does not own, so every bind in the range fails.
      "server.hostname": "203.0.113.1",
    },
    stack,
  );
  const bridge = effectBridge(service.runtime);
  // Disposal waits on the bind chain: a bind attempt that never settles hangs
  // the plugin's unload instead of returning here.
  await stack.disposeAsync();

  expect(bridge.runSync(service.server.effectivePort)).toBe(null);
  expect(bridge.runSync(service.server.available)).toBe(false);
});

it("closes and reopens the listener as the server toggle changes", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
    },
    stack,
  );
  const port = await whenListening(service);

  service.runtime.runSync(service.settings.update({ "server.enabled": false }));
  await whenClosed(service);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(null);
  await expect(
    fetch(`http://127.0.0.1:${port}/literature-notes`, {
      headers: companionHeaders,
    }),
  ).rejects.toThrow();

  service.runtime.runSync(service.settings.update({ "server.enabled": true }));
  const reopenedPort = await whenListening(service);
  expect(reopenedPort).toBeGreaterThan(0);
  const res = await fetch(`http://127.0.0.1:${reopenedPort}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("answers a mounted route group beside the Live Update routes", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
    },
    stack,
  );
  // The seam #1002 mounts the Local Bridge on: the same listener, its own
  // base path, and gates of its own — the Live Update gates stay off it.
  service.runtime.runSync(
    service.server.mount(
      "/v1",
      new Hono().get("/ping", (c) => c.text("pong")),
    ),
  );
  const port = await whenListening(service);

  const mounted = await fetch(`http://127.0.0.1:${port}/v1/ping`);
  expect(mounted.status).toBe(200);
  await expect(mounted.text()).resolves.toBe("pong");

  const liveUpdate = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(liveUpdate.status).toBe(200);
});

/** POST one companion notify event, the way the Zotero plugin's sender does. */
async function notify(port: number, event: unknown): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/notify`, {
    method: "POST",
    headers: { ...companionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  return res.status;
}

const READER_ACTIVE = {
  event: "reader/active",
  itemID: 11,
  attachmentID: 22,
  selected: [33],
};

it("keeps the last reader target and flags it closed on reader/inactive", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
    },
    stack,
  );
  const port = await whenListening(service);
  const closedEdges: boolean[] = [];
  stack.defer(
    subscribe(
      service.runtime,
      Stream.drop(service.server.readerClosedChanges, 1),
      (closed) => closedEdges.push(closed),
    ),
  );

  expect(await notify(port, READER_ACTIVE)).toBe(204);
  expect(service.runtime.runSync(service.server.readerTarget)).toEqual({
    itemID: 11,
    attachmentID: 22,
    selected: [33],
  });
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(false);

  expect(await notify(port, { event: "reader/inactive" })).toBe(204);
  // The attachment stays on screen; only the presence flag moves.
  expect(service.runtime.runSync(service.server.readerTarget)).toEqual({
    itemID: 11,
    attachmentID: 22,
    selected: [33],
  });
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(true);

  // A repeat carries no new edge, and the next reader push clears the flag.
  expect(await notify(port, { event: "reader/inactive" })).toBe(204);
  expect(await notify(port, { ...READER_ACTIVE, attachmentID: 44 })).toBe(204);
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(false);
  expect(
    service.runtime.runSync(service.server.readerTarget)?.attachmentID,
  ).toBe(44);
  expect(closedEdges).toEqual([true, false]);
});

it("holds the reader target past a listener that stops answering", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
    },
    stack,
  );
  const port = await whenListening(service);
  expect(await notify(port, READER_ACTIVE)).toBe(204);

  service.runtime.runSync(
    service.settings.update({ "server.live-update": false }),
  );
  expect(service.runtime.runSync(service.server.available)).toBe(false);
  // A view following the Zotero reader keeps what it shows and says why,
  // rather than emptying because the companion cannot reach us.
  expect(
    service.runtime.runSync(service.server.readerTarget)?.attachmentID,
  ).toBe(22);
});
