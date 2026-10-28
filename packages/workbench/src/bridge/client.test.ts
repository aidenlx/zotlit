// The Local Bridge client over a fake fetch: each member's answer, and
// each failure by its tag.
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { expect } from "vitest";

import {
  layerLocalBridgeClient,
  LocalBridgeClient,
  LocalBridgeStorage,
} from "./client";
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  connectFragment,
  LOCAL_BRIDGE_PATHS,
  localBridgeOrigin,
} from "./contracts";

import { SAMPLE_ITEMS } from "#/render/index";

const PORT = 23_120;
const CONTRACT = SAMPLE_ITEMS[0]!.contractVersion;
const COMPATIBILITY = {
  bridgeVersion: BRIDGE_VERSION,
  templateDataContractVersion: CONTRACT,
};
const KEPT_KEY = "zotlit.local-bridge.credential";

const GRANT = {
  credential: "credential-1",
  installation: { id: "fixture-installation", vault: "Fixture vault" },
  pluginVersion: "2.1.1",
  bridgeVersion: BRIDGE_VERSION,
  templateDataContractVersion: CONTRACT,
  capabilities: [...BRIDGE_CAPABILITIES],
  selectedItem: null,
  selectedProfile: { id: "default", name: "Default" },
  profileDefaults: {
    folder: "literature",
    citationStyle: null,
    importFolder: "notes",
    importColoredHighlights: false,
    importAnnotationsAsTemplate: false,
  },
};
const { credential: _credential, ...CONNECTED_GRANT } = GRANT;
const CONNECTED = { state: "connected", ...CONNECTED_GRANT } as const;

const PROFILE = {
  profile: { id: "default", name: "Default" },
  source: "---\nname: Default\n---\n",
  document: {
    state: "present",
    reference: "profile:default",
    revision: "revision-1",
  },
};

interface SentRequest {
  readonly url: string;
  readonly authorization: string | null;
  /** The header names, which a browser preflight checks against the bridge's list. */
  readonly headers: readonly string[];
  readonly body: unknown;
}

type Answer = (body: unknown) => Response | Promise<Response>;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

/** A bridge that answers each path it knows and records every request. */
function fakeBridge(answers: Partial<Record<string, Answer>> = {}) {
  const sent: SentRequest[] = [];
  const answer: Record<string, Answer> = {
    [LOCAL_BRIDGE_PATHS.codeBootstrap]: () => json(GRANT),
    [LOCAL_BRIDGE_PATHS.resumeSession]: () => json(CONNECTED_GRANT),
    [LOCAL_BRIDGE_PATHS.disconnect]: () => json({}),
    ...answers,
  };
  const transport: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({
      url: url.href,
      authorization: headers.get("Authorization"),
      headers: [...headers.keys()].toSorted(),
      body,
    });
    const respond = answer[url.pathname];
    if (!respond) throw new Error(`Nothing answers ${url.pathname}.`);
    return respond(body);
  };
  return { sent, transport };
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

function memoryStorage() {
  const values = new Map<string, string>();
  return LocalBridgeStorage.of({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  });
}

/** One page's client: the tab storage it keeps its grant in, and the bridge. */
function clientLayer(
  transport: typeof fetch,
  storage: LocalBridgeStorage["Service"] = memoryStorage(),
  compatibility = COMPATIBILITY,
) {
  return layerLocalBridgeClient(compatibility).pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, transport)),
      ),
    ),
    Layer.provide(Layer.succeed(LocalBridgeStorage, storage)),
  );
}

const connect = Effect.gen(function* () {
  const client = yield* LocalBridgeClient;
  return yield* client.connectFromFragment(connectFragment("code-1", PORT));
});

