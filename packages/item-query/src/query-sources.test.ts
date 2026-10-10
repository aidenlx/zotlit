import { Effect, Exit } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { collectionWarnings } from "./collection-warnings";
import { collectQuery } from "./query";
import { ANNOTATIONS } from "./query-annotations";
import { ATTACHMENTS } from "./query-attachments";
import { ITEMS } from "./query-items";
import { openQuerySources } from "./query-sources";
import { planRequest } from "./request";
import { runEffect } from "./test-helpers";

const { personal, group } = SCENARIO_LIBRARIES;

// Failure modes: opening reads eagerly; repeated needs read again; equivalent
// Target Library objects miss the cache; one query leaks sources into the next.
it("reads Query Sources lazily and keeps completed reads for one query", async () => {
  using scenario = openScenarioDatabase();
  const readers: string[] = [];
  const { exit } = await runEffect(
    Effect.gen(function* () {
      const sources = yield* openQuerySources;
      expect(readers).toEqual([]);
      const vocabulary = yield* sources.vocabulary();
      expect(yield* sources.vocabulary()).toBe(vocabulary);
      const paths = yield* sources.collectionPaths(personal);
      expect(yield* sources.collectionPaths({ ...personal })).toBe(paths);
      expect([...paths.values()]).toContainEqual(["Thesis", "Methods"]);
      const other = yield* openQuerySources;
      yield* other.vocabulary();
      yield* other.collectionPaths(personal);
    }),
    {
      client: scenario.db,
      onEvent: (event) => {
        if (event.type === "statement" && event.statement.reader !== "layout")
          readers.push(event.statement.reader);
      },
    },
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(readers).toEqual([
    "field-vocabulary",
    "field-vocabulary",
    "collection-paths",
    "field-vocabulary",
    "field-vocabulary",
    "collection-paths",
  ]);
});

// Failure modes: nested routes lose Collection paths, read them more than once,
// or report an existing Collection as unknown. Both passes share the same reads.
it.each([
  {
    dataset: ITEMS,
    fields: ["collections"],
    filter: 'collections.within("Thesis")',
  },
  {
    dataset: ATTACHMENTS,
    fields: ["item.collections"],
    filter: 'item.collections.within("Thesis")',
  },
  {
    dataset: ANNOTATIONS,
    fields: ["attachment.item.collections", "item.collections"],
    filter: 'attachment.item.collections.within("Thesis")',
  },
  {
    dataset: ITEMS,
    fields: ["collections", "annotations[].attachment.item.collections"],
    filter:
      'annotations.filter(value.attachment.item.collections.within("Thesis")).length > 0',
  },
])(
  "shares Collection paths through $dataset.id: $filter",
  async ({ dataset, fields, filter }) => {
    using scenario = openScenarioDatabase();
    for (const libraries of [[personal], [personal, group]]) {
      const reads: number[] = [];
      let vocabularyReads = 0;
      const { exit } = await runEffect(
        collectQuery(dataset, {
          libraries,
          fields,
          filter,
          sort: [],
          limit: null,
        }),
        {
          client: scenario.db,
          onEvent: (event) => {
            if (
              event.type === "statement" &&
              event.statement.reader === "field-vocabulary"
            )
              vocabularyReads++;
            if (
              event.type === "statement" &&
              event.statement.reader === "collection-paths"
            )
              reads.push(Number(event.statement.params["libraryID"]));
          },
        },
      );
      if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
      expect(exit.value.rows!.length).toBeGreaterThan(0);
      expect(exit.value.warnings).toEqual([]);
      expect(reads).toEqual(libraries.map((library) => library.libraryID));
      // One vocabulary read consists of its field and base-field statements.
      expect(vocabularyReads).toBe(2);
    }
  },
);

it.each([ITEMS, ATTACHMENTS, ANNOTATIONS])(
  "reads no Collection paths when $id names none",
  async (dataset) => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await runEffect(
      collectQuery(dataset, {
        libraries: [personal, group],
        fields: ["indexedKey"],
        sort: [],
        filter: "tags.isEmpty()",
      }),
      { client: scenario.db },
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === "statement" &&
          event.statement.reader === "collection-paths",
      ),
    ).toEqual([]);
  },
);

// Failure modes: a Collection warning depends on opening a loader, or warning
// lookups read paths again after another consumer has already read them.
it("checks Collection warnings directly through Query Sources", async () => {
  using scenario = openScenarioDatabase();
  const { exit, events } = await runEffect(
    Effect.gen(function* () {
      const plan = yield* planRequest(ANNOTATIONS, {
        libraries: [personal],
        filter: 'attachment.item.collections.within("Thesis/Methods")',
        fields: [],
        sort: [],
      });
      const sources = yield* openQuerySources;
      expect(
        yield* collectionWarnings(plan.filter!.root, [personal], sources),
      ).toEqual([]);
      yield* sources.collectionPaths(personal);
      expect(
        yield* collectionWarnings(plan.filter!.root, [personal], sources),
      ).toEqual([]);
    }),
    { client: scenario.db },
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(
    events.filter(
      (event) =>
        event.type === "statement" &&
        event.statement.reader === "collection-paths",
    ),
  ).toHaveLength(1);
});

it.each([
  { dataset: ITEMS, group: "collections[]" },
  { dataset: ATTACHMENTS, group: "item.collections[]" },
  { dataset: ANNOTATIONS, group: "attachment.item.collections[]" },
])(
  "reads Collection paths once for a Query Group in $dataset.id",
  async ({ dataset, group: groupPath }) => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await runEffect(
      collectQuery(dataset, {
        libraries: [personal, group],
        fields: [],
        sort: [],
        group: groupPath,
      }),
      { client: scenario.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(
      exit.value.groups?.some((group) => group.value === "Thesis/Methods"),
    ).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === "statement" &&
          event.statement.reader === "collection-paths",
      ),
    ).toHaveLength(2);
  },
);
