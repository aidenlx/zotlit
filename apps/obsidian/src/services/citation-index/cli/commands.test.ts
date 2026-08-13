import { describe, expect, it, vi } from "vitest";

import type { CslItemData } from "@zotlit/db";

import type {
  Citation,
  CitationKeyResolution,
  CitationOccurrence,
  CitationSettleOutcome,
  CitationSyntax,
  CitationSyntaxes,
  CitedBySnapshot,
  ReferenceSource,
  SnapshotItem,
} from "@/services/citation-index/service";

import {
  CITATIONS_GUIDE_COMMAND,
  CITED_BY_COMMAND,
  createCitationsCliHandlers,
  REFERENCES_COMMAND,
} from "./commands";
import type { DocumentReferences, ItemLookup } from "./commands";
import { DIAGNOSTIC_HINTS } from "./envelope";
import { CITED_BY_PARAMS, REFERENCES_PARAMS } from "./request";

const IDENTITY = {
  vault: { name: "Test Vault", path: "/vaults/test" },
  source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
} as const;

const ITEM_KEY = "ABCD2345";
const ITEM_CITEKEY = "doe2024";
const ITEM_SUMMARY = "Doe (2024): A study of citations";
const SNAPSHOT_ITEM: SnapshotItem = { itemID: 7, indexedKey: ITEM_KEY };
const PRESENT: ItemLookup = { presence: "present", summary: ITEM_SUMMARY };

const OCCURRENCE = {
  kind: "citekey",
  raw: ITEM_CITEKEY,
  position: {
    start: { line: 2, col: 0, offset: 40 },
    end: { line: 2, col: 8, offset: 48 },
  },
} as const;

/** {@link OCCURRENCE} as an answer reports it: line and col count from 1,
 *  offset stays as the index holds it. */
const REPORTED_OCCURRENCE = {
  kind: "citekey",
  raw: ITEM_CITEKEY,
  position: {
    start: { line: 3, col: 1, offset: 40 },
    end: { line: 3, col: 9, offset: 48 },
  },
} as const;

const CITED: CitedBySnapshot = {
  groups: [{ path: "notes/review.md", occurrences: [OCCURRENCE] }],
  coverage: "complete",
  resolution: "ready",
  omittedSyntaxes: null,
};

const EMPTY: CitedBySnapshot = {
  groups: [],
  coverage: "complete",
  resolution: "ready",
  omittedSyntaxes: [],
};

const DOCUMENT_PATH = "notes/review.md";
const MISSING_ITEM_KEY = "EFGH6789";

const SYNTAXES: CitationSyntaxes = {
  citekey: "included",
  wikilink: "excluded",
};

function occurrence(
  raw: string,
  offset: number,
  kind: CitationSyntax = "citekey",
): CitationOccurrence {
  return {
    kind,
    raw,
    position: {
      start: { line: 0, col: offset, offset },
      end: { line: 0, col: offset + raw.length, offset: offset + raw.length },
    },
  };
}

const FIRST_OCCURRENCE = occurrence(ITEM_CITEKEY, 10);
const REPEAT_OCCURRENCE = occurrence(ITEM_CITEKEY, 120);
const UNRESOLVED_OCCURRENCE = occurrence("roe2099", 30);
const MALFORMED_OCCURRENCE = occurrence("Doe 2024|p. 3|extra", 50, "wikilink");
const MISSING_OCCURRENCE = occurrence(MISSING_ITEM_KEY, 90, "wikilink");

/**
 * Each of the fixtures above as an answer reports it, written out rather than
 * derived, so the expectations pin the base the contract documents.
 */
const FIRST_REPORTED = {
  kind: "citekey",
  raw: ITEM_CITEKEY,
  position: {
    start: { line: 1, col: 11, offset: 10 },
    end: { line: 1, col: 18, offset: 17 },
  },
} as const;

const REPEAT_REPORTED = {
  kind: "citekey",
  raw: ITEM_CITEKEY,
  position: {
    start: { line: 1, col: 121, offset: 120 },
    end: { line: 1, col: 128, offset: 127 },
  },
} as const;

