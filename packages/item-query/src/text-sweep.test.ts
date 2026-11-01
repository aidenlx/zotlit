import { Exit } from "effect";
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

it.each([
  "İ",
  "ı",
  "K",
  "K",
  "k",
  "ß",
  "ſ",
  "Σ",
  "σ",
  "ς",
  "\u0307",
  "%",
  "_",
  "É",
  "气",
  "🧪",
  "A",
])(
  "keeps every evaluator match for %s in the real SQLite candidates",
  async (c) => {
    using scenario = openScenarioDatabase();
    title(scenario, "ART2FULL", `x${c.toUpperCase()}z`);
    title(scenario, "BK2MNTH2", `x${c.toLowerCase()}z`);
    for (const term of new Set([c, c.toUpperCase(), c.toLowerCase()])) {
      for (const method of ["contains", "icontains"]) {
        const filter = `title.${method}(${JSON.stringify(`x${term}z`)})`;
        const scanned = await query(scenario, filter, {
          tuning: { forceScan: true },
        });
        const swept = await query(scenario, filter, {
          tuning: { capRatio: 1 },
        });
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
        for (const row of result(scanned).rows!)
          expect(candidateKeys).toContain(row.indexedKey);
      }
    }
  },
);

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
  'title.contains("ik%_É")',
  'title.icontains("")',
  '!title.icontains("Exact")',
  'title.containsAny("Exact", "Lab")',
  'title.containsAll("Exact", "Lab")',
  'title.lower().contains("exact")',
  'title.startsWith("Exact")',
  'title.endsWith("Exact")',
  'title.contains("Ex" + "act")',
  "title.contains(1)",
  'tags.icontains("TO-READ")',
  'abstractNote.contains("text")',
  'extra.icontains("text")',
  `title.icontains("${"a".repeat(60_000)}")`,
])("leaves unsupported text form %# on the existing path", async (filter) => {
  using scenario = openScenarioDatabase();
  const run = await query(scenario, filter);
  const scanned = await query(scenario, filter, {
    tuning: { forceScan: true },
  });
  expect(run.exit).toEqual(scanned.exit);
  expect(statements(run).map((s) => s.reader)).not.toContain(
    "text-sweep-window",
  );
  expect(statements(run).map((s) => s.reader)).not.toContain("max-item-id");
});

it.each([
  [ATTACHMENTS, 'item.title.icontains("Exact")'],
  [ANNOTATIONS, 'item.title.contains("Exact")'],
  [ITEMS, 'attachments.filter(value.item.title.icontains("Exact")).length > 0'],
  [ITEMS, 'attachments.filter(value.title.contains("Text")).length > 0'],
  [ATTACHMENTS, 'title.icontains("Text")'],
  [ANNOTATIONS, 'text.icontains("text")'],
] as const)(
  "keeps relation and other Dataset paths off the sweep %#",
  async (dataset, filter) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const run = await query(scenario, filter, { dataset });
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
