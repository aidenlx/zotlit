import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import { ItemQueryDatabase, readCandidateSet, readLibraryRowCount } from ".";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

function runOk<A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>): A {
  scenario ??= openScenarioDatabase();
  const exit = Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return exit.value;
}

const { personal, group } = SCENARIO_LIBRARIES;

/** The keys of the `items` rows with these IDs, in key order. */
function keysOf(itemIDs: readonly number[]): string[] {
  const key = scenario!.sqlite.prepare(
    "select key from items where itemID = ?",
  );
  return itemIDs
    .map((itemID) => (key.get(itemID) as { key: string }).key)
    .toSorted();
}

describe("readLibraryRowCount", () => {
  it("counts every `items` row of one Library: top-level, child, and trashed", () => {
    // 10 live top-level Items, 1 trashed Item, 2 Attachments, 1 Annotation,
    // and 1 Child Note.
    expect(runOk(readLibraryRowCount(personal.libraryID))).toBe(15);
    // 2 live Items and 1 trashed Item.
    expect(runOk(readLibraryRowCount(group.libraryID))).toBe(3);
  });

  it("gives zero for a Library without Items", () => {
    expect(runOk(readLibraryRowCount(987))).toBe(0);
  });
});

describe("readCandidateSet", () => {
  const candidates = (
    library: { libraryID: number },
    leaf: Parameters<typeof readCandidateSet>[0]["leaf"],
    limit = 100,
  ) =>
    keysOf(
      runOk(readCandidateSet({ libraryID: library.libraryID, leaf, limit })),
    );

  it("gives the Items of the Target Library that carry a Tag, trashed Items included", () => {
    expect(candidates(personal, { kind: "tag", name: "to-read" })).toEqual([
      "ART2FULL",
      "BK2MNTH2",
      "TRS2SHED",
    ]);
    expect(candidates(group, { kind: "tag", name: "to-read" })).toEqual([
      "ART2FULL",
    ]);
    expect(candidates(personal, { kind: "tag", name: "group-only" })).toEqual(
      [],
    );
  });

  it("gives the Item IDs of the Target Library, not those of the other Library", () => {
    const ids = (library: { libraryID: number }) =>
      runOk(
        readCandidateSet({
          libraryID: library.libraryID,
          leaf: { kind: "tag", name: "to-read" },
          limit: 100,
        }),
      );

    expect(ids(personal)).not.toEqual(expect.arrayContaining(ids(group)));
  });

  it("matches a Tag by its exact name", () => {
    expect(candidates(personal, { kind: "tag", name: "To-Read" })).toEqual([
      "ART2FULL",
    ]);
    expect(candidates(personal, { kind: "tag", name: "TO-READ" })).toEqual([]);
    expect(candidates(personal, { kind: "tag", name: "to-rea_" })).toEqual([]);
  });

  it("gives the Item that has a Zotero Key inside the Target Library", () => {
    const [personalID] = runOk(
      readCandidateSet({
        libraryID: personal.libraryID,
        leaf: { kind: "key", key: "ART2FULL" },
        limit: 100,
      }),
    );
    const [groupID] = runOk(
      readCandidateSet({
        libraryID: group.libraryID,
        leaf: { kind: "key", key: "ART2FULL" },
        limit: 100,
      }),
    );

    expect(personalID).toEqual(expect.any(Number));
    expect(groupID).toEqual(expect.any(Number));
    expect(personalID).not.toBe(groupID);
    expect(candidates(personal, { kind: "key", key: "GRP2BK22" })).toEqual([]);
    // A child row is a candidate; the universe restriction removes it.
    expect(candidates(personal, { kind: "key", key: "PDF2LIVE" })).toEqual([
      "PDF2LIVE",
    ]);
  });

  it("reads at most `limit` Item IDs", () => {
    expect(
      candidates(personal, { kind: "tag", name: "to-read" }, 2),
    ).toHaveLength(2);
    expect(candidates(personal, { kind: "tag", name: "to-read" }, 3)).toEqual([
      "ART2FULL",
      "BK2MNTH2",
      "TRS2SHED",
    ]);
  });
});
