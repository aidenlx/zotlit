import { expect, it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { createHash } from "node:crypto";

import { managedBinaryPorts } from "./platform";
import {
  HashMismatchError,
  layerManagedBinary,
  ManagedBinaryPlatform,
} from "./service";
import type {
  ManagedBinary,
  ManagedBinaryApi,
  ManagedBinaryStatus,
} from "./service";
import { memoryDevice } from "./test-utils";

class TestBinary extends Context.Service<
  TestBinary,
  ManagedBinaryApi<Disposable>
>()("zotlit/managed-binary/TestBinary") {}

it.effect("releases the shared engine when its layer scope closes", () =>
  Effect.gen(function* () {
    const bytes = new TextEncoder().encode("binary");
    let releases = 0;
    const device = memoryDevice();
    const layer = layerManagedBinary(TestBinary, {
      id: "test-binary",
      label: "Test binary",
      logCategory: ["managed-binary"],
      pin: {
        version: "1",
        url: "https://example.invalid/binary",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      createEngine: () =>
        Promise.resolve({
          [Symbol.dispose]: () => {
            releases++;
          },
        }),
    }).pipe(
      Layer.provide(
        Layer.succeed(
          ManagedBinaryPlatform,
          managedBinaryPorts({
            ...device,
            download: () => Promise.resolve(bytes),
          }),
        ),
      ),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer);
        const binary = Context.get(context, TestBinary);
        yield* binary.install;
        // Each borrow ends before the next; the engine stays between them.
        const engine = yield* Effect.scoped(binary.getEngine);
        expect(yield* Effect.scoped(binary.getEngine)).toBe(engine);
        expect(releases).toBe(0);
      }),
    );
    expect(releases).toBe(1);
  }),
);

it.effect("publishes the current status and each later change", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = memoryDevice();
      const context = yield* Layer.build(testLayer(device));
      const binary = Context.get(context, TestBinary);
      const statuses = yield* Queue.unbounded<ManagedBinaryStatus>();
      yield* Effect.forkScoped(
        Stream.runForEach(binary.changes, (status) =>
          Queue.offer(statuses, status),
        ),
        { startImmediately: true },
      );
      expect(yield* Queue.take(statuses)).toEqual({ kind: "absent" });
      yield* binary.decline;
      expect(yield* Queue.take(statuses)).toEqual({ kind: "declined" });
      const install = yield* Effect.forkChild(binary.install);
      expect((yield* Queue.take(statuses)).kind).toBe("installing");
      yield* Fiber.join(install);
      expect((yield* Queue.take(statuses)).kind).toBe("installed");
      yield* binary.uninstall;
      expect(yield* Queue.take(statuses)).toEqual({ kind: "absent" });
    }),
  ),
);

it.effect(
  "fails a joined install with the error of the install it joined",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = memoryDevice();
        const context = yield* Layer.build(
          testLayer(device, { pin: { ...PIN, sha256: "0".repeat(64) } }),
        );
        const binary = Context.get(context, TestBinary);
        const first = yield* Effect.forkChild(Effect.flip(binary.install), {
          startImmediately: true,
        });
        expect((yield* binary.getStatus).kind).toBe("installing");

        const joined = yield* Effect.flip(binary.install);
        const own = yield* Fiber.join(first);

        expect(joined).toBeInstanceOf(HashMismatchError);
        expect(joined).toBe(own);
        expect((yield* binary.getStatus).kind).toBe("failed");
      }),
    ),
);

