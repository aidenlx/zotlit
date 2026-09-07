import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import {
  BRIDGE_VERSION,
  CONNECT_FRAGMENT_CODE,
  CONNECT_FRAGMENT_PORT,
  LOCAL_BRIDGE_PATHS,
} from "@zotlit/workbench/bridge";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { LocalServerService } from "@/services/local-server/service";
import type { ProfileReader } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { BridgeProfileReader } from "./reads";
import { LocalBridgeService } from "./service";
import type { LocalBridgeServiceDeps } from "./service";

const VAULT_NAME = "Research";
/** A Profile id of the shape the registry mints: twelve alphanumerics. */
const BOOKS_PROFILE = "Bk7Qm2Xr9Tz4";

const ITEM = { key: "IANNP5A2", title: "Why research findings are false" };

/** A port nothing holds, so the listener binds without racing a fixed one. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

interface SettingsStub {
  service: SettingsService;
  update: ReturnType<typeof vi.fn>;
  push(patch: Partial<Settings>): void;
}

function makeSettings(overrides: Partial<Settings>): SettingsStub {
  let current: Readonly<Settings> = { ...defaults, ...overrides };
  const subscribers = new Set<(value: Readonly<Settings>) => void>();
  const update = vi.fn();
  return {
    update,
    service: {
      get current() {
        return current;
      },
      get loaded() {
        return Promise.resolve(current);
      },
      subscribe: (cb: (value: Readonly<Settings>) => void) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
      update,
    } as unknown as SettingsService,
    push(patch) {
      current = { ...current, ...patch };
      for (const cb of subscribers) cb(current);
    },
  };
}

/** Obsidian's vault-scoped localStorage, as a plain map a test can inspect. */
function makeDevice(held: Map<string, unknown> = new Map()) {
  return {
    held,
    app: {
      vault: { getName: () => VAULT_NAME },
      loadLocalStorage: (key: string) => held.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => {
        if (value === null) held.delete(key);
        else held.set(key, value);
      },
    } as unknown as App,
  };
}

const PROFILES = {
  ready: Promise.resolve(),
  loaded: true,
  resolveProfile: (selector: string) =>
    selector === BOOKS_PROFILE
      ? ({ label: "Books" } as ReturnType<ProfileReader["resolveProfile"]>)
      : undefined,
  getSource: () => Promise.resolve(""),
} as unknown as BridgeProfileReader;

/**
 * The vault data the reads answer from. This suite is about the lifecycle and
 * the grant, so nothing here is asked for a value; `reads.test.ts` drives them.
 */
const READ_DEPS = {
  db: { acquireRead: () => Promise.reject(new Error("not used here")) },
  noteIndex: {
    whenIndexed: () => Promise.resolve(),
    getNotesByItemKey: () => [],
    getImportedNoteByNoteKey: () => [],
  },
  template: {
    ready: Promise.resolve(),
    exportLiteratureNotePackSource: (source: string) => Promise.resolve(source),
  },
  zoteroPref: { ready: Promise.resolve(), dataDir: "" },
} as unknown as Pick<
  LocalBridgeServiceDeps,
  "db" | "noteIndex" | "template" | "zoteroPref"
>;

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

/** The shape a bridge call takes here: plain headers, so nothing spreads wrong. */
interface CallInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

interface Harness extends AsyncDisposable {
  bridge: LocalBridgeService;
  settings: SettingsStub;
  device: ReturnType<typeof makeDevice>;
  /** A plain request against the bound port, the way the page makes one. */
  call(path: string, init?: CallInit): Promise<Response>;
  /** Open the launch URL the way the browser would, answering the credential. */
  connect(profileId?: string): Promise<string>;
}

