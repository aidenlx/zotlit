import { describe, expect, it } from "vitest";

import type { FixtureGateEffects } from "./fixture-gate.ts";
import { FIXTURE_GATE_ITEM_KEYS, runFixtureGate } from "./fixture-gate.ts";

const FIXTURE_DATABASE = "/work/tmp/acceptance-fixture/zotero/zotero.sqlite";

/** One recorded call, as the gate issued it. */
interface Call {
  command: string;
  params: readonly string[];
}

interface StubAnswers {
  status?: unknown;
  scope?: unknown;
  data?: (key: string) => unknown;
}

/** A vault that answers each gate command with a prepared envelope. */
function stubVault({ status, scope, data }: StubAnswers = {}): {
  effects: FixtureGateEffects;
  calls: Call[];
} {
  const calls: Call[] = [];
  const answers: Record<string, (params: readonly string[]) => unknown> = {
    "zotlit:template-status": () =>
      status ?? {
        ok: true,
        identity: { source: { id: "abc", databasePath: FIXTURE_DATABASE } },
      },
    "zotlit:library-scope": () =>
      scope ?? { ok: true, mode: "all", available: [1, 2, 3, 4] },
    "zotlit:template-data": (params) => {
      const key = params
        .find((param) => param.startsWith("key="))
        ?.slice("key=".length);
      return data?.(key ?? "") ?? { ok: true };
    },
  };
  return {
    calls,
    effects: {
      runCommand: async (command, params = []) => {
        calls.push({ command, params });
        const answer = answers[command];
        if (!answer) throw new Error(`unexpected command ${command}`);
        return JSON.stringify(answer(params));
      },
    },
  };
}

const EXPECTATION = { databasePath: FIXTURE_DATABASE, libraryCount: 4 };

describe("Fixture gate", () => {
  it("reports what the vault answered when every assertion holds", async () => {
    const { effects, calls } = stubVault();

    await expect(runFixtureGate(effects, EXPECTATION)).resolves.toEqual({
      databasePath: FIXTURE_DATABASE,
      libraries: 4,
      items: FIXTURE_GATE_ITEM_KEYS,
    });

    expect(calls.map((call) => call.command)).toEqual([
      "zotlit:template-status",
      "zotlit:library-scope",
      ...FIXTURE_GATE_ITEM_KEYS.map(() => "zotlit:template-data"),
    ]);
    expect(
      calls
        .filter((call) => call.command === "zotlit:template-data")
        .map((call) => call.params),
    ).toEqual(FIXTURE_GATE_ITEM_KEYS.map((key) => [`key=${key}`, "root=note"]));
  });

  it("fails closed when the plugin answers from another Zotero library", async () => {
    const { effects, calls } = stubVault({
      status: {
        ok: true,
        identity: {
          source: { id: "abc", databasePath: "/Users/me/Zotero/zotero.sqlite" },
        },
      },
    });

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      /answers from \/Users\/me\/Zotero\/zotero\.sqlite, not the Fixture database[\s\S]*Device Overrides are absent/,
    );
    // Nothing is probed against a database the gate already rejected.
    expect(calls).toHaveLength(1);
  });

  it("fails closed when the status envelope carries no database at all", async () => {
    const { effects } = stubVault({ status: { ok: false } });

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "answers from no database, not the Fixture database",
    );
  });

  it("fails closed when the database holds fewer Libraries than the Fixture", async () => {
    const { effects, calls } = stubVault({
      scope: { ok: true, mode: "all", available: [1, 2] },
    });

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "reports 2 available of the Fixture's 4 Libraries",
    );
    expect(calls.some((call) => call.command === "zotlit:template-data")).toBe(
      false,
    );
  });

  it("names the diagnostic when the scope report is not ok", async () => {
    const { effects } = stubVault({
      scope: {
        ok: false,
        diagnostic: {
          code: "DATABASE_UNREADABLE",
          message: "The connected Zotero source is not currently readable.",
        },
      },
    });

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "reports 0 available of the Fixture's 4 Libraries (DATABASE_UNREADABLE: The connected Zotero source is not currently readable.)",
    );
  });

  it("fails closed on the first Item the database cannot resolve", async () => {
    const unresolvable = FIXTURE_GATE_ITEM_KEYS[1];
    const { effects, calls } = stubVault({
      data: (key) =>
        key === unresolvable
          ? {
              ok: false,
              diagnostic: {
                code: "KEY_NOT_FOUND",
                message: `No Item ${key}.`,
              },
            }
          : { ok: true },
    });

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      `cannot resolve Fixture Item ${unresolvable} (KEY_NOT_FOUND: No Item ${unresolvable}.)`,
    );
    // The run stops at the failure rather than probing the remaining keys.
    expect(
      calls.filter((call) => call.command === "zotlit:template-data"),
    ).toHaveLength(2);
  });

  it("resolves only the Item keys the caller names", async () => {
    const { effects, calls } = stubVault();

    await expect(
      runFixtureGate(effects, { ...EXPECTATION, itemKeys: ["ZZZZ9999"] }),
    ).resolves.toMatchObject({ items: ["ZZZZ9999"] });

    expect(
      calls
        .filter((call) => call.command === "zotlit:template-data")
        .map((call) => call.params),
    ).toEqual([["key=ZZZZ9999", "root=note"]]);
  });

  it("reports a non-envelope answer rather than reading it as an empty result", async () => {
    const effects: FixtureGateEffects = {
      runCommand: async () => "Error: command not found",
    };

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "zotlit:template-status did not answer with a CLI envelope: Error: command not found",
    );
  });

  it("reports an empty answer, which a window gives before its plugin loads", async () => {
    const effects: FixtureGateEffects = { runCommand: async () => "" };

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "zotlit:template-status did not answer with a CLI envelope: (no output)",
    );
  });

  it("lets the runner's own failure through, so an unreachable vault stays unreachable", async () => {
    const effects: FixtureGateEffects = {
      runCommand: async () => {
        throw new Error(
          "Obsidian vault demo did not answer within 30 seconds.",
        );
      },
    };

    await expect(runFixtureGate(effects, EXPECTATION)).rejects.toThrow(
      "Obsidian vault demo did not answer within 30 seconds.",
    );
  });
});
