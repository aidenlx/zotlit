import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Logger, Queue, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import { expect } from "vitest";

import { MemoryDeviceStorage } from "@/lib/__fixtures__/obsidian-device-storage";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { LogCategory } from "@/lib/effect-log";

import { ledgerHost, useLedgerOf } from "./__fixtures__";

const itemKey = (n: number) =>
  n
    .toString(6)
    .split("")
    .map((digit) => "ABCDEF"[Number(digit)])
    .join("")
    .padStart(8, "A");

/** Device storage whose read throws, as a corrupt saved ledger would. */
class UnreadableStorage extends MemoryDeviceStorage {
  override loadLocalStorage(): unknown {
    throw new SyntaxError("Unexpected token");
  }
}

// Failure modes: the cap drops a recently used Item, an update consumes a
// second slot, or reloading restores entries already dropped by the cap.
it.effect("keeps the 300 most recently used Items across reloads", () =>
  Effect.gen(function* () {
    const host = ledgerHost();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* useLedgerOf(host);
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

    const reloaded = yield* useLedgerOf(host);
    expect(Object.keys(yield* reloaded.current)).toHaveLength(300);
    expect(yield* reloaded.get("AAAAAAAB")).toBeUndefined();
    expect((yield* reloaded.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
      301,
    );
  }),
);

// Failure mode: the saved instants change form, so a stored ledger differs
// from the one earlier versions wrote.
it.effect("saves each instant in the ISO form it has always had", () =>
  Effect.gen(function* () {
    const host = ledgerHost();
    const storage = host.deviceStorage;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* useLedgerOf(host);
        yield* TestClock.adjust(1000);
        yield* ledger.record("AAAAAAAA", "opened");
        yield* TestClock.adjust(120);
        yield* ledger.record("AAAAAAAB", "cited");
      }),
    );
    // Earlier versions saved under this key; a renamed key loses every Use.
    expect([...storage.values.keys()]).toEqual(["zotlit-use-ledger"]);
    expect(storage.loadLocalStorage("zotlit-use-ledger")).toEqual({
      AAAAAAAA: { instant: "1970-01-01T00:00:01Z", kind: "opened" },
      AAAAAAAB: { instant: "1970-01-01T00:00:01.12Z", kind: "cited" },
    });

    const reloaded = yield* useLedgerOf(host);
    expect((yield* reloaded.get("AAAAAAAB"))?.instant.epochMilliseconds).toBe(
      1120,
    );
  }),
);

// Failure modes: an Item note opened after unload still records a Use, or
// the ledger leaves its workspace listeners behind.
it.effect(
  "stops recording and releases its listeners when its scope closes",
  () =>
    Effect.gen(function* () {
      const metadataCache = new MemoryMetadataCache();
      const workspace = new MemoryWorkspace();
      const host = ledgerHost({ workspace, metadataCache });

      const ledger = yield* Effect.scoped(useLedgerOf(host));
      yield* ledger.record("AAAAAAAA", "opened");

      // The workspace and metadata cache listeners close with the ledger and
      // with the tags it reads, which close with it here.
      expect(workspace.listenerCount("file-open")).toBe(0);
      expect(metadataCache.listenerCount("changed")).toBe(0);
      expect(yield* ledger.current).toEqual({});
      expect(host.deviceStorage.values.size).toBe(0);
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
      const host = ledgerHost({ deviceStorage: new UnreadableStorage() });

      const ledger = yield* useLedgerOf(host).pipe(
        Effect.provide(Logger.layer([capture])),
      );

      expect(yield* ledger.current).toEqual({});
      expect(logged).toEqual([{ level: "Warn", category: ["use-ledger"] }]);
    }),
);

// Failure modes: a note Obsidian restores at startup counts as opened, or a
// note opened once the layout is ready records no Use.
it.effect("records an opened Item note only once the layout is ready", () =>
  Effect.gen(function* () {
    const metadataCache = new MemoryMetadataCache();
    const workspace = new MemoryWorkspace();
    const note = new TFile();
    note.path = "Paper.md";
    note.extension = "md";
    metadataCache.setCache(note.path, {
      frontmatter: { [FIELD_ZOTERO_KEY]: "AAAAAAAA" },
    });
    const ledger = yield* useLedgerOf(ledgerHost({ workspace, metadataCache }));

    workspace.open(note);
    expect(yield* ledger.get("AAAAAAAA")).toBeUndefined();

    workspace.layoutReady();
    workspace.open(note);
    expect((yield* ledger.get("AAAAAAAA"))?.kind).toBe("opened");
  }),
);

// Failure modes: an open Obsidian deferred from before a Companion update is
// dropped as the update's own, or the update's own navigation counts as a Use.
it.effect(
  "counts a deferred open before an update and not the update's own",
  () =>
    Effect.gen(function* () {
      const metadataCache = new MemoryMetadataCache();
      const workspace = new MemoryWorkspace({ layoutReady: true });
      const note = new TFile();
      note.path = "Paper.md";
      note.extension = "md";
      metadataCache.setCache(note.path, {
        frontmatter: { [FIELD_ZOTERO_KEY]: "AAAAAAAA" },
      });
      const ledger = yield* useLedgerOf(
        ledgerHost({ workspace, metadataCache }),
      );

      yield* TestClock.adjust(1);
      workspace.deferOpen(note);
      yield* ledger.withoutNoteUse(
        note,
        Effect.gen(function* () {
          yield* TestClock.adjust(1);
          workspace.open(note);
        }),
      );

      expect((yield* ledger.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
        1,
      );
    }),
);

// #1705: a state subscriber sees the current value, then each update, and its
// stream ends when the service stops.
it.effect(
  "changes replays the current Uses, delivers updates and ends when the scope closes",
  () =>
    Effect.gen(function* () {
      const host = ledgerHost();
      const scope = yield* Scope.make();
      const ledger = yield* useLedgerOf(host).pipe(Scope.provide(scope));
      const delivered = yield* Queue.unbounded<number>();
      const listening = yield* Stream.runForEach(ledger.changes, (entries) =>
        Queue.offer(delivered, Object.keys(entries).length),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* ledger.record("AAAAAAAA", "opened");
      yield* ledger.record("BBBBBBBB", "opened");
      expect(yield* Queue.take(delivered)).toBe(0);
      expect(yield* Queue.take(delivered)).toBe(1);
      expect(yield* Queue.take(delivered)).toBe(2);
      const late = yield* Stream.runCollect(Stream.take(ledger.changes, 1));
      expect(Object.keys(late[0]!)).toHaveLength(2);
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(listening);
      expect(yield* Queue.size(delivered)).toBe(0);
    }),
);
