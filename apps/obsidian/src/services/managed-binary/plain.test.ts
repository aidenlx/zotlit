import { createHash } from "node:crypto";

import { Effect } from "@/lib/effect";
import { expect, it } from "@/lib/effect-vitest";

import { openManagedBinary } from "./__fixtures__";
import { memoryDevice } from "./test-utils";

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