it.effect(
  "connects on the launch fragment's port and keeps the grant in the tab",
  () =>
    Effect.gen(function* () {
      const bridge = fakeBridge({
        [LOCAL_BRIDGE_PATHS.selectedProfile]: () => json(PROFILE),
      });
      const storage = memoryStorage();
      yield* Effect.gen(function* () {
        const client = yield* LocalBridgeClient;
        expect(yield* client.current).toEqual({
          connection: { state: "disconnected" },
          resumable: false,
        });

        expect(yield* connect).toEqual(CONNECTED);

        expect(yield* client.current).toEqual({
          connection: CONNECTED,
          resumable: true,
        });
        expect(yield* client.readSelectedProfile).toEqual(PROFILE);
      }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));

      expect(bridge.sent).toEqual([
        {
          url: `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
          authorization: null,
          // Only headers the bridge lists for a browser's preflight.
          headers: ["accept", "content-type"],
          body: { code: "code-1" },
        },
        {
          url: `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.selectedProfile}`,
          authorization: "Bearer credential-1",
          headers: ["accept", "authorization"],
          body: undefined,
        },
      ]);
      expect(JSON.parse(storage.getItem(KEPT_KEY)!)).toEqual({
        grant: GRANT,
        port: PORT,
      });
    }),
);

it.effect("answers each read and Save the connection grants", () =>
  Effect.gen(function* () {
    const item = SAMPLE_ITEMS[0]!;
    const dependencies = { templates: [], diagnostics: [] };
    const styles = [{ id: "apa", title: "APA" }];
    const style = { kind: "default" };
    const schemas = { note: {}, annotation: {}, filename: {} };
    const bridge = fakeBridge({
      [LOCAL_BRIDGE_PATHS.templateSchema]: () => json(schemas),
      [LOCAL_BRIDGE_PATHS.selectedItem]: () => json(item),
      [LOCAL_BRIDGE_PATHS.templateDependencies]: () => json(dependencies),
      [LOCAL_BRIDGE_PATHS.citationStyles]: () => json(styles),
      [LOCAL_BRIDGE_PATHS.selectedCitationStyle]: () => json(style),
      [LOCAL_BRIDGE_PATHS.saveSelectedProfile]: (body) =>
        json(
          (body as { source: string }).source === "refused"
            ? { state: "refused", reason: "invalid-source" }
            : { state: "saved", revision: "revision-2" },
        ),
    });
    yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      yield* connect;
      const save = (source: string) =>
        client.saveSelectedProfile({
          reference: "profile:default",
          expected: { state: "revision", revision: "revision-1" },
          source,
        });

      expect(yield* client.readTemplateSchema).toEqual(schemas);
      expect(yield* client.loadSelectedItem).toEqual(item);
      expect(
        yield* client.readTemplateDependencies({ source: PROFILE.source }),
      ).toEqual(dependencies);
      expect(yield* client.listCitationStyles).toEqual(styles);
      expect(
        yield* client.readSelectedCitationStyle({ styleId: null }),
      ).toEqual(style);
      expect(yield* save("edited")).toEqual({
        state: "saved",
        revision: "revision-2",
      });
      // A refused Save is an answer the page shows, not a failure.
      expect(yield* save("refused")).toEqual({
        state: "refused",
        reason: "invalid-source",
      });
    }).pipe(Effect.provide(clientLayer(bridge.transport)));
  }),
);

it.effect(
  "resumes a kept grant against the bridge running now, or answers null",
  () =>
    Effect.gen(function* () {
      const storage = memoryStorage();
      const bridge = fakeBridge();
      yield* connect.pipe(
        Effect.provide(clientLayer(bridge.transport, storage)),
      );

      // The tab a reload left behind holds the grant it kept.
      const returning = yield* Effect.gen(function* () {
        const client = yield* LocalBridgeClient;
        return [yield* client.current, yield* client.resume] as const;
      }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
      expect(returning).toEqual([
        { connection: CONNECTED, resumable: true },
        CONNECTED,
      ]);
      expect(bridge.sent.at(-1)).toMatchObject({
        url: `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.resumeSession}`,
        authorization: "Bearer credential-1",
      });

      const fresh = yield* Effect.flatMap(
        LocalBridgeClient,
        (client) => client.resume,
      ).pipe(Effect.provide(clientLayer(bridge.transport)));
      expect(fresh).toBeNull();
    }),
);

it.effect(
  "holds a version mismatch as the connection and drops the grant",
  () =>
    Effect.gen(function* () {
      const storage = memoryStorage();
      const bridge = fakeBridge({
        [LOCAL_BRIDGE_PATHS.codeBootstrap]: () =>
          json({ ...GRANT, bridgeVersion: BRIDGE_VERSION + 1 }),
      });
      const state = yield* Effect.gen(function* () {
        const client = yield* LocalBridgeClient;
        expect(yield* connect).toEqual({
          state: "unavailable",
          reason: "version-mismatch",
          expected: COMPATIBILITY,
          received: { ...COMPATIBILITY, bridgeVersion: BRIDGE_VERSION + 1 },
        });
        return yield* client.current;
      }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
      expect(state.resumable).toBe(false);
      expect(storage.getItem(KEPT_KEY)).toBeNull();
    }),
);

it.effect("fails with a decode failure for an answer it cannot read", () =>
  Effect.gen(function* () {
    const bridge = fakeBridge({
      [LOCAL_BRIDGE_PATHS.selectedProfile]: () => new Response("<html>"),
      [LOCAL_BRIDGE_PATHS.templateSchema]: () => json({ note: "no schema" }),
    });
    yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      // A launch URL that names no Connection code is refused before sending.
      expect(
        yield* Effect.flip(client.connectFromFragment(`#port=${PORT}`)),
      ).toMatchObject({
        _tag: "LocalBridgeDecodeError",
        message: "The URL fragment has no Connection code.",
      });
      expect(
        yield* Effect.flip(client.connectFromFragment("#zotlit-connect=code")),
      ).toMatchObject({
        _tag: "LocalBridgeDecodeError",
        message: "The URL fragment names no usable Local Bridge port.",
      });

      yield* connect;
      expect(yield* Effect.flip(client.readSelectedProfile)).toMatchObject({
        _tag: "LocalBridgeDecodeError",
      });
      expect(yield* Effect.flip(client.readTemplateSchema)).toMatchObject({
        _tag: "LocalBridgeDecodeError",
      });
      // Neither answer says anything about the connection.
      expect((yield* client.current).connection).toEqual(CONNECTED);
    }).pipe(Effect.provide(clientLayer(bridge.transport)));
  }),
);

