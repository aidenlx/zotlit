import { configure, reset } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@/prefs` pulls in `@/lib/l10n`, which constructs a `Localization` at module
// scope. Hoisted so the stub exists before the import graph is evaluated.
vi.hoisted(() => {
  (globalThis as { Localization?: unknown }).Localization = class {
    formatValue(): Promise<string | null> {
      return Promise.resolve(null);
    }
  };
});

const applicationBlur = vi.hoisted(() => ({
  callback: undefined as (() => void) | undefined,
  disposed: false,
  registered: false,
}));

vi.mock("@/lib/application-blur", () => ({
  registerApplicationBlur(callback: () => void): Disposable {
    applicationBlur.callback = callback;
    applicationBlur.registered = true;
    return {
      [Symbol.dispose]() {
        applicationBlur.disposed = true;
      },
    };
  },
}));

import { prefs } from "@/prefs";

import { registerWalCheckpoint } from "./wal-checkpoint.js";

const PROBE_SQL = "PRAGMA journal_mode";
const CHECKPOINT_SQL = "PRAGMA wal_checkpoint(PASSIVE)";
const MANUAL_CHECKPOINT_SQL = "PRAGMA wal_checkpoint(TRUNCATE)";

const WAL_CHECKPOINT_PREF = "extensions.zotlit.wal-checkpoint";

let statements: string[];
let observer: { notify: _ZoteroTypes.Notifier.Notify } | undefined;
let registeredTypes: _ZoteroTypes.Notifier.Type[] | undefined;
let unregistered: number[];
let checkpointFails: boolean;
let checkpointBusy: boolean;
let prefStore: Map<string, boolean | string | number>;

const OBSERVER_ID = 42;

function stubZotero(journalMode: string | undefined): void {
  statements = [];
  observer = undefined;
  registeredTypes = undefined;
  unregistered = [];
  checkpointFails = false;
  checkpointBusy = false;
  prefStore = new Map();

  (globalThis as { Zotero?: unknown }).Zotero = {
    debug() {},
    DB: {
      queryAsync(sql: string) {
        statements.push(sql);
        if (sql === PROBE_SQL) {
          return journalMode === undefined
            ? Promise.reject(new Error("probe failed"))
            : Promise.resolve([{ journal_mode: journalMode }]);
        }
        if (checkpointFails) {
          return Promise.reject(new Error("checkpoint failed"));
        }
        if (sql === MANUAL_CHECKPOINT_SQL) {
          return Promise.resolve([
            { busy: checkpointBusy ? 1 : 0, log: 0, checkpointed: 0 },
          ]);
        }
        return Promise.resolve([{ busy: 0, log: 12, checkpointed: 12 }]);
      },
    },
    Notifier: {
      registerObserver(
        ref: { notify: _ZoteroTypes.Notifier.Notify },
        types: _ZoteroTypes.Notifier.Type[],
      ) {
        observer = ref;
        registeredTypes = types;
        return OBSERVER_ID;
      },
      unregisterObserver(id: number) {
        unregistered.push(id);
      },
    },
    Prefs: {
      get(key: string) {
        return prefStore.get(key);
      },
      set(key: string, value: boolean | string | number) {
        prefStore.set(key, value);
      },
    },
  };
}

function emitNotifierEvent(): void {
  expect(observer).toBeDefined();
  void observer?.notify("modify", "item", [1], {});
}

const checkpoints = () => statements.filter((sql) => sql === CHECKPOINT_SQL);
const manualCheckpoints = () =>
  statements.filter((sql) => sql === MANUAL_CHECKPOINT_SQL);

let records: LogRecord[];

const recordsAt = (level: LogRecord["level"]) =>
  records.filter((record) => record.level === level);

beforeEach(async () => {
  applicationBlur.callback = undefined;
  applicationBlur.disposed = false;
  applicationBlur.registered = false;
  records = [];
  await configure({
    sinks: {
      memory: (record: LogRecord) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["zotlit"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], lowestLevel: "error", sinks: [] },
    ],
  });
  vi.useFakeTimers();
  stubZotero("wal");
});

afterEach(async () => {
  vi.useRealTimers();
  delete (globalThis as { Zotero?: unknown }).Zotero;
  await reset();
});

describe("registerWalCheckpoint", () => {
  describe("probe-gated activation", () => {
    it("registers an observer on a wal database", async () => {
      using handle = await registerWalCheckpoint();
      expect(statements).toEqual([PROBE_SQL]);
      expect(observer).toBeDefined();
      expect(handle.status()).toEqual({
        active: true,
        automaticEnabled: true,
        lastRun: null,
      });
    });

    it("stays inactive on a rollback-journal database", async () => {
      stubZotero("delete");
      using handle = await registerWalCheckpoint();
      expect(observer).toBeUndefined();
      expect(applicationBlur.registered).toBe(false);
      expect(handle.status()).toEqual({
        active: false,
        reason: "not-wal",
        lastRun: null,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(checkpoints()).toHaveLength(0);
      expect(recordsAt("debug")).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({ journalMode: "delete" }),
        }),
      );
    });

    it("stays inactive when the probe rejects", async () => {
      stubZotero(undefined);
      using handle = await registerWalCheckpoint();
      expect(observer).toBeUndefined();
      expect(applicationBlur.registered).toBe(false);
      expect(handle.status()).toEqual({
        active: false,
        reason: "probe-failed",
        lastRun: null,
      });
      expect(checkpoints()).toHaveLength(0);
    });
  });

  it("triggers on every write-bearing notifier type", async () => {
    using _handle = await registerWalCheckpoint();
    expect(registeredTypes).toEqual([
      "item",
      "item-tag",
      "tag",
      "collection",
      "collection-item",
      "trash",
      "group",
    ]);
  });

  it("accelerates a pending checkpoint on Application Blur", async () => {
    using _handle = await registerWalCheckpoint();
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(200);

    expect(applicationBlur.callback).toBeDefined();
    applicationBlur.callback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkpoints()).toHaveLength(1);
    expect(
      recordsAt("debug").some(
        (record) =>
          String(record.message) ===
          "accelerated wal checkpoint on application blur",
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkpoints()).toHaveLength(1);
  });

  it("does nothing on Application Blur when no checkpoint is pending", async () => {
    using _handle = await registerWalCheckpoint();

    applicationBlur.callback?.();
    await vi.runAllTimersAsync();

    expect(checkpoints()).toHaveLength(0);
  });

  it("honors the checkpoint preference during Application Blur", async () => {
    using _handle = await registerWalCheckpoint();
    prefs.set(WAL_CHECKPOINT_PREF, false);
    emitNotifierEvent();

    applicationBlur.callback?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(checkpoints()).toHaveLength(0);
  });

  it("coalesces a burst into one checkpoint 500 ms after the last event", async () => {
    vi.setSystemTime("2026-08-20T08:00:00Z");
    using handle = await registerWalCheckpoint();
    for (let i = 0; i < 5; i++) {
      emitNotifierEvent();
      await vi.advanceTimersByTimeAsync(200);
    }
    // 200 ms of the trailing delay already ran off after the last event.
    await vi.advanceTimersByTimeAsync(299);
    expect(checkpoints()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkpoints()).toHaveLength(1);
    expect(recordsAt("debug")).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          busy: 0,
          log: 12,
          checkpointed: 12,
        }),
      }),
    );
    expect(handle.status()).toEqual({
      active: true,
      automaticEnabled: true,
      lastRun: {
        at: new Date("2026-08-20T08:00:01.300Z"),
        result: "done",
      },
    });
  });

  it("checkpoints at the ten second max wait during sustained write activity", async () => {
    using _handle = await registerWalCheckpoint();
    // A 250 ms cadence keeps resetting the 500 ms trailing timer, so only the max
    // wait can fire.
    for (let elapsed = 0; elapsed < 9_750; elapsed += 250) {
      emitNotifierEvent();
      await vi.advanceTimersByTimeAsync(250);
    }
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(249);
    expect(checkpoints()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkpoints()).toHaveLength(1);

    // The burst runs on past the boundary, so the one checkpoint above is
    // unambiguously the max wait rather than a trailing expiry.
    for (let i = 0; i < 4; i++) {
      emitNotifierEvent();
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(checkpoints()).toHaveLength(1);
  });

  it("reads the pref at checkpoint time", async () => {
    using _handle = await registerWalCheckpoint();
    prefs.set(WAL_CHECKPOINT_PREF, false);
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(500);
    expect(checkpoints()).toHaveLength(0);
    expect(recordsAt("debug")).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ pref: WAL_CHECKPOINT_PREF }),
      }),
    );

    prefs.set(WAL_CHECKPOINT_PREF, true);
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(500);
    expect(checkpoints()).toHaveLength(1);
  });

  describe("writeNow", () => {
    it("truncates the wal when the automatic preference is off", async () => {
      vi.setSystemTime("2026-08-20T08:00:00Z");
      using handle = await registerWalCheckpoint();
      prefs.set(WAL_CHECKPOINT_PREF, false);

      await expect(handle.writeNow()).resolves.toBe("done");

      expect(manualCheckpoints()).toHaveLength(1);
      expect(handle.status()).toEqual({
        active: true,
        automaticEnabled: false,
        lastRun: {
          at: new Date("2026-08-20T08:00:00Z"),
          result: "done",
        },
      });
    });

    it("reports when another database user prevents truncation", async () => {
      using handle = await registerWalCheckpoint();
      checkpointBusy = true;

      await expect(handle.writeNow()).resolves.toBe("in-use");
      expect(manualCheckpoints()).toHaveLength(1);
      // Nothing was written and nothing failed, so no run is recorded.
      expect(handle.status().lastRun).toBeNull();
    });

    it("leaves an earlier failure standing when the database is busy", async () => {
      using handle = await registerWalCheckpoint();
      checkpointFails = true;
      await handle.writeNow();
      expect(handle.status().lastRun).toEqual({
        at: expect.any(Date),
        result: "failed",
      });

      checkpointFails = false;
      checkpointBusy = true;
      await expect(handle.writeNow()).resolves.toBe("in-use");

      expect(handle.status().lastRun).toEqual({
        at: expect.any(Date),
        result: "failed",
      });
    });

    it("records and reports a failed manual write", async () => {
      using handle = await registerWalCheckpoint();
      checkpointFails = true;

      await expect(handle.writeNow()).resolves.toBe("failed");

      expect(handle.status()).toEqual({
        active: true,
        automaticEnabled: true,
        lastRun: { at: expect.any(Date), result: "failed" },
      });
      expect(recordsAt("warning")).toContainEqual(
        expect.objectContaining({
          message: ["manual wal checkpoint failed"],
          properties: expect.objectContaining({ error: expect.any(Error) }),
        }),
      );
    });

    it("is unavailable when the database has no wal", async () => {
      stubZotero("delete");
      using handle = await registerWalCheckpoint();

      await expect(handle.writeNow()).resolves.toBe("unavailable");
      expect(manualCheckpoints()).toHaveLength(0);
    });
  });

  describe("onChange", () => {
    it("reports every checkpoint attempt, automatic and manual", async () => {
      using handle = await registerWalCheckpoint();
      const listener = vi.fn();
      handle.onChange(listener);

      emitNotifierEvent();
      await vi.advanceTimersByTimeAsync(500);
      expect(listener).toHaveBeenCalledTimes(1);

      await handle.writeNow();
      expect(listener).toHaveBeenCalledTimes(2);

      checkpointFails = true;
      await handle.writeNow();
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("stays quiet when the preference skips the checkpoint", async () => {
      using handle = await registerWalCheckpoint();
      const listener = vi.fn();
      handle.onChange(listener);
      prefs.set(WAL_CHECKPOINT_PREF, false);

      emitNotifierEvent();
      await vi.advanceTimersByTimeAsync(500);

      expect(listener).not.toHaveBeenCalled();
    });

    it("stops reporting once the subscription is torn down", async () => {
      using handle = await registerWalCheckpoint();
      const listener = vi.fn();
      handle.onChange(listener)();

      await handle.writeNow();

      expect(listener).not.toHaveBeenCalled();
    });

    it("keeps a throwing listener out of the checkpoint outcome", async () => {
      using handle = await registerWalCheckpoint();
      handle.onChange(() => {
        throw new Error("repaint failed");
      });

      await expect(handle.writeNow()).resolves.toBe("done");
      expect(handle.status().lastRun).toEqual({
        at: expect.any(Date),
        result: "done",
      });
      expect(recordsAt("warning")).toContainEqual(
        expect.objectContaining({
          message: ["wal checkpoint status listener failed"],
        }),
      );
    });

    it("never reports on a database with no wal", async () => {
      stubZotero("delete");
      using handle = await registerWalCheckpoint();
      const listener = vi.fn();
      const unsubscribe = handle.onChange(listener);

      await handle.writeNow();

      expect(listener).not.toHaveBeenCalled();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it("stays armed after a failed checkpoint", async () => {
    vi.setSystemTime("2026-08-20T08:00:00Z");
    using handle = await registerWalCheckpoint();
    checkpointFails = true;
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(500);
    expect(checkpoints()).toHaveLength(1);
    const [warning] = recordsAt("warning");
    expect(warning?.properties.error).toBeInstanceOf(Error);
    expect(warning?.properties.error).toHaveProperty(
      "message",
      "checkpoint failed",
    );
    expect(handle.status()).toEqual({
      active: true,
      automaticEnabled: true,
      lastRun: {
        at: new Date("2026-08-20T08:00:00.500Z"),
        result: "failed",
      },
    });

    checkpointFails = false;
    emitNotifierEvent();
    await vi.advanceTimersByTimeAsync(500);
    expect(checkpoints()).toHaveLength(2);
  });

  it("unregisters and drops pending work on dispose", async () => {
    const handle = await registerWalCheckpoint();
    emitNotifierEvent();
    handle[Symbol.dispose]();
    expect(unregistered).toEqual([OBSERVER_ID]);
    expect(applicationBlur.disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkpoints()).toHaveLength(0);
  });
});
