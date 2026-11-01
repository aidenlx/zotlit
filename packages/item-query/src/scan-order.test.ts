import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { collectQuery, ITEMS } from ".";
import type { ItemQueryRequest } from ".";
import { runEffect } from "./test-helpers";

const RECORDS = [
  { key: "ORD2ZZZZ", title: "Same title", type: "book" },
  { key: "ORD2AAAA", title: "Same title", type: "book" },
  { key: "ORD2MMMM", title: "First title", type: "report" },
  { key: "ORD2BBBB", title: "Same title", type: "report" },
  { key: "ORD2YYYY", title: "Same title", type: "report" },
  { key: "ORD2CCCC", title: "Last title", type: "book" },
] as const;

/** Keep each key's data fixed while changing its place in the Item ID scan. */
function seedOrder(
  scenario: ScenarioDatabase,
  itemIDs: readonly number[],
  records: readonly { key: string; title: string; type: string }[] = RECORDS,
) {
  const insertItem = scenario.sqlite.prepare(
    "insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified) select ?, itemTypeID, 1, ?, '2024-01-01 00:00:00', '2024-01-01 00:00:00' from itemTypesCombined where typeName = ?",
  );
  const insertValue = scenario.sqlite.prepare(
    "insert or ignore into itemDataValues (value) values (?)",
  );
  const insertTitle = scenario.sqlite.prepare(
    "insert into itemData (itemID, fieldID, valueID) select ?, fieldID, valueID from fieldsCombined, itemDataValues where fieldName = 'title' and custom = 0 and value = ?",
  );
  for (const [index, record] of records.entries()) {
    insertItem.run(itemIDs[index]!, record.key, record.type);
    insertValue.run(record.title);
    insertTitle.run(itemIDs[index]!, record.title);
  }
}

const REQUESTS = [
  {
    name: "sorted",
    request: {
      sort: [{ field: "title", direction: "asc" }],
      limit: null,
    },
    keys: [
      "ORD2MMMM",
      "ORD2CCCC",
      "ORD2AAAA",
      "ORD2BBBB",
      "ORD2YYYY",
      "ORD2ZZZZ",
    ],
  },
  {
    name: "limited",
    request: { sort: [], limit: 3 },
    keys: ["ORD2AAAA", "ORD2BBBB", "ORD2CCCC"],
  },
  {
    name: "grouped",
    request: {
      group: "itemType",
      sort: [{ field: "title", direction: "asc" }],
      limit: 2,
    },
    keys: ["ORD2CCCC", "ORD2AAAA", "ORD2MMMM", "ORD2BBBB"],
  },
] as const satisfies readonly {
  name: string;
  request: Omit<ItemQueryRequest, "libraries">;
  keys: readonly string[];
}[];

// Failure modes: scan order decides a sort tie, a limited selection, or a group;
// an OR candidate plan encounters the same records in a different order.
it.each(REQUESTS)(
  "keeps the complete $name Query Result when keys move between Item IDs",
  async ({ request: query, keys }) => {
    using first = openScenarioDatabase();
    using second = openScenarioDatabase();
    const itemIDs = [101, 102, 103, 1001, 1002, 1003];
    seedOrder(first, itemIDs);
    seedOrder(second, itemIDs.toReversed());
    const request: ItemQueryRequest = {
      libraries: [SCENARIO_LIBRARIES.personal],
      fields: ["title", "itemType"],
      filter: RECORDS.map(({ key }) => `key == "${key}"`).join(" || "),
      ...query,
    };
    const baseline = await runEffect(collectQuery(ITEMS, request), {
      client: first.db,
      tuning: { forceScan: true },
    });
    if (baseline.exit._tag === "Failure")
      throw new Error(String(baseline.exit.cause));
    const { groups, rows } = baseline.exit.value;
    expect(
      (groups?.flatMap((group) => group.rows) ?? rows!).map(
        (row) => row.indexedKey,
      ),
    ).toEqual(keys);
    for (const forceScan of [true, false]) {
      const result = await runEffect(collectQuery(ITEMS, request), {
        client: second.db,
        tuning: {
          forceScan,
          capRatio: 1,
          scanPageSize: 2,
          hydrateChunkSize: 1,
          mergeStepSize: 1,
        },
      });
      if (result.exit._tag === "Failure")
        throw new Error(String(result.exit.cause));
      expect(result.exit.value).toEqual(baseline.exit.value);
    }
  },
);

// Failure mode: two group values collate as equal, so read order decides them.
it("keeps the order of groups whose values collate as equal", async () => {
  const records = [
    { key: "ORD2DDDD", title: "Éclairs", type: "book" },
    { key: "ORD2EEEE", title: "Éclairs", type: "book" },
  ];
  const groups = async (itemIDs: readonly number[]) => {
    using scenario = openScenarioDatabase();
    seedOrder(scenario, itemIDs, records);
    const result = await runEffect(
      collectQuery(ITEMS, {
        libraries: [SCENARIO_LIBRARIES.personal],
        fields: ["title"],
        filter: records.map(({ key }) => `key == "${key}"`).join(" || "),
        group: "title",
        sort: [],
        limit: null,
      }),
      { client: scenario.db, tuning: { forceScan: true } },
    );
    if (result.exit._tag === "Failure")
      throw new Error(String(result.exit.cause));
    return result.exit.value.groups?.map(({ value }) => value);
  };
  const expected = ["Éclairs", "Éclairs"];
  expect(await groups([1001, 101])).toEqual(expected);
  expect(await groups([101, 1001])).toEqual(expected);
});
