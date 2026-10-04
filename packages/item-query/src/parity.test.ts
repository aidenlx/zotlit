// The parity suite: every plan and every chunk size gives the complete Query
// Result of the forced scan. The queries come from `scenario-queries.ts`.
import { Cause, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { queryItems } from ".";
import type { ItemQueryRequest, SortSpec } from ".";
import { GENERATED_FILTER_PARTS, SCENARIO_QUERIES } from "./scenario-queries";
import type { ScenarioQuery } from "./scenario-queries";
import { runEffect } from "./test-helpers";
import type { RunOptions } from "./test-helpers";

type Tuning = NonNullable<RunOptions["tuning"]>;

/** The oracle: the Library scan at the production chunk sizes. */
const FORCED_SCAN: Tuning = { forceScan: true };

/**
 * The plans and chunk sizes under test. The personal Library of the scenario
 * has 15 `items` rows and the group Library has 3, so the cap ratios give
 * caps of 3 and 0 Items (default), 15 and 3 (every set), and 1 and 0.
 */
const PLANS: readonly { name: string; tuning: Tuning }[] = [
  { name: "the default plan", tuning: {} },
  { name: "every candidate set within the cap", tuning: { capRatio: 1 } },
  { name: "a cap of one Item", tuning: { capRatio: 0.1 } },
  {
    name: "chunks of one Item",
    tuning: { scanPageSize: 1, hydrateChunkSize: 1, mergeStepSize: 1 },
  },
  {
    name: "pages of three and chunks of two Items, every set within the cap",
    tuning: {
      capRatio: 1,
      scanPageSize: 3,
      hydrateChunkSize: 2,
      mergeStepSize: 2,
    },
  },
  {
    name: "a hydrate chunk above the page size",
    tuning: { scanPageSize: 2, hydrateChunkSize: 5, mergeStepSize: 3 },
  },
  {
    name: "the forced scan in pages of four Items",
    tuning: {
      forceScan: true,
      scanPageSize: 4,
      hydrateChunkSize: 3,
      mergeStepSize: 1,
    },
  },
];

let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
});

afterAll(() => {
  scenario.close();
});

/**
 * The complete outcome of one run in its wire form: the Query Result, or the
 * typed failure. A defect or an interruption fails the test.
 */
async function outcome(query: ScenarioQuery, tuning: Tuning): Promise<unknown> {
  const request: ItemQueryRequest = {
    ...query.request,
    library: SCENARIO_LIBRARIES[query.library],
  };
  const { exit } = await runEffect(queryItems(request), {
    client: scenario.db,
    now: query.now,
    timeZone: query.timeZone,
    tuning,
  });
  if (Exit.isSuccess(exit)) return wire({ result: exit.value });
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return wire({
    failure: Object.assign({}, error.value, { message: error.value.message }),
  });
}

/** A value as JSON gives it back: a Temporal value becomes its ISO string. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function expectParity(query: ScenarioQuery, hint = ""): Promise<unknown> {
  const oracle = await outcome(query, FORCED_SCAN);
  for (const plan of PLANS) {
    expect(
      await outcome(query, plan.tuning),
      `${query.name}: ${plan.name} differs from the forced scan.${hint}`,
    ).toEqual(oracle);
  }
  return oracle;
}

describe("parity of every plan with the forced scan", () => {
  it("has a unique name for every scenario query", () => {
    const names = SCENARIO_QUERIES.map((query) => query.name);

    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });

  it.each(SCENARIO_QUERIES)("$name", async (query) => {
    await expectParity(query);
  });
});

/**
 * The fixed seed of the generated combinations. Change it only together with
 * a reason; a failure it finds becomes a named case in `scenario-queries.ts`.
 */
const GENERATED_SEED = 1314;
const GENERATED_COUNT = 400;

/** A seeded generator (mulberry32) of numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const SORTS: readonly (readonly SortSpec[] | undefined)[] = [
  undefined,
  [],
  [{ field: "title", direction: "asc" }],
  [
    { field: "volume", direction: "desc" },
    { field: "dateAdded", direction: "asc" },
  ],
];
const LIMITS = [undefined, null, 1, 2, 3] as const;
const FIELDS: readonly (readonly string[] | undefined)[] = [
  undefined,
  [],
  ["title", "tags[0].name"],
  ["collections", "creators[0].fullName", "attachments"],
];

function generateQueries(seed: number, count: number): ScenarioQuery[] {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(next() * values.length)]!;
  const part = (depth: number): string =>
    depth === 0 || next() < 0.2
      ? pick(GENERATED_FILTER_PARTS)
      : combination(depth);
  const combination = (depth: number): string => {
    const parts = () => part(depth - 1);
    switch (Math.floor(next() * 8)) {
      case 0:
      case 1:
      case 2:
        return `(${parts()} && ${parts()})`;
      case 3:
      case 4:
        return `(${parts()} || ${parts()})`;
      case 5:
        return `!(${parts()})`;
      case 6:
        return `((${parts()}) == (${parts()}))`;
      default:
        return next() < 0.5
          ? `if(${parts()}, ${parts()}, ${parts()})`
          : `if(${parts()}, ${parts()})`;
    }
  };
  return Array.from({ length: count }, (_, index) => ({
    name: `generated ${seed}/${index}`,
    library: next() < 0.75 ? "personal" : "group",
    request: {
      filter: combination(3),
      fields: pick(FIELDS),
      sort: pick(SORTS),
      limit: pick(LIMITS),
    },
  }));
}

describe("parity of generated filter combinations", () => {
  const queries = generateQueries(GENERATED_SEED, GENERATED_COUNT);

  it("generates the same queries for the fixed seed", () => {
    expect(generateQueries(GENERATED_SEED, GENERATED_COUNT)).toEqual(queries);
    expect(
      new Set(queries.map((query) => query.request.filter)).size,
    ).toBeGreaterThan(GENERATED_COUNT * 0.9);
  });

  it.each(queries)("$name: $request.filter", async (query) => {
    const oracle = await expectParity(
      query,
      ` Add this query to NAMED_CASES in src/scenario-queries.ts under a name that says what it covers:\n${JSON.stringify(query, null, 2)}`,
    );

    // Every generated query is valid: a failure is a fault of the generator.
    expect(oracle).toHaveProperty("result");
  });
});
