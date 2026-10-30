// The parity suite: every plan and every chunk size gives the complete Query
// Result of the forced scan. The queries come from `scenario-queries.ts`.
import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ATTACHMENTS, AttachmentFileResolver, collectQuery, ITEMS } from ".";
import type { ItemQueryRequest } from ".";
import { ATTACHMENT_SCENARIO_QUERIES } from "./attachment-scenario-queries";
import { RELATION_SCENARIO_QUERIES } from "./relation-scenario-queries";
import { PINNED_FILTERS, SCENARIO_QUERIES } from "./scenario-queries";
import type { ScenarioQuery } from "./scenario-queries";
import { ItemQueryScheduler } from "./scheduler";
import { runEffect } from "./test-helpers";
import type { RunOptions } from "./test-helpers";

type Tuning = NonNullable<RunOptions["tuning"]>;

/** The oracle: the Library scan at the production chunk sizes. */
const FORCED_SCAN: Tuning = { forceScan: true };

/**
 * The plans and chunk sizes under test. The personal Library of the scenario
 * has 15 `items` rows and the group Library has 3, so the cap ratios give
 * caps of 3 and 0 Items (default), 15 and 3 (every set), 1 and 0, and 5 and 1.
 * Each Library has its own cap: a query of both Libraries reads a candidate
 * set in one Library and scans the other when a set is within one cap only,
 * as the Tag `to-read` is at the default ratio.
 */
const PLANS: readonly { name: string; tuning: Tuning }[] = [
  { name: "the default plan", tuning: {} },
  { name: "every candidate set within the cap", tuning: { capRatio: 1 } },
  { name: "a cap of one Item", tuning: { capRatio: 0.1 } },
  { name: "caps of five Items and of one Item", tuning: { capRatio: 0.34 } },
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

/**
 * The pause methods under test, each with small chunks so that a run has many
 * operations. Semantic parity runs use a scheduler with no pauses.
 */
const PAUSE_METHODS: readonly {
  name: string;
  scheduler: () => ItemQueryScheduler;
}[] = [
  {
    name: "a MessageChannel pause after several operations",
    scheduler: () => {
      // A counter in place of the clock, as in the test scheduler.
      let ticks = 0;
      return new ItemQueryScheduler({ budgetMs: 10, now: () => ticks++ });
    },
  },
  {
    name: "no pause",
    scheduler: () => new ItemQueryScheduler({ budgetMs: Infinity }),
  },
  {
    name: "a setImmediate pause after every operation",
    scheduler: () => {
      // A counter in place of the clock, as in the test scheduler.
      let ticks = 0;
      return new ItemQueryScheduler({
        budgetMs: 3,
        now: () => ticks++,
        pause: (resume) => {
          const timer = setImmediate(resume);
          return () => clearImmediate(timer);
        },
      });
    },
  },
];
const PAUSE_METHOD_TUNING: Tuning = {
  capRatio: 1,
  scanPageSize: 3,
  hydrateChunkSize: 2,
  mergeStepSize: 2,
};

const databases = new DisposableStack();
let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = databases.use(openScenarioDatabase());
});

afterAll(() => {
  databases.dispose();
});

let annotated: ScenarioDatabase | undefined;

/** The scenario with Annotations, opened on first use. No test writes to it. */
const annotatedScenario = (): ScenarioDatabase =>
  (annotated ??= databases.use(openScenarioDatabase({ annotations: true })));

/**
 * The complete outcome of one run in its wire form: the Query Result, or the
 * typed failure. A defect or an interruption fails the test.
 */
async function outcome(
  query: ScenarioQuery,
  tuning: Tuning,
  on: { database?: ScenarioDatabase; scheduler?: ItemQueryScheduler } = {},
): Promise<unknown> {
  const {
    database = scenario,
    scheduler = new ItemQueryScheduler({ budgetMs: Infinity }),
  } = on;
  const request: ItemQueryRequest = {
    ...query.request,
    libraries: query.libraries.map((name) => SCENARIO_LIBRARIES[name]),
  };
  const { exit } = await runEffect(collectQuery(ITEMS, request), {
    client: database.db,
    now: query.now,
    timeZone: query.timeZone,
    tuning,
    scheduler,
  });
  if (Exit.isSuccess(exit)) return wire({ result: exit.value });
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return wire({
    failure:
      error.value._tag === "ItemQueryError"
        ? { fault: error.value.fault, location: error.value.location }
        : error.value,
  });
}

