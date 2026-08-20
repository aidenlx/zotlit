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

  it("requires a live Obsidian host before changing the Fixture", async () => {
    let changedFixture = false;
    const ports = testPorts({
      assertObsidianHost: async () => {
        throw new Error("No live Obsidian vault answered within 5 seconds");
      },
      prepareDevelopmentVault: async () => {
        changedFixture = true;
        throw new Error("unsafe rebuild");
      },
    });

    await expect(
      runPairedRun({ mode: "open", scopeCase: "all", purge: false }, ports),
    ).rejects.toThrow("No live Obsidian vault answered within 5 seconds");
    expect(changedFixture).toBe(false);
  });

  it("opens both loaded extensions after preparing the selected Scope Case", async () => {
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
        if (!prepared) throw new Error("Fixture was not prepared");
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
