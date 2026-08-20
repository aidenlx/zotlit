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

const WAL_CHECKPOINT_PREF = "extensions.zotlit.wal-checkpoint";

let statements: string[];
let observer: { notify: _ZoteroTypes.Notifier.Notify } | undefined;
let registeredTypes: _ZoteroTypes.Notifier.Type[] | undefined;
let unregistered: number[];
let checkpointFails: boolean;
let prefStore: Map<string, boolean | string | number>;

const OBSERVER_ID = 42;

function stubZotero(journalMode: string | undefined): void {
  statements = [];
  observer = undefined;
  registeredTypes = undefined;
  unregistered = [];
  checkpointFails = false;
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
      using _handle = await registerWalCheckpoint();
      expect(statements).toEqual([PROBE_SQL]);
      expect(observer).toBeDefined();
    });

    it("stays inactive on a rollback-journal database", async () => {
      stubZotero("delete");
      using _handle = await registerWalCheckpoint();
      expect(observer).toBeUndefined();
      expect(applicationBlur.registered).toBe(false);
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
      using _handle = await registerWalCheckpoint();
      expect(observer).toBeUndefined();
      expect(applicationBlur.registered).toBe(false);
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
    using _handle = await registerWalCheckpoint();
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

  it("stays armed after a failed checkpoint", async () => {
    using _handle = await registerWalCheckpoint();
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
