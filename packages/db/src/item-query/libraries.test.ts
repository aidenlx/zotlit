import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getLibraries } from "@/queries/libraries";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import { ItemQueryDatabase, readLibraries } from ".";

function read(scenario: ScenarioDatabase) {
  return Effect.runSync(
    Effect.provideService(readLibraries(), ItemQueryDatabase, {
      client: scenario.db,
    }),
  );
}

const PERSONAL = {
  libraryID: 1,
  type: "user",
  version: 0,
  clientVersion: 0,
  groupID: null,
  name: null,
};
const METHODS_GROUP = {
  libraryID: 2,
  type: "group",
  version: 0,
  clientVersion: 0,
  groupID: 4815,
  name: "Methods Reading Group",
};

describe("readLibraries", () => {
  it("gives the personal Library and each group Library with its group ID and name", () => {
    using scenario = openScenarioDatabase();

    expect(read(scenario)).toEqual([PERSONAL, METHODS_GROUP]);
  });

  it("gives the rows of getLibraries", () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 1);

    expect(read(scenario)).toEqual(getLibraries(scenario.db));
    expect(read(scenario)).toContainEqual(
      expect.objectContaining({ ...BULK_LIBRARY, type: "group" }),
    );
  });

  it("leaves out a Library that is no personal or group Library", () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec(
      "insert into libraries (libraryID, type, editable, filesEditable) values (7, 'feed', 0, 0)",
    );

    expect(read(scenario)).toEqual([PERSONAL, METHODS_GROUP]);
  });

  it("reads the lowest layout with a version stamp outside the supported range", () => {
    using scenario = openScenarioDatabase({ layout: "lowest" });
    scenario.sqlite.exec(
      "update version set version = 999 where schema = 'userdata'",
    );

    expect(read(scenario)).toEqual([
      { ...PERSONAL, clientVersion: null },
      { ...METHODS_GROUP, clientVersion: null },
    ]);
  });
});
