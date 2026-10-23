import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { describe, expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { openManagedBinary } from "@/services/managed-binary/__fixtures__";
import type {
  BinaryPin,
  BinaryStore,
  ManagedBinaryHostPorts,
} from "@/services/managed-binary/service";

import type { CitationEngine, PreparedDocument } from "./engine";
import { PANDOC_ENGINE } from "./service";

/** Node's own typings hand back `ArrayBufferLike` views; the ports take `ArrayBuffer` ones. */
function bytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(source);
}

const BINARY = bytes(new TextEncoder().encode("pandoc wasm bytes"));

/** Node's own digest, so the pin the service verifies against is an independent oracle. */
const PIN = {
  version: "3.10",
  url: "https://example.invalid/pandoc-3.10-wasm.zip",
  sha256: createHash("sha256").update(BINARY).digest("hex"),
};

const CACHED_NAME = `${PIN.sha256}.wasm`;

/** The upstream asset nests the binary under a release-named directory. */
const ARCHIVE = bytes(zipSync({ "pandoc-3.10-wasm/pandoc.wasm": BINARY }));

type BinaryFiles = Record<string, Uint8Array<ArrayBuffer>>;

type MemoryStore = BinaryStore & {
  files: Map<string, Uint8Array<ArrayBuffer>>;
};