/** A value as JSON gives it back: a Temporal value becomes its ISO string. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function expectParity(query: ScenarioQuery): Promise<unknown> {
  const oracle = await outcome(query, FORCED_SCAN);
  for (const plan of PLANS) {
    expect(
      await outcome(query, plan.tuning),
      `${query.name}: ${plan.name} differs from the forced scan.`,
    ).toEqual(oracle);
  }
  return oracle;
}

const highest = process.env.ZOTLIT_SCENARIO_LAYOUT !== "lowest";
const BOUNDARY_FILTERS = [
  'tags.contains("methods")',
  'key == "ART2FULL"',
  'publicationTitle == "Handbook of Methods"',
  'collections.contains("Thesis/Methods")',
  'collections.within("Thesis")',
  'tags.contains("to-read") && tags.contains("methods")',
  'tags.contains("tie") || tags.contains("methods")',
  'tags.contains("eclair") || key == "RPT2NDTE"',
];
const LOWEST_REQUESTS = [
  "no filter, defaults",
  "no filter, every relation, tie-heavy sort",
  "no filter, both Libraries, every relation, tie-heavy sort",
  "Tag filter, sort, limit, and projection",
  "field-value filter, sort, limit, and projection",
  "Relation List element projection",
  "Formulas over a candidate set, with a custom field and a date",
  "group tags[].name",
];
const boundaryQueries = SCENARIO_QUERIES.filter((query) =>
  BOUNDARY_FILTERS.some(
    (filter) => query.name === `${filter} [both Libraries, key order]`,
  ),
);
const scenarioQueries = highest
  ? SCENARIO_QUERIES
  : SCENARIO_QUERIES.filter(
      (query) =>
        boundaryQueries.includes(query) || LOWEST_REQUESTS.includes(query.name),
    );

describe("parity of every plan with the forced scan", () => {
  {
    it.runIf(highest)("has a unique name for every scenario query", () => {
      const names = SCENARIO_QUERIES.map((query) => query.name);

      expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
    });

    it.runIf(highest)("pins the matches of filters of the list only", () => {
      // One key-order query of each pinned filter carries its matches.
      expect(SCENARIO_QUERIES.filter((query) => query.matches)).toHaveLength(
        PINNED_FILTERS.length,
      );
    });
  }

  it.each(scenarioQueries.filter((query) => !query.matches))(
    "$name",
    async (query) => {
      await expectParity(query);
    },
  );

  // A query with pinned matches also checks the forced scan against the seed.
  it.each(
    scenarioQueries.flatMap(({ matches, ...query }) =>
      matches ? [{ ...query, matches }] : [],
    ),
  )("$name", async (query) => {
    const oracle = await expectParity(query);
    expect(indexedKeys(oracle), "the forced scan").toEqual(
      [...query.matches].sort(),
    );
  });
});

/** The Indexed Keys of a Query Result, sorted. */
function indexedKeys(outcome: unknown): string[] {
  const { result } = outcome as { result: { rows: { indexedKey: string }[] } };
  return result.rows.map((row) => row.indexedKey).sort();
}

{
  describe.runIf(highest)(
    "parity of every pause method with the forced scan",
    () => {
      it.each(
        SCENARIO_QUERIES.filter((query) =>
          [
            "no filter, identity-only, limit 2",
            "no filter, every relation, tie-heavy sort",
            "Tag filter, sort, limit, and projection",
            "no filter, both Libraries, every relation, tie-heavy sort",
            "group tags[].name",
          ].includes(query.name),
        ),
      )("$name", async (query) => {
        const oracle = await outcome(query, FORCED_SCAN);
        for (const method of PAUSE_METHODS) {
          expect(
            await outcome(query, PAUSE_METHOD_TUNING, {
              scheduler: method.scheduler(),
            }),
            `${query.name}: ${method.name} differs from the forced scan.`,
          ).toEqual(oracle);
        }
      });
    },
  );
}

/**
 * The indexes of the pristine Zotero database that the Tag and field-value
 * candidate statements use. An index affects speed only.
 */
const LEAF_INDEXES = ["itemTags_tagID", "itemData_fieldID", "itemData_valueID"];

{
  describe.runIf(highest)(
    "parity without the Tag and field-value indexes",
    () => {
      let unindexed: ScenarioDatabase;

      beforeAll(() => {
        unindexed = openScenarioDatabase();
        // `drop index` fails for a name the database does not have.
        for (const index of LEAF_INDEXES)
          unindexed.sqlite.exec(`drop index "${index}"`);
      });

      afterAll(() => {
        unindexed.close();
      });

      it.each(boundaryQueries)("$name", async (query) => {
        const oracle = await outcome(query, FORCED_SCAN);
        for (const plan of PLANS) {
          expect(
            await outcome(query, plan.tuning, { database: unindexed }),
            `${query.name}: ${plan.name} without the indexes differs from the forced scan with them.`,
          ).toEqual(oracle);
        }
      });
    },
  );
}

