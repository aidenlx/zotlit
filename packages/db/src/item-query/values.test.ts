import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";

import { ItemQueryDatabase, readCollectionPaths, readTagValues } from ".";

it("reads empty Collection paths and drops trashed Collections and their subtrees per Library", () => {
  using scenario = openScenarioDatabase();
  scenario.sqlite
    .prepare(
      "insert into collections (collectionName, libraryID, key) values ('Empty', 1, 'EMPTYCL2')",
    )
    .run();
  const read = (library: { libraryID: number }) =>
    [
      ...Effect.runSync(
        readCollectionPaths(library).pipe(
          Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        ),
      ).values(),
    ]
      .map((path) => path.join("/"))
      .sort();
  expect(read(SCENARIO_LIBRARIES.personal)).toEqual([
    "Empty",
    "Teaching",
    "Teaching/Methods",
    "Thesis",
    "Thesis/Methods",
  ]);
  expect(read(SCENARIO_LIBRARIES.group)).toEqual(["Methods"]);
});

it("reads each Tag name and type once per Library, excluding trashed items", () => {
  using scenario = openScenarioDatabase();
  const read = (library: { libraryID: number }) =>
    Effect.runSync(
      readTagValues(library).pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
      ),
    );
  expect(read(SCENARIO_LIBRARIES.group)).toEqual(
    expect.arrayContaining([
      { name: "group-only", type: 0 },
      { name: "to-read", type: 0 },
    ]),
  );
  const personal = read(SCENARIO_LIBRARIES.personal);
  expect(personal).toContainEqual({ name: "To-Read", type: 1 });
  expect(personal).not.toContainEqual({ name: "group-only", type: 0 });
  expect(personal.filter((tag) => tag.name === "tie")).toEqual([
    { name: "tie", type: 0 },
  ]);
  scenario.sqlite.exec(
    "insert into tags (name) values ('trash-only'); insert into itemTags (itemID, tagID, type) select itemID, last_insert_rowid(), 0 from deletedItems limit 1",
  );
  expect(
    read(SCENARIO_LIBRARIES.personal).some((tag) => tag.name === "trash-only"),
  ).toBe(false);
});
