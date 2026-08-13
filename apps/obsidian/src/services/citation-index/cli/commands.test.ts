import { describe, expect, it, vi } from "vitest";

import type {
  CitationSettleOutcome,
  CitedBySnapshot,
  SnapshotItem,
} from "@/services/citation-index/service";

import { CITED_BY_COMMAND, createCitationsCliHandlers } from "./commands";
import type { ItemPresence } from "./commands";
import { DIAGNOSTIC_HINTS } from "./envelope";

const IDENTITY = {
  vault: { name: "Test Vault", path: "/vaults/test" },
  source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
} as const;

const ITEM_KEY = "ABCD2345";
const ITEM_CITEKEY = "doe2024";
const SNAPSHOT_ITEM: SnapshotItem = { itemID: 7, indexedKey: ITEM_KEY };

const OCCURRENCE = {
  kind: "citekey",
  raw: ITEM_CITEKEY,
  position: {
    start: { line: 2, col: 0, offset: 40 },
    end: { line: 2, col: 8, offset: 48 },
  },
} as const;

const CITED: CitedBySnapshot = {
  groups: [{ path: "notes/review.md", occurrences: [OCCURRENCE] }],
  coverage: "complete",
  resolution: "ready",
};

const EMPTY: CitedBySnapshot = {
  groups: [],
  coverage: "complete",
  resolution: "ready",
};

interface SetupOptions {
  settle?: CitationSettleOutcome;
  settleTimeoutMs?: number;
  snapshot?: CitedBySnapshot;
  presence?: ItemPresence;
  citekeyItem?: SnapshotItem | null;
}

function setup(options: SetupOptions = {}) {
  const settle = options.settle ?? "settled";
  const presence = options.presence ?? "present";
  const citekeyItem = options.citekeyItem ?? null;
  const getIdentity = vi.fn(() => IDENTITY);
  const waitUntilSettled = vi.fn(() => Promise.resolve(settle));
  const resolveCitekey = vi.fn(() => citekeyItem);
  const citekeyOf = vi.fn(() => ITEM_CITEKEY);
  const getCitedBy = vi.fn(() => options.snapshot ?? CITED);
  const lookupItem = vi.fn(() => presence);
  const handlers = createCitationsCliHandlers({
    getIdentity,
    settleTimeoutMs: options.settleTimeoutMs,
    index: { waitUntilSettled, resolveCitekey, citekeyOf, getCitedBy },
    lookupItem,
  });
  const citedBy = (params: Record<string, string>): Promise<string> =>
    Promise.resolve(handlers[CITED_BY_COMMAND](params));
  return {
    citedBy,
    getIdentity,
    waitUntilSettled,
    resolveCitekey,
    citekeyOf,
    getCitedBy,
    lookupItem,
  };
}

