import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Logger, Queue, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import { expect, vi } from "vitest";

import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { LogCategory } from "@/lib/effect-log";

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
      const save = vi.fn();
      const metadataCache = new MemoryMetadataCache();
      const workspace = new MemoryWorkspace();
      const app = fakeApp({
        load: () => undefined,
        save,
        workspace,
        metadataCache,
      });

      const ledger = yield* Effect.scoped(useLedgerOf(app));
      yield* ledger.record("AAAAAAAA", "opened");

      // The workspace and metadata cache listeners close with the ledger and
      // with the tags it reads, which close with it here.
      expect(workspace.listenerCount("file-open")).toBe(0);
      expect(metadataCache.listenerCount("changed")).toBe(0);
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
    const ledger = yield* useLedgerOf(
      fakeApp({ load: () => undefined, workspace, metadataCache }),
    );

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
      const deferred: TFile[] = [];
      const workspace = Object.assign(
        new MemoryWorkspace({ layoutReady: true }),
        {
          // Obsidian's debounced active-leaf events: `run` delivers now.
          requestActiveLeafEvents: {
            run: () => {
              for (const file of deferred.splice(0)) workspace.open(file);
            },
          },
        },
      );
      const note = new TFile();
      note.path = "Paper.md";
      note.extension = "md";
      metadataCache.setCache(note.path, {
        frontmatter: { [FIELD_ZOTERO_KEY]: "AAAAAAAA" },
      });
      const ledger = yield* useLedgerOf(
        fakeApp({ load: () => undefined, workspace, metadataCache }),
      );

      yield* TestClock.adjust(1);
      deferred.push(note);
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
      const app = fakeApp({ load: () => undefined, save: () => {} });
      const scope = yield* Scope.make();
      const ledger = yield* useLedgerOf(app).pipe(Scope.provide(scope));
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
