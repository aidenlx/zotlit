import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import { ItemQueryDatabase, readSourceLibraries } from ".";

function read(scenario: ScenarioDatabase) {
  return Effect.runSync(
    Effect.provideService(readSourceLibraries(), ItemQueryDatabase, {
      client: scenario.db,
    }),
  );
}

const PERSONAL = { libraryID: 1, type: "user", groupID: null, name: null };
const METHODS_GROUP = {
  libraryID: 2,
  type: "group",
  groupID: 4815,
  name: "Methods Reading Group",
};

describe("readSourceLibraries", () => {
  it("gives the personal Library first, then each group Library with its group ID and name", () => {
    using scenario = openScenarioDatabase();

    expect(read(scenario)).toEqual([PERSONAL, METHODS_GROUP]);
  });

  it("orders the group Libraries by group ID, whatever their local library IDs are", () => {
    using scenario = openScenarioDatabase();
    // The bulk Library has the higher `libraryID` and the lower group ID.
    seedBulkLibrary(scenario.sqlite, 1);

    expect(read(scenario)).toEqual([
      PERSONAL,
      { ...BULK_LIBRARY, type: "group" },
      METHODS_GROUP,
    ]);
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

    expect(read(scenario)).toEqual([PERSONAL, METHODS_GROUP]);
  });
});
