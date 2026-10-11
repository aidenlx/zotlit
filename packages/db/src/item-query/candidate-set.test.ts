import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  readCandidateSet,
  readCollectionPaths,
  readFieldVocabulary,
  readLibraryRowCount,
} from ".";

function runOk<A, E>(
  scenario: ScenarioDatabase,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
): A {
  const exit = Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
  );
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return exit.value;
}

const { personal, group } = SCENARIO_LIBRARIES;

/** The keys of the `items` rows with these IDs, in key order. */
function keysOf(
  scenario: ScenarioDatabase,
  itemIDs: readonly number[],
): string[] {
  const key = scenario.sqlite.prepare("select key from items where itemID = ?");
  return itemIDs
    .map((itemID) => (key.get(itemID) as { key: string }).key)
    .toSorted();
}

describe("readLibraryRowCount", () => {
  it("counts every `items` row of one Library: top-level, child, and trashed", () => {
    using scenario = openScenarioDatabase();
    // 10 live top-level Items, 1 trashed Item, 2 Attachments, 1 Annotation,
    // and 1 Child Note.
    expect(runOk(scenario, readLibraryRowCount(personal.libraryID))).toBe(15);
    // 2 live Items and 1 trashed Item.
    expect(runOk(scenario, readLibraryRowCount(group.libraryID))).toBe(3);
  });

  it("gives zero for a Library without Items", () => {
    using scenario = openScenarioDatabase();
    expect(runOk(scenario, readLibraryRowCount(987))).toBe(0);
  });
});

describe("readCandidateSet", () => {
  const candidates =
    (scenario: ScenarioDatabase) =>
    (
      library: { libraryID: number },
      leaf: Parameters<typeof readCandidateSet>[0]["leaf"],
      limit = 100,
    ) =>
      keysOf(
        scenario,
        runOk(
          scenario,
          readCandidateSet({ libraryID: library.libraryID, leaf, limit }),
        ),
      );

  it("gives the Items of the Target Library that carry a Tag, trashed Items included", () => {
    using scenario = openScenarioDatabase();
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "to-read" }),
    ).toEqual(["ART2FULL", "BK2MNTH2", "TRS2SHED"]);
    expect(
      candidates(scenario)(group, { kind: "tag", value: "to-read" }),
    ).toEqual(["ART2FULL"]);
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "group-only" }),
    ).toEqual([]);
  });

  it("gives the Item IDs of the Target Library, not those of the other Library", () => {
    using scenario = openScenarioDatabase();
    const ids = (library: { libraryID: number }) =>
      runOk(
        scenario,
        readCandidateSet({
          libraryID: library.libraryID,
          leaf: { kind: "tag", value: "to-read" },
          limit: 100,
        }),
      );

    expect(ids(personal)).not.toEqual(expect.arrayContaining(ids(group)));
  });

  it("matches a Tag by its exact name", () => {
    using scenario = openScenarioDatabase();
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "To-Read" }),
    ).toEqual(["ART2FULL"]);
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "TO-READ" }),
    ).toEqual([]);
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "to-rea_" }),
    ).toEqual([]);
  });

  it("gives the Item that has a Zotero Key inside the Target Library", () => {
    using scenario = openScenarioDatabase();
    const [personalID] = runOk(
      scenario,
      readCandidateSet({
        libraryID: personal.libraryID,
        leaf: { kind: "key", key: "ART2FULL" },
        limit: 100,
      }),
    );
    const [groupID] = runOk(
      scenario,
      readCandidateSet({
        libraryID: group.libraryID,
        leaf: { kind: "key", key: "ART2FULL" },
        limit: 100,
      }),
    );

    expect(personalID).toEqual(expect.any(Number));
    expect(groupID).toEqual(expect.any(Number));
    expect(personalID).not.toBe(groupID);
    expect(
      candidates(scenario)(personal, { kind: "key", key: "GRP2BK22" }),
    ).toEqual([]);
    // A child row is a candidate; the universe restriction removes it.
    expect(
      candidates(scenario)(personal, { kind: "key", key: "PDF2LIVE" }),
    ).toEqual(["PDF2LIVE"]);
  });

  // Failure modes: list selection crosses Libraries, duplicates IDs, or exceeds its cap.
  it("reads a bounded set of keys inside one Target Library", () => {
    using scenario = openScenarioDatabase();
    const leaf = {
      kind: "keys" as const,
      keys: ["ART2FULL", "ART2FULL", "GRP2BK22", "NOSUCHKY"],
    };
    expect(candidates(scenario)(personal, leaf)).toEqual(["ART2FULL"]);
    expect(candidates(scenario)(group, leaf)).toEqual(["ART2FULL", "GRP2BK22"]);
    expect(candidates(scenario)(group, leaf, 1)).toHaveLength(1);
    expect(candidates(scenario)(personal, { kind: "keys", keys: [] })).toEqual(
      [],
    );
  });

  it("reads at most `limit` Item IDs", () => {
    using scenario = openScenarioDatabase();
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "to-read" }, 2),
    ).toHaveLength(2);
    expect(
      candidates(scenario)(personal, { kind: "tag", value: "to-read" }, 3),
    ).toEqual(["ART2FULL", "BK2MNTH2", "TRS2SHED"]);
  });
});

