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
}

export interface PairedRunPorts {
  assertObsidianHost(): Promise<void>;
  assertFixtureIdle(): Promise<void>;
  /** A port that is free right now, for this run's Live Updates channel. */
  allocateLiveUpdatePort(): Promise<number>;
  prepareDevelopmentVault(options: {
    scopeCase: string;
    purge: boolean;
    liveUpdatePort: number;
  }): Promise<DevelopmentVault>;
  openPairedZotero(): Promise<PairedZotero>;
  startDevelopmentSession(): Promise<DevelopmentSession>;
  reportReady(result: PairedRunReady): void;
}

type Attempt<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

async function attempt<T>(operation: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { status: "fulfilled", value: await operation() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

export async function runPairedRun(
  options: PairedRunOptions,
  ports: PairedRunPorts,
): Promise<void> {
  if (options.mode === "open") {
    await ports.assertFixtureIdle();
    const liveUpdatePort = await ports.allocateLiveUpdatePort();
    const [vault, zotero] = await Promise.all([
      attempt(async () => {
        await ports.assertObsidianHost();
        return ports.prepareDevelopmentVault({
          scopeCase: options.scopeCase,
          purge: options.purge,
          liveUpdatePort,
        });
      }),
      attempt(() => ports.openPairedZotero()),
    ]);

    if (vault.status === "fulfilled" && zotero.status === "fulfilled") {
      ports.reportReady({
        mode: options.mode,
        vault: vault.value,
        zotero: zotero.value,
        liveUpdatePort,
      });
      return;
    }
    if (vault.status === "rejected" && zotero.status === "rejected") {
      throw new AggregateError(
        [vault.reason, zotero.reason],
        "Obsidian and Paired Zotero failed to open",
      );
    }
    if (vault.status === "rejected") throw vault.reason;
    if (zotero.status === "rejected") throw zotero.reason;
  }

  await ports.assertObsidianHost();
  await ports.assertFixtureIdle();
  // One fresh port per Paired Run: the default port belongs to whichever ZotLit
  // vault claimed it first, and a Development Vault that loses the race serves
  // no Live Updates at all.
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const vault = await ports.prepareDevelopmentVault({
    scopeCase: options.scopeCase,
    purge: options.purge,
    liveUpdatePort,
  });

  const session = await ports.startDevelopmentSession();
  const zotero = await session.ready;
  ports.reportReady({ mode: options.mode, vault, zotero, liveUpdatePort });
  await session.closed;
}
