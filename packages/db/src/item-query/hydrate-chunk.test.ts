import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_ITEMS } from "@/test-scenario";
import type { ScenarioDatabase, ScenarioItemName } from "@/test-scenario";

import {
  HYDRATE_CHUNK_SIZE,
  ItemQueryDatabase,
  ItemQueryStatementObserver,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
} from ".";
import type { HydrateFields, HydratedItem, HydrateRelation } from ".";

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

function itemID(scenario: ScenarioDatabase, name: ScenarioItemName): number {
  const { key, library } = SCENARIO_ITEMS[name];
  const row = scenario.sqlite
    .prepare("select itemID from items where key = ? and libraryID = ?")
    .get(key, library === "personal" ? 1 : 2) as { itemID: number };
  return row.itemID;
}

function hydrate(
  scenario: ScenarioDatabase,
  names: readonly ScenarioItemName[],
  fields: HydrateFields,
): Map<ScenarioItemName, HydratedItem> {
  const ids = names.map((name) => itemID(scenario, name));
  const hydrated = runOk(
    scenario,
    Effect.flatMap(readFieldVocabulary(), (vocabulary) =>
      readHydrateChunk({ vocabulary, itemIDs: ids, fields }),
    ),
  );
  return new Map(names.map((name, i) => [name, hydrated.get(ids[i]!)!]));
}

function hydrateRelations(
  scenario: ScenarioDatabase,
  names: readonly ScenarioItemName[],
  relations: readonly HydrateRelation[],
): Map<ScenarioItemName, HydratedItem> {
  const ids = names.map((name) => itemID(scenario, name));
  const hydrated = runOk(
    scenario,
    Effect.gen(function* () {
      const vocabulary = yield* readFieldVocabulary();
      const collectionPaths = yield* readCollectionPaths({ libraryID: 1 });
      return yield* readHydrateChunk({
        vocabulary,
        itemIDs: ids,
        fields: { builtIn: [], custom: [] },
        relations,
        collectionPaths,
      });
    }),
  );
  return new Map(names.map((name, i) => [name, hydrated.get(ids[i]!)!]));
}

const plain = (item: HydratedItem | undefined) =>
  item && {
    fields: Object.fromEntries(item.fields),
    custom: Object.fromEntries(item.custom),
  };

describe("readFieldVocabulary", () => {
  it("lists the custom fields of the source by exact name", () => {
    using scenario = openScenarioDatabase();
    const vocabulary = runOk(scenario, readFieldVocabulary());

    expect(vocabulary.customFieldNames).toEqual([
      "review.status",
      "mood",
      "title",
      "publicationTitle",
    ]);
  });
});

describe("readCollectionPaths", () => {
  it("gives the root-first path of each live Collection of one Library", () => {
    using scenario = openScenarioDatabase();
    const personalPaths = runOk(
      scenario,
      readCollectionPaths({ libraryID: 1 }),
    );
    const groupPaths = runOk(scenario, readCollectionPaths({ libraryID: 2 }));

    // Archive is trashed; Archive/Old is live below it.
    expect([...personalPaths.values()]).toHaveLength(4);
    expect([...personalPaths.values()]).toEqual(
      expect.arrayContaining([
        ["Thesis"],
        ["Thesis", "Methods"],
        ["Teaching"],
        ["Teaching", "Methods"],
      ]),
    );
    expect([...groupPaths.values()]).toEqual([["Methods"]]);
  });
});