describe("readCandidateSet for a field value", () => {
  const fieldCandidates =
    (scenario: ScenarioDatabase) =>
    (
      library: { libraryID: number },
      [name, value]: readonly [name: string, value: string],
      limit = 100,
    ) =>
      keysOf(
        scenario,
        runOk(
          scenario,
          Effect.flatMap(readFieldVocabulary(), (vocabulary) =>
            readCandidateSet({
              libraryID: library.libraryID,
              leaf: {
                kind: "field",
                fieldIDs: vocabulary.fieldIDsOf(name),
                value,
              },
              limit,
            }),
          ),
        ),
      );

  it("gives the Items that store the value as text and as a number", () => {
    using scenario = openScenarioDatabase();
    // ART2FULL and TIE2AAAA store `volume` as the integer 12, TIE2BBBB as text.
    expect(fieldCandidates(scenario)(personal, ["volume", "12"])).toEqual([
      "ART2FULL",
      "TIE2AAAA",
      "TIE2BBBB",
    ]);
    expect(fieldCandidates(scenario)(personal, ["volume", "12.0"])).toEqual([]);
    expect(fieldCandidates(scenario)(personal, ["volume", "012"])).toEqual([]);
    expect(fieldCandidates(scenario)(personal, ["volume", "1"])).toEqual([]);
  });

  it("covers every field ID of the field's aliases", () => {
    using scenario = openScenarioDatabase();
    // CHP2YEAR stores `bookTitle`, CNF2TEXT `proceedingsTitle`, and
    // RPT2NDTE `institution`.
    expect(
      fieldCandidates(scenario)(personal, [
        "publicationTitle",
        "Handbook of Methods",
      ]),
    ).toEqual(["CHP2YEAR"]);
    expect(
      fieldCandidates(scenario)(personal, [
        "publicationTitle",
        "Proceedings of Testing",
      ]),
    ).toEqual(["CNF2TEXT"]);
    expect(
      fieldCandidates(scenario)(personal, ["publisher", "Lab Institute"]),
    ).toEqual(["RPT2NDTE"]);
    // ALS2CNFL stores both the base field and its type-specific variant.
    expect(
      fieldCandidates(scenario)(personal, [
        "publicationTitle",
        "Type-Specific Host",
      ]),
    ).toEqual(["ALS2CNFL"]);
    expect(
      fieldCandidates(scenario)(personal, [
        "publicationTitle",
        "Base Field Host",
      ]),
    ).toEqual(["ALS2CNFL"]);
  });

  it("reads only the fields of the name and its aliases, not custom fields", () => {
    using scenario = openScenarioDatabase();
    // `title` stores "Custom Title Value" as a custom field of ART2FULL.
    expect(
      fieldCandidates(scenario)(personal, ["title", "Custom Title Value"]),
    ).toEqual([]);
    expect(
      fieldCandidates(scenario)(personal, ["publicationTitle", "Custom Host"]),
    ).toEqual([]);
    expect(
      fieldCandidates(scenario)(personal, ["title", "Journal of Testing"]),
    ).toEqual([]);
  });

  it("matches the exact value inside the Target Library, trashed Items included", () => {
    using scenario = openScenarioDatabase();
    expect(
      fieldCandidates(scenario)(personal, ["title", "Same Title"]),
    ).toEqual(["TIE2AAAA", "TIE2BBBB"]);
    expect(
      fieldCandidates(scenario)(personal, ["title", "same title"]),
    ).toEqual([]);
    expect(
      fieldCandidates(scenario)(personal, ["title", "Same Titl_"]),
    ).toEqual([]);
    expect(
      fieldCandidates(scenario)(personal, ["title", "Trashed Article"]),
    ).toEqual(["TRS2SHED"]);
    expect(
      fieldCandidates(scenario)(personal, ["publisher", "Group Press"]),
    ).toEqual([]);
    expect(
      fieldCandidates(scenario)(group, ["publisher", "Group Press"]),
    ).toEqual(["GRP2BK22"]);
  });

  it("gives each Item once and reads at most `limit` Item IDs", () => {
    using scenario = openScenarioDatabase();
    expect(
      fieldCandidates(scenario)(personal, ["volume", "12"], 2),
    ).toHaveLength(2);
    expect(
      fieldCandidates(scenario)(personal, ["volume", "12"], 3),
    ).toHaveLength(3);
  });
});

