// The Workbench Connection over a fake Local Bridge: which reads a Disconnect,
// a closed page and a newer draft stop.
import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  SubscriptionRef,
} from "effect";
import { expect } from "vitest";

import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  LocalBridgeClient,
} from "@zotlit/workbench/bridge";
import type {
  LocalBridgeConnection,
  LocalBridgeState,
} from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

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

/** A draft that calls one partial, which the held bundle does not answer. */
const calling = (name: string) => ({
  source: `${DEFAULT_PROFILE_SOURCE}\n{% render "${name}" %}`,
  names: name,
});

/**
 * A Local Bridge that answers hydration at once and holds every later Item
 * load and dependency read open, noting each dependency read it was asked for
 * and each held read that was interrupted. A held read stops only once
 * `stopped` is done.
 */
const heldBridge = Effect.gen(function* () {
  const started = {
    item: yield* Deferred.make<void>(),
    dependencies: yield* Deferred.make<void>(),
  };
  const stopped = yield* Deferred.make<void>();
  const interrupted: string[] = [];
  const dependencyReads: string[] = [];
  const client = yield* SubscriptionRef.make<LocalBridgeState>({
    connection: CONNECTED,
    resumable: true,
  });
  const held = (name: keyof typeof started): Effect.Effect<never> =>
    Deferred.succeed(started[name], undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Deferred.await(stopped).pipe(
          Effect.andThen(Effect.sync(() => interrupted.push(name))),
        ),
      ),
    );
  const layer = Layer.succeed(
    LocalBridgeClient,
    LocalBridgeClient.of({
      current: SubscriptionRef.get(client),
      changes: SubscriptionRef.changes(client),
      connectFromFragment: () => Effect.succeed(CONNECTED),
      resume: Effect.succeed(CONNECTED),
      disconnect: SubscriptionRef.set(client, {
        connection: { state: "disconnected" },
        resumable: false,
      }),
      readTemplateSchema: Effect.succeed({
        note: {},
        annotation: {},
        filename: {},
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
      readTemplateDependencies: ({ source }) =>
        Effect.suspend(() =>
          dependencyReads.push(source) === 1
            ? Effect.succeed({ templates: [], diagnostics: [] })
            : held("dependencies"),
        ),
      listCitationStyles: Effect.succeed([]),
      readSelectedCitationStyle: () => Effect.succeed({ kind: "default" }),
    }),
  );
  return {
    started,
    stopped,
    interrupted,
    dependencyReads,
    layer: layerWorkbenchConnection.pipe(Layer.provide(layer)),
  };
});

/** Opens the connection, then starts an Item load and a dependency read. */
const startReads = Effect.gen(function* () {
  const connection = yield* WorkbenchConnection;
  yield* connection.reload;
  yield* connection.followDependencies(calling("summary"));
  return yield* Effect.forkChild(connection.loadSelectedItem);
});

it.effect("Disconnect stops the reads its connection started", () =>
  Effect.gen(function* () {
    const fake = yield* heldBridge;
    yield* Deferred.succeed(fake.stopped, undefined);
    const state = yield* Effect.gen(function* () {
      const connection = yield* WorkbenchConnection;
      const load = yield* startReads;
      yield* Deferred.await(fake.started.item);
      yield* Deferred.await(fake.started.dependencies);

      expect(yield* connection.disconnect).toBe(true);

      expect(yield* Fiber.await(load)).toSatisfy(Exit.hasInterrupts);
      return yield* connection.current;
    }).pipe(Effect.provide(fake.layer));
    expect(fake.interrupted.toSorted()).toEqual(["dependencies", "item"]);
    expect(state).toMatchObject({
      connection: { state: "disconnected" },
      itemBusy: false,
      resourcesStale: false,
      resources: undefined,
    });
  }),
);

it.effect(
  "closing the page stops a pending Item load and dependency read",
  () =>
    Effect.gen(function* () {
      const fake = yield* heldBridge;
      yield* Deferred.succeed(fake.stopped, undefined);
      const page = yield* Scope.make();
      const services = yield* Layer.buildWithScope(fake.layer, page);
      const load = yield* Effect.provideContext(startReads, services);
      yield* Deferred.await(fake.started.item);
      yield* Deferred.await(fake.started.dependencies);

      yield* Scope.close(page, Exit.void);

      expect(yield* Fiber.await(load)).toSatisfy(Exit.hasInterrupts);
      expect(fake.interrupted.toSorted()).toEqual(["dependencies", "item"]);
    }),
);

it.effect(
  "a newer draft reads its bundle while the older read still stops",
  () =>
    Effect.gen(function* () {
      const fake = yield* heldBridge;
      yield* Effect.gen(function* () {
        const connection = yield* WorkbenchConnection;
        yield* connection.reload;
        yield* connection.followDependencies(calling("summary"));
        yield* Deferred.await(fake.started.dependencies);

        const newer = yield* Effect.forkChild(
          connection.followDependencies(calling("abstract")),
          { startImmediately: true },
        );
        yield* Effect.yieldNow;

        // The older read has not finished stopping, and the newer one is out.
        expect(fake.interrupted).toEqual([]);
        expect(fake.dependencyReads).toEqual([
          DEFAULT_PROFILE_SOURCE,
          calling("summary").source,
          calling("abstract").source,
        ]);
        yield* Deferred.succeed(fake.stopped, undefined);
        yield* Fiber.join(newer);
      }).pipe(Effect.provide(fake.layer));
    }),
);
