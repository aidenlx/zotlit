import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { type CitationEngine } from "./engine";
import { PandocEngineService, type PandocEnginePorts } from "./service";
import { type EngineBinaryStore } from "./store";

/** Node's own typings hand back `ArrayBufferLike` views; the ports take `ArrayBuffer` ones. */
function bytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(source);
}

const BINARY = bytes(new TextEncoder().encode("pandoc wasm bytes"));

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const PIN = {
  version: "3.10",
  url: "https://example.invalid/pandoc-3.10-wasm.zip",
  sha256: await sha256Hex(BINARY),
};

const CACHED_NAME = `${PIN.sha256}.wasm`;

/** The upstream asset nests the binary under a release-named directory. */
const ARCHIVE = bytes(zipSync({ "pandoc-3.10-wasm/pandoc.wasm": BINARY }));

type BinaryFiles = Record<string, Uint8Array<ArrayBuffer>>;

type MemoryStore = EngineBinaryStore & {
  files: Map<string, Uint8Array<ArrayBuffer>>;
};

function memoryStore(initial: BinaryFiles = {}): MemoryStore {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name)),
    write: (name, bytes) => {
      files.set(name, bytes);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const bytes = files.get(from);
      if (!bytes) throw new Error(`No entry named ${from}`);
      files.delete(from);
      files.set(to, bytes);
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    clear: () => {
      files.clear();
      return Promise.resolve();
    },
  };
}

type MemoryConsent = PandocEnginePorts["consent"];

