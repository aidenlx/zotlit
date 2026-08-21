import { describe, expect, it } from "vitest";

import { findPairedZoteroProcesses } from "./paired-run-node.ts";
import type {
  DevelopmentSession,
  PairedRunPorts,
  PairedRunReady,
} from "./paired-run.ts";
import { runPairedRun } from "./paired-run.ts";

function testPorts(overrides: Partial<PairedRunPorts> = {}): PairedRunPorts {
  return {
    assertObsidianHost: async () => {},
    assertFixtureIdle: async () => {},
    allocateLiveUpdatePort: async () => 51_234,
    prepareDevelopmentVault: async () => ({
      id: "fixture-vault-test-fixture",
      path: "/workspace/tests/fixture-vault-test-fixture",
    }),
    openPairedZotero: async () => ({
      applicationDir: "/Applications/Zotero.app",
      pid: 804,
    }),
    startDevelopmentSession: async () => ({
      ready: Promise.resolve({
        applicationDir: "/Applications/Zotero.app",
        pid: 804,
      }),
      closed: Promise.resolve(),
    }),
    reportReady: () => {},
    ...overrides,
  };
}

describe("Paired Run", () => {
  it("distinguishes Paired Zotero from the linked Obsidian database reader", () => {
    expect(
      findPairedZoteroProcesses(
        "p16893\ncObsidian Helper (Renderer)\np27078\nczotero\n",
      ),
    ).toEqual(["zotero (pid 27078)"]);
  });

  it("refuses an active Paired Zotero before changing the Fixture", async () => {
    let changedFixture = false;
    const ports = testPorts({
      assertFixtureIdle: async () => {
        throw new Error("Paired Zotero is using zotero.sqlite");
      },
      prepareDevelopmentVault: async () => {
        changedFixture = true;
        throw new Error("unsafe rebuild");
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("Paired Zotero is using zotero.sqlite");
    expect(changedFixture).toBe(false);
  });

  it("opens Paired Zotero when the Obsidian host check fails", async () => {
    let changedFixture = false;
    let openedZotero = false;
    const ports = testPorts({
      assertObsidianHost: async () => {
        throw new Error("No live Obsidian vault answered within 5 seconds");
      },
      prepareDevelopmentVault: async () => {
        changedFixture = true;
        throw new Error("unsafe rebuild");
      },
      openPairedZotero: async () => {
        openedZotero = true;
        return { applicationDir: "/Applications/Zotero.app", pid: 804 };
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("No live Obsidian vault answered within 5 seconds");
    expect(changedFixture).toBe(false);
    expect(openedZotero).toBe(true);
  });

  it("opens Paired Zotero when the Development Vault fails to open", async () => {
    let openedZotero = false;
    const ports = testPorts({
      prepareDevelopmentVault: async () => {
        throw new Error("Development Vault failed to open");
      },
      openPairedZotero: async () => {
        openedZotero = true;
        return { applicationDir: "/Applications/Zotero.app", pid: 804 };
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("Development Vault failed to open");
    expect(openedZotero).toBe(true);
  });

  it("opens the Development Vault when Paired Zotero fails to open", async () => {
    let openedVault = false;
    const ports = testPorts({
      prepareDevelopmentVault: async () => {
        openedVault = true;
        return {
          id: "fixture-vault-test-fixture",
          path: "/workspace/tests/fixture-vault-test-fixture",
        };
      },
      openPairedZotero: async () => {
        throw new Error("Paired Zotero failed to open");
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("Paired Zotero failed to open");
    expect(openedVault).toBe(true);
  });

  it("prepares the Development Vault and opens Paired Zotero in parallel", async () => {
    const vaultCanFinish = Promise.withResolvers<void>();
    let openedZotero = false;
    const ports = testPorts({
      prepareDevelopmentVault: async () => {
        await vaultCanFinish.promise;
        return {
          id: "fixture-vault-test-fixture",
          path: "/workspace/tests/fixture-vault-test-fixture",
        };
      },
      openPairedZotero: async () => {
        openedZotero = true;
        return { applicationDir: "/Applications/Zotero.app", pid: 804 };
      },
    });

    const running = runPairedRun(
      { mode: "open", scopeCase: "all", purge: false },
      ports,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const openedBeforeVaultFinished = openedZotero;
    vaultCanFinish.resolve();
    await running;

    expect(openedBeforeVaultFinished).toBe(true);
  });

  it("opens both loaded extensions for the selected Scope Case", async () => {
    let prepared = false;
    let ready: PairedRunReady | undefined;
    const ports = testPorts({
      prepareDevelopmentVault: async (options) => {
        expect(options).toEqual({
          scopeCase: "partial",
          purge: true,
          liveUpdatePort: 51_234,
        });
        prepared = true;
        return {
          id: "fixture-vault-test-fixture",
          path: "/workspace/tests/fixture-vault-test-fixture",
        };
      },
      openPairedZotero: async () => {
        return { applicationDir: "/Applications/Zotero.app", pid: 804 };
      },
      reportReady: (result) => {
        ready = result;
      },
    });

    await runPairedRun(
      { mode: "open", scopeCase: "partial", purge: true },
      ports,
    );

    expect(prepared).toBe(true);
    expect(ready).toEqual({
      mode: "open",
      vault: {
        id: "fixture-vault-test-fixture",
        path: "/workspace/tests/fixture-vault-test-fixture",
      },
      zotero: { applicationDir: "/Applications/Zotero.app", pid: 804 },
      liveUpdatePort: 51_234,
    });
  });

  it("gives every Paired Run a port of its own", async () => {
    const allocated: number[] = [];
    const seeded: number[] = [];
    let next = 51_234;
    const ports = testPorts({
      allocateLiveUpdatePort: async () => {
        next += 1;
        allocated.push(next);
        return next;
      },
      prepareDevelopmentVault: async ({ liveUpdatePort }) => {
        seeded.push(liveUpdatePort);
        return {
          id: "fixture-vault-test-fixture",
          path: "/workspace/tests/fixture-vault-test-fixture",
        };
      },
    });
    const run = () =>
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports);

    await run();
    await run();

    expect(allocated).toEqual([51_235, 51_236]);
    expect(seeded).toEqual(allocated);
  });

  it("reports a live Paired Run only after the supervised session is ready", async () => {
    const readySignal = Promise.withResolvers<PairedRunReady["zotero"]>();
    const closedSignal = Promise.withResolvers<void>();
    const startedSignal = Promise.withResolvers<void>();
    const reportedSignal = Promise.withResolvers<void>();
    const reports: PairedRunReady[] = [];
    const session: DevelopmentSession = {
      ready: readySignal.promise,
      closed: closedSignal.promise,
    };
    const ports = testPorts({
      startDevelopmentSession: async () => {
        startedSignal.resolve();
        return session;
      },
      reportReady: (result) => {
        reports.push(result);
        reportedSignal.resolve();
      },
    });

    const running = runPairedRun(
      { mode: "dev", scopeCase: "all", purge: false },
      ports,
    );
    await startedSignal.promise;
    expect(reports).toEqual([]);

    readySignal.resolve({
      applicationDir: "/Applications/Zotero.app",
      pid: 804,
    });
    await reportedSignal.promise;
    expect(reports).toHaveLength(1);

    closedSignal.resolve();
    await expect(running).resolves.toBeUndefined();
  });
});