describe("readCandidateSet for Collections", () => {
  /** The live Collection IDs of a Library whose joined path passes `test`. */
  const collectionIDs = (
    scenario: ScenarioDatabase,
    library: { libraryID: number },
    test: (path: string) => boolean,
  ) =>
    [...runOk(scenario, readCollectionPaths(library))]
      .filter(([, path]) => test(path.join("/")))
      .map(([collectionID]) => collectionID);

  const collectionCandidates =
    (scenario: ScenarioDatabase) =>
    (library: { libraryID: number }, ids: readonly number[], limit = 100) =>
      keysOf(
        scenario,
        runOk(
          scenario,
          readCandidateSet({
            libraryID: library.libraryID,
            leaf: { kind: "collection", collectionIDs: ids },
            limit,
          }),
        ),
      );

  it("gives the Items filed directly in the Collections, trashed Items included", () => {
    using scenario = openScenarioDatabase();
    expect(
      collectionCandidates(scenario)(
        personal,
        collectionIDs(scenario, personal, (path) => path === "Thesis/Methods"),
      ),
    ).toEqual(["ART2FULL", "CHP2YEAR", "TRS2SHED"]);
    expect(
      collectionCandidates(scenario)(
        personal,
        collectionIDs(scenario, personal, (path) => path === "Thesis"),
      ),
    ).toEqual(["CHP2YEAR"]);
    expect(collectionCandidates(scenario)(personal, [])).toEqual([]);
  });

  it("gives separate sets for two Collections with the same name", () => {
    using scenario = openScenarioDatabase();
    expect(
      collectionCandidates(scenario)(
        personal,
        collectionIDs(
          scenario,
          personal,
          (path) => path === "Teaching/Methods",
        ),
      ),
    ).toEqual(["BK2MNTH2"]);
    expect(
      collectionCandidates(scenario)(
        group,
        collectionIDs(scenario, group, (path) => path === "Methods"),
      ),
    ).toEqual(["GRP2BK22"]);
  });

  it("gives each Item once, inside the Target Library, at most `limit` of them", () => {
    using scenario = openScenarioDatabase();
    const thesis = collectionIDs(scenario, personal, (path) =>
      path.startsWith("Thesis"),
    );

    expect(collectionCandidates(scenario)(personal, thesis)).toEqual([
      "ART2FULL",
      "CHP2YEAR",
      "TRS2SHED",
    ]);
    expect(collectionCandidates(scenario)(personal, thesis, 2)).toHaveLength(2);
    expect(
      collectionCandidates(scenario)(
        group,
        collectionIDs(scenario, personal, (path) => path === "Thesis/Methods"),
      ),
    ).toEqual([]);
  });
});