const UNRESOLVED_REPORTED = {
  kind: "citekey",
  raw: "roe2099",
  position: {
    start: { line: 1, col: 31, offset: 30 },
    end: { line: 1, col: 38, offset: 37 },
  },
} as const;

const MALFORMED_REPORTED = {
  kind: "wikilink",
  raw: "Doe 2024|p. 3|extra",
  position: {
    start: { line: 1, col: 51, offset: 50 },
    end: { line: 1, col: 70, offset: 69 },
  },
} as const;

const MISSING_REPORTED = {
  kind: "wikilink",
  raw: MISSING_ITEM_KEY,
  position: {
    start: { line: 1, col: 91, offset: 90 },
    end: { line: 1, col: 99, offset: 98 },
  },
} as const;

const SOURCE: ReferenceSource = {
  csl: { id: "item-7" } as CslItemData,
  summary: ITEM_SUMMARY,
  itemKey: ITEM_KEY,
  itemID: 7,
  groupID: null,
  citekey: ITEM_CITEKEY,
  linkpath: "Literature/@doe2024.md",
  attachments: [],
};

const CITATIONS: Citation[] = [
  {
    indexedKey: ITEM_KEY,
    linkpath: SOURCE.linkpath,
    refNumber: 1,
    occurrences: [FIRST_OCCURRENCE, REPEAT_OCCURRENCE],
  },
  {
    indexedKey: null,
    linkpath: null,
    refNumber: 2,
    occurrences: [UNRESOLVED_OCCURRENCE],
  },
  {
    indexedKey: MISSING_ITEM_KEY,
    linkpath: null,
    refNumber: 3,
    occurrences: [MISSING_OCCURRENCE],
  },
];

const DOCUMENT: DocumentReferences = {
  citations: CITATIONS,
  errors: [{ kind: "malformed-wikilink", occurrence: MALFORMED_OCCURRENCE }],
  sources: new Map([[ITEM_KEY, SOURCE]]),
  database: "ready",
};

interface SetupOptions {
  settle?: CitationSettleOutcome;
  settleTimeoutMs?: number;
  snapshot?: CitedBySnapshot;
  lookup?: ItemLookup;
  citekeyItem?: SnapshotItem | null;
  document?: DocumentReferences | null;
  resolution?: CitationKeyResolution;
  syntaxes?: CitationSyntaxes;
  omittedSyntaxes?: readonly CitationSyntax[];
}

