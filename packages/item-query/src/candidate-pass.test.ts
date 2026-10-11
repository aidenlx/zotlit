import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { Effect, Exit } from "effect";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { runCandidatePass } from "./candidate-pass";
import type { CandidateDataset } from "./dataset";
import { planFilter } from "./filter-plan";
import { runEffect } from "./test-helpers";
import { PRODUCTION_TUNING } from "./tuning";

const logs: LogRecord[] = [];
beforeEach(() => {
  logs.length = 0;
});
beforeAll(() => {
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
afterAll(() => resetSync());

function fake(
  count: number,
  ids: number[],
  id: "items" | "attachments" | "annotations" = "items",
) {
  const reads: number[] = [];
  const dataset: CandidateDataset<string> = {
    id,
    lowerCandidate: (node) =>
      node.kind === "method" &&
      node.name === "contains" &&
      node.subject.kind === "field" &&
      node.subject.name === "tags" &&
      node.args[0]?.kind === "literal" &&
      typeof node.args[0].value === "string"
        ? node.args[0].value
        : null,
    readCandidate: ({ libraryID, limit, afterItemID = 0 }) =>
      Effect.sync(() => {
        reads.push(libraryID);
        return ids.filter((id) => id > afterItemID).slice(0, limit);
      }),
    readRowCount: () => Effect.succeed(count),
    candidateParents: [],
    candidateRelations: {},
    filterField: (name) =>
      name === "tags"
        ? {
            filterable: true,
            needs: {},
            value: { type: "list", read: () => [] },
          }
        : undefined,
  };
  return { dataset, reads };
}

it.each(["items", "attachments", "annotations"] as const)(
  "uses candidates at the cap of one Target Library and logs the %s decision",
  async (id) => {
    const { dataset, reads } = fake(12, [1, 2, 3], id);
    const filter = planFilter('tags.contains("selected")');
    if (!("root" in filter)) throw new Error("Invalid test filter");
    const run = await runEffect(
      runCandidatePass({
        dataset,
        filter: filter.root,
        library: { libraryID: 1, groupID: null },
        sources: {
          candidateContext: (library) => ({
            library,
            vocabulary: null,
            collectionPaths: undefined,
          }),
        },
        tuning: PRODUCTION_TUNING,
      }),
    );
    expect(run.exit).toEqual(Exit.succeed(new Set([1, 2, 3])));
    expect(reads).toEqual([1]);
    expect(logs[0]?.rawMessage).toBe(
      "ZotLit Query uses {plan} for {dataset} in Library {libraryID}",
    );
    expect(logs[0]?.properties).toEqual({
      dataset: dataset.id,
      libraryID: 1,
      groupID: null,
      plan: "candidates",
      candidateCount: 3,
      candidateCap: 3,
      reason: null,
    });
  },
);

async function choose(
  dataset: CandidateDataset,
  text?: string,
  {
    forceScan = false,
    libraryID = 1,
    relationPageBudget = PRODUCTION_TUNING.relationPageBudget,
  } = {},
) {
  const filter = text === undefined ? undefined : planFilter(text);
  if (filter && !("root" in filter)) throw new Error("Invalid test filter");
  const run = await runEffect(
    runCandidatePass({
      dataset,
      filter: filter?.root,
      library: { libraryID, groupID: libraryID === 1 ? null : 9 },
      sources: {
        candidateContext: (library) => ({
          library,
          vocabulary: null,
          collectionPaths: undefined,
        }),
      },
      tuning: { ...PRODUCTION_TUNING, forceScan, relationPageBudget },
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
      dataset: dataset.id,
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
      dataset: "items",
      libraryID: 1,
      groupID: null,
      plan: "candidates",
      candidateCount: 3,
      candidateCap: 3,
      reason: null,
    },
    {
      dataset: "items",
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
  ['tags.contains("selected") || title == "text"', false, "unsupported-filter"],
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
      rawMessage:
        "ZotLit Query uses {plan} for {dataset} in Library {libraryID}",
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

it.each([
  { operator: "||", left: [1, 2], right: [2, 3], expected: [1, 2, 3] },
  { operator: "||", left: [1, 2], right: [3, 4], expected: null },
  { operator: "&&", left: [1, 2, 3, 4], right: [2], expected: [2] },
  { operator: "&&", left: [1, 2], right: [2, 3], expected: [2] },
] as const)(
  "caps composed candidate sets for $operator",
  async ({ operator, left, right, expected }) => {
    const { dataset } = fake(12, []);
    const composed: CandidateDataset<string> = {
      ...dataset,
      readCandidate: ({ leaf, limit }) =>
        Effect.succeed([...(leaf === "left" ? left : right)].slice(0, limit)),
    };
    expect(
      await choose(
        composed,
        `tags.contains("left") ${operator} tags.contains("right")`,
      ),
    ).toEqual(expected === null ? null : new Set(expected));
    expect(logs[0]?.properties).toMatchObject({
      plan: expected === null ? "scan" : "candidates",
      reason: expected === null ? "candidate-cap-exceeded" : null,
    });
  },
);

it("uses a Relation List candidate through the fake descriptor's reader", async () => {
  const { dataset, reads } = fake(12, [1]);
  const root: CandidateDataset = {
    ...dataset,
    candidateRelations: {
      attachments: {
        dataset: () => dataset,
        readParents: () => Effect.succeed([7]),
      },
    },
  };
  expect(
    await choose(
      root,
      'attachments.filter(value.tags.contains("selected")).length > 0',
    ),
  ).toEqual(new Set([7]));
  expect(reads).toEqual([1]);
  expect(logs[0]?.properties).toMatchObject({
    plan: "candidates",
    candidateCount: 1,
    reason: null,
  });
});

// Failure modes: a Relation List never reaches the parent cap, a partial
// candidate set loses matches, or a budget outcome is logged as the cap.
it("scans when a Relation List exhausts its element page budget", async () => {
  const { dataset, reads } = fake(
    12,
    Array.from({ length: 10_000 }, (_, i) => i + 1),
  );
  const root: CandidateDataset = {
    ...dataset,
    candidateRelations: {
      attachments: {
        dataset: () => dataset,
        readParents: () => Effect.succeed([7]),
      },
    },
  };
  expect(
    await choose(
      root,
      'attachments.filter(value.tags.contains("selected")).length > 0',
    ),
  ).toBeNull();
  expect(reads).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  expect(logs[0]?.properties).toMatchObject({
    plan: "scan",
    candidateCount: null,
    reason: "relation-page-budget-exhausted",
  });
});

// One look-ahead row proves completeness at an exact page boundary. The cap
// wins when that same page supplies too many distinct parents.
it.each([
  { elements: 499, parents: [7], budget: 1, expected: [7], reason: null },
  {
    elements: 500,
    parents: [7],
    budget: 1,
    expected: [7],
    reason: null,
  },
  {
    elements: 501,
    parents: [7],
    budget: 1,
    expected: null,
    reason: "relation-page-budget-exhausted",
  },
  { elements: 500, parents: [7], budget: 2, expected: [7], reason: null },
  { elements: 501, parents: [7], budget: 2, expected: [7], reason: null },
  {
    elements: 500,
    parents: [1, 2, 3, 4],
    budget: 1,
    expected: null,
    reason: "candidate-cap-exceeded",
  },
])(
  "keeps completeness at the Relation List budget boundary: $elements elements, $budget pages",
  async ({ elements, parents, budget, expected, reason }) => {
    const { dataset } = fake(
      12,
      Array.from({ length: elements }, (_, i) => i + 1),
    );
    const root: CandidateDataset = {
      ...dataset,
      candidateRelations: {
        attachments: {
          dataset: () => dataset,
          readParents: () => Effect.succeed(parents),
        },
      },
    };
    expect(
      await choose(
        root,
        'attachments.filter(value.tags.contains("selected")).length > 0',
        { relationPageBudget: budget },
      ),
    ).toEqual(expected === null ? null : new Set(expected));
    expect(logs[0]?.properties).toMatchObject({ reason });
  },
);

it.each([
  {
    operator: "||",
    direct: [7],
    relationFirst: true,
    expected: null,
    reason: "relation-page-budget-exhausted",
  },
  {
    operator: "&&",
    direct: [7],
    relationFirst: true,
    expected: [7],
    reason: null,
  },
  {
    operator: "&&",
    direct: [],
    relationFirst: true,
    expected: [],
    reason: null,
  },
  {
    operator: "&&",
    direct: [1, 2, 3, 4],
    relationFirst: true,
    expected: null,
    reason: "relation-page-budget-exhausted",
  },
  {
    operator: "&&",
    direct: [1, 2, 3, 4],
    relationFirst: false,
    expected: null,
    reason: "candidate-cap-exceeded",
  },
  {
    operator: "||",
    direct: [1, 2, 3, 4],
    relationFirst: false,
    expected: null,
    reason: "candidate-cap-exceeded",
  },
])(
  "combines an exhausted Relation List branch with $operator, relation first: $relationFirst, direct: $direct",
  async ({ operator, direct, relationFirst, expected, reason }) => {
    const element = fake(
      12,
      Array.from({ length: 10_000 }, (_, i) => i + 1),
    );
    const root: CandidateDataset = {
      ...fake(12, direct).dataset,
      candidateRelations: {
        attachments: {
          dataset: () => element.dataset,
          readParents: () => Effect.succeed([7]),
        },
      },
    };
    const relation =
      'attachments.filter(value.tags.contains("selected")).length > 0';
    const parts = [relation, 'tags.contains("direct")'];
    if (!relationFirst) parts.reverse();
    expect(await choose(root, parts.join(` ${operator} `))).toEqual(
      expected === null ? null : new Set(expected),
    );
    expect(logs[0]?.properties).toMatchObject({ reason });
  },
);

it.each([false, true])(
  "logs a Parent Record page budget outcome (exhausted: %s)",
  async (exhausted) => {
    const { ATTACHMENTS } = await import("./query-attachments");
    const parent = fake(40_000, []);
    const reads: number[] = [];
    const dataset: CandidateDataset = {
      ...parent.dataset,
      id: "attachments",
      candidateParents: ATTACHMENTS.candidateParents,
      candidateRelations: {
        item: {
          dataset: () => parent.dataset,
          readChildren: ({ budget }) =>
            Effect.sync(() => {
              reads.push(budget);
              return {
                itemIDs: [7],
                exhausted,
              };
            }),
        },
      },
    };
    const filter = ATTACHMENTS.planFilter('item.tags.contains("selected")');
    if (!("root" in filter)) throw new Error("Invalid test filter");
    const run = await runEffect(
      runCandidatePass({
        dataset,
        filter: filter.root,
        library: { libraryID: 1, groupID: null },
        sources: {
          candidateContext: (library) => ({
            library,
            vocabulary: null,
            collectionPaths: undefined,
          }),
        },
        tuning: PRODUCTION_TUNING,
      }),
    );
    expect(run.exit).toEqual(Exit.succeed(exhausted ? null : new Set([7])));
    expect(reads).toEqual([4000]);
    expect(logs[0]?.properties).toMatchObject({
      reason: exhausted ? "parent-page-budget-exhausted" : null,
    });
  },
);
