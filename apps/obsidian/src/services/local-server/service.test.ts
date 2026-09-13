import { Hono } from "hono/tiny";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import { defaults } from "@/services/settings/schema";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { LocalServerService } from "./service";
import type { LocalServerServiceDeps } from "./service";

const SOURCE_ID = "a1b2c3d4";

const companionHeaders = {
  [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
  [SOURCE_ID_HEADER]: SOURCE_ID,
};

interface SettingsStub {
  service: SettingsService;
  /** Push a settings change the way the settings tab's toggles do. */
  update(patch: Partial<Settings>): void;
}

function makeSettings(overrides: Partial<Settings>): SettingsStub {
  let current: Readonly<Settings> = { ...defaults, ...overrides };
  const subscribers = new Set<(value: Readonly<Settings>) => void>();
  return {
    service: {
      loaded: Promise.resolve(current),
      subscribe: (cb: (value: Readonly<Settings>) => void) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    } as unknown as SettingsService,
    update(patch) {
      current = { ...current, ...patch };
      for (const cb of subscribers) cb(current);
    },
  };
}

function makeDeps(settings: SettingsService): LocalServerServiceDeps {
  return {
    settings,
    zoteroPref: { sourceId: SOURCE_ID } as unknown as ZoteroPrefService,
    noteIndex: {
      whenIndexed: () => Promise.resolve(),
      getIndexedItemKeys: () => ["ABCD2345"],
    },
  } as LocalServerServiceDeps;
}

/** Resolve the port once the listener binds one. */
async function whenListening(service: LocalServerService): Promise<number> {
  await service.ready;
  const bound = service.effectivePort;
  if (bound !== null) return bound;
  return await new Promise<number>((resolve) => {
    const off = service.on("listening", (port) => {
      if (port === null) return;
      off();
      resolve(port);
    });
  });
}

/** Resolve once the listener has closed. */
async function whenClosed(service: LocalServerService): Promise<void> {
  await service.ready;
  if (service.effectivePort === null) return;
  await new Promise<void>((resolve) => {
    const off = service.on("listening", (port) => {
      if (port !== null) return;
      off();
      resolve();
    });
  });
}

it("serves without taking over the window's Request and Response", async () => {
  const nativeRequest = globalThis.Request;
  const nativeResponse = globalThis.Response;
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": 0,
  });

  await using service = new LocalServerService(makeDeps(settings.service));
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
  const settings = makeSettings({
    "server.enabled": true,
    "server.live-update": false,
    "server.workbench": true,
    "server.port": 0,
  });

  await using service = new LocalServerService(makeDeps(settings.service));
  const port = await whenListening(service);

  expect(service.effectivePort).toBe(port);
  // The port is open, and Live Update alone refuses.
  expect(service.available).toBe(false);
  const refused = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(refused.status).toBe(404);

  // Turning Live updates back on answers again on the same port: the toggle
  // gates the routes, so nothing rebinds.
  settings.update({ "server.live-update": true });
  expect(service.available).toBe(true);
  expect(service.effectivePort).toBe(port);
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
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": port,
  });

  await using service = new LocalServerService(makeDeps(settings.service));
  const bound = await whenListening(service);

  // The held port is skipped for one inside the range of ten. Which one is not
  // pinned: a parallel test worker can hold the very next port too.
  expect(bound).toBeGreaterThan(port);
  expect(bound).toBeLessThanOrEqual(port + 9);
  expect(service.effectivePort).toBe(bound);
  const res = await fetch(`http://127.0.0.1:${bound}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("unloads cleanly when no port in the range can bind", async () => {
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": 0,
    // An address this machine does not own, so every bind in the range fails.
    "server.hostname": "203.0.113.1",
  });

  const service = new LocalServerService(makeDeps(settings.service));
  await service.ready;
  // Disposal waits on the bind chain: a bind attempt that never settles hangs
  // the plugin's unload instead of returning here.
  await service[Symbol.asyncDispose]();

  expect(service.effectivePort).toBe(null);
  expect(service.available).toBe(false);
});

it("closes and reopens the listener as the server toggle changes", async () => {
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": 0,
  });

  await using service = new LocalServerService(makeDeps(settings.service));
  const port = await whenListening(service);

  settings.update({ "server.enabled": false });
  await whenClosed(service);
  expect(service.effectivePort).toBe(null);
  await expect(
    fetch(`http://127.0.0.1:${port}/literature-notes`, {
      headers: companionHeaders,
    }),
  ).rejects.toThrow();

  settings.update({ "server.enabled": true });
  const reopenedPort = await whenListening(service);
  expect(reopenedPort).toBeGreaterThan(0);
  const res = await fetch(`http://127.0.0.1:${reopenedPort}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("answers a mounted route group beside the Live Update routes", async () => {
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": 0,
  });

  await using service = new LocalServerService(makeDeps(settings.service));
  // The seam #1002 mounts the Local Bridge on: the same listener, its own
  // base path, and gates of its own — the Live Update gates stay off it.
  service.mount(
    "/v1",
    new Hono().get("/ping", (c) => c.text("pong")),
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