function setup(options: SetupOptions = {}) {
  const settle = options.settle ?? "settled";
  const lookup = options.lookup ?? PRESENT;
  const citekeyItem = options.citekeyItem ?? null;
  const documentReferences =
    options.document === undefined ? DOCUMENT : options.document;
  const getIdentity = vi.fn(() => IDENTITY);
  const waitUntilSettled = vi.fn(() => Promise.resolve(settle));
  const resolveCitekey = vi.fn(() => citekeyItem);
  const citekeyOf = vi.fn(() => ITEM_CITEKEY);
  const getCitedBy = vi.fn(() => options.snapshot ?? CITED);
  const lookupItem = vi.fn(() => lookup);
  const readDocument = vi.fn(() => Promise.resolve(documentReferences));
  const resolution = vi.fn(() => options.resolution ?? "ready");
  const syntaxes = vi.fn(() => options.syntaxes ?? SYNTAXES);
  const omittedSyntaxesOf = vi.fn(() =>
    Promise.resolve(options.omittedSyntaxes ?? []),
  );
  const handlers = createCitationsCliHandlers({
    getIdentity,
    settleTimeoutMs: options.settleTimeoutMs,
    index: {
      waitUntilSettled,
      resolveCitekey,
      citekeyOf,
      getCitedBy,
      resolution,
      syntaxes,
      omittedSyntaxesOf,
    },
    lookupItem,
    readDocument,
  });
  const citedBy = (params: Record<string, string>): Promise<string> =>
    Promise.resolve(handlers[CITED_BY_COMMAND](params));
  const references = (params: Record<string, string>): Promise<string> =>
    Promise.resolve(handlers[REFERENCES_COMMAND](params));
  const guide = (params: Record<string, string>): Promise<string> =>
    Promise.resolve(handlers[CITATIONS_GUIDE_COMMAND](params));
  return {
    citedBy,
    references,
    guide,
    getIdentity,
    waitUntilSettled,
    resolveCitekey,
    citekeyOf,
    getCitedBy,
    lookupItem,
    readDocument,
    syntaxes,
    omittedSyntaxesOf,
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
      item: {
        key: ITEM_KEY,
        citekey: ITEM_CITEKEY,
        summary: ITEM_SUMMARY,
      },
      groups: [{ path: "notes/review.md", occurrences: [REPORTED_OCCURRENCE] }],
      coverage: "complete",
      resolution: "ready",
      syntaxes: SYNTAXES,
    });
  });

  it("counts line and col from 1, and keeps offset counting from 0", async () => {
    const { citedBy } = setup({
      snapshot: {
        groups: [
          {
            path: "notes/review.md",
            occurrences: [occurrence(ITEM_CITEKEY, 0)],
          },
        ],
        coverage: "complete",
        resolution: "ready",
        omittedSyntaxes: null,
      },
    });

    const output = await citedBy({ key: ITEM_KEY });

    const [first] = JSON.parse(output).groups[0].occurrences;
    expect(first.position).toEqual({
      start: { line: 1, col: 1, offset: 0 },
      end: { line: 1, col: 8, offset: 7 },
    });
    expect(first.position.end.offset - first.position.start.offset).toBe(
      ITEM_CITEKEY.length,
    );
  });

  it("reports citekey as excluded when the index says so", async () => {
    const { citedBy } = setup({
      syntaxes: { citekey: "excluded", wikilink: "included" },
    });

    const output = await citedBy({ key: ITEM_KEY });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      syntaxes: { citekey: "excluded", wikilink: "included" },
    });
  });

  it("answers an item nobody cites with empty groups and no omitted syntax", async () => {
    const { citedBy } = setup({ snapshot: EMPTY });

    const output = await citedBy({ key: ITEM_KEY });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      groups: [],
      omittedSyntaxes: [],
    });
  });

  it("reports the excluded syntax that held the item's occurrences", async () => {
    const { citedBy } = setup({
      snapshot: {
        groups: [],
        coverage: "complete",
        resolution: "ready",
        omittedSyntaxes: ["wikilink"],
      },
    });

    const output = await citedBy({ key: ITEM_KEY });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      groups: [],
      omittedSyntaxes: ["wikilink"],
    });
  });

  it("carries no omittedSyntaxes key when groups is non-empty", async () => {
    const { citedBy } = setup();

    const output = await citedBy({ key: ITEM_KEY });

    expect(Object.keys(JSON.parse(output))).not.toContain("omittedSyntaxes");
  });

  it("resolves a citation key through the resolution snapshot", async () => {
    const { citedBy, resolveCitekey, getCitedBy, lookupItem } = setup({
      citekeyItem: SNAPSHOT_ITEM,
    });

    const output = await citedBy({ citekey: ITEM_CITEKEY });

    expect(resolveCitekey).toHaveBeenCalledWith(ITEM_CITEKEY);
    expect(lookupItem).toHaveBeenCalledWith(ITEM_KEY);
    expect(getCitedBy).toHaveBeenCalledWith(ITEM_KEY);
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      request: { citekey: ITEM_CITEKEY },
      item: { key: ITEM_KEY, citekey: ITEM_CITEKEY, summary: ITEM_SUMMARY },
    });
  });

  it("keeps the snapshot's verdict when a citation key names an item the source read leaves out", async () => {
    const { citedBy } = setup({
      citekeyItem: SNAPSHOT_ITEM,
      lookup: { presence: "absent", summary: null },
    });

    const output = await citedBy({ citekey: ITEM_CITEKEY });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      item: { key: ITEM_KEY, citekey: ITEM_CITEKEY, summary: null },
    });
  });

  it("answers ok with a null summary when the item fields cannot be read", async () => {
    const { citedBy } = setup({
      lookup: { presence: "present", summary: null },
    });

    const output = await citedBy({ key: ITEM_KEY });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      item: { key: ITEM_KEY, summary: null },
    });
  });

  it("reports degraded coverage and resolution as payload data", async () => {
    const { citedBy } = setup({
      snapshot: {
        groups: [],
        coverage: "degraded",
        resolution: "degraded",
        omittedSyntaxes: [],
      },
    });

    expect(JSON.parse(await citedBy({ key: ITEM_KEY }))).toMatchObject({
      ok: true,
      coverage: "degraded",
      resolution: "degraded",
    });
  });

  it("answers from the index when the Zotero database cannot be read", async () => {
    const { citedBy } = setup({
      lookup: { presence: "unreadable", summary: null },
      snapshot: {
        groups: [],
        coverage: "complete",
        resolution: "degraded",
        omittedSyntaxes: [],
      },
    });

    expect(JSON.parse(await citedBy({ key: ITEM_KEY }))).toMatchObject({
      ok: true,
      item: { key: ITEM_KEY, summary: null },
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
    const { citedBy, getCitedBy } = setup({
      lookup: { presence: "absent", summary: null },
    });

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
        resolution: () => "ready",
        syntaxes: () => SYNTAXES,
        omittedSyntaxesOf: () => Promise.resolve([]),
      },
      lookupItem: () => {
        order.push("lookup");
        return PRESENT;
      },
      readDocument: () => Promise.resolve(DOCUMENT),
    });

    await handlers[CITED_BY_COMMAND]({ key: ITEM_KEY });

    expect(order).toEqual(["identity", "settle", "lookup", "cited-by"]);
  });
});

