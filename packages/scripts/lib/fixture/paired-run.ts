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
}

export interface PairedRunPorts {
  assertObsidianHost(): Promise<void>;
  assertFixtureIdle(): Promise<void>;
  prepareDevelopmentVault(options: {
    scopeCase: string;
    purge: boolean;
  }): Promise<DevelopmentVault>;
  openPairedZotero(): Promise<PairedZotero>;
  startDevelopmentSession(): Promise<DevelopmentSession>;
  reportReady(result: PairedRunReady): void;
}

export async function runPairedRun(
  options: PairedRunOptions,
  ports: PairedRunPorts,
): Promise<void> {
  await ports.assertObsidianHost();
  await ports.assertFixtureIdle();
  const vault = await ports.prepareDevelopmentVault({
    scopeCase: options.scopeCase,
    purge: options.purge,
  });

  if (options.mode === "open") {
    const zotero = await ports.openPairedZotero();
    ports.reportReady({ mode: options.mode, vault, zotero });
    return;
  }

  const session = await ports.startDevelopmentSession();
  const zotero = await session.ready;
  ports.reportReady({ mode: options.mode, vault, zotero });
  await session.closed;
}
