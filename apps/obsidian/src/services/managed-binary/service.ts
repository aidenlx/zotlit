// Consent-gated download, hash verification, and device-wide cache of one pinned Managed Binary.

import { requestUrl } from "obsidian";
import type { App } from "obsidian";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import { createOpfsBinaryStore } from "./store";
import type { BinaryStore } from "./store";

export type { BinaryStore } from "./store";

/** Suffix of a cached binary; a download still running writes `.part` instead. */
const BINARY_SUFFIX = ".wasm";

/**
 * The download a build committed to, resolved and verified against the
 * official upstream release at build time.
 */
export interface BinaryPin {
  /** Upstream release version, e.g. `3.10`. */
  readonly version: string;
  /** Exact upstream asset that carries the binary. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the binary itself, after {@link ManagedBinary.extract}. */
  readonly sha256: string;
}

/**
 * One Managed Binary: what a release pins, where the device caches it, and what
 * it starts once verified. Two declarations with distinct `id`s share no cache
 * entry and no consent record.
 */
export interface ManagedBinary<Engine extends AsyncDisposable | Disposable> {
  /**
   * Names the binary on the device: its cache directory `zotlit/<id>` and its
   * vault-scoped consent record `zotlit-<id>-declined`.
   */
  readonly id: string;
  /** The binary's name in logs and error messages, e.g. `Pandoc engine`. */
  readonly label: string;
  readonly logCategory: readonly [string, ...string[]];
  readonly pin: BinaryPin;
  /**
   * The binary inside the downloaded asset.
   * @default the asset itself, for an asset that is the bare binary
   */
  readonly extract?: (
    asset: Uint8Array<ArrayBuffer>,
  ) => Uint8Array<ArrayBuffer>;
  /** Starts the engine over the verified binary, streamed rather than materialized. */
  readonly createEngine: (binary: Blob) => Promise<Engine>;
  /**
   * Start the engine once after each install, then release it, so a binary
   * that does not start reports `init-failed` before its first use.
   * @default false
   */
  readonly startOnInstall?: boolean;
}

/** Why a binary is unusable, in the terms the fallback surface guides out of. */
export type ManagedBinaryFailure =
  | { code: "download-failed"; url: string; detail: string }
  | { code: "hash-mismatch"; expected: string; actual: string }
  | { code: "init-failed"; detail: string };

/**
 * Where a binary stands. Arms are mutually exclusive, so one shared fallback
 * surface renders one of them rather than deriving its own combination of
 * flags.
 */
export type ManagedBinaryStatus =
  /** No binary is cached, and the install offer still stands. */
  | { kind: "absent" }
  /** No binary is cached, and this vault dismissed the offer. */
  | { kind: "declined" }
  | { kind: "installing"; done: Promise<void> }
  | { kind: "installed"; version: string }
  | { kind: "failed"; failure: ManagedBinaryFailure };

export interface ManagedBinaryPorts {
  /** Opens the device-wide cache directory a binary owns. */
  openStore: (directory: string) => BinaryStore;
  /** One download of the pinned asset; rejects when the download fails. */
  download: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** Vault-scoped storage the dismissed install offer is remembered in. */
  consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
}

/** The name a verified binary is cached under: its pinned hash. */
export function cachedBinaryName(pin: BinaryPin): string {
  return `${pin.sha256}${BINARY_SUFFIX}`;
}

/**
 * Owns one Managed Binary: the consent-gated download of the pinned asset, its
 * verification against the pinned SHA-256, the device-wide cache it lands in,
 * and the engine instantiated from it.
 *
 * Nothing downloads on its own — {@link install} is the one door onto the
 * network, and startup only reads which binary is already cached.
 */
export class ManagedBinaryService<
  Engine extends AsyncDisposable | Disposable = AsyncDisposable | Disposable,
