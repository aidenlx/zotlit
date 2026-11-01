import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, collectQuery, ITEMS } from ".";
import { runEffect } from "./test-helpers";

// Failure modes: membership scans despite literal arguments, or a candidate
// plan drops matches that the evaluator would keep.
it.each([
  {
    filter: 'tags.containsAny("tie", "methods")',
    returnedCount: 5,
  },
  {
    filter: 'tags.containsAll("to-read", "methods")',
    returnedCount: 1,
  },
  {
    filter: 'tags.containsAny(["tie", "methods"])',
    returnedCount: 5,
  },
  {
    filter: 'tags.containsAll(["to-read", "methods"])',
    returnedCount: 1,
  },
  {
    filter: 'collections.containsAny("Thesis/Methods", "Teaching/Methods")',
    returnedCount: 3,
  },
  {
    filter: 'collections.containsAll("Thesis", "Thesis/Methods")',
    returnedCount: 1,
  },
  {
    filter: 'collections.containsAny(["Thesis/Methods", "Teaching/Methods"])',
    returnedCount: 3,
  },
  {
    filter: 'collections.containsAll(["Thesis", "Thesis/Methods"])',
    returnedCount: 1,
  },
])("reads candidates for $filter", async ({ filter, returnedCount }) => {
  using scenario = openScenarioDatabase();
  const query = collectQuery(ITEMS, {
    libraries: [SCENARIO_LIBRARIES.personal],
    filter,
    fields: [],
    sort: [],
  });
  const actual = await runEffect(query, {
    client: scenario.db,
    tuning: { capRatio: 1 },
  });
  const scan = await runEffect(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount },
  });
  const readers = actual.events.flatMap((event) =>
    event.type === "statement" ? [event.statement.reader] : [],
  );
  expect(readers.filter((reader) => reader === "candidate-set")).toHaveLength(
    2,
  );
  expect(readers).not.toContain("scan-page");
});

// Failure mode: a nested plan overflows the stack on a long argument list.
it.each(["containsAny", "containsAll"])(
  "plans tags.%s with 10,000 values",
  async (method) => {
    using scenario = openScenarioDatabase();
    const values = Array.from(
      { length: 10_000 },
      (_, index) => `"tag ${index}"`,
    );
    const query = collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: `tags.${method}(${values.join(", ")})`,
      fields: [],
      sort: [],
    });
    const actual = await runEffect(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit._tag).toBe("Success");
  },
);

it('scans text title.containsAny("a")', async () => {
  using scenario = openScenarioDatabase();
  const actual = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter: 'title.containsAny("a")',
      fields: [],
    }),
    { client: scenario.db, tuning: { capRatio: 1 } },
  );
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 7 },
  });
  const readers = actual.events.flatMap((event) =>
    event.type === "statement" ? [event.statement.reader] : [],
  );
  expect(readers).toContain("scan-page");
  expect(readers).not.toContain("candidate-set");
});

// A Parent Record or Relation List must use the element Dataset's lowering.
// Intersections of parent supersets still need the complete evaluator.
it.each(
  [
    {
      dataset: ATTACHMENTS,
      subject: "tags",
      values: '"attachment-method", "missing"',
      any: 1,
      all: 0,
    },
    {
      dataset: ANNOTATIONS,
      subject: "tags",
      values: '"method", "missing"',
      any: 7,
      all: 0,
    },
    ...[ATTACHMENTS, ANNOTATIONS].flatMap((dataset) => [
      {
        dataset,
        subject: "item.tags",
        values: '"methods", "to-read"',
        any: dataset === ATTACHMENTS ? 4 : 12,
        all: dataset === ATTACHMENTS ? 4 : 12,
      },
      {
        dataset,
        subject: "item.collections",
        values: '"Thesis/Methods", "missing"',
        any: dataset === ATTACHMENTS ? 4 : 12,
        all: 0,
      },
    ]),
    {
      dataset: ITEMS,
      subject: "value.tags",
      relation: "attachments",
      values: '"attachment-method", "missing"',
      any: 1,
      all: 0,
    },
    {
      dataset: ITEMS,
      subject: "value.tags",
      relation: "annotations",
      values: '"method", "missing"',
      any: 1,
      all: 0,
    },
    {
      dataset: ATTACHMENTS,
      subject: "value.tags",
      relation: "annotations",
      values: '"method", "missing"',
      any: 2,
      all: 0,
    },
    {
      dataset: ITEMS,
      subject: "value.item.tags",
      relation: "attachments",
      values: '"methods", "to-read"',
      any: 1,
      all: 1,
    },
  ].flatMap(({ dataset, subject, values, any, all, ...route }) =>
    ["containsAny", "containsAll"].flatMap((method) =>
      [values, `[${values}]`].map((args) => {
        const membership = `${subject}.${method}(${args})`;
        return {
          dataset,
          filter:
            "relation" in route
              ? `${route.relation}.filter(${membership}).length > 0`
              : membership,
          returnedCount: method === "containsAny" ? any : all,
        };
      }),
    ),
  ),
)(
  "$dataset.id reads candidates for $filter",
  async ({ dataset, filter, returnedCount }) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const query = collectQuery(dataset, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
      sort: [],
    });
    const actual = await runEffect(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit).toMatchObject({
      _tag: "Success",
      value: { returnedCount },
    });
    const readers = actual.events.flatMap((event) =>
      event.type === "statement" ? [event.statement.reader] : [],
    );
    expect(readers.some((reader) => reader.endsWith("candidate-set"))).toBe(
      true,
    );
    expect(readers.some((reader) => reader.endsWith("scan-page"))).toBe(false);
  },
);

// Empty inputs and computed or non-string values retain evaluator semantics.
it.each([
  { filter: "tags.containsAny(title)", returnedCount: 0 },
  { filter: 'tags.containsAny(["methods", title])', returnedCount: 2 },
  { filter: 'tags.containsAll("methods", title)', returnedCount: 0 },
  { filter: 'tags.containsAny("methods", 12)', returnedCount: 2 },
  { filter: 'tags.containsAll(["methods", 12])', returnedCount: 0 },
  { filter: 'tags.containsAny("METHODS".lower())', returnedCount: 2 },
  { filter: "tags.containsAny()", returnedCount: 0 },
  { filter: "tags.containsAll()", returnedCount: 10 },
  { filter: "tags.containsAny([])", returnedCount: 0 },
  { filter: "tags.containsAll([])", returnedCount: 10 },
])("scans $filter", async ({ filter, returnedCount }) => {
  using scenario = openScenarioDatabase();
  const actual = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      filter,
      fields: [],
    }),
    { client: scenario.db, tuning: { capRatio: 1 } },
  );
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount },
  });
  const readers = actual.events.flatMap((event) =>
    event.type === "statement" ? [event.statement.reader] : [],
  );
  expect(readers).toContain("scan-page");
  expect(readers).not.toContain("candidate-set");
});