it.effect.each([false, true])(
  "waits for pending engine acquisition on scope close (install probe: %s)",
  (startOnInstall) =>
    Effect.gen(function* () {
      const device = memoryDevice();
      const started = yield* Deferred.make<void>();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      let releases = 0;
      const scope = yield* Scope.make();
      const context = yield* Layer.build(
        testLayer(device, {
          startOnInstall,
          createEngine: () =>
            runPromise(
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Effect.sleep("1 second");
                return {
                  [Symbol.dispose]: () => {
                    releases++;
                  },
                };
              }),
            ),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      const binary = Context.get(context, TestBinary);
      if (!startOnInstall) yield* binary.install;
      const operation = yield* Effect.forkChild(
        startOnInstall ? binary.install : binary.getEngine,
      );
      yield* Deferred.await(started);
      const close = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      expect(releases).toBe(0);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(close);
      yield* Fiber.await(operation);
      expect(releases).toBe(1);
    }),
);

const BYTES = new TextEncoder().encode("binary");
const PIN = {
  version: "1",
  url: "https://example.invalid/binary",
  sha256: createHash("sha256").update(BYTES).digest("hex"),
};

// #1705: platform operations run in the caller's Effect context and Clock.
it.effect("drives download, store, and consent Effects with TestClock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = new Map<string, Uint8Array<ArrayBuffer>>();
      let consent: unknown = true;
      const writing = yield* Deferred.make<void>();
      const layer = layerManagedBinary(TestBinary, {
        id: "test-binary",
        label: "Test binary",
        logCategory: ["managed-binary"],
        pin: PIN,
        createEngine: () => Promise.resolve({ [Symbol.dispose]: () => {} }),
      }).pipe(
        Layer.provide(
          Layer.succeed(ManagedBinaryPlatform, {
            openStore: () =>
              Effect.succeed({
                list: Effect.sync(() => [...files.keys()]),
                read: (name: string) =>
                  Effect.sync(() =>
                    files.has(name) ? new Blob([files.get(name)!]) : undefined,
                  ),
                write: (name: string, bytes: Uint8Array<ArrayBuffer>) =>
                  Effect.gen(function* () {
                    yield* Deferred.succeed(writing, undefined);
                    yield* Effect.sleep("1 second");
                    files.set(name, bytes);
                  }),
                rename: (from: string, to: string) =>
                  Effect.sync(() => {
                    files.set(to, files.get(from)!);
                    files.delete(from);
                  }),
                remove: (name: string) =>
                  Effect.sync(() => {
                    files.delete(name);
                  }),
                clear: Effect.sync(() => files.clear()),
              }),
            download: () => Effect.sleep("1 second").pipe(Effect.as(BYTES)),
            consent: {
              loadLocalStorage: () => Effect.sync(() => consent),
              saveLocalStorage: (_key: string, value: unknown) =>
                Effect.sync(() => {
                  consent = value;
                }),
            },
          }),
        ),
      );
      const binary = Context.get(yield* Layer.build(layer), TestBinary);
      const installing = yield* Effect.forkChild(binary.install, {
        startImmediately: true,
      });
      expect(consent).toBeNull();
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(writing);
      expect(files.size).toBe(0);
      expect((yield* binary.getStatus).kind).toBe("installing");
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(installing);
      expect((yield* binary.getStatus).kind).toBe("installed");
      expect([...files.keys()]).toEqual([`${PIN.sha256}.wasm`]);
      yield* binary.uninstall;
      yield* binary.decline;
      expect(consent).toBe(true);
      expect(files.size).toBe(0);
      expect((yield* binary.getStatus).kind).toBe("declined");
    }),
  ),
);

it.effect(
  "keeps an uninstall at absent when an engine start races its cache clear",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = slowClearDevice();
        const binary = Context.get(
          yield* Layer.build(testLayer(device)),
          TestBinary,
        );
        yield* binary.install;
        const statuses = yield* Queue.unbounded<ManagedBinaryStatus>();
        yield* Effect.forkScoped(
          Stream.runForEach(binary.changes, (status) =>
            Queue.offer(statuses, status),
          ),
          { startImmediately: true },
        );
        expect((yield* Queue.take(statuses)).kind).toBe("installed");

        const uninstall = yield* Effect.forkChild(binary.uninstall, {
          startImmediately: true,
        });
        yield* Effect.promise(() => device.clearing.promise);
        const start = yield* Effect.forkChild(
          Effect.flip(Effect.scoped(binary.getEngine)),
          { startImmediately: true },
        );
        device.cleared.resolve();
        yield* Fiber.join(uninstall);
        const error = yield* Fiber.join(start);

        expect(yield* Queue.take(statuses)).toEqual({ kind: "absent" });
        expect(yield* Queue.size(statuses)).toBe(0);
        expect(yield* binary.getStatus).toEqual({ kind: "absent" });
        expect(error.message).toBe("The Test binary is not installed");
      }),
    ),
);

