import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
// Database ownership behind the ZoteroReads interface: Read Mode, refresh lane, watcher gate, lifetimes.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureSchema } from "@zotlit/db/test-utils";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";
import { prepareRead, snapshotSource } from "@/services/database/read-source";
import type {
  PreparedRead,
  SourceFingerprint,
} from "@/services/database/read-source";

import { Connection } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";
import { layerSource } from "./source";
import type { SourcePorts } from "./source";

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = join(tmpdir(), `zotlit-reads-source-test-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  dbPath = join(dir, "zotero.sqlite");
  writeLibrary(dbPath, 1);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A Zotero database file on the fixture schema whose user library reports
 * `version`, so a read shows which state of the file it saw.
 */
function writeLibrary(path: string, version: number): void {
  using sqlite = new DatabaseSync(path);
  seedLibrary(sqlite);
  sqlite.exec(`update libraries set version = ${version} where libraryID = 1`);
}

function seedLibrary(sqlite: DatabaseSync): void {
  const exists = sqlite
    .prepare("select name from sqlite_master where name = 'libraries'")
    .get();
  if (exists) return;
  createFixtureSchema(sqlite);
  sqlite.exec(
    "insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 0)",
  );
}

function config(patch: Partial<ReadsConfig> = {}): ReadsConfig {
  return {
    databasePath: dbPath,
    readMode: "copy",
    autoRefresh: true,
    locale: null,
    chineseSegmenter: null,
    logLevel: null,
    ...patch,
  };
}

interface FakeWatcher {
  readonly path: string;
  readonly listener: (event: string, filename: string | null) => void;
  closed: boolean;
}

/**
 * Ports over the real file system and SQLite, with spies a test can steer:
 * `prepareRead` and `snapshotSource` call through to the real functions until
 * a test overrides a call, and `watch` records listeners instead of watching.
 */
function testPorts() {
  const watchers: FakeWatcher[] = [];
  const reads: PreparedRead[] = [];
  const releases: PreparedRead[] = [];
  const releaseGate = Ref.makeUnsafe<{
    entered: Deferred.Deferred<void>;
    release: Deferred.Deferred<void>;
  } | null>(null);
  const ports = {
    prepareRead: vi.fn<SourcePorts["prepareRead"]>(
      (mode: ReadsConfig["readMode"], path: string) =>
        prepareRead(mode, path).pipe(
          Effect.tap((read) => Effect.sync(() => reads.push(read))),
          Effect.flatMap((read) =>
            Effect.acquireRelease(Effect.succeed(read), () =>
              Ref.getAndSet(releaseGate, null).pipe(
                Effect.flatMap((gate) =>
                  gate
                    ? Effect.andThen(
                        Deferred.succeed(gate.entered, undefined),
                        Deferred.await(gate.release),
                      )
                    : Effect.void,
                ),
                Effect.andThen(Effect.sync(() => releases.push(read))),
              ),
            ),
          ),
        ),
    ),
    snapshotSource: vi.fn<SourcePorts["snapshotSource"]>(snapshotSource),
    watch: vi.fn((path: string, _options: unknown, listener: unknown) => {
      const watcher: FakeWatcher = {
        path,
        listener: listener as FakeWatcher["listener"],
        closed: false,
      };
      watchers.push(watcher);
      return {
        close: () => {
          watcher.closed = true;
        },
      };
    }),
    reapReadClones: vi.fn<SourcePorts["reapReadClones"]>(() => Effect.void),
  } satisfies Partial<SourcePorts>;
  return { ports, watchers, reads, releases, releaseGate };
}

/**
 * The source layer behind an in-process client, on a test clock. Changes are
 * recorded from before the first open: the layer starts unconfigured and
 * `initial` arrives through `Configure` once the recorder listens. `close`
 * tears the layer down as plugin unload does.
 */
async function startSource(
  initial: ReadsConfig | null,
  ports: Partial<SourcePorts>,
) {
  const scope = Scope.makeUnsafe();
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      Layer.provideMerge(layerSource({ ports }), TestClock.layer()),
      scope,
    ),
  );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      Layer.Success<ReturnType<typeof layerSource>> | TestClock.TestClock
    >,
  ) => Effect.runPromise(Effect.provideContext(effect, context));
  const reads: ZoteroReadsClient = await Effect.runPromise(
    makeInProcessClient().pipe(
      Effect.provideContext(context),
      Scope.provide(scope),
    ),
  );
  const events: ChangeEvent[] = [];
  Effect.runFork(
    Stream.runForEach(reads.Changes(), (event) =>
      Effect.sync(() => events.push(event)),
    ).pipe(Effect.ignore, Effect.forkIn(scope)),
  );
  await vi.waitFor(() => expect(events).toHaveLength(1));
  if (initial) await run(reads.Configure(initial));
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Effect.runPromise(Scope.close(scope, Exit.void)));
  const tags = () => events.slice(1).map((event) => event._tag);
  return {
    reads,
    events,
    /** Event tags after the first `state` seed. */
    tags,
    /** Wait until the events recorded so far include `expected`, in order. */
    sawTags: (expected: ChangeEvent["_tag"][], start = 1) =>
      vi.waitFor(() =>
        expect(events.slice(start).map((event) => event._tag)).toEqual(
          expected,
        ),
      ),
    /** Wait until the refresh lane has run and gone quiet. */
    idle: () =>
      vi.waitFor(() => {
        const lane = events.filter((event) => event._tag === "refreshing");
        expect(lane.at(-1)).toEqual({ _tag: "refreshing", active: false });
      }),
    /** Run a request whose fiber teardown may interrupt. */
    detach: <A, E>(
      effect: Effect.Effect<
        A,
        E,
        Layer.Success<ReturnType<typeof layerSource>>
      >,
    ) => {
      void run(effect).catch(() => undefined);
    },
    /** Advance the test clock past every debounce. */
    elapse: () => run(TestClock.adjust("2 seconds")),
    /** The library-1 version a read sees now. */
    version: () =>
      run(
        Effect.map(
          reads.Libraries({}),
          (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
        ),
      ),
    run,
    close,
    [Symbol.asyncDispose]: close,
  };
}

/**
 * Completion of every watcher tick's gate: each fingerprint read has settled,
 * and a read queued after that has answered. The tick resumed when its read
 * settled, so it was scheduled ahead of that request and has decided by then.
 */
async function gatesDecided(
  _ports: ReturnType<typeof testPorts>["ports"],
  source: { version: () => Promise<number> },
): Promise<void> {
  await source.version();
}

function emitDirEvent(watchers: FakeWatcher[], filename: string): void {
  const bound = watchers.filter((w) => w.path === dir && !w.closed).at(-1);
  expect(bound, "a bound directory watcher").toBeDefined();
  bound!.listener("change", filename);
}

/** A held `prepareRead`: it waits for `release`, then reads for real. */
function holdRead(ports: ReturnType<typeof testPorts>["ports"]) {
  const held = Deferred.makeUnsafe<void>();
  ports.prepareRead.mockImplementationOnce((mode, path) =>
    Effect.andThen(Deferred.await(held), prepareRead(mode, path)),
  );
  return { release: () => Effect.runSync(Deferred.succeed(held, undefined)) };
}

const tagsSince = (events: ChangeEvent[], start: number) =>
  events.slice(start).map((event) => event._tag);

const awaitFingerprint = (
  gate: Deferred.Deferred<SourceFingerprint>,
): Effect.Effect<SourceFingerprint, DbUnavailable> => Deferred.await(gate);

describe("ZoteroReads source", () => {
  it("opens the configured read source at startup", async () => {
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await expect(source.version()).resolves.toBe(1);
    await source.sawTags(["refreshing", "changed", "refreshing"]);
    expect(ports.prepareRead).toHaveBeenCalledExactlyOnceWith("copy", dbPath);
  });

  it("opens the settings it starts with, before any Configure", async () => {
    const { ports } = testPorts();
    const version = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeInProcessClient();
        return yield* reads.Libraries({});
      }).pipe(
        Effect.scoped,
        Effect.provide(layerSource({ ports, initial: config() })),
      ),
    );
    expect(version.find((l) => l.libraryID === 1)?.version).toBe(1);
  });

  it("waits for Configure before it opens anything", async () => {
    const { ports } = testPorts();
    await using source = await startSource(null, ports);
    expect(ports.prepareRead).not.toHaveBeenCalled();
    expect(source.events).toEqual([
      { _tag: "state", state: "loading", error: null },
    ]);
    await source.run(source.reads.Configure(config()));
    await expect(source.version()).resolves.toBe(1);
  });

  it("reads committed WAL rows in a copy and skips them in an immutable read", async () => {
    using live = new DatabaseSync(dbPath);
    live.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      update libraries set version = 2 where libraryID = 1;
    `);
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await expect(source.version()).resolves.toBe(2);

    await source.run(source.reads.Configure(config({ readMode: "immutable" })));
    await source.run(source.reads.Refresh());
    await expect(source.version()).resolves.toBe(1);
  });

  it("names the effective Read Mode of each new connection on Changes", async () => {
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await source.idle();
    expect(source.events.filter((event) => event._tag === "changed")).toEqual([
      { _tag: "changed", readMode: "copy" },
    ]);

    await source.run(source.reads.Configure(config({ readMode: "immutable" })));
    await source.run(source.reads.Refresh());
    await vi.waitFor(() =>
      expect(
        source.events.filter((event) => event._tag === "changed").at(-1),
      ).toEqual({ _tag: "changed", readMode: "immutable" }),
    );
    const seed = await source.run(
      Stream.runHead(source.reads.Changes()).pipe(
        Effect.map((option) => Option.getOrThrow(option)),
      ),
    );
    expect(seed).toEqual({
      _tag: "state",
      state: "ready",
      error: null,
      readMode: "immutable",
    });
  });

  it("settles degraded when the startup open fails, and Refresh fails while degraded", async () => {
    const { ports } = testPorts();
    await using source = await startSource(
      config({ databasePath: join(dir, "absent", "zotero.sqlite") }),
      ports,
    );
    const error = await source.run(Effect.flip(source.reads.Libraries({})));
    expect(error).toMatchObject({ _tag: "DbUnavailable" });
    await source.sawTags([
      "refreshing",
      "refresh-failed",
      "db-file-missing",
      "degraded",
      "refreshing",
    ]);
    await expect(
      source.run(Effect.flip(source.reads.Refresh())),
    ).resolves.toMatchObject({ _tag: "DbUnavailable" });
  });

  it("leaves degraded once a refresh opens the source", async () => {
    const { ports } = testPorts();
    ports.prepareRead.mockImplementationOnce(() =>
      Effect.fail(new DbUnavailable({ message: "busy" })),
    );
    await using source = await startSource(config(), ports);
    await source.run(Effect.ignore(source.reads.Libraries({})));
    await source.sawTags([
      "refreshing",
      "refresh-failed",
      "degraded",
      "refreshing",
    ]);

    await source.run(source.reads.NotifyExternalChange());
    await source.elapse();
    await vi.waitFor(async () => expect(await source.version()).toBe(1));
  });

  it("keeps the active client when a refresh fails, and Refresh reports the failure", async () => {
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await expect(source.version()).resolves.toBe(1);
    await source.idle();
    const before = source.events.length;

    writeLibrary(dbPath, 2);
    ports.prepareRead.mockImplementationOnce(() =>
      Effect.fail(new DbUnavailable({ message: "busy" })),
    );
    await expect(
      source.run(Effect.flip(source.reads.Refresh())),
    ).resolves.toMatchObject({ _tag: "DbUnavailable", message: "busy" });

    await expect(source.version()).resolves.toBe(1);
    await source.sawTags(
      ["refreshing", "refresh-failed", "refreshing"],
      before,
    );
    // The same database failed to refresh: the one serving is still the one
    // the settings name.
    expect(
      source.events.find((e) => e._tag === "refresh-failed"),
    ).toMatchObject({ moved: false });
  });

  it("keeps the active client when the new source is not a Zotero database", async () => {
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await expect(source.version()).resolves.toBe(1);

    await mkdir(join(dir, "other"));
    const other = join(dir, "other", "zotero.sqlite");
    new DatabaseSync(other).close();
    await source.run(source.reads.Configure(config({ databasePath: other })));
    await source.run(Effect.ignore(source.reads.Refresh()));

    await expect(source.version()).resolves.toBe(1);
    await vi.waitFor(() =>
      expect(
        source.events.find((e) => e._tag === "refresh-failed"),
      ).toHaveProperty(
        "error.message",
        expect.stringContaining("This file is not a Zotero database."),
      ),
    );
    // The client still serving reads another database than the settings
    // name, which a subscriber that comes later learns from the seed too.
    expect(
      source.events.find((e) => e._tag === "refresh-failed"),
    ).toMatchObject({ moved: true });
  });

  it("refreshes when the read mode or database path changes, not on an auto-refresh change", async () => {
    const { ports } = testPorts();
    await mkdir(join(dir, "next"));
    const next = join(dir, "next", "zotero.sqlite");
    writeLibrary(next, 3);
    await using source = await startSource(config(), ports);
    await source.version();

    // Each change waits for the read it started: Configures that arrive
    // together share one run on the newest settings.
    const immutable = config({ readMode: "immutable" });
    await source.run(source.reads.Configure(immutable));
    await vi.waitFor(() => expect(ports.prepareRead).toHaveBeenCalledTimes(2));
    await source.run(
      source.reads.Configure({ ...immutable, databasePath: next }),
    );
    await vi.waitFor(() => expect(ports.prepareRead).toHaveBeenCalledTimes(3));
    await source.run(
      source.reads.Configure({
        ...immutable,
        databasePath: next,
        autoRefresh: false,
      }),
    );
    // Joins whatever the lane still runs, then reads once more.
    await source.run(source.reads.Refresh());

    expect(ports.prepareRead.mock.calls.slice(0, 3)).toEqual([
      ["copy", dbPath],
      ["immutable", dbPath],
      ["immutable", next],
    ]);
    await expect(source.version()).resolves.toBe(3);
  });

  it("sweeps read snapshots beside each database path it binds, once each", async () => {
    const { ports } = testPorts();
    await mkdir(join(dir, "next"));
    const next = join(dir, "next", "zotero.sqlite");
    writeLibrary(next, 3);
    await using source = await startSource(config(), ports);
    await source.version();
    await source.run(source.reads.Refresh());
    expect(ports.reapReadClones).toHaveBeenCalledExactlyOnceWith({
      parent: join(dir, ZOTERO_DB_READ_PARENT_DIRNAME),
    });

    await source.run(source.reads.Configure(config({ databasePath: next })));
    await source.run(source.reads.Refresh());
    expect(ports.reapReadClones).toHaveBeenCalledTimes(2);
    expect(ports.reapReadClones).toHaveBeenLastCalledWith({
      parent: join(dir, "next", ZOTERO_DB_READ_PARENT_DIRNAME),
    });
  });

  it("keeps refreshing active across coalesced trailing reruns", async () => {
    const { ports } = testPorts();
    await using source = await startSource(config(), ports);
    await source.idle();
    const held = holdRead(ports);

    const before = source.events.length;
    const first = source.run(source.reads.Refresh());
    await vi.waitFor(() => expect(ports.prepareRead).toHaveBeenCalledTimes(2));
    const second = source.run(source.reads.Refresh());
    held.release();
    await Promise.all([first, second]);

    expect(ports.prepareRead).toHaveBeenCalledTimes(3);
    await source.sawTags(
      ["refreshing", "changed", "changed", "refreshing"],
      before,
    );
  });

  it("coalesces an external change during the initial open into the same lane", async () => {
    const { ports } = testPorts();
    const startup = holdRead(ports);
    await using source = await startSource(config(), ports);
    await vi.waitFor(() => expect(ports.prepareRead).toHaveBeenCalledOnce());

    // A Zotero push lands while the first read is still preparing, and its
    // debounce elapses inside that window: it becomes the trailing rerun of
    // the same lane, never a second lane opening beside the first.
    await source.run(source.reads.NotifyExternalChange());
    await source.elapse();

    startup.release();
    await source.sawTags(["refreshing", "changed", "changed", "refreshing"]);
    expect(ports.prepareRead).toHaveBeenCalledTimes(2);
    await expect(source.version()).resolves.toBe(1);
  });

  describe("refresh lane coalescing", () => {
    /** A held `prepareRead` that fails with `message` once released. */
    function holdFailure(
      ports: ReturnType<typeof testPorts>["ports"],
      message: string,
    ) {
      const held = Deferred.makeUnsafe<void>();
      ports.prepareRead.mockImplementationOnce(() =>
        Effect.andThen(
          Deferred.await(held),
          Effect.fail(new DbUnavailable({ message })),
        ),
      );
      return {
        release: () => Effect.runSync(Deferred.succeed(held, undefined)),
      };
    }

    /** Tracks whether a request's promise has settled, without awaiting it. */
    function watchSettled<T>(promise: Promise<T>) {
      let settled = false;
      const outcome = promise.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      void outcome.then(() => {
        settled = true;
      });
      return { outcome, isSettled: () => settled };
    }

    it("runs one trailing rerun for every request made during a refresh", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const held = holdRead(ports);
      const before = source.events.length;

      const first = source.run(source.reads.Refresh());
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      const during = [
        source.run(source.reads.Refresh()),
        source.run(source.reads.Refresh()),
        source.run(source.reads.Refresh()),
      ];
      // The requests must join the active lane before its read settles.
      await source.version();
      held.release();
      await Promise.all([first, ...during]);
      await source.idle();

      // The startup open, the held run, and a single rerun for all three.
      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
      await source.sawTags(
        ["refreshing", "changed", "changed", "refreshing"],
        before,
      );
    });

    it("keeps the first caller waiting for the trailing rerun", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const heldFirst = holdRead(ports);
      const heldTrailing = holdRead(ports);

      const first = watchSettled(source.run(source.reads.Refresh()));
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      const second = watchSettled(source.run(source.reads.Refresh()));
      await source.version();
      heldFirst.release();
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(3),
      );

      // The first read is done and the trailing one is held.
      expect(first.isSettled()).toBe(false);
      expect(second.isSettled()).toBe(false);
      heldTrailing.release();
      await Promise.all([first.outcome, second.outcome]);
    });

    it("settles every caller with the failure of the lane's last refresh", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const held = holdFailure(ports, "first");
      ports.prepareRead.mockImplementationOnce(() =>
        Effect.fail(new DbUnavailable({ message: "trailing" })),
      );

      const first = source.run(Effect.flip(source.reads.Refresh()));
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      const second = source.run(Effect.flip(source.reads.Refresh()));
      await source.version();
      held.release();

      await expect(Promise.all([first, second])).resolves.toMatchObject([
        { _tag: "DbUnavailable", message: "trailing" },
        { _tag: "DbUnavailable", message: "trailing" },
      ]);
      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
    });

    it("settles every caller successfully when the trailing rerun recovers", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const held = holdFailure(ports, "first");

      const first = watchSettled(source.run(source.reads.Refresh()));
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      const second = watchSettled(source.run(source.reads.Refresh()));
      await source.version();
      held.release();

      await expect(
        Promise.all([first.outcome, second.outcome]),
      ).resolves.toMatchObject([{ ok: true }, { ok: true }]);
      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
    });

    it("gives a push that arrives during a refresh its trailing read even when the source is unchanged", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const held = holdRead(ports);

      const refresh = source.run(source.reads.Refresh());
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await gatesDecided(ports, source);
      held.release();
      await refresh;
      await source.idle();

      // An idle push over an unchanged source reads nothing (see the
      // self-echo gate); one that joined a running refresh still reads.
      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
    });
  });

  it("hands a borrower the newest client while an unread one is released", async () => {
    const { ports, releaseGate } = testPorts();
    await using source = await startSource(config(), ports);
    await source.version();
    // Read #2 is swapped in and never borrowed before the next refresh.
    await source.run(source.reads.Refresh());

    // Releasing read #2 is slow; a read arriving meanwhile must get read #3
    // and keep it after the release completes.
    const gate = {
      entered: Deferred.makeUnsafe<void>(),
      release: Deferred.makeUnsafe<void>(),
    };
    Effect.runSync(Ref.set(releaseGate, gate));
    writeLibrary(dbPath, 3);
    const refresh = source.run(source.reads.Refresh());
    await Effect.runPromise(Deferred.await(gate.entered));
    await expect(source.version()).resolves.toBe(3);
    Effect.runSync(Deferred.succeed(gate.release, undefined));
    await refresh;

    await expect(source.version()).resolves.toBe(3);
  });

  describe("databaseGeneration", () => {
    /** The generation of the client a borrow gets now. */
    const generationNow = Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* Connection;
        return connection.databaseGeneration(yield* connection.borrow);
      }),
    );

    it("keeps the generation when a refresh reopens the same database", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await expect(source.run(generationNow)).resolves.toBe(1);
      writeLibrary(dbPath, 2);
      await source.run(source.reads.Refresh());
      await expect(source.version()).resolves.toBe(2);
      await expect(source.run(generationNow)).resolves.toBe(1);
    });

    it("gives a higher generation after a Configure to another database file", async () => {
      const { ports } = testPorts();
      await mkdir(join(dir, "next"));
      const next = join(dir, "next", "zotero.sqlite");
      writeLibrary(next, 3);
      await using source = await startSource(config(), ports);
      const before = await source.run(generationNow);
      await source.run(source.reads.Configure(config({ databasePath: next })));
      await source.run(source.reads.Refresh());
      await expect(source.version()).resolves.toBe(3);
      expect(await source.run(generationNow)).toBeGreaterThan(before);
    });

    it("gives a higher generation to another database at the same path", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      const before = await source.run(generationNow);
      {
        using sqlite = new DatabaseSync(dbPath);
        sqlite.exec(
          "insert into settings (setting, key, value) values ('account', 'localUserKey', 'OTHERDB');",
        );
      }
      writeLibrary(dbPath, 2);
      await source.run(source.reads.Refresh());
      await expect(source.version()).resolves.toBe(2);
      expect(await source.run(generationNow)).toBeGreaterThan(before);
    });
  });

  describe("watcher self-echo gate", () => {
    /**
     * Regression: every refresh re-armed the watchers that started the next
     * one, so the plugin refreshed forever on a database nobody had touched.
     */
    it("ignores a watcher tick when the source is unchanged since the last read", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      emitDirEvent(watchers, "zotero.sqlite");
      emitDirEvent(watchers, "zotero.sqlite-wal");
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
      );
      await gatesDecided(ports, source);

      expect(ports.prepareRead).toHaveBeenCalledOnce();
    });

    it("refreshes when the watcher tick follows a real Zotero write", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      writeLibrary(dbPath, 2);
      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();

      await vi.waitFor(async () => expect(await source.version()).toBe(2));
    });

    it("refreshes an immutable read when the source fingerprint is unchanged", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(
        config({ readMode: "immutable" }),
        ports,
      );
      await source.version();

      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();

      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
    });

    it("keeps an immutable watcher tick cancelled when auto-refresh is off", async () => {
      const { ports, watchers } = testPorts();
      const immutable = config({ readMode: "immutable" });
      await using source = await startSource(immutable, ports);
      await source.version();

      emitDirEvent(watchers, "zotero.sqlite");
      await source.run(
        source.reads.Configure({ ...immutable, autoRefresh: false }),
      );
      await source.elapse();
      await gatesDecided(ports, source);

      expect(ports.prepareRead).toHaveBeenCalledOnce();
    });

    it("retains the snapshot on an unchanged push, while manual refresh still reopens it", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await source.sawTags(["refreshing", "refreshing"], before);

      expect(ports.prepareRead).toHaveBeenCalledOnce();
      expect(ports.snapshotSource).toHaveBeenCalledTimes(2);
      await expect(source.version()).resolves.toBe(1);

      await source.run(source.reads.Refresh());
      expect(ports.prepareRead).toHaveBeenCalledTimes(2);
    });

    it("refreshes a changed push using one pre-read source fingerprint", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      writeLibrary(dbPath, 2);
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await source.sawTags(["refreshing", "changed", "refreshing"], before);

      await expect(source.version()).resolves.toBe(2);
      expect(ports.snapshotSource).toHaveBeenCalledTimes(2);
      expect(ports.prepareRead).toHaveBeenCalledTimes(2);
    });

    it("retries an unchanged push after a failed refresh with held reads", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      ports.prepareRead.mockImplementationOnce(() =>
        Effect.fail(new DbUnavailable({ message: "busy" })),
      );
      await source.run(Effect.flip(source.reads.Refresh()));
      await source.idle();
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await source.sawTags(["refreshing", "changed", "refreshing"], before);

      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
      await expect(source.version()).resolves.toBe(1);
    });

    it.each(["unreadable", "unstable"] as const)(
      "refreshes a push when its fingerprint is %s",
      async (observation) => {
        const { ports } = testPorts();
        await using source = await startSource(config(), ports);
        await source.idle();
        const before = source.events.length;
        if (observation === "unreadable") {
          ports.snapshotSource.mockImplementationOnce(() =>
            Effect.fail(new DbUnavailable({ message: "EIO" })),
          );
        } else {
          ports.snapshotSource.mockImplementationOnce((path) =>
            Effect.map(snapshotSource(path), (fingerprint) => ({
              ...fingerprint,
              wal: { state: "unstable" },
            })),
          );
        }

        await source.run(source.reads.NotifyExternalChange());
        await source.elapse();
        await source.sawTags(["refreshing", "changed", "refreshing"], before);

        expect(ports.prepareRead).toHaveBeenCalledTimes(2);
        await expect(source.version()).resolves.toBe(1);
      },
    );

    it("keeps an unchanged trusted signal in Immutable Source mode", async () => {
      const { ports } = testPorts();
      await using source = await startSource(
        config({ readMode: "immutable" }),
        ports,
      );
      await source.idle();
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await source.sawTags(["refreshing", "changed", "refreshing"], before);

      expect(ports.prepareRead).toHaveBeenCalledTimes(2);
    });

    it("preserves manual force queued during a trusted fingerprint read", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const fingerprint = await Effect.runPromise(snapshotSource(dbPath));
      const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
      using cleanup = new DisposableStack();
      cleanup.defer(() => Effect.runSync(Deferred.succeed(gate, fingerprint)));
      ports.snapshotSource.mockImplementationOnce(() => awaitFingerprint(gate));
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
      );
      const forced = source.run(source.reads.Refresh());
      // The request must join the active lane before its fingerprint settles.
      await source.version();
      Effect.runSync(Deferred.succeed(gate, fingerprint));
      await forced;

      await source.sawTags(
        ["refreshing", "changed", "changed", "refreshing"],
        before,
      );
      expect(ports.prepareRead).toHaveBeenCalledTimes(3);
    });

    it("refreshes the new configuration when it changes during a trusted fingerprint read", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();
      const next = join(dir, "next.sqlite");
      writeLibrary(next, 3);
      const fingerprint = await Effect.runPromise(snapshotSource(dbPath));
      const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
      using cleanup = new DisposableStack();
      cleanup.defer(() => Effect.runSync(Deferred.succeed(gate, fingerprint)));
      ports.snapshotSource.mockImplementationOnce(() => awaitFingerprint(gate));
      const before = source.events.length;

      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
      );
      await source.run(source.reads.Configure(config({ databasePath: next })));
      Effect.runSync(Deferred.succeed(gate, fingerprint));

      await source.sawTags(
        ["refreshing", "changed", "changed", "refreshing"],
        before,
      );
      await expect(source.version()).resolves.toBe(3);
    });

    it("refreshes when the source fingerprint cannot be read", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      ports.snapshotSource.mockImplementationOnce(() =>
        Effect.fail(new DbUnavailable({ message: "EIO" })),
      );
      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();

      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
    });

    it("keeps a watcher tick armed across the rebind that follows a refresh", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      // Hold a refresh open past the point where it fingerprints the source,
      // so the write below is later than the state this refresh reads.
      const held = holdRead(ports);
      const refresh = source.run(source.reads.Refresh());
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );

      // Zotero writes, and its tick arms the debounce mid-refresh. The rebind
      // after the swap must keep that tick, or the write stays unseen.
      emitDirEvent(watchers, "zotero.sqlite");
      held.release();
      await refresh;
      writeLibrary(dbPath, 2);

      await source.elapse();
      await vi.waitFor(async () => expect(await source.version()).toBe(2));
    });

    it("gates the next tick again once a trusted burst has fired", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.idle();

      // The push applies to its own burst; later watcher echoes are gated.
      writeLibrary(dbPath, 2);
      const before = source.events.length;
      await source.run(source.reads.NotifyExternalChange());
      await source.elapse();
      await source.sawTags(["refreshing", "changed", "refreshing"], before);

      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(3),
      );
      await gatesDecided(ports, source);

      expect(ports.prepareRead).toHaveBeenCalledTimes(2);
    });

    it("keeps a pending push when auto-refresh is switched off", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      // A push is its own change source, so the flag must not silence it.
      writeLibrary(dbPath, 2);
      await source.run(source.reads.NotifyExternalChange());
      await source.run(source.reads.Configure(config({ autoRefresh: false })));
      await source.elapse();

      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
    });

    it("cancels an untrusted tick when auto-refresh is switched off", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      writeLibrary(dbPath, 2);
      emitDirEvent(watchers, "zotero.sqlite");
      await source.run(source.reads.Configure(config({ autoRefresh: false })));
      await source.elapse();
      await gatesDecided(ports, source);

      expect(ports.prepareRead).toHaveBeenCalledOnce();
      expect(watchers.every((w) => w.closed)).toBe(true);
    });

    it("drops a tick that outlives the auto-refresh switch inside the gate", async () => {
      const { ports, watchers } = testPorts();
      await using source = await startSource(config(), ports);
      await source.version();

      // Inside the gate the timer has already cleared itself, so switching
      // auto-refresh off cannot cancel the tick; it must refuse on its own.
      const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
      ports.snapshotSource.mockImplementationOnce(() => awaitFingerprint(gate));
      writeLibrary(dbPath, 2);
      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
      );

      await source.run(source.reads.Configure(config({ autoRefresh: false })));
      Effect.runSync(
        Deferred.succeed(gate, await Effect.runPromise(snapshotSource(dbPath))),
      );
      await gatesDecided(ports, source);

      expect(ports.prepareRead).toHaveBeenCalledOnce();
    });
  });

  describe("lifetime guards", () => {
    it("drops a tick whose gate check outlives teardown", async () => {
      const { ports, watchers } = testPorts();
      const source = await startSource(config(), ports);
      await source.version();

      const gate = Deferred.makeUnsafe<SourceFingerprint, never>();
      ports.snapshotSource.mockImplementationOnce(() => awaitFingerprint(gate));
      writeLibrary(dbPath, 2);
      emitDirEvent(watchers, "zotero.sqlite");
      await source.elapse();
      await vi.waitFor(() =>
        expect(ports.snapshotSource).toHaveBeenCalledTimes(2),
      );

      // Teardown completes with the tick interrupted inside its gate.
      await source.close();
      Effect.runSync(
        Deferred.succeed(gate, await Effect.runPromise(snapshotSource(dbPath))),
      );

      expect(ports.prepareRead).toHaveBeenCalledOnce();
    });

    it("releases a read that lands after teardown and opens nothing on it", async () => {
      const { ports, watchers } = testPorts();
      const source = await startSource(config(), ports);
      await source.version();
      const boundAtStartup = ports.watch.mock.calls.length;

      const acquired = Deferred.makeUnsafe<PreparedRead>();
      const late = Deferred.makeUnsafe<void>();
      ports.prepareRead.mockImplementationOnce((mode, path) =>
        Effect.gen(function* () {
          const read = yield* prepareRead(mode, path);
          yield* Deferred.succeed(acquired, read);
          yield* Deferred.await(late);
          return read;
        }),
      );
      await source.idle();
      const before = source.events.length;
      source.detach(source.reads.Refresh());
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      await source.close();

      const read = await Effect.runPromise(Deferred.await(acquired));
      Effect.runSync(Deferred.succeed(late, undefined));
      await expect(readdir(dirname(read.path))).rejects.toMatchObject({
        code: "ENOENT",
      });

      expect(ports.watch).toHaveBeenCalledTimes(boundAtStartup);
      expect(watchers.every((w) => w.closed)).toBe(true);
      expect(tagsSince(source.events, before)).not.toContain("changed");
    });

    it("reports nothing when a read fails after teardown", async () => {
      const { ports } = testPorts();
      const source = await startSource(config(), ports);
      await source.version();

      const late = Deferred.makeUnsafe<PreparedRead, DbUnavailable>();
      ports.prepareRead.mockImplementationOnce(() => Deferred.await(late));
      await source.idle();
      const before = source.events.length;
      source.detach(source.reads.Refresh());
      await vi.waitFor(() =>
        expect(ports.prepareRead).toHaveBeenCalledTimes(2),
      );
      // Teardown completes with the refresh interrupted inside its read.
      await source.close();
      Effect.runSync(
        Deferred.fail(late, new DbUnavailable({ message: "gone" })),
      );

      const tags = tagsSince(source.events, before);
      expect(tags).not.toContain("refresh-failed");
      expect(tags).not.toContain("degraded");
    });

    it("leaves nothing open when teardown lands while the old read is released", async () => {
      const { ports, watchers, reads, releases, releaseGate } = testPorts();
      const source = await startSource(config(), ports);
      await source.version();

      // Releasing the previous read removes its clone: a real await, and a
      // window for teardown while the new client is being handed over.
      const gate = {
        entered: Deferred.makeUnsafe<void>(),
        release: Deferred.makeUnsafe<void>(),
      };
      Effect.runSync(Ref.set(releaseGate, gate));
      source.detach(source.reads.Refresh());
      await Effect.runPromise(Deferred.await(gate.entered));
      const closing = source.close();
      Effect.runSync(Deferred.succeed(gate.release, undefined));
      await closing;

      expect(releases).toHaveLength(2);
      expect(releases).toEqual(expect.arrayContaining(reads));
      expect(watchers.every((w) => w.closed)).toBe(true);
    });

    it("closes every client and releases every read on teardown", async () => {
      const { ports, reads, releases } = testPorts();
      const source = await startSource(config(), ports);
      await source.version();
      await source.run(source.reads.Refresh());
      expect(reads).toHaveLength(2);
      await source.close();
      expect(releases).toEqual(reads);
    });
  });

  describe("db-file-missing signal", () => {
    const missing = () => join(dir, "absent", "zotero.sqlite");

    it("emits once when the database file is absent", async () => {
      const { ports } = testPorts();
      await using source = await startSource(
        config({ databasePath: missing() }),
        ports,
      );
      await source.sawTags([
        "refreshing",
        "refresh-failed",
        "db-file-missing",
        "degraded",
        "refreshing",
      ]);
    });

    it("reaches a subscriber that arrives after the first open failed", async () => {
      const { ports } = testPorts();
      const seed = await Effect.runPromise(
        Effect.gen(function* () {
          const reads = yield* makeInProcessClient();
          yield* Effect.flip(reads.Libraries({}));
          const pull = yield* Stream.toPull(reads.Changes());
          return yield* pull;
        }).pipe(
          Effect.scoped,
          Effect.provide(
            layerSource({
              ports,
              initial: config({ databasePath: missing() }),
            }),
          ),
        ),
      );
      expect(seed.map((event) => event._tag)).toEqual([
        "state",
        "db-file-missing",
      ]);
    });

    it("does not emit a second time on a later failure in the same lifetime", async () => {
      const { ports } = testPorts();
      await using source = await startSource(
        config({ databasePath: missing() }),
        ports,
      );
      await source.idle();
      const before = source.events.length;
      await source.run(Effect.ignore(source.reads.Refresh()));
      await source.sawTags(
        ["refreshing", "refresh-failed", "degraded", "refreshing"],
        before,
      );
    });

    it("does not emit when the file exists but cannot be read", async () => {
      await writeFile(dbPath, "not a database");
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.sawTags([
        "refreshing",
        "refresh-failed",
        "degraded",
        "refreshing",
      ]);
    });

    it("emits nothing on a healthy open", async () => {
      const { ports } = testPorts();
      await using source = await startSource(config(), ports);
      await source.sawTags(["refreshing", "changed", "refreshing"]);
    });
  });
});
