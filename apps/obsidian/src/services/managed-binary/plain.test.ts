import { createHash } from "node:crypto";

import { Effect } from "@/lib/effect";
import { expect, it } from "@/lib/effect-vitest";

import { openManagedBinary } from "./__fixtures__";
import { memoryDevice } from "./test-utils";

// #1705: exercise whole-runtime disposal, not only an inner layer scope.
it.effect(
  "returns released values from every adapter method after runtime disposal",
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
      await binary.install();
      await binary.getEngine();
      const snapshot = binary.getStatus();
      let changes = 0;
      const unsubscribe = binary.subscribe(() => {
        changes++;
      });
      await binary[Symbol.asyncDispose]();
      expect(releases).toBe(1);
      expect(binary.getStatus()).toBe(snapshot);
      await expect(binary.getEngine()).resolves.toBeNull();
      await expect(binary.install()).resolves.toBeUndefined();
      await expect(binary.uninstall()).resolves.toBeUndefined();
      expect(() => binary.decline()).not.toThrow();
      const afterClose = binary.subscribe(() => {
        changes++;
      });
      afterClose();
      unsubscribe();
      expect(changes).toBe(0);
      expect(binary.getStatus()).toBe(snapshot);
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

// #1705: a listener attaches before subscribe returns, including same-task changes.
it.effect("receives both changes made immediately after subscribing", () =>
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
    let changes = 0;
    const installed = Promise.withResolvers<void>();
    const unsubscribe = binary.subscribe(() => {
      changes++;
      if (binary.getStatus().kind === "installed") installed.resolve();
    });
    expect(changes).toBe(0);
    binary.decline();
    const installing = binary.install();
    download.resolve(bytes);
    await installing;
    await installed.promise;
    unsubscribe();
    expect(changes).toBe(3);
  }),
);

it.effect(
  "shares the install Promise and stops notifying after unsubscribe",
  () =>
    Effect.promise(async () => {
      const device = memoryDevice();
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
        { ...device, download: () => download.promise },
      );
      const seen: string[] = [];
      const changed = Promise.withResolvers<void>();
      const unsubscribe = binary.subscribe(() => {
        seen.push(binary.getStatus().kind);
        if (binary.getStatus().kind === "installing") changed.resolve();
      });
      const first = binary.install();
      expect(binary.install()).toBe(first);
      expect(binary.getStatus()).toEqual({
        kind: "installing",
        done: first,
        binary: null,
      });
      const snapshot = binary.getStatus();
      const nextSnapshot = binary.getStatus();
      await changed.promise;
      unsubscribe();
      download.resolve(bytes);
      await first;
      await binary.uninstall();
      binary.decline();
      expect(nextSnapshot).toBe(snapshot);
      expect(seen).toEqual(["installing"]);
      expect(binary.getStatus()).toEqual({ kind: "declined" });
    }),
);
