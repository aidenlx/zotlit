import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import { ItemQueryDatabase, readTargetLibrary } from ".";
import type { TargetLibrarySelector } from ".";

function read(scenario: ScenarioDatabase, selector: TargetLibrarySelector) {
  return Effect.runSync(
    Effect.provideService(readTargetLibrary(selector), ItemQueryDatabase, {
      client: scenario.db,
    }),
  );
}

describe("readTargetLibrary", () => {
  it("gives the personal Library and a group Library by its group ID", () => {
    using scenario = openScenarioDatabase();

    expect(read(scenario, { type: "personal" })).toEqual({
      libraryID: 1,
      groupID: null,
      name: null,
    });
    expect(read(scenario, { type: "group", groupID: 4815 })).toEqual({
      libraryID: 2,
      groupID: 4815,
      name: "Methods Reading Group",
    });
  });

  it("gives null for a group that the copy does not hold", () => {
    using scenario = openScenarioDatabase();

    expect(read(scenario, { type: "group", groupID: 987 })).toBeNull();
  });

  it("reads the lowest layout with a version stamp outside the supported range", () => {
    using scenario = openScenarioDatabase({ layout: "lowest" });
    scenario.sqlite.exec(
      "update version set version = 999 where schema = 'userdata'",
    );

    expect(read(scenario, { type: "group", groupID: 4815 })).toMatchObject({
      libraryID: 2,
    });
  });
});
