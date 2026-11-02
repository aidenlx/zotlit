import { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, collectQuery, ITEMS } from ".";
import type { QueryDataset, QueryResult } from ".";
import { runEffect } from "./test-helpers";
import type { Run, RunOptions } from "./test-helpers";
import { textSweepPattern } from "./text-sweep";

const { personal } = SCENARIO_LIBRARIES;
function result(run: Run<QueryResult, unknown>) {
  if (!Exit.isSuccess(run.exit)) throw new Error(String(run.exit.cause));
  return run.exit.value;
}
const statements = (run: Run<unknown, unknown>) =>
  run.events.flatMap((event) =>
    event.type === "statement" ? [event.statement] : [],
  );
const query = (
  scenario: ScenarioDatabase,
  filter: string,
  { dataset = ITEMS, ...options }: RunOptions & { dataset?: QueryDataset } = {},
) =>
  runEffect(
    collectQuery(dataset, {
      libraries: [personal],
      fields: [],
      sort: [],
      filter,
      limit: null,
    }),
    { client: scenario.db, ...options },
  );

function title(
  scenario: ScenarioDatabase,
  key: string,
  value: string | number,
) {
  scenario.sqlite
    .prepare("insert or ignore into itemDataValues (value) values (?)")
    .run(value);
  const id = scenario.sqlite
    .prepare("select valueID from itemDataValues where value = ?")
    .get(value)!.valueID;
  scenario.sqlite
    .prepare(`update itemData set valueID = ? where itemID =
    (select itemID from items where key = ? and libraryID = 1)
    and fieldID = (select fieldID from fieldsCombined where fieldName = 'title' and custom = 0)`)
    .run(id as number, key);
}

// Failure modes: Unicode folding, literal wildcards, empty patterns and UTF-8 byte limits.
it.each([
  ["climate", "%cl%mate%"],
  ["气候", "%气候%"],
  ["50%_off", "%50%off%"],
  ["İıKKkßſΣσς\u0307%_É", null],
  ["", null],
  ["a".repeat(49_998), `%${"a".repeat(49_998)}%`],
  ["a".repeat(60_000), null],
  ["气".repeat(16_667), null],
])("makes the conservative LIKE pattern %#", (text, expected) => {
  expect(textSweepPattern(text)).toBe(expected);
});

// Fixed keys for the two stored forms; the expected sets do not call case folding.
const UPPER = ["ART2FULL"] as const;
const LOWER = ["BK2MNTH2"] as const;
const BOTH = ["ART2FULL", "BK2MNTH2"] as const;