describe("zotlit:references", () => {
  it("reports the document's entries in first-occurrence order, with identity and positions", async () => {
    const { references, readDocument } = setup();

    const output = await references({ file: DOCUMENT_PATH });

    expect(readDocument).toHaveBeenCalledWith(DOCUMENT_PATH);
    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
      command: REFERENCES_COMMAND,
      ok: true,
      request: { file: DOCUMENT_PATH },
      identity: IDENTITY,
      entries: [
        {
          refNumber: 1,
          kind: "resolved",
          key: ITEM_KEY,
          citekey: ITEM_CITEKEY,
          summary: SOURCE.summary,
          linkpath: SOURCE.linkpath,
          occurrences: [FIRST_REPORTED, REPEAT_REPORTED],
        },
        {
          refNumber: 2,
          kind: "unresolved",
          citekey: "roe2099",
          occurrences: [UNRESOLVED_REPORTED],
        },
        {
          kind: "malformed",
          occurrences: [MALFORMED_REPORTED],
        },
        {
          refNumber: 3,
          kind: "missing",
          key: MISSING_ITEM_KEY,
          occurrences: [MISSING_REPORTED],
        },
      ],
      database: "ready",
      resolution: "ready",
      syntaxes: SYNTAXES,
    });
  });

  it("counts line and col from 1, and keeps offset counting from 0", async () => {
    const { references } = setup({
      document: {
        citations: [
          {
            indexedKey: null,
            linkpath: null,
            refNumber: 1,
            occurrences: [occurrence("roe2099", 0)],
          },
        ],
        errors: [],
        sources: new Map(),
        database: "ready",
      },
    });

    const output = await references({ file: DOCUMENT_PATH });

    const [first] = JSON.parse(output).entries[0].occurrences;
    expect(first.position).toEqual({
      start: { line: 1, col: 1, offset: 0 },
      end: { line: 1, col: 8, offset: 7 },
    });
    expect(first.position.end.offset - first.position.start.offset).toBe(
      "roe2099".length,
    );
  });

  it("reports an unreadable Zotero database as payload state, not as missing items", async () => {
    const { references } = setup({
      document: {
        citations: CITATIONS,
        errors: [],
        sources: new Map(),
        database: "unreadable",
      },
      resolution: "degraded",
    });

    const output = await references({ file: DOCUMENT_PATH });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      database: "unreadable",
      resolution: "degraded",
    });
  });

  it("reports citekey as excluded when the index says so", async () => {
    const { references } = setup({
      syntaxes: { citekey: "excluded", wikilink: "included" },
    });

    const output = await references({ file: DOCUMENT_PATH });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      syntaxes: { citekey: "excluded", wikilink: "included" },
    });
  });

  it("carries no CSL detail or attachment data in a resolved entry", async () => {
    const { references } = setup();

    const output = await references({ file: DOCUMENT_PATH });

    expect(output).not.toContain("csl");
    expect(output).not.toContain("attachments");
  });

  it("answers a document that cites nothing with no entries and no omitted syntax", async () => {
    const { references, omittedSyntaxesOf } = setup({
      document: {
        citations: [],
        errors: [],
        sources: new Map(),
        database: "ready",
      },
      omittedSyntaxes: [],
    });

    const output = await references({ file: "notes/plain.md" });

    expect(omittedSyntaxesOf).toHaveBeenCalledWith("notes/plain.md");
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      entries: [],
      omittedSyntaxes: [],
    });
  });

  it("reports wikilink as the excluded syntax that held the document's occurrences", async () => {
    const { references } = setup({
      document: {
        citations: [],
        errors: [],
        sources: new Map(),
        database: "ready",
      },
      syntaxes: { citekey: "included", wikilink: "excluded" },
      omittedSyntaxes: ["wikilink"],
    });

    const output = await references({ file: "notes/wikilinks-only.md" });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      entries: [],
      omittedSyntaxes: ["wikilink"],
    });
  });

  it("reports citekey as the excluded syntax that held the document's occurrences", async () => {
    const { references } = setup({
      document: {
        citations: [],
        errors: [],
        sources: new Map(),
        database: "ready",
      },
      syntaxes: { citekey: "excluded", wikilink: "included" },
      omittedSyntaxes: ["citekey"],
    });

    const output = await references({ file: "notes/citekeys-only.md" });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      entries: [],
      omittedSyntaxes: ["citekey"],
    });
  });

  it("carries no omittedSyntaxes key when entries is non-empty", async () => {
    const { references, omittedSyntaxesOf } = setup();

    const output = await references({ file: DOCUMENT_PATH });

    expect(omittedSyntaxesOf).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(output))).not.toContain("omittedSyntaxes");
  });

  describe("selector", () => {
    it.each([
      ["no file", {}, "file"],
      ["an empty file", { file: "" }, "file"],
      ["a bare file", { file: "true" }, "file"],
      [
        "a bare expect-source",
        { file: DOCUMENT_PATH, "expect-source": "true" },
        "expect-source",
      ],
      ["an unknown parameter", { file: DOCUMENT_PATH, key: ITEM_KEY }, "key"],
      ["a trailing vault", { file: DOCUMENT_PATH, vault: "Other" }, "vault"],
    ])("rejects %s", async (_label, params, parameter) => {
      const { references, getIdentity, waitUntilSettled, readDocument } =
        setup();

      const response = JSON.parse(await references(params)) as {
        ok: boolean;
        diagnostic: { code: string; hint: string; details: object };
      };

      expect(response.ok).toBe(false);
      expect(response.diagnostic.code).toBe("INVALID_SELECTOR");
      expect(response.diagnostic.hint).toBe(DIAGNOSTIC_HINTS.INVALID_SELECTOR);
      expect(response.diagnostic.details).toEqual({ parameter });
      expect(getIdentity).not.toHaveBeenCalled();
      expect(waitUntilSettled).not.toHaveBeenCalled();
      expect(readDocument).not.toHaveBeenCalled();
    });
  });

  it("reports a path the vault holds no note at", async () => {
    const { references } = setup({ document: null });

    const output = await references({ file: "notes/gone.md" });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      request: { file: "notes/gone.md" },
      identity: IDENTITY,
      diagnostic: {
        code: "FILE_NOT_FOUND",
        message: "The vault holds no Markdown note at 'notes/gone.md'.",
        hint: DIAGNOSTIC_HINTS.FILE_NOT_FOUND,
        details: { file: "notes/gone.md" },
      },
    });
  });

  it("rejects a source mismatch before any data load", async () => {
    const { references, waitUntilSettled, readDocument } = setup();

    const output = await references({
      file: DOCUMENT_PATH,
      "expect-source": "other",
    });

    expect(waitUntilSettled).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      request: { file: DOCUMENT_PATH },
      identity: IDENTITY,
      diagnostic: {
        code: "TARGET_MISMATCH",
        details: { target: "source", expected: "other", actual: "a1b2c3d4" },
      },
    });
  });

  it("returns a retryable diagnostic when the index stays transitional", async () => {
    const { references, readDocument } = setup({
      settle: "timeout",
      settleTimeoutMs: 25,
    });

    const output = await references({ file: DOCUMENT_PATH });

    expect(readDocument).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "INDEX_NOT_READY",
        message: "The Citation Index did not settle within 25 ms.",
        hint: DIAGNOSTIC_HINTS.INDEX_NOT_READY,
      },
    });
  });
});