describe("zotlit:cited-by", () => {
  it("reports citing notes with occurrences, positions, and index states", async () => {
    const { citedBy, getCitedBy } = setup();

    const output = await citedBy({ key: ITEM_KEY });

    expect(getCitedBy).toHaveBeenCalledWith(ITEM_KEY);
    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
      command: CITED_BY_COMMAND,
      ok: true,
      request: { key: ITEM_KEY },
      identity: IDENTITY,
      item: { key: ITEM_KEY, citekey: ITEM_CITEKEY },
      groups: [{ path: "notes/review.md", occurrences: [OCCURRENCE] }],
      coverage: "complete",
      resolution: "ready",
    });
  });

  it("answers an item nobody cites with empty groups", async () => {
    const { citedBy } = setup({ snapshot: EMPTY });

    const output = await citedBy({ key: ITEM_KEY });

    expect(JSON.parse(output)).toMatchObject({ ok: true, groups: [] });
  });

  it("resolves a citation key through the resolution snapshot", async () => {
    const { citedBy, resolveCitekey, getCitedBy, lookupItem } = setup({
      citekeyItem: SNAPSHOT_ITEM,
    });

    const output = await citedBy({ citekey: ITEM_CITEKEY });

    expect(resolveCitekey).toHaveBeenCalledWith(ITEM_CITEKEY);
    expect(lookupItem).not.toHaveBeenCalled();
    expect(getCitedBy).toHaveBeenCalledWith(ITEM_KEY);
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      request: { citekey: ITEM_CITEKEY },
      item: { key: ITEM_KEY, citekey: ITEM_CITEKEY },
    });
  });

  it("reports degraded coverage and resolution as payload data", async () => {
    const { citedBy } = setup({
      snapshot: { groups: [], coverage: "degraded", resolution: "degraded" },
    });

    expect(JSON.parse(await citedBy({ key: ITEM_KEY }))).toMatchObject({
      ok: true,
      coverage: "degraded",
      resolution: "degraded",
    });
  });

  it("answers from the index when the Zotero database cannot be read", async () => {
    const { citedBy } = setup({
      presence: "unreadable",
      snapshot: { groups: [], coverage: "complete", resolution: "degraded" },
    });

    expect(JSON.parse(await citedBy({ key: ITEM_KEY }))).toMatchObject({
      ok: true,
      item: { key: ITEM_KEY },
      resolution: "degraded",
    });
  });

  describe("selector", () => {
    it.each([
      ["both selectors", { key: ITEM_KEY, citekey: ITEM_CITEKEY }, "citekey"],
      ["neither selector", {}, "key"],
      ["an empty key", { key: "" }, "key"],
      ["an empty citekey", { citekey: "" }, "citekey"],
      ["a bare citekey", { citekey: "true" }, "citekey"],
      ["a malformed key", { key: "not-a-key" }, "key"],
      [
        "a bare expect-source",
        { key: ITEM_KEY, "expect-source": "true" },
        "expect-source",
      ],
      ["an unknown parameter", { key: ITEM_KEY, radius: "3" }, "radius"],
      ["a trailing vault", { key: ITEM_KEY, vault: "Other" }, "vault"],
    ])("rejects %s", async (_label, params, parameter) => {
      const { citedBy, getIdentity, waitUntilSettled } = setup();

      const response = JSON.parse(await citedBy(params)) as {
        ok: boolean;
        diagnostic: { code: string; hint: string; details: object };
      };

      expect(response.ok).toBe(false);
      expect(response.diagnostic.code).toBe("INVALID_SELECTOR");
      expect(response.diagnostic.hint).toBe(DIAGNOSTIC_HINTS.INVALID_SELECTOR);
      expect(response.diagnostic.details).toEqual({ parameter });
      expect(getIdentity).not.toHaveBeenCalled();
      expect(waitUntilSettled).not.toHaveBeenCalled();
    });
  });

  it("reports a key the connected source does not hold", async () => {
    const { citedBy, getCitedBy } = setup({ presence: "absent" });

    const output = await citedBy({ key: ITEM_KEY });

    expect(getCitedBy).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "KEY_NOT_FOUND",
        hint: DIAGNOSTIC_HINTS.KEY_NOT_FOUND,
        details: { key: ITEM_KEY },
      },
    });
  });

  it("reports a citation key that resolves to no item", async () => {
    const { citedBy, getCitedBy } = setup({ citekeyItem: null });

    const output = await citedBy({ citekey: "roe2099" });

    expect(getCitedBy).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "KEY_NOT_FOUND",
        details: { citekey: "roe2099" },
      },
    });
  });

  it("rejects a source mismatch before any data load", async () => {
    const { citedBy, waitUntilSettled, lookupItem, getCitedBy } = setup();

    const output = await citedBy({ key: ITEM_KEY, "expect-source": "other" });

    expect(waitUntilSettled).not.toHaveBeenCalled();
    expect(lookupItem).not.toHaveBeenCalled();
    expect(getCitedBy).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
      command: CITED_BY_COMMAND,
      ok: false,
      request: { key: ITEM_KEY },
      identity: IDENTITY,
      diagnostic: {
        code: "TARGET_MISMATCH",
        message: `Expected Zotero source 'other', connected to 'a1b2c3d4'.`,
        hint: DIAGNOSTIC_HINTS.TARGET_MISMATCH,
        details: { target: "source", expected: "other", actual: "a1b2c3d4" },
      },
    });
  });

  it("passes a matching source through to the index", async () => {
    const { citedBy, getCitedBy } = setup();

    const output = await citedBy({
      key: ITEM_KEY,
      "expect-source": IDENTITY.source.id,
    });

    expect(getCitedBy).toHaveBeenCalledWith(ITEM_KEY);
    expect(JSON.parse(output)).toMatchObject({ ok: true });
  });

  it("returns a retryable diagnostic when the index stays transitional", async () => {
    const { citedBy, lookupItem, getCitedBy } = setup({
      settle: "timeout",
      settleTimeoutMs: 25,
    });

    const output = await citedBy({ key: ITEM_KEY });

    expect(lookupItem).not.toHaveBeenCalled();
    expect(getCitedBy).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      request: { key: ITEM_KEY },
      identity: IDENTITY,
      diagnostic: {
        code: "INDEX_NOT_READY",
        message: "The Citation Index did not settle within 25 ms.",
        hint: DIAGNOSTIC_HINTS.INDEX_NOT_READY,
      },
    });
  });

  it("waits for the index before reading it", async () => {
    const order: string[] = [];
    const handlers = createCitationsCliHandlers({
      getIdentity: () => {
        order.push("identity");
        return IDENTITY;
      },
      index: {
        waitUntilSettled: () => {
          order.push("settle");
          return Promise.resolve("settled");
        },
        resolveCitekey: () => null,
        citekeyOf: () => ITEM_CITEKEY,
        getCitedBy: () => {
          order.push("cited-by");
          return CITED;
        },
      },
      lookupItem: () => {
        order.push("lookup");
        return "present";
      },
    });

    await handlers[CITED_BY_COMMAND]({ key: ITEM_KEY });

    expect(order).toEqual(["identity", "settle", "lookup", "cited-by"]);
  });
});
