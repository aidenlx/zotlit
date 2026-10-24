import { createHash } from "node:crypto";

import { Effect, Stream } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import { expect, it } from "@/lib/effect-vitest";

import { openManagedBinary } from "./__fixtures__";
import { memoryDevice } from "./test-utils";

it.effect(
  "returns released values from every handle method after runtime disposal",
  () =>
    Effect.promise(async () => {
      const bytes = new TextEncoder().encode("binary");
      const device = memoryDevice();
      let downloads = 0;
      let starts = 0;
      let releases = 0;
      await using binary = await openManagedBinary(
        {
          id: "test-binary",
          label: "Test binary",
          logCategory: ["managed-binary"],
          pin: {
            version: "1",
            url: "https://example.invalid/binary",
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          createEngine: () => {
            starts++;
            return Promise.resolve({
              [Symbol.dispose]: () => {
                releases++;
              },
            });
          },
        },
        {
          ...device,
          download: () => {
            downloads++;
            return Promise.resolve(bytes);
          },
        },
      );
      const { handle, runtime, service } = binary;
      await handle.runPromise(service.install());
      await handle.runPromise(service.getEngine());
      const snapshot = handle.runSync(service.getStatus());
      let changes = 0;
      const unsubscribe = subscribe(
        runtime,
        Stream.drop(service.changes, 1),
        () => {
          changes++;
        },
      );
      await binary[Symbol.asyncDispose]();
      expect(releases).toBe(1);
      expect(handle.runSync(service.getStatus())).toBe(snapshot);
      await expect(handle.runPromise(service.getEngine())).resolves.toBeNull();
      await expect(
        handle.runPromise(service.install()),
      ).resolves.toBeUndefined();
      await expect(
        handle.runPromise(service.uninstall()),
      ).resolves.toBeUndefined();
      expect(() => handle.runSync(service.decline())).not.toThrow();
      const afterClose = subscribe(
        runtime,
        Stream.drop(service.changes, 1),
        () => {
          changes++;
        },
      );
      afterClose();
      unsubscribe();
      expect(changes).toBe(0);
      expect(handle.runSync(service.getStatus())).toBe(snapshot);
      expect(downloads).toBe(1);
      expect(starts).toBe(1);
      expect(device.names("test-binary")).toEqual([
        `${createHash("sha256").update(bytes).digest("hex")}.wasm`,
      ]);
      expect(
        device.consent.loadLocalStorage("zotlit-test-binary-declined"),
      ).toBeNull();
    }),
);

it.effect("keeps a throwing listener subscribed for immediate changes", () =>
  Effect.promise(async () => {
    const bytes = new TextEncoder().encode("binary");
    const download = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    await using binary = await openManagedBinary(
      {
        id: "test-binary",
        label: "Test binary",
        logCategory: ["managed-binary"],
        pin: {
          version: "1",
          url: "https://example.invalid/binary",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        createEngine: () => Promise.resolve({ [Symbol.dispose]: () => {} }),
      },
      { ...memoryDevice(), download: () => download.promise },
    );
    const { handle, runtime, service } = binary;
    let changes = 0;
    const installed = Promise.withResolvers<void>();
    const unsubscribe = subscribe(
      runtime,
      Stream.drop(service.changes, 1),
      () => {
        changes++;
        if (changes === 1) throw new Error("listener failed");
        if (handle.runSync(service.getStatus()).kind === "installed")
          installed.resolve();
      },
    );
    expect(changes).toBe(0);
    handle.runSync(service.decline());
    const installing = handle.runPromise(service.install());
    download.resolve(bytes);
    await installing;
    await installed.promise;
    unsubscribe();
    expect(changes).toBe(3);
  }),
);

it.effect("joins two installs and stops notifying after unsubscribe", () =>
  Effect.promise(async () => {
    const device = memoryDevice();
    const bytes = new TextEncoder().encode("binary");
    const download = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    let downloads = 0;
    await using binary = await openManagedBinary(
      {
        id: "test-binary",
        label: "Test binary",
        logCategory: ["managed-binary"],
        pin: {
          version: "1",
          url: "https://example.invalid/binary",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        createEngine: () => Promise.resolve({ [Symbol.dispose]: () => {} }),
      },
      {
        ...device,
        download: () => {
          downloads++;
          return download.promise;
        },
      },
    );
    const { handle, runtime, service } = binary;
    const seen: string[] = [];
    const changed = Promise.withResolvers<void>();
    const unsubscribe = subscribe(
      runtime,
      Stream.drop(service.changes, 1),
      () => {
        seen.push(handle.runSync(service.getStatus()).kind);
        if (handle.runSync(service.getStatus()).kind === "installing")
          changed.resolve();
      },
    );
    const first = handle.runPromise(service.install());
    const second = handle.runPromise(service.install());
    await changed.promise;
    const installing = handle.runSync(service.getStatus());
    expect(handle.runSync(service.getStatus())).toBe(installing);
    unsubscribe();
    download.resolve(bytes);
    await Promise.all([first, second]);
    await handle.runPromise(service.uninstall());
    handle.runSync(service.decline());
    expect(downloads).toBe(1);
    expect(seen).toEqual(["installing"]);
    expect(handle.runSync(service.getStatus())).toEqual({ kind: "declined" });
  }),
);
