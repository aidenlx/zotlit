import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import type { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { Effect, Logger } from "@/lib/effect";
import { LogCategory } from "@/lib/effect-log";
import { it } from "@/lib/effect-vitest";

import { fakeApp, useLedgerOf } from "./__fixtures__";

const itemKey = (n: number) =>
  n
    .toString(6)
    .split("")
    .map((digit) => "ABCDEF"[Number(digit)])
    .join("")
    .padStart(8, "A");

// Failure modes: the cap drops a recently used Item, an update consumes a
// second slot, or reloading restores entries already dropped by the cap.
it.effect("keeps the 300 most recently used Items across reloads", () =>
  Effect.gen(function* () {
    let stored: unknown;
    const app = fakeApp({
      load: () => stored,
      save: (_key, value) => {
        stored = structuredClone(value);
      },
    });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* useLedgerOf(app);
        for (let item = 0; item < 300; item++) {
          yield* TestClock.adjust(1);
          yield* ledger.record(itemKey(item), "opened");
        }
        yield* TestClock.adjust(1);
        yield* ledger.record("AAAAAAAA", "opened");
        yield* TestClock.adjust(1);
        yield* ledger.record("NEWKEYZZ", "opened");
        expect(Object.keys(yield* ledger.current)).toHaveLength(300);
        expect(yield* ledger.get("AAAAAAAB")).toBeUndefined();
        expect((yield* ledger.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
          301,
        );
        expect((yield* ledger.get("NEWKEYZZ"))?.instant.epochMilliseconds).toBe(
          302,
        );
      }),
    );

    const reloaded = yield* useLedgerOf(app);
    expect(Object.keys(yield* reloaded.current)).toHaveLength(300);
    expect(yield* reloaded.get("AAAAAAAB")).toBeUndefined();
    expect((yield* reloaded.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
      301,
    );
  }),
);

// Failure modes: an Item note opened after unload still records a Use, or
// the ledger leaves its workspace listeners behind.
it.effect(
  "stops recording and releases its listeners when its scope closes",
  () =>
    Effect.gen(function* () {
      const offref = vi.fn();
      const save = vi.fn();
      const app = fakeApp({ load: () => undefined, save, offref });

      const ledger = yield* Effect.scoped(useLedgerOf(app));
      yield* ledger.record("AAAAAAAA", "opened");

      // The workspace listener is the ledger's; the metadata cache's belongs
      // to the MetadataCache tag, which closes with it here.
      expect(offref).toHaveBeenCalledTimes(1);
      expect(
        (app.metadataCache as unknown as MemoryMetadataCache).listenerCount(
          "changed",
        ),
      ).toBe(0);
      expect(yield* ledger.current).toEqual({});
      expect(save).not.toHaveBeenCalled();
    }),
);

// Failure modes: a corrupt saved ledger stops plugin load, or the fallback
// to an empty ledger leaves no trace in the log.
it.effect(
  "starts empty and logs a warning when the saved Uses cannot be read",
  () =>
    Effect.gen(function* () {
      const logged: { level: string; category: readonly string[] }[] = [];
      const capture = Logger.make(({ logLevel, fiber }) => {
        logged.push({ level: logLevel, category: fiber.getRef(LogCategory) });
      });
      const app = fakeApp({
        load: () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      const ledger = yield* useLedgerOf(app).pipe(
        Effect.provide(Logger.layer([capture])),
      );

      expect(yield* ledger.current).toEqual({});
      expect(logged).toEqual([{ level: "Warn", category: ["use-ledger"] }]);
    }),
);
