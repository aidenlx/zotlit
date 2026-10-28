// The Workbench Connection over a fake Local Bridge: which reads a Disconnect
// and a closed page stop.
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { expect, it } from "vitest";

import { BRIDGE_CAPABILITIES, BRIDGE_VERSION } from "@zotlit/workbench/bridge";
import type { LocalBridgeConnection } from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { LocalBridge } from "./local-bridge";
import {
  layerWorkbenchConnection,
  WorkbenchConnection,
} from "./workbench-connection";

const CONNECTED: LocalBridgeConnection = {
  state: "connected",
  installation: { id: "fixture-installation", vault: "Fixture vault" },
  pluginVersion: "2.1.1",
  bridgeVersion: BRIDGE_VERSION,
  templateDataContractVersion: SAMPLE_ITEMS[0]!.contractVersion,
  capabilities: [...BRIDGE_CAPABILITIES],
  selectedItem: null,
  selectedProfile: { id: "default", name: "Default" },
  profileDefaults: {
    folder: "fixture-literature",
    citationStyle: "ieee",
    importFolder: "fixture-notes",
    importColoredHighlights: true,
    importAnnotationsAsTemplate: false,
  },
};

/**
 * A Local Bridge that answers hydration at once and holds every later Item
 * load and dependency read open, noting each one that was interrupted.
 */
const heldBridge = Effect.gen(function* () {
  const started = {
    item: yield* Deferred.make<void>(),
    dependencies: yield* Deferred.make<void>(),
  };
  const interrupted: string[] = [];
  let connection: LocalBridgeConnection = CONNECTED;
  let dependencyReads = 0;
  const held = <A>(name: keyof typeof started) =>
    Deferred.succeed(started[name], undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => interrupted.push(name))),
    ) as Effect.Effect<A>;
  const layer = Layer.succeed(
    LocalBridge,
    LocalBridge.of({
      connection: Effect.sync(() => connection),
      resumable: Effect.succeed(true),
      connectFromFragment: () => Effect.succeed(connection),
      resume: Effect.succeed(connection),
      disconnect: Effect.sync(() => {
        connection = { state: "disconnected" };
      }),
      loadSelectedItem: held("item"),
      readSelectedProfile: Effect.succeed({
        profile: { id: "default", name: "Default" },
        source: DEFAULT_PROFILE_SOURCE,
        document: {
          state: "present",
          reference: "profile:default",
          revision: "revision-1",
        },
      }),
      saveSelectedProfile: () =>
        Effect.succeed({ state: "saved", revision: "revision-2" }),
      readTemplateDependencies: () =>
        Effect.suspend(() =>
          ++dependencyReads === 1
            ? Effect.succeed({ templates: [], diagnostics: [] })
            : held("dependencies"),
        ),
      listCitationStyles: Effect.succeed([]),
      readSelectedCitationStyle: () => Effect.succeed({ kind: "default" }),
    }),
  );
  return { started, interrupted, layer };
});

/** Opens the connection, then starts an Item load and a dependency read. */
const startReads = Effect.gen(function* () {
  const connection = yield* WorkbenchConnection;
  yield* connection.reload;
  yield* connection.followDependencies({
    source: `${DEFAULT_PROFILE_SOURCE}\n{% render "summary" %}`,
    names: "summary",
  });
  return yield* Effect.forkChild(connection.loadSelectedItem);
});

it("Disconnect stops the reads its connection started", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* heldBridge;
      const connection = yield* Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkbenchConnection;
          const load = yield* startReads;
          yield* Deferred.await(fake.started.item);
          yield* Deferred.await(fake.started.dependencies);

          expect(yield* service.disconnect).toBe(true);

          expect(yield* Fiber.await(load)).toSatisfy(Exit.hasInterrupts);
          return yield* service.current;
        }),
        layerWorkbenchConnection.pipe(Layer.provide(fake.layer)),
      );
      expect(fake.interrupted.toSorted()).toEqual(["dependencies", "item"]);
      expect(connection).toMatchObject({
        connection: { state: "disconnected" },
        itemBusy: false,
        resourcesStale: false,
        resources: undefined,
      });
    }),
  ));

it("closing the page stops a pending Item load and dependency read", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* heldBridge;
      const page = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        layerWorkbenchConnection.pipe(Layer.provide(fake.layer)),
        page,
      );
      const load = yield* Effect.provideContext(startReads, context);
      yield* Deferred.await(fake.started.item);
      yield* Deferred.await(fake.started.dependencies);

      yield* Scope.close(page, Exit.void);

      expect(yield* Fiber.await(load)).toSatisfy(Exit.hasInterrupts);
      expect(fake.interrupted.toSorted()).toEqual(["dependencies", "item"]);
    }),
  ));