describe("readHydrateChunk", () => {
  it("loads only the requested built-in and custom fields of each Item", () => {
    using scenario = openScenarioDatabase();
    const items = hydrate(scenario, ["fullDateArticle", "missingDateReport"], {
      builtIn: ["title", "DOI"],
      custom: ["review.status"],
    });

    expect(plain(items.get("fullDateArticle"))).toEqual({
      fields: {
        title: "Exact Matching in Literature Review",
        DOI: "10.1234/exact",
      },
      custom: { "review.status": "done" },
    });
    expect(plain(items.get("missingDateReport"))).toEqual({
      fields: { title: "Lab Report" },
      custom: {},
    });
  });

  it("reads the stored values of the requested fields only", () => {
    using scenario = openScenarioDatabase();
    const rows: unknown[] = [];
    const id = itemID(scenario, "yearOnlyChapter");

    runOk(
      scenario,
      Effect.flatMap(readFieldVocabulary(), (vocabulary) =>
        readHydrateChunk({
          vocabulary,
          itemIDs: [id],
          fields: { builtIn: ["title"], custom: [] },
        }),
      ).pipe(
        Effect.provideService(ItemQueryStatementObserver, (run) => {
          if (run.reader === "hydrate-chunk") rows.push(...run.rows);
        }),
      ),
    );

    // The chapter also stores `bookTitle`, a type-specific field of another
    // base field.
    expect(rows).toEqual([
      expect.objectContaining({ itemID: id, value: "A Chapter on Sampling" }),
    ]);
  });

  it("resolves a base field through the type-specific field of the item type", () => {
    using scenario = openScenarioDatabase();
    const items = hydrate(
      scenario,
      ["yearOnlyChapter", "textDateConference", "missingDateReport"],
      { builtIn: ["publicationTitle", "publisher"], custom: [] },
    );

    expect(plain(items.get("yearOnlyChapter"))?.fields).toEqual({
      publicationTitle: "Handbook of Methods",
      publisher: "Sage",
    });
    expect(plain(items.get("textDateConference"))?.fields).toEqual({
      publicationTitle: "Proceedings of Testing",
    });
    expect(plain(items.get("missingDateReport"))?.fields).toEqual({
      publisher: "Lab Institute",
    });
  });

  it("prefers the type-specific field in an alias conflict and keeps custom fields apart", () => {
    using scenario = openScenarioDatabase();
    const items = hydrate(scenario, ["aliasConflictChapter"], {
      builtIn: ["publicationTitle", "bookTitle"],
      custom: ["publicationTitle"],
    });

    expect(plain(items.get("aliasConflictChapter"))).toEqual({
      fields: {
        publicationTitle: "Type-Specific Host",
        bookTitle: "Type-Specific Host",
      },
      custom: { publicationTitle: "Custom Host" },
    });
  });

  it("gives a value stored as an integer as a string", () => {
    using scenario = openScenarioDatabase();
    const items = hydrate(scenario, ["tieFirst", "tieSecond"], {
      builtIn: ["volume"],
      custom: [],
    });

    expect(plain(items.get("tieFirst"))?.fields).toEqual({ volume: "12" });
    expect(plain(items.get("tieSecond"))?.fields).toEqual({ volume: "12" });
  });

  it("gives an entry for every Item of the chunk, also one with no values", () => {
    using scenario = openScenarioDatabase();
    const items = hydrate(scenario, ["tieUntitled"], {
      builtIn: ["title"],
      custom: [],
    });

    expect(plain(items.get("tieUntitled"))).toEqual({ fields: {}, custom: {} });
  });

  it("loads the Creators of each Item in Zotero's creator order, one for each row", () => {
    using scenario = openScenarioDatabase();
    const items = hydrateRelations(
      scenario,
      ["yearMonthBook", "fullDateArticle", "missingDateReport"],
      ["creators"],
    );

    expect(items.get("yearMonthBook")?.creators).toEqual([
      {
        firstName: "Grace",
        lastName: "Hopper",
        fieldMode: 0,
        creatorType: "author",
      },
      {
        firstName: "Grace",
        lastName: "Hopper",
        fieldMode: 0,
        creatorType: "editor",
      },
    ]);
    expect(items.get("fullDateArticle")?.creators).toEqual([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        fieldMode: 0,
        creatorType: "author",
      },
      {
        firstName: "",
        lastName: "World Health Organization",
        fieldMode: 1,
        creatorType: "author",
      },
    ]);
    expect(items.get("missingDateReport")?.creators).toEqual([]);
  });

  it("loads every Tag of each Item with its type", () => {
    using scenario = openScenarioDatabase();
    const items = hydrateRelations(
      scenario,
      ["fullDateArticle", "missingDateReport"],
      ["tags"],
    );

    expect(items.get("fullDateArticle")?.tags).toHaveLength(3);
    expect(items.get("fullDateArticle")?.tags).toEqual(
      expect.arrayContaining([
        { name: "to-read", type: 0 },
        { name: "To-Read", type: 1 },
        { name: "methods", type: 0 },
      ]),
    );
    expect(items.get("missingDateReport")?.tags).toEqual([]);
  });

  it("loads the root-first path of each live Collection an Item is filed in", () => {
    using scenario = openScenarioDatabase();
    const items = hydrateRelations(
      scenario,
      ["fullDateArticle", "yearMonthBook", "yearOnlyChapter", "tieFirst"],
      ["collections"],
    );

    // ART2FULL is also in Archive/Old, below the trashed Archive.
    expect(items.get("fullDateArticle")?.collections).toEqual([
      ["Thesis", "Methods"],
    ]);
    // BK2MNTH2 is also in the trashed Archive.
    expect(items.get("yearMonthBook")?.collections).toEqual([
      ["Teaching", "Methods"],
    ]);
    expect(items.get("yearOnlyChapter")?.collections).toHaveLength(2);
    expect(items.get("yearOnlyChapter")?.collections).toEqual(
      expect.arrayContaining([["Thesis"], ["Thesis", "Methods"]]),
    );
    expect(items.get("tieFirst")?.collections).toEqual([]);
  });

  it("reports whether an Item has a live child Attachment", () => {
    using scenario = openScenarioDatabase();
    const items = hydrateRelations(
      scenario,
      ["fullDateArticle", "missingDateReport"],
      ["attachments"],
    );

    expect(items.get("fullDateArticle")?.hasAttachments).toBe(true);
    expect(items.get("missingDateReport")?.hasAttachments).toBe(false);
  });

  it("ignores a trashed Attachment", () => {
    // ART2FULL keeps only its trashed Attachment.
    using scenario = openScenarioDatabase();
    scenario.sqlite
      .prepare(
        "insert into deletedItems (itemID, dateDeleted) values (?, '2024-01-01 00:00:00')",
      )
      .run(itemID(scenario, "liveAttachment"));

    const items = hydrateRelations(
      scenario,
      ["fullDateArticle"],
      ["attachments"],
    );

    expect(items.get("fullDateArticle")?.hasAttachments).toBe(false);
  });

  it("rejects a chunk larger than the chunk size", () => {
    using scenario = openScenarioDatabase();
    expect(HYDRATE_CHUNK_SIZE).toBe(250);
    const ids = Array.from({ length: 251 }, (_, i) => i + 1);

    expect(() =>
      runOk(
        scenario,
        Effect.flatMap(readFieldVocabulary(), (vocabulary) =>
          readHydrateChunk({
            vocabulary,
            itemIDs: ids,
            fields: { builtIn: ["title"], custom: [] },
          }),
        ),
      ),
    ).toThrow(/250/);
  });
});