{
  describe.runIf(highest)("parity of generated filter combinations", () => {
    const queries: ScenarioQuery[] = [
      '(key == "ART2FULL") && title.startsWith("Exact")',
      '(key == "ART2FULL") || title.startsWith("Exact")',
      '!(key == "ART2FULL")',
      '(key == "ART2FULL") == title.startsWith("Exact")',
      'if(key == "ART2FULL", title.startsWith("Exact"))',
      'if(key == "ART2FULL", title.startsWith("Exact"), tags.contains("methods"))',
      '((key == "ART2FULL") || tags.contains("methods")) && title.startsWith("Exact")',
      '((key == "ART2FULL") && tags.contains("methods")) || title.startsWith("Exact")',
    ].map((filter) => ({
      name: filter,
      libraries: ["personal", "group"],
      request: { filter, fields: [], sort: [] },
    }));

    it.each(queries)("$name", async (query) => {
      const oracle = await expectParity(query);
      expect(oracle).toHaveProperty("result");
    });
  });
}

// Failure modes: a property suffix can hide a dotted source name; an existing
// prefix keeps its property meaning even when the dotted name also exists.
it.each(["review.length", "custom.review.length"])(
  "preserves source-dependent property resolution for %s in every plan",
  async (access) => {
    using database = openScenarioDatabase();
    database.sqlite.exec(
      "update fieldsCombined set fieldName = 'review.length' where fieldName = 'review.status'; update customFields set fieldName = 'review.length' where fieldName = 'review.status'",
    );
    const query: ScenarioQuery = {
      name: access,
      libraries: ["personal"],
      request: { filter: `${access} == 4`, fields: [], sort: [] },
    };
    const missing = await outcome(query, FORCED_SCAN, { database });
    expect(missing).toMatchObject({
      failure: {
        fault: {
          kind: "unknown",
          name: "review.length",
          dotted: true,
          at: { from: 0, to: access.length },
        },
      },
    });
    for (const { tuning } of PLANS)
      expect(await outcome(query, tuning, { database })).toEqual(missing);
    database.sqlite.exec(
      "update fieldsCombined set fieldName = 'review' where fieldName = 'mood'; update customFields set fieldName = 'review' where fieldName = 'mood'",
    );
    const property = await outcome(query, FORCED_SCAN, { database });
    expect(property).toMatchObject({
      result: {
        returnedCount: 1,
        rows: [{ indexedKey: "ART2FULL", values: {} }],
        warnings: [],
      },
    });
    for (const { tuning } of PLANS)
      expect(await outcome(query, tuning, { database })).toEqual(property);
    database.sqlite.exec(
      "update fieldsCombined set fieldName = 'review.status' where fieldName = 'review.length'; update customFields set fieldName = 'review.status' where fieldName = 'review.length'",
    );
    for (const { tuning } of PLANS)
      expect(await outcome(query, tuning, { database })).toEqual(property);
  },
);

{
  describe.runIf(highest)("Attachment parity with the forced scan", () => {
    const libraries = [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group];
    it.each(ATTACHMENT_SCENARIO_QUERIES)("request %# %j", async (request) => {
      const run = async (tuning: Tuning) => {
        const { exit } = await runEffect(
          collectQuery(ATTACHMENTS, { ...request, libraries }),
          {
            client: annotatedScenario().db,
            tuning,
            scheduler: new ItemQueryScheduler({ budgetMs: Infinity }),
          },
        );
        if (exit._tag === "Failure") throw new Error(String(exit.cause));
        return wire(exit.value);
      };
      const expected = await run(FORCED_SCAN);
      for (const plan of PLANS)
        expect(
          await run(plan.tuning),
          JSON.stringify({ request, libraries, plan }),
        ).toEqual(expected);
    });
  });
}

{
  it.runIf(highest).each(RELATION_SCENARIO_QUERIES)(
    "keeps scan parity for $name",
    async ({ dataset, request }) => {
      const source = annotatedScenario();
      for (const libraries of [Object.values(SCENARIO_LIBRARIES)]) {
        const query = collectQuery(dataset, { ...request, libraries }).pipe(
          Effect.provideService(AttachmentFileResolver, (attachment) =>
            Effect.succeed({
              path: attachment.key === "PDF2LIVE" ? "/paper.pdf" : null,
              exists: attachment.key === "PDF2LIVE",
            }),
          ),
        );
        const oracle = await runEffect(query, {
          client: source.db,
          tuning: FORCED_SCAN,
          scheduler: new ItemQueryScheduler({ budgetMs: Infinity }),
        });
        if (oracle.exit._tag === "Failure")
          throw Cause.squash(oracle.exit.cause);
        for (const { name, tuning } of PLANS) {
          const actual = await runEffect(query, {
            client: source.db,
            tuning,
            scheduler: new ItemQueryScheduler({ budgetMs: Infinity }),
          });
          if (actual.exit._tag === "Failure")
            throw Cause.squash(actual.exit.cause);
          expect(actual.exit.value, name).toEqual(oracle.exit.value);
        }
      }
    },
  );
}
