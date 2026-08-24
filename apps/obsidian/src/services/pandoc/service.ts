// Consent-gated download, hash verification, and device-wide cache of the pinned Pandoc engine binary.

import { unzipSync } from "fflate";
import { requestUrl } from "obsidian";
import type { App } from "obsidian";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import { createCitationEngine } from "./engine";
import type { CitationEngine } from "./engine";
import { PINNED_PANDOC_ENGINE } from "./pinned-engine";
import type { PinnedPandocEngine } from "./pinned-engine";
import { createOpfsBinaryStore } from "./store";
import type { EngineBinaryStore } from "./store";

const logger = getLogger(["pandoc", "engine"]);

/** Name the official WASM asset carries the binary under, inside its archive. */
const BINARY_ENTRY = "pandoc.wasm";

/** Suffix of a cached binary; a download still running writes `.part` instead. */
const BINARY_SUFFIX = ".wasm";

/** Vault-scoped record of a declined install offer. */
const DECLINED_KEY = "zotlit-pandoc-engine-declined";

/** Why the engine is unusable, in the terms the fallback surface guides out of. */
export type PandocEngineFailure =
  | { code: "download-failed"; url: string; detail: string }
  | { code: "hash-mismatch"; expected: string; actual: string }
  | { code: "init-failed"; detail: string };

/**
 * Where the Pandoc engine stands. Arms are mutually exclusive, so one shared
 * fallback surface renders one of them rather than deriving its own combination
 * of flags.
 */
export type PandocEngineStatus =
  /** No binary is cached, and the install offer still stands. */
  | { kind: "absent" }
  /** No binary is cached, and this vault dismissed the offer. */
  | { kind: "declined" }
  | { kind: "installing"; done: Promise<void> }
  | { kind: "installed"; version: string }
  | { kind: "failed"; failure: PandocEngineFailure };

export interface PandocEnginePorts {
  /** The device-wide binary cache. */
  store: EngineBinaryStore;
  /** One download of the pinned asset; rejects when the download fails. */
  download: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** Vault-scoped storage the dismissed install offer is remembered in. */
  consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
  /** @default PINNED_PANDOC_ENGINE */
  pin?: PinnedPandocEngine;
  /** @default createCitationEngine */
  createEngine?: (binary: Blob) => Promise<CitationEngine>;
}

/**
 * Owns the Pandoc engine binary: the consent-gated download of the pinned
 * asset, its verification against the pinned SHA-256, the device-wide cache it
 * lands in, and the engine instantiated from it.
 *
 * Nothing downloads on its own — {@link install} is the one door onto the
 * network, and startup only reads which binary is already cached.
 */
export class PandocEngineService extends Service<void> {
  readonly #store: EngineBinaryStore;
  readonly #download: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly #consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
  readonly #pin: PinnedPandocEngine;
  readonly #createEngine: (binary: Blob) => Promise<CitationEngine>;

  readonly #listeners = new Set<() => void>();
  #status: PandocEngineStatus;
  /** Memoized instantiation; cleared whenever the binary behind it goes away. */
  #engine: Promise<CitationEngine> | undefined;

  ready: Promise<void>;