> extends Service<void> {
  readonly #binary: ManagedBinary<Engine>;
  readonly #store: BinaryStore;
  readonly #download: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly #consent: Pick<App, "loadLocalStorage" | "saveLocalStorage">;
  readonly #declinedKey: string;
  readonly #logger: ReturnType<typeof getLogger>;

  readonly #listeners = new Set<() => void>();
  #status: ManagedBinaryStatus;
  /** Memoized instantiation; cleared whenever the binary behind it goes away. */
  #engine: Promise<Engine> | undefined;

  ready: Promise<void>;

  constructor(
    binary: ManagedBinary<Engine>,
    { openStore, download, consent }: ManagedBinaryPorts,
  ) {
    super();
    this.#binary = binary;
    this.#store = openStore(binary.id);
    this.#download = download;
    this.#consent = consent;
    this.#declinedKey = `zotlit-${binary.id}-declined`;
    this.#logger = getLogger(binary.logCategory);
    this.#status = Object.freeze<ManagedBinaryStatus>(
      consent.loadLocalStorage(this.#declinedKey)
        ? { kind: "declined" }
        : { kind: "absent" },
    );
    this.ready = this.#load();
  }

  getStatus(): ManagedBinaryStatus {
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
  getEngine(): Promise<Engine> {
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

    this.#consent.saveLocalStorage(this.#declinedKey, null);
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
    this.#consent.saveLocalStorage(this.#declinedKey, true);
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
    this.#consent.saveLocalStorage(this.#declinedKey, null);
    this.#logger.info("Removed the binary cache", {
      binary: this.#binary.id,
      pin: this.#binary.pin,
    });
    this.#setStatus({ kind: "absent" });
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(() => this.#dropEngine());

    if (await this.#isCached()) {
      this.#setStatus({ kind: "installed", version: this.#binary.pin.version });
    }
    this.commit(stack.move());
  }

  /** A cache the device denies ZotLit reads as no binary rather than as a failure. */
  async #isCached(): Promise<boolean> {
    try {
      return (await this.#store.list()).includes(this.#binaryName);
    } catch (error) {
      this.#logger.warn("Cannot read the binary cache", {
        binary: this.#binary.id,
        error,
      });
      return false;
    }
  }

  get #binaryName(): string {
    return cachedBinaryName(this.#binary.pin);
  }

  async #loadEngine(): Promise<Engine> {
    const { label, pin, createEngine } = this.#binary;
    if (this.#status.kind !== "installed") {
      throw new Error(`The ${label} is not installed`);
    }
    let binary: Blob;
    try {
      const read = await this.#store.read(this.#binaryName);
      if (!read) throw new Error(`The cached ${label} binary is gone`);
      binary = read;
    } catch (error) {
      this.#failInit(error);
      throw error;
    }
    try {
      return await createEngine(binary);
    } catch (error) {
      // The binary that failed to start may simply be corrupt on disk; a
      // pinned-hash mismatch means the cache is bad, not the binary itself, so
      // clearing it lets the normal install offer reappear instead of
      // stranding the user on a dead cache. This path is rare, so
      // materializing the whole binary to hash it is fine here.
      const actual = await sha256Hex(await binary.arrayBuffer());
      if (actual !== pin.sha256) {
        this.#logger.warn("The cached binary is corrupt", {
          binary: this.#binary.id,
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
    const failure: ManagedBinaryFailure = {
      code: "init-failed",
      detail: describe(error),
    };
    this.#logger.error("The binary did not start", {
      binary: this.#binary.id,
      failure,
      error,
    });
    this.#setStatus({ kind: "failed", failure });
  }

  async #runInstall(): Promise<void> {
    const { id: binary, pin } = this.#binary;
    const { version, url, sha256 } = pin;
    try {
      // Another vault may have finished the very same download already.
      if (!(await this.#isCached())) await this.#fetchBinary();
      await this.#prune();
      this.#logger.info("Installed the binary", { binary, version, sha256 });
      this.#setStatus({ kind: "installed", version });
    } catch (error) {
      const failure = toFailure(error, url);
      this.#logger.error("The binary install failed", {
        binary,
        failure,
        error,
      });
      this.#setStatus({ kind: "failed", failure });
      throw error;
    }
    if (!this.#binary.startOnInstall) return;
    try {
      await this.getEngine();
    } finally {
      await this.#dropEngine();
    }
  }

  /**
   * Temp write → verify → rename, so a vault reading the cache never observes a
   * half-written binary and two vaults downloading at once land on identical
   * verified bytes.
   */
  async #fetchBinary(): Promise<void> {
    const { id, pin, extract = (asset) => asset } = this.#binary;
    const { url, sha256 } = pin;
    this.#logger.info("Downloading the binary", { binary: id, url });
    const binary = extract(await this.#download(url));

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
      this.#logger.warn("Cannot drop the superseded binaries", {
        binary: this.#binary.id,
        error,
      });
    }
  }

  async #dropEngine(): Promise<void> {
    const pending = this.#engine;
    this.#engine = undefined;
    await using _engine = await pending?.catch(() => undefined);
  }

  #setStatus(status: ManagedBinaryStatus): void {
    this.#status = Object.freeze(status);
    for (const listener of this.#listeners) listener();
  }
}

/** Obsidian's own ports: the origin's OPFS, `requestUrl`, and the vault's local storage. */
export function obsidianBinaryPorts(app: App): ManagedBinaryPorts {
  return {
    openStore: createOpfsBinaryStore,
    download: async (url) =>
      new Uint8Array(await requestUrl({ url }).arrayBuffer),
    consent: app,
  };
}

class HashMismatchError extends Error {
  override name = "HashMismatchError";
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Expected the binary to hash to ${expected}, got ${actual}`);
    this.expected = expected;
    this.actual = actual;
  }
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toFailure(error: unknown, url: string): ManagedBinaryFailure {
  return error instanceof HashMismatchError
    ? { code: "hash-mismatch", expected: error.expected, actual: error.actual }
    : { code: "download-failed", url, detail: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