function memoryStore(initial: BinaryFiles = {}): MemoryStore {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => {
      const bytes = files.get(name);
      return Promise.resolve(bytes && new Blob([bytes]));
    },
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

type MemoryConsent = ManagedBinaryHostPorts["consent"];

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

/** A prepared document that cites nothing, which no test here renders. */
const fakeDocument: PreparedDocument = {
  citedIds: [],
  withCitedIds: () => fakeDocument,
};

function fakeEngine(dispose = vi.fn()): CitationEngine {
  return {
    renderBibliography: () => Promise.resolve([]),
    renderCitations: () => Promise.resolve([]),
    prepareDocument: () =>
      Promise.resolve({ citedIds: [], withCitedIds: () => fakeDocument }),
    renderPrepared: () => Promise.resolve(new Uint8Array()),
    [Symbol.asyncDispose]: () => {
      dispose();
      return Promise.resolve();
    },
  };
}

interface HarnessOptions {
  files?: BinaryFiles;
  consent?: MemoryConsent;
  pin?: BinaryPin;
  /** The store comes along, so a download can act out what another vault does meanwhile. */
  download?: (
    url: string,
    store: MemoryStore,
  ) => Promise<Uint8Array<ArrayBuffer>>;
  createEngine?: (binary: Blob) => Promise<CitationEngine>;
}

async function harness(options: HarnessOptions = {}) {
  const store = memoryStore(options.files);
  const consent = options.consent ?? memoryConsent();
  const behavior = options.download ?? (() => Promise.resolve(ARCHIVE.slice()));
  const download = vi.fn((url: string) => behavior(url, store));
  const createEngine = vi.fn(
    options.createEngine ?? (() => Promise.resolve(fakeEngine())),
  );
  const service = await openManagedBinary(
    { ...PANDOC_ENGINE, pin: options.pin ?? PIN, createEngine },
    { openStore: () => store, consent, download },
  );
  return { service, store, consent, download, createEngine };
}

describe("Pandoc Engine", () => {
  it.effect("caches a verified binary under its own hash", () =>
    Effect.promise(async () => {
      const { service, store, download } = await harness();

      await service.install();

      expect(download).toHaveBeenCalledWith(PIN.url);
      expect(store.files.get(CACHED_NAME)).toEqual(BINARY);
      expect([...store.files.keys()]).toEqual([CACHED_NAME]);
      expect(service.getStatus()).toEqual({
        kind: "installed",
        version: PIN.version,
        binary: { directory: "pandoc-engine", name: CACHED_NAME },
      });
      await service[Symbol.asyncDispose]();
    }),
  );

  it.effect("reports a download that never arrived", () =>
    Effect.promise(async () => {
      const { service, store } = await harness({
        download: () =>
          Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
      });

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
    }),
  );

  it.effect(
    "adopts the binary another vault already cached, without downloading",
    () =>
      Effect.promise(async () => {
        const { service, download } = await harness({
          files: { [CACHED_NAME]: BINARY },
        });

        expect(service.getStatus()).toEqual({
          kind: "installed",
          version: PIN.version,
          binary: { directory: "pandoc-engine", name: CACHED_NAME },
        });

        await service.install();

        expect(download).not.toHaveBeenCalled();
        await service[Symbol.asyncDispose]();
      }),
  );

  it.effect("shares one download between concurrent installs", () =>
    Effect.promise(async () => {
      const { service, download } = await harness();

      await Promise.all([service.install(), service.install()]);

      expect(download).toHaveBeenCalledTimes(1);
      await service[Symbol.asyncDispose]();
    }),
  );

  it.effect(
    "replaces the binary another vault cached while the download ran",
    () =>
      Effect.promise(async () => {
        const { service, store } = await harness({
          // The competing vault verifies the same bytes and renames onto the cache
          // first, so this install renames onto a name that already exists.
          download: (_url, store) => {
            store.files.set(CACHED_NAME, BINARY);
            return Promise.resolve(ARCHIVE.slice());
          },
        });

        await service.install();

        expect(store.files.get(CACHED_NAME)).toEqual(BINARY);
        expect([...store.files.keys()]).toEqual([CACHED_NAME]);
        expect(service.getStatus()).toEqual({
          kind: "installed",
          version: PIN.version,
          binary: { directory: "pandoc-engine", name: CACHED_NAME },
        });
        await service[Symbol.asyncDispose]();
      }),
  );

  it.effect(
    "waits out an install in flight, so the removal has the last word",
    () =>
      Effect.promise(async () => {
        let arrive = () => undefined as void;
        const arrived = new Promise<void>((resolve) => {
          arrive = resolve;
        });
        const { service, store } = await harness({
          download: async () => {
            await arrived;
            return ARCHIVE.slice();
          },
        });

        const install = service.install();
        const uninstall = service.uninstall();
        arrive();
        await install;
        await uninstall;

        expect([...store.files.keys()]).toEqual([]);
        expect(service.getStatus()).toEqual({ kind: "absent" });
        await service[Symbol.asyncDispose]();
      }),
  );

  it.effect("notifies subscribers on every status change", () =>
    Effect.promise(async () => {
      const { service } = await harness();
      const listener = vi.fn();
      const unsubscribe = service.subscribe(listener);

      await service.install();
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

      unsubscribe();
      await service.uninstall();
      expect(service.getStatus()).toEqual({ kind: "absent" });
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
      await service[Symbol.asyncDispose]();
    }),
  );

  it.effect(
    "refuses an engine while nothing is installed, and keeps the status",
    () =>
      Effect.promise(async () => {
        const { service, createEngine } = await harness();

        await expect(service.getEngine()).rejects.toThrow(/not installed/);

        expect(service.getStatus()).toEqual({ kind: "absent" });
        expect(createEngine).not.toHaveBeenCalled();
        await service[Symbol.asyncDispose]();
      }),
  );

  it.effect(
    "reports a binary that will not start, and starts over on a re-install",
    () =>
      Effect.promise(async () => {
        const createEngine = vi
          .fn<(binary: Blob) => Promise<CitationEngine>>()
          .mockRejectedValueOnce(new Error("CompileError: bad magic"))
          .mockResolvedValue(fakeEngine());
        const { service } = await harness({ createEngine });
        await service.install();

        await expect(service.getEngine()).rejects.toThrow(/bad magic/);
        expect(service.getStatus()).toEqual({
          kind: "failed",
          failure: { code: "init-failed", detail: "CompileError: bad magic" },
        });

        // Re-installing finds the content-addressed binary still cached and moves
        // the status back to `installed`, so the engine can be tried again.
        await service.install();
        await expect(service.getEngine()).resolves.toBeDefined();
        await service[Symbol.asyncDispose]();
      }),
  );

  it.effect("clears a corrupt cached binary and offers the install again", () =>
    Effect.promise(async () => {
      const corrupt = bytes(new TextEncoder().encode("not the pinned bytes"));
      const createEngine = vi
        .fn<(binary: Blob) => Promise<CitationEngine>>()
        .mockRejectedValueOnce(new Error("CompileError: bad magic"))
        .mockResolvedValue(fakeEngine());
      const { service, store } = await harness({
        files: { [CACHED_NAME]: corrupt },
        createEngine,
      });
      const listener = vi.fn();
      service.subscribe(listener);

      await expect(service.getEngine()).rejects.toThrow(/bad magic/);

      expect(store.files.has(CACHED_NAME)).toBe(false);
      expect(service.getStatus()).toEqual({ kind: "absent" });
      expect(listener).toHaveBeenCalled();

      await service.install();
      await expect(service.getEngine()).resolves.toBeDefined();
      await service[Symbol.asyncDispose]();
    }),
  );

  it.effect("hands out one engine and disposes it with the service", () =>
    Effect.promise(async () => {
      const dispose = vi.fn();
      const { service, createEngine } = await harness({
        createEngine: () => Promise.resolve(fakeEngine(dispose)),
      });
      await service.install();

      const engine = await service.getEngine();
      expect(await service.getEngine()).toBe(engine);
      expect(createEngine).toHaveBeenCalledTimes(1);
      const [passed] = createEngine.mock.calls[0]!;
      expect(passed).toBeInstanceOf(Blob);
      expect(new Uint8Array(await passed.arrayBuffer())).toEqual(BINARY);

      await service[Symbol.asyncDispose]();
      expect(dispose).toHaveBeenCalledOnce();
    }),
  );

  it.effect("disposes the engine on uninstall", () =>
    Effect.promise(async () => {
      const dispose = vi.fn();
      const { service } = await harness({
        createEngine: () => Promise.resolve(fakeEngine(dispose)),
      });
      await service.install();
      await service.getEngine();

      await service.uninstall();

      expect(dispose).toHaveBeenCalledOnce();
      await service[Symbol.asyncDispose]();
    }),
  );
});