function memoryConsent(): MemoryConsent {
  const values = new Map<string, unknown>();
  return {
    loadLocalStorage: (key) => values.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}

function fakeEngine(dispose = vi.fn()): CitationEngine {
  return {
    renderBibliography: () => Promise.resolve([]),
    renderDocument: () => Promise.resolve(new Uint8Array()),
    [Symbol.asyncDispose]: () => {
      dispose();
      return Promise.resolve();
    },
  };
}

interface HarnessOptions {
  files?: BinaryFiles;
  consent?: MemoryConsent;
  pin?: PandocEnginePorts["pin"];
  download?: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  createEngine?: (binary: Uint8Array<ArrayBuffer>) => Promise<CitationEngine>;
}

function harness(options: HarnessOptions = {}) {
  const store = memoryStore(options.files);
  const consent = options.consent ?? memoryConsent();
  const download = vi.fn(
    options.download ?? (() => Promise.resolve(ARCHIVE.slice())),
  );
  const createEngine = vi.fn(
    options.createEngine ?? (() => Promise.resolve(fakeEngine())),
  );
  const service = new PandocEngineService({
    store,
    consent,
    download,
    createEngine,
    pin: options.pin ?? PIN,
  });
  return { service, store, consent, download, createEngine };
}

describe("PandocEngineService", () => {
  it("downloads nothing until an explicit install", async () => {
    const { service, download } = harness();
    await service.ready;

    expect(service.getStatus()).toEqual({ kind: "absent" });
    expect(download).not.toHaveBeenCalled();
    await service[Symbol.asyncDispose]();
  });

  it("caches a verified binary under its own hash", async () => {
    const { service, store, download } = harness();
    await service.ready;

    await service.install();

    expect(download).toHaveBeenCalledWith(PIN.url);
    expect(store.files.get(CACHED_NAME)).toEqual(BINARY);
    expect([...store.files.keys()]).toEqual([CACHED_NAME]);
    expect(service.getStatus()).toEqual({
      kind: "installed",
      version: PIN.version,
    });
    await service[Symbol.asyncDispose]();
  });

  it("reports a binary that does not match the pinned hash, and caches nothing", async () => {
    const expected = "f".repeat(64);
    const { service, store } = harness({ pin: { ...PIN, sha256: expected } });
    await service.ready;

    await expect(service.install()).rejects.toThrow();

    expect(service.getStatus()).toEqual({
      kind: "failed",
      failure: { code: "hash-mismatch", expected, actual: PIN.sha256 },
    });
    expect([...store.files.keys()]).toEqual([]);
    await service[Symbol.asyncDispose]();
  });

  it("reports a download that never arrived", async () => {
    const { service, store } = harness({
      download: () =>
        Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
    });
    await service.ready;

    await expect(service.install()).rejects.toThrow();

    expect(service.getStatus()).toEqual({
      kind: "failed",
      failure: {
        code: "download-failed",
        url: PIN.url,
        detail: "net::ERR_INTERNET_DISCONNECTED",
      },
    });
    expect([...store.files.keys()]).toEqual([]);
    await service[Symbol.asyncDispose]();
  });

  it("adopts the binary another vault already cached, without downloading", async () => {
    const { service, download } = harness({ files: { [CACHED_NAME]: BINARY } });
    await service.ready;

    expect(service.getStatus()).toEqual({
      kind: "installed",
      version: PIN.version,
    });

    await service.install();

    expect(download).not.toHaveBeenCalled();
    await service[Symbol.asyncDispose]();
  });

  it("shares one download between concurrent installs", async () => {
    const { service, download } = harness();
    await service.ready;

    await Promise.all([service.install(), service.install()]);

    expect(download).toHaveBeenCalledTimes(1);
    await service[Symbol.asyncDispose]();
  });

  it("drops earlier binaries once the new one verifies, leaving downloads in flight alone", async () => {
    const stale = bytes(new TextEncoder().encode("pandoc 3.9"));
    const { service, store } = harness({
      files: {
        "0123.wasm": stale,
        [`${"9".repeat(64)}.f1e2.part`]: stale,
      },
    });
    await service.ready;

    await service.install();

    expect([...store.files.keys()].sort()).toEqual(
      [`${"9".repeat(64)}.f1e2.part`, CACHED_NAME].sort(),
    );
    await service[Symbol.asyncDispose]();
  });

  it("clears the whole cache on uninstall and offers the install again", async () => {
    const { service, store } = harness();
    await service.ready;
    await service.install();

    await service.uninstall();

    expect([...store.files.keys()]).toEqual([]);
    expect(service.getStatus()).toEqual({ kind: "absent" });
    await service[Symbol.asyncDispose]();
  });

  it("remembers a declined offer across restarts, and forgets it on install", async () => {
    const consent = memoryConsent();
    const first = harness({ consent });
    await first.service.ready;

    first.service.decline();
    expect(first.service.getStatus()).toEqual({ kind: "declined" });
    await first.service[Symbol.asyncDispose]();

    const restarted = harness({ consent });
    await restarted.service.ready;
    expect(restarted.service.getStatus()).toEqual({ kind: "declined" });

    await restarted.service.install();
    await restarted.service.uninstall();
    expect(restarted.service.getStatus()).toEqual({ kind: "absent" });
    await restarted.service[Symbol.asyncDispose]();
  });

  it("notifies subscribers on every status change", async () => {
    const { service } = harness();
    await service.ready;
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    await service.install();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    await service.uninstall();
    expect(service.getStatus()).toEqual({ kind: "absent" });
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    await service[Symbol.asyncDispose]();
  });

  it("refuses an engine while nothing is installed, and keeps the status", async () => {
    const { service, createEngine } = harness();
    await service.ready;

    await expect(service.getEngine()).rejects.toThrow(/not installed/);

    expect(service.getStatus()).toEqual({ kind: "absent" });
    expect(createEngine).not.toHaveBeenCalled();
    await service[Symbol.asyncDispose]();
  });

  it("reports a binary that will not start, and starts over on a re-install", async () => {
    const createEngine = vi
      .fn<(binary: Uint8Array<ArrayBuffer>) => Promise<CitationEngine>>()
      .mockRejectedValueOnce(new Error("CompileError: bad magic"))
      .mockResolvedValue(fakeEngine());
    const { service } = harness({ createEngine });
    await service.ready;
    await service.install();

    await expect(service.getEngine()).rejects.toThrow(/bad magic/);
    expect(service.getStatus()).toEqual({
      kind: "failed",
      failure: { code: "init-failed", detail: "CompileError: bad magic" },
    });

    // Re-installing re-verifies the cached binary, so the engine can be tried again.
    await service.install();
    await expect(service.getEngine()).resolves.toBeDefined();
    await service[Symbol.asyncDispose]();
  });

  it("hands out one engine and disposes it with the service", async () => {
    const dispose = vi.fn();
    const { service, createEngine } = harness({
      createEngine: () => Promise.resolve(fakeEngine(dispose)),
    });
    await service.ready;
    await service.install();

    const engine = await service.getEngine();
    expect(await service.getEngine()).toBe(engine);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledWith(BINARY);

    await service[Symbol.asyncDispose]();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes the engine on uninstall", async () => {
    const dispose = vi.fn();
    const { service } = harness({
      createEngine: () => Promise.resolve(fakeEngine(dispose)),
    });
    await service.ready;
    await service.install();
    await service.getEngine();

    await service.uninstall();

    expect(dispose).toHaveBeenCalledOnce();
    await service[Symbol.asyncDispose]();
  });
});