it.effect("installs again after an uninstall that an install overlaps", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = memoryDevice();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const binary = Context.get(
        yield* Layer.build(
          testLayer({
            ...device,
            openStore: (directory) => {
              const store = device.openStore(directory);
              // A slow device: the files go as the clear ends.
              return {
                ...store,
                clear: async () => {
                  await runPromise(Effect.sleep("1 second"));
                  await store.clear();
                },
              };
            },
          }),
        ),
        TestBinary,
      );
      yield* binary.install;

      const uninstall = yield* Effect.forkChild(binary.uninstall, {
        startImmediately: true,
      });
      const install = yield* Effect.forkChild(binary.install, {
        startImmediately: true,
      });
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(uninstall);
      yield* Fiber.join(install);

      expect((yield* binary.getStatus).kind).toBe("installed");
      expect(device.names("test-binary")).toEqual([`${PIN.sha256}.wasm`]);
    }),
  ),
);

it.effect(
  "shares one install between the installs queued behind an uninstall",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = memoryDevice();
        const runPromise = Effect.runPromiseWith(
          yield* Effect.context<never>(),
        );
        let downloads = 0;
        const binary = Context.get(
          yield* Layer.build(
            testLayer(
              {
                ...device,
                openStore: (directory) => {
                  const store = device.openStore(directory);
                  return {
                    ...store,
                    clear: async () => {
                      await runPromise(Effect.sleep("1 second"));
                      await store.clear();
                    },
                  };
                },
              },
              {},
              () => {
                downloads++;
                return downloads === 1
                  ? Promise.resolve(BYTES)
                  : Promise.reject(new Error("offline"));
              },
            ),
          ),
          TestBinary,
        );
        yield* binary.install;

        yield* Effect.forkChild(binary.uninstall, { startImmediately: true });
        const first = yield* Effect.forkChild(Effect.flip(binary.install), {
          startImmediately: true,
        });
        const second = yield* Effect.forkChild(Effect.flip(binary.install), {
          startImmediately: true,
        });
        yield* TestClock.adjust("1 second");
        const own = yield* Fiber.join(first);

        expect(yield* Fiber.join(second)).toBe(own);
        expect(own.message).toBe("offline");
        expect(downloads).toBe(2);
      }),
    ),
);

it.effect("closes while an install waits behind a stalled cache read", () =>
  Effect.gen(function* () {
    const device = memoryDevice();
    const scope = yield* Scope.make();
    const building = yield* Effect.forkChild(
      Layer.build(
        testLayer({
          ...device,
          openStore: (directory) => ({
            ...device.openStore(directory),
            // The cache never answers, so discovery holds the lane.
            list: () => new Promise<string[]>(() => {}),
          }),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope)),
      { startImmediately: true },
    );
    yield* TestClock.adjust("5 seconds");
    const binary = Context.get(yield* Fiber.join(building), TestBinary);
    yield* Effect.forkChild(binary.install, { startImmediately: true });

    const close = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
      startImmediately: true,
    });
    yield* TestClock.adjust("1 second");

    expect(yield* Fiber.join(close)).toBeUndefined();
  }),
);

it.effect("keeps each install after the uninstall queued before it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = memoryDevice();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const clearing = yield* Queue.unbounded<void>();
      const binary = Context.get(
        yield* Layer.build(
          testLayer({
            ...device,
            openStore: (directory) => {
              const store = device.openStore(directory);
              return {
                ...store,
                clear: async () => {
                  await runPromise(Queue.offer(clearing, undefined));
                  await runPromise(Effect.sleep("1 second"));
                  await store.clear();
                },
              };
            },
          }),
        ),
        TestBinary,
      );
      yield* binary.install;

      const calls = [
        binary.uninstall,
        binary.install,
        binary.uninstall,
        binary.install,
      ];
      const fibers = [];
      for (const call of calls)
        fibers.push(yield* Effect.forkChild(call, { startImmediately: true }));
      // Each uninstall's clear begins, then ends a second later.
      for (const _ of [1, 2]) {
        yield* Queue.take(clearing);
        yield* TestClock.adjust("1 second");
      }
      for (const fiber of fibers) yield* Fiber.join(fiber);

      expect((yield* binary.getStatus).kind).toBe("installed");
      expect(device.names("test-binary")).toEqual([`${PIN.sha256}.wasm`]);
    }),
  ),
);