it.each(
  (
    [
      [
        "İ",
        "İ",
        "i̇",
        [
          ["İ", UPPER, BOTH],
          ["i̇", LOWER, BOTH],
        ],
      ],
      [
        "ı",
        "I",
        "ı",
        [
          ["I", UPPER, UPPER],
          ["ı", LOWER, LOWER],
        ],
      ],
      [
        "K",
        "K",
        "k",
        [
          ["K", UPPER, BOTH],
          ["k", LOWER, BOTH],
        ],
      ],
      [
        "K",
        "K",
        "k",
        [
          ["K", UPPER, BOTH],
          ["k", LOWER, BOTH],
        ],
      ],
      [
        "k",
        "K",
        "k",
        [
          ["K", UPPER, BOTH],
          ["k", LOWER, BOTH],
        ],
      ],
      [
        "ß",
        "SS",
        "ß",
        [
          ["SS", UPPER, UPPER],
          ["ß", LOWER, LOWER],
        ],
      ],
      [
        "ſ",
        "S",
        "ſ",
        [
          ["S", UPPER, UPPER],
          ["ſ", LOWER, LOWER],
        ],
      ],
      [
        "Σ",
        "Σ",
        "σ",
        [
          ["Σ", UPPER, BOTH],
          ["σ", LOWER, BOTH],
        ],
      ],
      [
        "σ",
        "Σ",
        "σ",
        [
          ["Σ", UPPER, BOTH],
          ["σ", LOWER, BOTH],
        ],
      ],
      [
        "ς",
        "Σ",
        "ς",
        [
          ["Σ", UPPER, UPPER],
          ["ς", LOWER, LOWER],
        ],
      ],
      ["̇", "̇", "̇", [["̇", BOTH, BOTH]]],
      ["%", "%", "%", [["%", BOTH, BOTH]]],
      ["_", "_", "_", [["_", BOTH, BOTH]]],
      [
        "É",
        "É",
        "é",
        [
          ["É", UPPER, BOTH],
          ["é", LOWER, BOTH],
        ],
      ],
      ["气", "气", "气", [["气", BOTH, BOTH]]],
      ["🧪", "🧪", "🧪", [["🧪", BOTH, BOTH]]],
      [
        "A",
        "A",
        "a",
        [
          ["A", UPPER, BOTH],
          ["a", LOWER, BOTH],
        ],
      ],
    ] as const
  ).map(([character, upper, lower, forms]) => ({
    character,
    upper,
    lower,
    forms,
  })),
)(
  "keeps every evaluator match for $character in the real SQLite candidates",
  async ({ upper, lower, forms }) => {
    using scenario = openScenarioDatabase();
    title(scenario, "ART2FULL", `x${upper}z`);
    title(scenario, "BK2MNTH2", `x${lower}z`);
    for (const [term, contains, icontains] of forms) {
      for (const [method, expected] of [
        ["contains", contains],
        ["icontains", icontains],
      ] as const) {
        const filter = `title.${method}(${JSON.stringify(`x${term}z`)})`;
        const scanned = await query(scenario, filter, {
          tuning: { forceScan: true },
        });
        const swept = await query(scenario, filter, {
          tuning: { capRatio: 1 },
        });
        expect(result(swept).rows!.map((row) => row.indexedKey)).toEqual(
          expected,
        );
        expect(result(swept)).toEqual(result(scanned));
        const windows = statements(swept).filter(
          (s) => s.reader === "text-sweep-window",
        );
        expect(windows).toHaveLength(1);
        const candidateKeys = windows.flatMap((s) =>
          s.rows.map((row) => {
            const { itemID } = row as { itemID: number };
            return scenario.sqlite
              .prepare("select key from items where itemID = ?")
              .get(itemID)!.key;
          }),
        );
        for (const key of expected) expect(candidateKeys).toContain(key);
      }
    }
  },
);

it("finds text after a stored NUL", async () => {
  using scenario = openScenarioDatabase();
  title(scenario, "ART2FULL", "before\u0000after");
  expect(
    scenario.sqlite
      .prepare("select instr(?, char(0)) as position")
      .get("before\u0000after")!.position,
  ).toBe(7);
  const filter = 'title.contains("after")';
  const scanned = await query(scenario, filter, {
    tuning: { forceScan: true },
  });
  expect(result(scanned).rows!.map((row) => row.indexedKey)).toEqual([
    "ART2FULL",
  ]);
  const swept = await query(scenario, filter);
  expect(result(swept).rows!.map((row) => row.indexedKey)).toEqual([
    "ART2FULL",
  ]);
  expect(result(swept)).toEqual(result(scanned));
});

it("keeps a stored REAL whose JavaScript spelling differs from SQLite", async () => {
  using scenario = openScenarioDatabase();
  title(scenario, "ART2FULL", 1e21);
  const run = await query(scenario, 'title.contains("1e+21")');
  expect(result(run).rows!.map((r) => r.indexedKey)).toEqual(["ART2FULL"]);
  expect(statements(run).some((s) => s.reader === "text-sweep-window")).toBe(
    true,
  );
  expect(statements(run).some((s) => s.reader === "scan-page")).toBe(false);
});

