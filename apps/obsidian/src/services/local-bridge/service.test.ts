import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Stream } from "effect";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import {
  BRIDGE_VERSION,
  CONNECT_FRAGMENT_CODE,
  CONNECT_FRAGMENT_PORT,
  LOCAL_BRIDGE_PATHS,
} from "@zotlit/workbench/bridge";

import { MemoryDeviceStorage } from "@/lib/__fixtures__/obsidian-device-storage";
import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { DOCS_SITE_URL } from "@/lib/constants";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { subscribe } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { buildLocalServer } from "@/services/local-server/__fixtures__";
import type { LocalServer } from "@/services/local-server/service";
import { NoteIndex } from "@/services/note-index/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import type { PluginSettings, Settings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { bindLocalBridge } from "./handle";
import type { LocalBridgeHandle } from "./handle";
import { layerLocalBridge, LocalBridge } from "./service";
import type { WorkbenchConnection, WorkbenchLaunch } from "./service";

const VAULT_NAME = "Research";
/** A Profile id of the shape the registry mints: twelve alphanumerics. */
const BOOKS_PROFILE = "Bk7Qm2Xr9Tz4";

const ITEM = { key: "IANNP5A2", title: "Why research findings are false" };

/** The Books document as the page submits it in a Save. */
const BOOKS_SOURCE = `---
id: ${BOOKS_PROFILE}
name: Books
version: 1.0.0
contract: ${CONTRACT_VERSION}
filename: '{{ zt.title }}'
language: liquid
---
# {{ zt.title }}

--- zotlit:annotation ---
{{ zt.text }}
`;

/** The registry: Books resolves, and a Save of it lands. */
const PROFILES = Layer.mock(Profile, {
  loaded: Effect.succeed(true),
  resolveProfile: (selector) =>
    Effect.succeed(
      selector === BOOKS_PROFILE
        ? stubService<ResolvedProfile>("ResolvedProfile", { label: "Books" })
        : undefined,
    ),
  getSource: () => Effect.succeed(""),
  saveSource: () =>
    Effect.succeed({ state: "saved" as const, revision: "written" }),
});

/**
 * The vault data the reads answer from. This suite is about the lifecycle and
 * the grant, so nothing here is asked for a value; `reads.test.ts` drives them.
 */
const READ_SERVICES = Layer.mergeAll(
  Layer.mock(ZoteroReads, { reads: stubService<ZoteroReadsApi>("Reads", {}) }),
  Layer.mock(NoteIndex, { whenIndexed: Effect.void }),
  Layer.mock(Template, {
    exportLiteratureNotePackSource: (source: string) => Effect.succeed(source),
  }),
  Layer.mock(ZoteroPref, {}),
);

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

/** The shape a bridge call takes here: plain headers, so nothing spreads wrong. */
interface CallInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

interface Harness extends AsyncDisposable {
  /** The bridge as the saved Notice holds it. */
  handle: LocalBridgeHandle;
  /** The connection standing now, as the setting tab reads it. */
  connection(): WorkbenchConnection | null;
  /** End the connection from Obsidian, as the setting tab's button does. */
  disconnect(): void;
  /** Follow each connection change, as the setting tab's rebuild stream does. */
  onConnection(
    callback: (connection: WorkbenchConnection | null) => void,
  ): () => void;
  launchUrl(launch: WorkbenchLaunch): string | null;
  /** Close the bridge's layer, as an unload does, while the server stays up. */
  unload(): Promise<void>;
  settings: PluginSettings["Service"];
  /** Every write to the store, which still goes through. */
  settingsUpdates: Mock<PluginSettings["Service"]["update"]>;
  settingsBridge: Pick<EffectBridge, "runSync">;
  device: MemoryDeviceStorage;
  /** A plain request against the bound port, the way the page makes one. */
  call(path: string, init?: CallInit): Promise<Response>;
  /** Open the launch URL the way the browser would, answering the credential. */
  connect(profileId?: string): Promise<string>;
}