it.effect("fails with the status and the bridge's own code for a refusal", () =>
  Effect.gen(function* () {
    const bridge = fakeBridge({
      [LOCAL_BRIDGE_PATHS.codeBootstrap]: () =>
        json(
          {
            error: {
              code: "invalid-one-time-code",
              message: "The Connection code was already used.",
            },
          },
          401,
        ),
      [LOCAL_BRIDGE_PATHS.selectedItem]: () => json({}, 500),
    });
    yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      expect(yield* Effect.flip(connect)).toMatchObject({
        _tag: "LocalBridgeStatusError",
        status: 401,
        code: "invalid-one-time-code",
        message: "The Connection code was already used.",
      });
      expect((yield* client.current).connection).toEqual({
        state: "disconnected",
      });
    }).pipe(Effect.provide(clientLayer(bridge.transport)));

    const connected = fakeBridge({
      [LOCAL_BRIDGE_PATHS.selectedItem]: () => json({}, 500),
    });
    const failure = yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      yield* connect;
      return yield* Effect.flip(client.loadSelectedItem);
    }).pipe(Effect.provide(clientLayer(connected.transport)));
    expect(failure).toMatchObject({
      _tag: "LocalBridgeStatusError",
      status: 500,
      code: "invalid-error-response",
      message: "Local Bridge returned HTTP 500.",
    });
  }),
);

