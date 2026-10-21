import { describe, expect, it } from "vitest";

import { getFixtureLayout } from "./layout.ts";
import {
  createNodePairedRunPorts,
  findPairedZoteroProcesses,
  findWindowsPairedZoteroProcesses,
  getWatcherCommand,
} from "./paired-run-node.ts";
import type {
  DevelopmentSession,
  PairedRunPorts,
  PairedRunReady,
} from "./paired-run.ts";
import { runPairedRun } from "./paired-run.ts";

function testPorts(overrides: Partial<PairedRunPorts> = {}): PairedRunPorts {
  return {
    assertObsidianHost: async () => {},
    stopLivePairedZotero: async () => [],
    allocateLiveUpdatePort: async () => 51_234,
    allocateZoteroHttpPort: async () => 52_234,
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

it("launches pnpm watchers through the Windows command processor", () => {
  const args = ["--filter", "@zotlit/obsidian", "dev"];
  expect(
    getWatcherCommand(args, { platform: "win32", comspec: "cmd.exe" }),
  ).toEqual({
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "pnpm", ...args],
  });
  expect(getWatcherCommand(args, { platform: "darwin" })).toEqual({
    command: "pnpm",
    args,
  });
});

describe("Paired Run", () => {
  it("allocates distinct free ports for Live Updates and Zotero HTTP", async () => {
    const ports = createNodePairedRunPorts({
      workspaceRoot: "/workspace",
      layout: getFixtureLayout("/workspace/.scratch/acceptance-fixture"),
    });

    const liveUpdatePort = await ports.allocateLiveUpdatePort();
    const zoteroHttpPort = await ports.allocateZoteroHttpPort();

    expect(liveUpdatePort).toBeGreaterThan(0);
    expect(zoteroHttpPort).toBeGreaterThan(0);
    expect(zoteroHttpPort).not.toBe(liveUpdatePort);
  });

  it("distinguishes Paired Zotero from the linked Obsidian database reader", () => {
    expect(
      findPairedZoteroProcesses(
        "p16893\ncObsidian Helper (Renderer)\np27078\nczotero\n",
      ),
    ).toEqual([{ command: "zotero", pid: 27_078 }]);
  });

  it("reads the process id the Windows Fixture scan reports", () => {
    expect(findWindowsPairedZoteroProcesses("27078 zotero.exe\n\n")).toEqual([
      { command: "zotero.exe", pid: 27_078 },
    ]);
  });

  it("closes a live Paired Zotero before it changes the Fixture", async () => {
    const calls: string[] = [];
    const ports = testPorts({
      stopLivePairedZotero: async () => {
        calls.push("stop");
        return [];
      },
      prepareDevelopmentVault: async () => {
        calls.push("prepare");
        return {
          id: "fixture-vault-test-fixture",
          path: "/workspace/tests/fixture-vault-test-fixture",
        };
      },
      openPairedZotero: async () => {
        calls.push("open");
        return { applicationDir: "/Applications/Zotero.app", pid: 804 };
      },
    });

    await runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports);

    expect(calls).toEqual(["stop", "prepare", "open"]);
  });

  it("keeps the Fixture unchanged when a live Paired Zotero stays open", async () => {
    let changedFixture = false;
    const ports = testPorts({
      stopLivePairedZotero: async () => {
        throw new Error(
          "the Fixture database stays open by zotero (pid 27078)",
        );
      },
      prepareDevelopmentVault: async () => {
        changedFixture = true;
        throw new Error("unsafe rebuild");
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("the Fixture database stays open by zotero (pid 27078)");
    expect(changedFixture).toBe(false);
  });

  it("does not start Paired Zotero when the Obsidian host check fails", async () => {
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
    expect(openedZotero).toBe(false);
  });

  it("does not start Paired Zotero when profile preparation fails", async () => {
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
    expect(openedZotero).toBe(false);
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

  it("starts Paired Zotero after the generated profile is ready", async () => {
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
    expect(openedZotero).toBe(false);
    vaultCanFinish.resolve();
    await running;

    expect(openedZotero).toBe(true);
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