async function harness(
  options: {
    webWorkbenchEnabled?: boolean;
    settings?: Partial<Settings>;
    device?: MemoryDeviceStorage;
  } = {},
): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const localServer = await buildLocalServer(
    {
      "server.enabled": true,
      "server.port": 0,
      ...options.settings,
    },
    stack,
  );
  const settings = localServer.settings;
  const settingsUpdates = vi.spyOn(settings, "update");
  const device = options.device ?? new MemoryDeviceStorage();
  // The bridge's layer closes on its own stack, before the server's.
  const bridgeStack = stack.use(new AsyncDisposableStack());
  const runtime = buildRuntime(
    layerLocalBridge({
      webWorkbenchEnabled: options.webWorkbenchEnabled ?? true,
      pluginVersion: "2.1.1",
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeedContext(
            localServer.runtime.runSync(
              Effect.context<LocalServer | PluginSettings>(),
            ),
          ),
          PROFILES,
          READ_SERVICES,
          NodeFileSystem.layer,
          layerHost({ deviceStorage: device }),
          layerTestObsidianEnv({ vaultName: VAULT_NAME }),
        ),
      ),
    ),
    bridgeStack,
  );
  await runtime.context();
  const service = runtime.runSync(LocalBridge);
  const runner = effectBridge(runtime);
  const handle = bindLocalBridge(runner, service);
  const bound = await whenListening(localServer);
  const call = (path: string, init: CallInit = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${bound}${path}`, {
      ...init,
      headers: { Origin: DOCS_SITE_URL, ...init.headers },
    });
  const launchUrl = (launch: WorkbenchLaunch) =>
    runtime.runSync(service.launchUrl(launch));
  const lifetime = stack.move();
  return {
    handle,
    connection: () => runner.runSync(service.connection),
    disconnect: () => runner.runSync(service.disconnect),
    onConnection: (callback) =>
      // The current connection replays first; the tab follows a change.
      runner.subscribe(Stream.drop(service.changes, 1), callback),
    launchUrl,
    unload: () => bridgeStack.disposeAsync(),
    settings,
    settingsUpdates,
    settingsBridge: effectBridge(localServer.runtime),
    device,
    call,
    async connect(profileId = BOOKS_PROFILE) {
      const url = launchUrl({ profileId, item: ITEM });
      const fragment = new URLSearchParams(new URL(url!).hash.slice(1));
      const res = await call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
        method: "POST",
        body: JSON.stringify({ code: fragment.get(CONNECT_FRAGMENT_CODE) }),
      });
      const grant = (await res.json()) as { credential: string };
      return grant.credential;
    },
    async [Symbol.asyncDispose]() {
      await lifetime[Symbol.asyncDispose]();
    },
  };
}

function authorized(credential: string): Record<string, string> {
  return { Authorization: `Bearer ${credential}` };
}

it("opens a version-2 grant from the launch URL it hands the browser", async () => {
  await using bridge = await harness();

  const url = bridge.launchUrl({
    profileId: BOOKS_PROFILE,
    item: ITEM,
  })!;
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));

  expect(`${parsed.origin}${parsed.pathname}`).toBe(
    `${DOCS_SITE_URL}/workbench`,
  );
  const res = await fetch(
    `http://127.0.0.1:${fragment.get(CONNECT_FRAGMENT_PORT)}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
    {
      method: "POST",
      headers: { Origin: DOCS_SITE_URL },
      body: JSON.stringify({ code: fragment.get(CONNECT_FRAGMENT_CODE) }),
    },
  );

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

  expect(bridge.connection()).toEqual({
    origin: DOCS_SITE_URL,
    profileId: "default",
    profileName: m.settings_profile_default_name(),
    item: ITEM,
  });
});

it("writes nothing about the session to settings or device storage", async () => {
  await using bridge = await harness();
  const credential = await bridge.connect();

  expect(bridge.settingsUpdates).not.toHaveBeenCalled();
  // The installation id is the one device record, and it is not the secret.
  expect([...bridge.device.values.keys()]).toEqual([
    "zotlit-local-bridge-installation",
  ]);
  expect(JSON.stringify([...bridge.device.values.values()])).not.toContain(
    credential,
  );
});

it("keeps the installation id across a reload and mints a fresh one per device", async () => {
  const device = new MemoryDeviceStorage();
  const idOf = async (held: MemoryDeviceStorage): Promise<string> => {
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
  expect(await idOf(new MemoryDeviceStorage())).not.toBe(first);
});

it("revokes the credential when the plugin unloads", async () => {
  await using bridge = await harness();
  const credential = await bridge.connect();
  expect(bridge.connection()).not.toBe(null);

  await bridge.unload();

  expect(bridge.connection()).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.resumeSession, {
    headers: authorized(credential),
  });
  expect(res.status).toBe(401);
});

it("ends the session on both sides when Obsidian disconnects", async () => {
  await using bridge = await harness();
  const credential = await bridge.connect();

  bridge.disconnect();

  expect(bridge.connection()).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.resumeSession, {
    headers: authorized(credential),
  });
  expect(res.status).toBe(401);
});

it("tells the setting tab of each connection change, and only of a change", async () => {
  await using bridge = await harness();
  const seen: (string | null)[] = [];
  const off = bridge.onConnection((connection) =>
    seen.push(connection?.profileName ?? null),
  );

  await bridge.connect();
  bridge.disconnect();
  off();
  // A change after the subscription ends reaches nothing.
  await bridge.connect();

  expect(seen).toEqual(["Books", null]);
});

it("announces a Save that landed in the vault", async () => {
  await using bridge = await harness();
  const saved: string[] = [];
  const off = bridge.handle.onProfileSaved((profileId) =>
    saved.push(profileId),
  );
  const credential = await bridge.connect();

  const res = await bridge.call(LOCAL_BRIDGE_PATHS.saveSelectedProfile, {
    method: "POST",
    headers: authorized(credential),
    body: JSON.stringify({
      reference: BOOKS_PROFILE,
      expected: { state: "absent" },
      source: BOOKS_SOURCE,
    }),
  });
  off();

  await expect(res.json()).resolves.toEqual({
    state: "saved",
    revision: "written",
  });
  expect(saved).toEqual([BOOKS_PROFILE]);
});

it("offers no launch and refuses the port while the Workbench toggle is off", async () => {
  await using bridge = await harness({
    settings: { "server.workbench": false },
  });

  expect(bridge.launchUrl({ profileId: BOOKS_PROFILE, item: null })).toBe(null);
  const res = await bridge.call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
    method: "POST",
    body: JSON.stringify({ code: "anything" }),
  });
  expect(res.status).toBe(403);
  await expect(res.json()).resolves.toEqual({
    error: { code: "bridge-disabled", message: expect.any(String) },
  });
});

it("refuses persisted bridge access when the build gate is off", async () => {
  await using bridge = await harness({
    webWorkbenchEnabled: false,
    settings: { "server.workbench": true },
  });

  expect(bridge.launchUrl({ profileId: BOOKS_PROFILE, item: null })).toBe(null);
  const response = await bridge.call(LOCAL_BRIDGE_PATHS.codeBootstrap, {
    method: "OPTIONS",
  });
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: { code: "bridge-disabled", message: expect.any(String) },
  });
});

it("ends the live connection when the Workbench toggle is turned off", async () => {
  await using bridge = await harness();
  await bridge.connect();

  bridge.settingsBridge.runSync(
    bridge.settings.update({ "server.workbench": false }),
  );

  expect(bridge.connection()).toBe(null);
});
