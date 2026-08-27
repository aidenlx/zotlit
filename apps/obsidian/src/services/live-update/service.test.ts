import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { LiveUpdateService } from "./service";
import type { LiveUpdateServiceDeps } from "./service";

const SOURCE_ID = "a1b2c3d4";

/** A port nothing holds, so the listener binds without racing a fixed one. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function makeDeps(port: number): LiveUpdateServiceDeps {
  const settings = {
    "server.enabled": true,
    "server.port": port,
    "server.hostname": "127.0.0.1",
  } as unknown as Readonly<Settings>;
  return {
    settings: {
      loaded: Promise.resolve(settings),
      subscribe: () => () => undefined,
    } as unknown as SettingsService,
    zoteroPref: { sourceId: SOURCE_ID } as unknown as ZoteroPrefService,
    noteIndex: {
      whenIndexed: () => Promise.resolve(),
      getIndexedItemKeys: () => ["ABCD2345"],
    },
  } as LiveUpdateServiceDeps;
}

/** Resolve once the listener accepts connections. */
async function whenAvailable(service: LiveUpdateService): Promise<void> {
  await service.ready;
  if (service.available) return;
  await new Promise<void>((resolve) => {
    const off = service.on("available", (available) => {
      if (!available) return;
      off();
      resolve();
    });
  });
}

it("serves without taking over the window's Request and Response", async () => {
  const nativeRequest = globalThis.Request;
  const nativeResponse = globalThis.Response;
  const port = await freePort();

  await using service = new LiveUpdateService(makeDeps(port));
  await whenAvailable(service);

  // The globals are the window's own, and WebAssembly streaming brand-checks
  // the native `Response`: a swapped-in class breaks the Pandoc engine.
  expect(globalThis.Request).toBe(nativeRequest);
  expect(globalThis.Response).toBe(nativeResponse);

  const res = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      [SOURCE_ID_HEADER]: SOURCE_ID,
    },
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ keys: ["ABCD2345"] });
});
