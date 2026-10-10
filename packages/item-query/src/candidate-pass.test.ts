import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, expect, it } from "vitest";

import { runCandidatePass } from "./candidate-pass";
import type { CandidateDataset } from "./dataset";
import { planFilter } from "./filter-plan";
import { runEffect } from "./test-helpers";
import { PRODUCTION_TUNING } from "./tuning";

const logs: LogRecord[] = [];
beforeEach(() => {
  logs.length = 0;
  configureSync({
    sinks: { capture: (record) => logs.push(record) },
    loggers: [
      {
        category: ["zotlit", "item-query"],
        sinks: ["capture"],
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
    ],
  });
});
afterEach(() => resetSync());

function fake(count: number, ids: number[]) {
  const reads: number[] = [];
  const dataset: CandidateDataset<string> = {
    lowerCandidate: (node) =>
      node.kind === "method" && node.name === "contains" ? "tag" : null,
    readCandidate: ({ libraryID, limit }) =>
      Effect.sync(() => {
        reads.push(libraryID);
        return ids.slice(0, limit);
      }),
    readRowCount: () => Effect.succeed(count),
    candidateParents: [],
    candidateRelations: {},
    filterField: () => undefined,
  };
  return { dataset, reads };
}

it("uses candidates at the cap of one Target Library and logs the decision", async () => {
  const { dataset, reads } = fake(12, [1, 2, 3]);
  const filter = planFilter('tags.contains("selected")');
  if (!("root" in filter)) throw new Error("Invalid test filter");
  const run = await runEffect(
    runCandidatePass({
      dataset,
      filter: filter.root,
      sources: {
        library: { libraryID: 1, groupID: null },
        vocabulary: null,
        collectionPaths: undefined,
      },
      tuning: PRODUCTION_TUNING,
    }),
  );
  expect(run.exit).toEqual(Exit.succeed(new Set([1, 2, 3])));
  expect(reads).toEqual([1]);
  expect(logs[0]?.properties).toEqual({
    libraryID: 1,
    groupID: null,
    plan: "candidates",
    candidateCount: 3,
    candidateCap: 3,
    reason: null,
  });
});

async function choose(
  dataset: CandidateDataset,
  text?: string,
  { forceScan = false, libraryID = 1 } = {},
) {
  const filter = text === undefined ? undefined : planFilter(text);
  if (filter && !("root" in filter)) throw new Error("Invalid test filter");
  const run = await runEffect(
    runCandidatePass({
      dataset,
      filter: filter?.root,
      sources: {
        library: { libraryID, groupID: libraryID === 1 ? null : 9 },
        vocabulary: null,
        collectionPaths: undefined,
      },
      tuning: { ...PRODUCTION_TUNING, forceScan },
    }),
  );
  if (run.exit._tag === "Failure") throw new Error(String(run.exit.cause));
  return run.exit.value;
}

it.each([
  [2, [1, 2], null],
  [3, [1, 2, 3], null],
  [4, null, "candidate-cap-exceeded"],
] as const)(
  "applies the 25%% cap to %i candidates",
  async (size, expected, reason) => {
    const { dataset } = fake(12, [1, 2, 3, 4].slice(0, size));
    expect(await choose(dataset, 'tags.contains("selected")')).toEqual(
      expected === null ? null : new Set(expected),
    );
    expect(logs[0]?.properties).toEqual({
      libraryID: 1,
      groupID: null,
      plan: expected === null ? "scan" : "candidates",
      candidateCount: expected === null ? null : size,
      candidateCap: 3,
      reason,
    });
  },
);

it("chooses separately for two Target Libraries of different sizes", async () => {
  const { dataset } = fake(12, [1, 2, 3]);
  const libraries = {
    ...dataset,
    readRowCount: (id: number) => Effect.succeed(id === 1 ? 12 : 8),
  };
  expect(
    await choose(libraries, 'tags.contains("selected")', { libraryID: 1 }),
  ).toEqual(new Set([1, 2, 3]));
  expect(
    await choose(libraries, 'tags.contains("selected")', { libraryID: 2 }),
  ).toBeNull();
  expect(logs.map((log) => log.properties)).toEqual([
    {
      libraryID: 1,
      groupID: null,
      plan: "candidates",
      candidateCount: 3,
      candidateCap: 3,
      reason: null,
    },
    {
      libraryID: 2,
      groupID: 9,
      plan: "scan",
      candidateCount: null,
      candidateCap: 2,
      reason: "candidate-cap-exceeded",
    },
  ]);
});

it.each([
  [undefined, false, "no-filter"],
  ['tags.contains("selected")', true, "forced-scan"],
  ['title == "text"', false, "unsupported-filter"],
  ['if(tags.contains("selected"), true, false)', false, "unsupported-filter"],
  [
    'attachments.filter(if(value.tags.contains("selected"), true, false)).length > 0',
    false,
    "unsupported-filter",
  ],
  [
    "attachments.filter(number(value.key) == 1).length > 0",
    false,
    "unsupported-filter",
  ],
] as const)(
  "scans without candidate reads for %s",
  async (text, forceScan, reason) => {
    const { dataset, reads } = fake(12, [1]);
    const root: CandidateDataset = {
      ...dataset,
      candidateRelations: {
        attachments: {
          dataset: () => dataset,
          readParents: () => Effect.die("Unexpected relation read"),
        },
      },
      readRowCount: () => Effect.die("Unexpected count"),
    };
    expect(await choose(root, text, { forceScan })).toBeNull();
    expect(reads).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      category: ["zotlit", "item-query"],
      level: "debug",
      rawMessage: "Item Query uses {plan} for Library {libraryID}",
      properties: {
        libraryID: 1,
        groupID: null,
        plan: "scan",
        candidateCount: null,
        candidateCap: null,
        reason,
      },
    });
  },
);

it("uses an empty candidate set without scanning", async () => {
  const { dataset } = fake(0, []);
  expect(await choose(dataset, 'tags.contains("selected")')).toEqual(new Set());
  expect(logs[0]?.properties).toMatchObject({
    plan: "candidates",
    candidateCap: 0,
    candidateCount: 0,
    reason: null,
  });
});
