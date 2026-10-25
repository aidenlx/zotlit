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
import { layerManagedBinary, ManagedBinaryPlatform } from "./service";
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
        const engine = yield* binary.getEngine;
        expect(yield* binary.getEngine).toBe(engine);
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

function testLayer(
  device: ReturnType<typeof memoryDevice>,
  overrides: Partial<ManagedBinary<Disposable>> = {},
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
          download: () => Promise.resolve(BYTES),
        }),
      ),
    ),
  );
}