  constructor({
    store,
    download,
    consent,
    pin = PINNED_PANDOC_ENGINE,
    createEngine = createCitationEngine,
  }: PandocEnginePorts) {
    super();
    this.#store = store;
    this.#download = download;
    this.#consent = consent;
    this.#pin = pin;
    this.#createEngine = createEngine;
    this.#status = Object.freeze<PandocEngineStatus>(
      consent.loadLocalStorage(DECLINED_KEY)
        ? { kind: "declined" }
        : { kind: "absent" },
    );
    this.ready = this.#load();
  }

  getStatus(): PandocEngineStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * The engine, instantiated from the cached binary on first use and shared
   * afterwards. An instantiation failure moves the status to
   * `failed`/`init-failed`; {@link install} re-verifies the cache and puts the
   * engine back within reach.
   *
   * @throws when no verified binary is cached, or when the binary fails to
   *   instantiate.
   */
  getEngine(): Promise<CitationEngine> {
    const engine = (this.#engine ??= this.#loadEngine());
    // A failed instantiation stays out of the memo, so the next call retries.
    engine.catch(() => {
      if (this.#engine === engine) this.#engine = undefined;
    });
    return engine;
  }

  /**
   * The one door onto a download: records consent, downloads the pinned asset,
   * verifies it, and caches it. Concurrent calls share the install in flight.
   *
   * @throws when the download, its verification, or the cache write fails; the
   *   status then carries the same failure.
   */
  install(): Promise<void> {
    const current = this.#status;
    if (current.kind === "installing") return current.done;

    this.#consent.saveLocalStorage(DECLINED_KEY, null);
    const done = this.#runInstall();
    // No-op side chain: keeps the status's copy of the promise from tripping
    // unhandledrejection when the caller attaches no handler of its own.
    done.catch(() => undefined);
    this.#setStatus({ kind: "installing", done });
    return done;
  }

  /**
   * Records the dismissal, moving `absent` to `declined`. The offer itself is
   * the dismissible install hint the fallback surface carries, so the decision
   * is remembered here and survives a restart.
   */
  decline(): void {
    this.#consent.saveLocalStorage(DECLINED_KEY, true);
    if (this.#status.kind === "absent") this.#setStatus({ kind: "declined" });
  }

  /**
   * Drops the whole cache — every vault on the device loses the binary — and
   * the running engine with it. The dismissed offer is forgotten too, so this
   * vault is offered the install again.
   *
   * An install in flight lands its binary and its `installed` status whenever
   * the download arrives, so the removal waits that install out and has the
   * last word instead of racing it.
   */
  async uninstall(): Promise<void> {
    const current = this.#status;
    if (current.kind === "installing") {
      await current.done.catch(() => undefined);
    }
    await this.#dropEngine();
    await this.#store.clear();
    this.#consent.saveLocalStorage(DECLINED_KEY, null);
    logger.info("Removed the Pandoc engine cache", { pin: this.#pin });
    this.#setStatus({ kind: "absent" });
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(() => this.#dropEngine());

    if (await this.#isCached()) {
      this.#setStatus({ kind: "installed", version: this.#pin.version });
    }
    this.commit(stack.move());
  }

  /** A cache the device denies ZotLit reads as no binary rather than as a failure. */
  async #isCached(): Promise<boolean> {
    try {
      return (await this.#store.list()).includes(this.#binaryName);
    } catch (error) {
      logger.warn("Cannot read the Pandoc engine cache", { error });
      return false;
    }
  }

  get #binaryName(): string {
    return `${this.#pin.sha256}${BINARY_SUFFIX}`;
  }

  async #loadEngine(): Promise<CitationEngine> {
    if (this.#status.kind !== "installed") {
      throw new Error("The Pandoc engine is not installed");
    }
    let binary: Blob;
    try {
      const read = await this.#store.read(this.#binaryName);
      if (!read) throw new Error("The cached Pandoc engine binary is gone");
      binary = read;
    } catch (error) {
      this.#failInit(error);
      throw error;
    }
    try {
      return await this.#createEngine(binary);
    } catch (error) {
      // The binary that failed to start may simply be corrupt on disk; a
      // pinned-hash mismatch means the cache is bad, not Pandoc itself, so
      // clearing it lets the normal install offer reappear instead of
      // stranding the user on a dead cache. This path is rare, so
      // materializing the whole binary to hash it is fine here.
      const actual = await sha256Hex(await binary.arrayBuffer());
      if (actual !== this.#pin.sha256) {
        logger.warn("The cached Pandoc engine binary is corrupt", {
          name: this.#binaryName,
          actual,
          error,
        });
        await this.#store.remove(this.#binaryName).catch(() => undefined);
        this.#setStatus({ kind: "absent" });
        throw error;
      }
      this.#failInit(error);
      throw error;
    }
  }

  #failInit(error: unknown): void {
    const failure: PandocEngineFailure = {
      code: "init-failed",
      detail: describe(error),
    };
    logger.error("The Pandoc engine did not start", { failure, error });
    this.#setStatus({ kind: "failed", failure });
  }

  async #runInstall(): Promise<void> {
    const { version, url, sha256 } = this.#pin;
    try {
      // Another vault may have finished the very same download already.
      if (!(await this.#isCached())) await this.#fetchBinary();
      await this.#prune();
      logger.info("Installed the Pandoc engine", { version, sha256 });
      this.#setStatus({ kind: "installed", version });
    } catch (error) {
      const failure = toFailure(error, url);
      logger.error("The Pandoc engine install failed", { failure, error });
      this.#setStatus({ kind: "failed", failure });
      throw error;
    }
  }

  /**
   * Temp write → verify → rename, so a vault reading the cache never observes a
   * half-written binary and two vaults downloading at once land on identical
   * verified bytes.
   */
  async #fetchBinary(): Promise<void> {
    const { url, sha256 } = this.#pin;
    logger.info("Downloading the Pandoc engine", { url });
    const binary = extractBinary(await this.#download(url));

    const temp = `${sha256}.${crypto.randomUUID()}.part`;
    await this.#store.write(temp, binary);
    try {
      const actual = await sha256Hex(binary);
      if (actual !== sha256) throw new HashMismatchError(sha256, actual);
      await this.#store.rename(temp, this.#binaryName);
    } catch (error) {
      await this.#store.remove(temp).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Drops the binaries earlier releases pinned, once the current one verified.
   * A `.part` entry belongs to a download another vault still has in flight.
   * The install already succeeded here, so a leftover ZotLit cannot delete
   * costs disk space rather than the install.
   */
  async #prune(): Promise<void> {
    const current = this.#binaryName;
    try {
      for (const name of await this.#store.list()) {
        if (name === current || !name.endsWith(BINARY_SUFFIX)) continue;
        await this.#store.remove(name);
      }
    } catch (error) {
      logger.warn("Cannot drop the superseded Pandoc engine binaries", {
        error,
      });
    }
  }

  async #dropEngine(): Promise<void> {
    const pending = this.#engine;
    this.#engine = undefined;
    const engine = await pending?.catch(() => undefined);
    await engine?.[Symbol.asyncDispose]();
  }

  #setStatus(status: PandocEngineStatus): void {
    this.#status = Object.freeze(status);
    for (const listener of this.#listeners) listener();
  }
}

/** The service over Obsidian's own ports: `requestUrl` and the origin's OPFS. */
export function createPandocEngineService(app: App): PandocEngineService {
  return new PandocEngineService({
    store: createOpfsBinaryStore(),
    download: async (url) =>
      new Uint8Array(await requestUrl({ url }).arrayBuffer),
    consent: app,
  });
}

class HashMismatchError extends Error {
  override name = "HashMismatchError";
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Expected the engine binary to hash to ${expected}, got ${actual}`);
    this.expected = expected;
    this.actual = actual;
  }
}

/** The official asset nests the binary under a release-named directory. */
function extractBinary(
  archive: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const entries = unzipSync(archive, {
    filter: (file) => file.name.split("/").at(-1) === BINARY_ENTRY,
  });
  const [binary] = Object.values(entries);
  if (!binary) {
    throw new Error(`The downloaded asset carries no ${BINARY_ENTRY} entry`);
  }
  return binary;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toFailure(error: unknown, url: string): PandocEngineFailure {
  return error instanceof HashMismatchError
    ? { code: "hash-mismatch", expected: error.expected, actual: error.actual }
    : { code: "download-failed", url, detail: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