describe("zotlit:citations-guide", () => {
  it("serves the page as literal prose, without an envelope", async () => {
    const { guide, getIdentity, waitUntilSettled } = setup();

    const output = await guide({});

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("ZOTLIT-CITATIONS(1)");
    expect(output).toContain(CITED_BY_COMMAND);
    expect(output).toContain(REFERENCES_COMMAND);
    expect(output).toContain(CITATIONS_GUIDE_COMMAND);
    expect(getIdentity).not.toHaveBeenCalled();
    expect(waitUntilSettled).not.toHaveBeenCalled();
  });

  it("documents every selector both commands accept", async () => {
    const { guide } = setup();

    const output = await guide({});

    for (const parameter of [...CITED_BY_PARAMS, ...REFERENCES_PARAMS]) {
      expect(output).toContain(parameter);
    }
  });

  it("documents every entry kind and index state a payload reports", async () => {
    const { guide } = setup();

    const output = await guide({});

    for (const kind of ["resolved", "unresolved", "missing", "malformed"]) {
      expect(output).toContain(kind);
    }
    for (const state of [
      "indexing",
      "complete",
      "degraded",
      "resolving",
      "ready",
      "unreadable",
    ]) {
      expect(output).toContain(state);
    }
    for (const syntax of ["citekey", "wikilink"]) {
      expect(output).toContain(syntax);
    }
  });

  it("documents the item summary a cited-by answer carries", async () => {
    const { guide } = setup();

    const page = (await guide({})).replaceAll(/\s+/gu, " ");

    expect(page).toContain("{ key, citekey, summary }");
    expect(page).toContain(
      "summary renders the item as 'Creators (Year): Title'",
    );
    expect(page).toContain(
      "null for an item whose fields the Zotero source could not provide",
    );
  });

  it("documents the base a position counts from, with the rg column caveat", async () => {
    const { guide } = setup();

    const page = (await guide({})).replaceAll(/\s+/gu, " ");

    expect(page).toContain(
      "line and col count from 1, matching editor and grep line numbers",
    );
    expect(page).toContain("offset counts UTF-16 code units from 0");
    expect(page).toContain(
      "col counts UTF-16 code units while rg --column counts bytes",
    );
  });

  it("documents every diagnostic code with its own recovery hint", async () => {
    const { guide } = setup();

    const output = await guide({});

    for (const [code, hint] of Object.entries(DIAGNOSTIC_HINTS)) {
      expect(output).toContain(code);
      expect(output.replaceAll(/\s+/gu, " ")).toContain(hint);
    }
  });

  it("rejects a parameter, since the guide serves one page", async () => {
    const { guide } = setup();

    const output = await guide({ topic: "positions" });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
      command: CITATIONS_GUIDE_COMMAND,
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
        details: { parameter: "topic" },
      },
    });
  });
});
