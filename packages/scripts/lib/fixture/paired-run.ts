import type { PairedZotero } from "./paired-zotero.ts";

export type PairedRunMode = "open" | "dev";

export interface PairedRunOptions {
  mode: PairedRunMode;
  scopeCase: string;
  purge: boolean;
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
}

export interface PairedRunPorts {
  assertObsidianHost(): Promise<void>;
  assertFixtureIdle(): Promise<void>;
  /** A port that is free right now, for this run's Live Updates channel. */
  allocateLiveUpdatePort(): Promise<number>;
  /** A port that is free right now, for this run's Zotero HTTP server. */
  allocateZoteroHttpPort(): Promise<number>;
  prepareDevelopmentVault(options: {
    scopeCase: string;
    purge: boolean;
    liveUpdatePort: number;
    zoteroHttpPort: number;
  }): Promise<DevelopmentVault>;
  openPairedZotero(): Promise<PairedZotero>;
  startDevelopmentSession(): Promise<DevelopmentSession>;
  reportReady(result: PairedRunReady): void;
}

export async function runPairedRun(
  options: PairedRunOptions,
  ports: PairedRunPorts,
): Promise<void> {
  if (options.mode === "open") {
    await ports.assertFixtureIdle();
    const liveUpdatePort = await ports.allocateLiveUpdatePort();
    const zoteroHttpPort = await ports.allocateZoteroHttpPort();
    await ports.assertObsidianHost();
    const vault = await ports.prepareDevelopmentVault({
      scopeCase: options.scopeCase,
      purge: options.purge,
      liveUpdatePort,
      zoteroHttpPort,
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
    });
    return;
  }

  await ports.assertObsidianHost();
  await ports.assertFixtureIdle();
  // Two fresh ports per Paired Run keep both loopback servers independent of
  // other ZotLit and Zotero profiles on the machine.
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const zoteroHttpPort = await ports.allocateZoteroHttpPort();
  const vault = await ports.prepareDevelopmentVault({
    scopeCase: options.scopeCase,
    purge: options.purge,
    liveUpdatePort,
    zoteroHttpPort,
  });

  const session = await ports.startDevelopmentSession();
  const zotero = await session.ready;
  ports.reportReady({
    mode: options.mode,
    vault,
    zotero,
    liveUpdatePort,
    zoteroHttpPort,
  });
  await session.closed;
}