it.effect("answers an install that arrives while the layer closes", () =>
  Effect.gen(function* () {
    const device = slowClearDevice();
    const scope = yield* Scope.make();
    const binary = Context.get(
      yield* Layer.build(testLayer(device)).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
      TestBinary,
    );
    yield* binary.install;
    yield* Effect.forkChild(binary.uninstall, { startImmediately: true });
    yield* Effect.promise(() => device.clearing.promise);
    // The close waits for the uninstall's clear.
    const close = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
      startImmediately: true,
    });

    const install = yield* Effect.forkChild(binary.install, {
      startImmediately: true,
    });
    device.cleared.resolve();
    yield* Fiber.join(close);

    expect(Exit.isSuccess(yield* Fiber.await(install))).toBe(true);
  }),
);

it.effect("keeps a borrowed engine usable until its borrower ends", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let releases = 0;
      const binary = Context.get(
        yield* Layer.build(
          testLayer(memoryDevice(), {
            createEngine: () =>
              Promise.resolve({
                [Symbol.dispose]: () => {
                  releases++;
                },
              }),
          }),
        ),
        TestBinary,
      );
      yield* binary.install;

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* binary.getEngine;
          yield* binary.uninstall;
          expect(yield* binary.getStatus).toEqual({ kind: "absent" });
          expect(releases).toBe(0);
        }),
      );

      expect(releases).toBe(1);
    }),
  ),
);

it.effect("keeps an engine whose first borrower left while it started", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    let starts = 0;
    let releases = 0;
    const binary = Context.get(
      yield* Layer.build(
        testLayer(memoryDevice(), {
          createEngine: () =>
            runPromise(
              Effect.gen(function* () {
                starts++;
                yield* Deferred.succeed(started, undefined);
                yield* Effect.sleep("1 second");
                return {
                  [Symbol.dispose]: () => {
                    releases++;
                  },
                };
              }),
            ),
        }),
      ),
      TestBinary,
    );
    yield* binary.install;

    // A render that is cancelled while the engine starts.
    const first = yield* Effect.forkChild(Effect.scoped(binary.getEngine));
    yield* Deferred.await(started);
    const cancel = yield* Effect.forkChild(Fiber.interrupt(first));
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(cancel);
    const second = yield* Effect.forkChild(Effect.scoped(binary.getEngine));
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(second);

    expect(starts).toBe(1);
    expect(releases).toBe(0);
  }).pipe(Effect.scoped),
);

it.effect(
  "offers the install again when the cached binary is gone from the device",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = memoryDevice();
        const binary = Context.get(
          yield* Layer.build(testLayer(device)),
          TestBinary,
        );
        yield* binary.install;
        // Another vault on this device removed the shared cache.
        device.files("test-binary").clear();

        const error = yield* Effect.flip(Effect.scoped(binary.getEngine));

        expect(error.message).toBe("The cached Test binary binary is gone");
        expect(yield* binary.getStatus).toEqual({ kind: "absent" });
      }),
    ),
);

/**
 * A device whose cache clear removes the files at once and ends only when the
 * test resolves `cleared`, as a slow device's does; `clearing` resolves as the
 * files go.
 */
function slowClearDevice() {
  const device = memoryDevice();
  const clearing = Promise.withResolvers<void>();
  const cleared = Promise.withResolvers<void>();
  return {
    ...device,
    clearing,
    cleared,
    openStore: (directory: string) => {
      const store = device.openStore(directory);
      return {
        ...store,
        clear: async () => {
          await store.clear();
          clearing.resolve();
          await cleared.promise;
        },
      };
    },
  };
}

function testLayer(
  device: ReturnType<typeof memoryDevice>,
  overrides: Partial<ManagedBinary<Disposable>> = {},
  download: () => Promise<Uint8Array<ArrayBuffer>> = () =>
    Promise.resolve(BYTES),
) {
  return layerManagedBinary(TestBinary, {
    id: "test-binary",
    label: "Test binary",
    logCategory: ["managed-binary"],
    pin: PIN,
    createEngine: () => Promise.resolve({ [Symbol.dispose]: () => {} }),
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.succeed(
        ManagedBinaryPlatform,
        managedBinaryPorts({
          ...device,
          download,
        }),
      ),
    ),
  );
}