async function harness(
  options: {
    settings?: Partial<Settings>;
    device?: Map<string, unknown>;
  } = {},
): Promise<Harness> {
  const port = await freePort();
  const settings = makeSettings({
    "server.enabled": true,
    "server.port": port,
    ...options.settings,
  });
  const device = makeDevice(options.device);
  const localServer = new LocalServerService({
    settings: settings.service,
    zoteroPref: { sourceId: "a1b2c3d4" } as unknown as ZoteroPrefService,
    noteIndex: {
      whenIndexed: () => Promise.resolve(),
      getIndexedItemKeys: () => [],
    },
  } as never);
  const bridge = new LocalBridgeService({
    app: device.app,
    settings: settings.service,
    profile: PROFILES,
    localServer,
    ...READ_DEPS,
    pluginVersion: "2.1.1",
  });
  await bridge.ready;
  const bound = await whenListening(localServer);
  const call = (path: string, init: CallInit = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${bound}${path}`, {
      ...init,
      headers: { Origin: DOCS_SITE_URL, ...init.headers },
    });
  return {
    bridge,
    settings,
    device,
    call,
    async connect(profileId = BOOKS_PROFILE) {
      const url = bridge.launchUrl({ profileId, item: ITEM });
      const fragment = new URLSearchParams(new URL(url!).hash.slice(1));
      const res = await call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
        method: "POST",
        body: JSON.stringify({ code: fragment.get(CONNECT_FRAGMENT_CODE) }),
      });
      const grant = (await res.json()) as { credential: string };
      return grant.credential;
    },
    async [Symbol.asyncDispose]() {
      await bridge[Symbol.asyncDispose]();
      await localServer[Symbol.asyncDispose]();
    },
  };
}

function authorized(credential: string): Record<string, string> {
  return { Authorization: `Bearer ${credential}` };
}

it("opens a version-2 grant from the launch URL it hands the browser", async () => {
  await using bridge = await harness();

  const url = bridge.bridge.launchUrl({
    profileId: BOOKS_PROFILE,
    item: ITEM,
  })!;
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));

  expect(`${parsed.origin}${parsed.pathname}`).toBe(
    `${DOCS_SITE_URL}/workbench`,
  );
  expect(fragment.get(CONNECT_FRAGMENT_PORT)).toBe(
    String(bridge.settings.service.current!["server.port"]),
  );

  const res = await bridge.call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
    method: "POST",
    body: JSON.stringify({ code: fragment.get(CONNECT_FRAGMENT_CODE) }),
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    credential: expect.any(String),
    installation: { id: expect.any(String), vault: VAULT_NAME },
    pluginVersion: "2.1.1",
    bridgeVersion: BRIDGE_VERSION,
    templateDataContractVersion: expect.any(Number),
    capabilities: expect.arrayContaining(["selected-profile:save"]),
    selectedItem: ITEM,
    selectedProfile: { id: BOOKS_PROFILE, name: "Books" },
    profileDefaults: {
      folder: "literatures",
      citationStyle: null,
      importFolder: "zotero_notes",
      importColoredHighlights: false,
      importAnnotationsAsTemplate: false,
    },
  });
});

it("names the built-in Profile the way the settings tab does", async () => {
  await using bridge = await harness();
  await bridge.connect("default");

  expect(bridge.bridge.connection).toEqual({
    origin: DOCS_SITE_URL,
    profileId: "default",
    profileName: m.settings_profile_default_name(),
    item: ITEM,
  });
});

it("writes nothing about the session to settings or device storage", async () => {
  await using bridge = await harness();
  const credential = await bridge.connect();

  expect(bridge.settings.update).not.toHaveBeenCalled();
  // The installation id is the one device record, and it is not the secret.
  expect([...bridge.device.held.keys()]).toEqual([
    "zotlit-local-bridge-installation",
  ]);
  expect([...bridge.device.held.values()]).not.toContain(credential);
});

it("keeps the installation id across a reload and mints a fresh one per device", async () => {
  const device = new Map<string, unknown>();
  const idOf = async (held: Map<string, unknown>): Promise<string> => {
    await using bridge = await harness({ device: held });
    const credential = await bridge.connect();
    const res = await bridge.call(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: authorized(credential),
    });
    const grant = (await res.json()) as { installation: { id: string } };
    return grant.installation.id;
  };

  const first = await idOf(device);
  // The same device storage, a fresh plugin load: the page's drafts still match.
  expect(await idOf(device)).toBe(first);
  // A second device sharing the synced vault has device storage of its own.
  expect(await idOf(new Map())).not.toBe(first);
});

it("revokes the credential when the plugin unloads", async () => {
  const bridge = await harness();
  const credential = await bridge.connect();
  expect(bridge.bridge.connection).not.toBe(null);

  await bridge.bridge[Symbol.asyncDispose]();

  expect(bridge.bridge.connection).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.resumeSession, {
    headers: authorized(credential),
  });
  expect(res.status).toBe(401);
  await bridge[Symbol.asyncDispose]();
});

it("ends the session on both sides when Obsidian disconnects", async () => {
  await using bridge = await harness();
  const credential = await bridge.connect();

  bridge.bridge.disconnect();

  expect(bridge.bridge.connection).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.resumeSession, {
    headers: authorized(credential),
  });
  expect(res.status).toBe(401);
});

it("offers no launch and refuses the port while the Workbench toggle is off", async () => {
  await using bridge = await harness({
    settings: { "server.workbench": false },
  });

  expect(
    bridge.bridge.launchUrl({ profileId: BOOKS_PROFILE, item: null }),
  ).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
    method: "POST",
    body: JSON.stringify({ code: "anything" }),
  });
  expect(res.status).toBe(403);
  await expect(res.json()).resolves.toEqual({
    error: { code: "bridge-disabled", message: expect.any(String) },
  });
});

it("ends the live connection when the Workbench toggle is turned off", async () => {
  await using bridge = await harness();
  await bridge.connect();

  bridge.settings.push({ "server.workbench": false });

  expect(bridge.bridge.connection).toBe(null);
});