describe("seek branches before text sweeps", () => {
  it.each([
    'key == "ART2FULL" && ((tags.contains("tie") && title.contains("Exact")) || key == "TIE2AAAA")',
    '((tags.contains("tie") && title.contains("Exact")) || key == "TIE2AAAA") && key == "ART2FULL"',
  ])(
    "skips a mixed subtree after a seek with the nested Tag above the cap %#",
    async (filter) => {
      using scenario = openScenarioDatabase();
      const run = await query(scenario, filter, { tuning: { capRatio: 0.1 } });
      expect(result(run).rows!.map((row) => row.indexedKey)).toEqual([]);
      expect(
        statements(run).map((statement) => statement.reader),
      ).not.toContain("text-sweep-window");
    },
  );
  it("orders an any plan by pure seeks, mixed branches, then pure sweeps", async () => {
    using scenario = openScenarioDatabase();
    const run = await query(
      scenario,
      'title.contains("Lab") || (tags.contains("tie") && title.contains("Exact")) || key == "ART2FULL"',
      { tuning: { capRatio: 0.1 } },
    );
    expect(result(run).rows!.map((row) => row.indexedKey)).toEqual([
      "ART2FULL",
      "RPT2NDTE",
    ]);
    const reads = statements(run).filter(
      (statement) =>
        statement.reader === "candidate-set" ||
        statement.reader === "text-sweep-window",
    );
    expect(
      reads.map(
        (statement) => statement.params.value ?? statement.params.pattern,
      ),
    ).toEqual(["ART2FULL", "tie", "%exact%", "%lab%"]);
  });
  it("reads both sweeps when an all plan has no complete seek set", async () => {
    using scenario = openScenarioDatabase();
    const run = await query(
      scenario,
      'title.contains("Exact") && title.icontains("literature")',
    );
    expect(result(run).rows!.map((row) => row.indexedKey)).toEqual([
      "ART2FULL",
    ]);
    expect(
      statements(run).filter(
        (statement) => statement.reader === "text-sweep-window",
      ),
    ).toHaveLength(2);
  });
  it.each([
    'title.contains("Exact") && tags.contains("methods")',
    '(title.contains("Exact") && tags.contains("to-read")) && key == "ART2FULL"',
    'tags.contains("methods") && title.contains("Exact")',
    'title.contains("Exact") && (title.contains("Literature") && tags.contains("methods"))',
    '(title.contains("Exact") || title.contains("Methods")) && tags.contains("methods")',
  ])("uses the seek alone in %s", async (filter) => {
    using scenario = openScenarioDatabase();
    const run = await query(scenario, filter);
    expect(result(run).rows!.map((row) => row.indexedKey)).toEqual([
      "ART2FULL",
    ]);
    expect(result(run)).toEqual(
      result(await query(scenario, filter, { tuning: { forceScan: true } })),
    );
    const readers = statements(run).map((s) => s.reader);
    expect(readers).toContain("candidate-set");
    expect(readers).not.toContain("text-sweep-window");
    expect(readers).not.toContain("scan-page");
  });
  it("reads the seek first in an any plan, then every sweep", async () => {
    using scenario = openScenarioDatabase();
    const filter =
      'title.contains("Exact") || tags.contains("methods") || title.contains("Lab")';
    const run = await query(scenario, filter, { tuning: { capRatio: 1 } });
    expect(result(run).rows!.map((r) => r.indexedKey)).toEqual([
      "ALS2CNFL",
      "ART2FULL",
      "RPT2NDTE",
    ]);
    expect(
      statements(run)
        .map((s) => s.reader)
        .filter((r) => r === "candidate-set" || r === "text-sweep-window"),
    ).toEqual(["candidate-set", "text-sweep-window", "text-sweep-window"]);
    expect(
      statements(run).filter((s) => s.reader === "max-item-id"),
    ).toHaveLength(1);
  });
});

