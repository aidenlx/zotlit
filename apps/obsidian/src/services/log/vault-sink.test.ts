import { type LogRecord } from "@logtape/logtape";
import { type DataAdapter } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVaultFileSink } from "./vault-sink";

interface AdapterStub {
  writeCalls: string[];
  appendCalls: string[];
  write: (path: string, data: string) => Promise<void>;
  append: (path: string, data: string) => Promise<void>;
}

function makeAdapter(overrides: Partial<AdapterStub> = {}): AdapterStub {
  const writeCalls: string[] = [];
  const appendCalls: string[] = [];
  return {
    writeCalls,
    appendCalls,
    write: async (_path: string, data: string) => {
      writeCalls.push(data);
    },
    append: async (_path: string, data: string) => {
      appendCalls.push(data);
    },
    ...overrides,
  };
}

function asAdapter(stub: AdapterStub): DataAdapter {
  return stub as unknown as DataAdapter;
}

function makeRecord(message: string): LogRecord {
  return {
    category: ["zotlit", "obsidian", "test"],
    level: "info",
    message: [message],
    properties: {},
    rawMessage: message,
    timestamp: 1_700_000_000_000,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("createVaultFileSink", () => {
  it("truncates the file on open", async () => {
    const adapter = makeAdapter();
    await createVaultFileSink(asAdapter(adapter), "log.jsonl");
    expect(adapter.writeCalls).toEqual([""]);
  });

  it("buffers records and flushes on the next timer tick", async () => {
    const adapter = makeAdapter();
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    sink(makeRecord("a"));
    sink(makeRecord("b"));
    expect(adapter.appendCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.appendCalls).toHaveLength(1);
    expect(adapter.appendCalls[0]).toContain('"message":"a"');
    expect(adapter.appendCalls[0]).toContain('"message":"b"');
    expect(adapter.appendCalls[0]?.endsWith("\n")).toBe(true);
  });

  it("drains pending records on dispose", async () => {
    const adapter = makeAdapter();
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    sink(makeRecord("only"));
    await sink[Symbol.asyncDispose]();

    expect(adapter.appendCalls).toHaveLength(1);
    expect(adapter.appendCalls[0]).toContain('"message":"only"');
  });

  it("ignores records emitted after dispose", async () => {
    const adapter = makeAdapter();
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    await sink[Symbol.asyncDispose]();
    sink(makeRecord("after"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(adapter.appendCalls).toHaveLength(0);
  });

  it("dispose awaits in-flight writes before resolving", async () => {
    let resolveAppend!: () => void;
    const adapter = makeAdapter({
      append: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveAppend = resolve;
          }),
      ),
    });
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    sink(makeRecord("a"));
    await vi.advanceTimersByTimeAsync(1000);

    let resolved = false;
    const disposePromise = sink[Symbol.asyncDispose]().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    resolveAppend();
    await disposePromise;
    expect(resolved).toBe(true);
    expect(adapter.append).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows append failures, continuing on subsequent ticks", async () => {
    let calls = 0;
    const adapter = makeAdapter({
      append: vi.fn(async (_path: string, data: string) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("disk full");
        }
        adapter.appendCalls.push(data);
      }),
    });
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    sink(makeRecord("a"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to write to plugin log file",
      expect.any(Error),
    );

    sink(makeRecord("b"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.appendCalls).toContainEqual(expect.stringContaining('"b"'));
  });

  it("idempotent dispose returns the same promise", async () => {
    const adapter = makeAdapter();
    const sink = await createVaultFileSink(asAdapter(adapter), "log.jsonl");

    const a = sink[Symbol.asyncDispose]();
    const b = sink[Symbol.asyncDispose]();
    expect(a).toBe(b);
    await a;
  });
});