it.effect(
  "fails with a connection failure when ZotLit is not reachable, and keeps the grant",
  () =>
    Effect.gen(function* () {
      const storage = memoryStorage();
      const bridge = fakeBridge({
        [LOCAL_BRIDGE_PATHS.selectedItem]: () =>
          Promise.reject(new TypeError("Failed to fetch")),
      });
      const state = yield* Effect.gen(function* () {
        const client = yield* LocalBridgeClient;
        yield* connect;
        expect(yield* Effect.flip(client.loadSelectedItem)).toMatchObject({
          _tag: "LocalBridgeConnectionError",
          message: "Failed to fetch",
        });
        return yield* client.current;
      }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
      expect(state).toEqual({
        connection: { state: "unavailable", reason: "connection-lost" },
        resumable: true,
      });
      expect(storage.getItem(KEPT_KEY)).not.toBeNull();
    }),
);

it.effect("fails as unavailable while not connected and once revoked", () =>
  Effect.gen(function* () {
    const storage = memoryStorage();
    const bridge = fakeBridge({
      [LOCAL_BRIDGE_PATHS.selectedItem]: () =>
        json(
          { error: { code: "unauthorized", message: "Unknown credential." } },
          401,
        ),
    });
    const state = yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      expect(yield* Effect.flip(client.readTemplateSchema)).toMatchObject({
        _tag: "LocalBridgeUnavailableError",
        reason: "not-connected",
      });
      yield* connect;
      expect(yield* Effect.flip(client.loadSelectedItem)).toMatchObject({
        _tag: "LocalBridgeUnavailableError",
        reason: "revoked",
        message: "The Workbench Connection was revoked.",
      });
      return yield* client.current;
    }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
    expect(state).toEqual({
      connection: { state: "unavailable", reason: "revoked" },
      resumable: false,
    });
    expect(storage.getItem(KEPT_KEY)).toBeNull();
  }),
);

it.effect("Disconnect ends the connection and drops the grant", () =>
  Effect.gen(function* () {
    const storage = memoryStorage();
    const bridge = fakeBridge();
    const state = yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      yield* connect;
      yield* client.disconnect;
      return yield* client.current;
    }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
    expect(bridge.sent.at(-1)).toMatchObject({
      url: `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.disconnect}`,
      authorization: "Bearer credential-1",
    });
    expect(state).toEqual({
      connection: { state: "disconnected" },
      resumable: false,
    });
    expect(storage.getItem(KEPT_KEY)).toBeNull();
  }),
);

it.effect("Disconnect drops the grant even when its request fails", () =>
  Effect.gen(function* () {
    const storage = memoryStorage();
    const bridge = fakeBridge({
      [LOCAL_BRIDGE_PATHS.disconnect]: () =>
        Promise.reject(new TypeError("Failed to fetch")),
    });
    const state = yield* Effect.gen(function* () {
      const client = yield* LocalBridgeClient;
      yield* connect;
      expect(yield* Effect.flip(client.disconnect)).toMatchObject({
        _tag: "LocalBridgeConnectionError",
      });
      return yield* client.current;
    }).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
    expect(state.resumable).toBe(false);
    expect(storage.getItem(KEPT_KEY)).toBeNull();
    // A reload finds nothing to resume.
    const returning = yield* Effect.flatMap(
      LocalBridgeClient,
      (client) => client.current,
    ).pipe(Effect.provide(clientLayer(bridge.transport, storage)));
    expect(returning).toEqual({
      connection: { state: "disconnected" },
      resumable: false,
    });
  }),
);

it.effect(
  "an interrupted read aborts its request and leaves the connection as it was",
  () =>
    Effect.gen(function* () {
      const sent = yield* Deferred.make<AbortSignal>();
      const bridge = fakeBridge({
        [LOCAL_BRIDGE_PATHS.selectedItem]: () => new Promise<never>(() => {}),
      });
      const transport: typeof fetch = (input, init) => {
        if (
          init?.signal &&
          requestUrl(input).pathname === LOCAL_BRIDGE_PATHS.selectedItem
        ) {
          Deferred.doneUnsafe(sent, Effect.succeed(init.signal));
        }
        return bridge.transport(input, init);
      };
      yield* Effect.gen(function* () {
        const client = yield* LocalBridgeClient;
        yield* connect;
        const load = yield* Effect.forkChild(client.loadSelectedItem);
        const signal = yield* Deferred.await(sent);

        yield* Fiber.interrupt(load);

        expect(signal.aborted).toBe(true);
        expect(yield* client.current).toEqual({
          connection: CONNECTED,
          resumable: true,
        });
      }).pipe(Effect.provide(clientLayer(transport)));
    }),
);