it.each([
  ['title.contains("ik%_É")', []],
  [
    'title.icontains("")',
    [
      "ALS2CNFL",
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "UNI2CDE2",
    ],
  ],
  [
    '!title.icontains("Exact")',
    [
      "ALS2CNFL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ],
  ],
  ['title.containsAny("Exact", "Lab")', ["ART2FULL", "RPT2NDTE"]],
  ['title.containsAll("Exact", "Lab")', []],
  ['title.lower().contains("exact")', ["ART2FULL"]],
  ['title.startsWith("Exact")', ["ART2FULL"]],
  ['title.endsWith("Exact")', []],
  ['title.contains("Ex" + "act")', ["ART2FULL"]],
  ['tags.icontains("TO-READ")', ["ART2FULL", "BK2MNTH2"]],
  ['abstractNote.contains("text")', []],
  ['extra.icontains("text")', []],
  [`title.icontains("${"a".repeat(60_000)}")`, []],
] as const)(
  "leaves unsupported text form %# on the existing path",
  async (filter, expected) => {
    using scenario = openScenarioDatabase();
    const run = await query(scenario, filter);
    const scanned = await query(scenario, filter, {
      tuning: { forceScan: true },
    });
    expect(result(run).rows!.map((row) => row.indexedKey)).toEqual(expected);
    expect(result(run)).toEqual(result(scanned));
    expect(statements(run).map((s) => s.reader)).not.toContain(
      "text-sweep-window",
    );
    expect(statements(run).map((s) => s.reader)).not.toContain("max-item-id");
  },
);

it("rejects a non-string text argument before candidate reads", async () => {
  using scenario = openScenarioDatabase();
  const run = await query(scenario, "title.contains(1)");
  if (!Exit.isFailure(run.exit)) throw new Error("expected a typed failure");
  const error = Cause.findErrorOption(run.exit.cause);
  expect(error).toMatchObject({
    _tag: "Some",
    value: { _tag: "ItemQueryError", code: "wrong-argument-type" },
  });
  const scanned = await query(scenario, "title.contains(1)", {
    tuning: { forceScan: true },
  });
  expect(run.exit).toEqual(scanned.exit);
  expect(statements(run)).toEqual([]);
});

it.each([
  [
    ATTACHMENTS,
    'item.title.icontains("Exact")',
    ["PDF2LINK", "PDF2LIVE", "URL2LIVE", "WEB2LIVE"],
  ],
  [
    ANNOTATIONS,
    'item.title.contains("Exact")',
    [
      "ANL2IMAG",
      "ANL2INK2",
      "ANL2TEXT",
      "ANL2UNDR",
      "ANN2BAD2",
      "ANN2HGHT",
      "ANN2IMAG",
      "ANN2INK2",
      "ANN2LINK",
      "ANN2NOTE",
      "ANN2TEXT",
      "ANN2UNDR",
    ],
  ],
  [
    ITEMS,
    'attachments.filter(value.item.title.icontains("Exact")).length > 0',
    ["ART2FULL"],
  ],
  [
    ITEMS,
    'attachments.filter(value.title.contains("Text")).length > 0',
    ["ART2FULL"],
  ],
  [ATTACHMENTS, 'title.icontains("Text")', ["PDF2LIVE"]],
  [ANNOTATIONS, 'text.icontains("text")', []],
] as const)(
  "keeps relation and other Dataset paths off the sweep %#",
  async (dataset, filter, expected) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const run = await query(scenario, filter, { dataset });
    expect(new Set(result(run).rows!.map((row) => row.indexedKey))).toEqual(
      new Set(expected),
    );
    expect(result(run)).toEqual(
      result(
        await query(scenario, filter, { tuning: { forceScan: true }, dataset }),
      ),
    );
    expect(statements(run).map((s) => s.reader)).not.toContain(
      "text-sweep-window",
    );
    expect(statements(run).map((s) => s.reader)).not.toContain("max-item-id");
  },
);
