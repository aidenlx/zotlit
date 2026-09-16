import type { PairedZotero } from "./paired-zotero.ts";

export type PairedRunMode = "open" | "dev";

export interface PairedRunOptions {
  mode: PairedRunMode;
  scopeCase: string;
  /** Vault Case to seed; absent keeps the Development Vault's current case. */
  vaultCase?: string;
  purge: boolean;
  /**
   * Open Zotero's Local API in the Fixture profile. The run's Zotero HTTP port
   * carries it, so Paired Zotero serves the API where ZotLit reads it.
   *
   * @default false
   */
  localApi?: boolean;
}

export interface DevelopmentVault {
  id: string;
  path: string;
}

export interface DevelopmentSession {
  ready: Promise<PairedZotero>;
  closed: Promise<void>;
}

export interface PairedRunReady {
  mode: PairedRunMode;
  vault: DevelopmentVault;
  zotero: PairedZotero;
  /** The port this run gave the Development Vault and Paired Zotero. */
  liveUpdatePort: number;
  /** The HTTP server port this run gave the active Zotero profile. */
  zoteroHttpPort: number;
  /** Whether this run opened Zotero's Local API on that port. */
  localApi: boolean;
}

export interface PairedRunPorts {
  assertObsidianHost(): Promise<void>;
  /**
   * Close a Paired Zotero that still holds this Fixture, so the rebuild that
   * follows starts on a Fixture root no process keeps open.
   */
  stopLivePairedZotero(): Promise<void>;
  /** A port that is free right now, for this run's Live Updates channel. */
  allocateLiveUpdatePort(): Promise<number>;
  /** A port that is free right now, for this run's Zotero HTTP server. */
  allocateZoteroHttpPort(): Promise<number>;
  prepareDevelopmentVault(options: {
    scopeCase: string;
    vaultCase?: string;
    purge: boolean;
    liveUpdatePort: number;
    zoteroHttpPort: number;
    localApi: boolean;
  }): Promise<DevelopmentVault>;
  openPairedZotero(): Promise<PairedZotero>;
  startDevelopmentSession(options: {
    vaultCase?: string;
  }): Promise<DevelopmentSession>;
  reportReady(result: PairedRunReady): void;
}

export async function runPairedRun(
  options: PairedRunOptions,
  ports: PairedRunPorts,
): Promise<void> {
  const localApi = options.localApi ?? false;
  if (options.mode === "open") {
    await ports.stopLivePairedZotero();
    const liveUpdatePort = await ports.allocateLiveUpdatePort();
    const zoteroHttpPort = await ports.allocateZoteroHttpPort();
    await ports.assertObsidianHost();
    const vault = await ports.prepareDevelopmentVault({
      scopeCase: options.scopeCase,
      vaultCase: options.vaultCase,
      purge: options.purge,
      liveUpdatePort,
      zoteroHttpPort,
      localApi,
    });
    // Zotero reads `httpServer.port` during startup, after the generated
    // profile has been written above.
    const zotero = await ports.openPairedZotero();
    ports.reportReady({
      mode: options.mode,
      vault,
      zotero,
      liveUpdatePort,
      zoteroHttpPort,
      localApi,
    });
    return;
  }

  await ports.assertObsidianHost();
  await ports.stopLivePairedZotero();
  // Two fresh ports per Paired Run keep both loopback servers independent of
  // other ZotLit and Zotero profiles on the machine.
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const zoteroHttpPort = await ports.allocateZoteroHttpPort();
  const vault = await ports.prepareDevelopmentVault({
    scopeCase: options.scopeCase,
    vaultCase: options.vaultCase,
    purge: options.purge,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
  });

  const session = await ports.startDevelopmentSession({
    vaultCase: options.vaultCase,
  });
  const zotero = await session.ready;
  ports.reportReady({
    mode: options.mode,
    vault,
    zotero,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
  });
  await session.closed;
}
