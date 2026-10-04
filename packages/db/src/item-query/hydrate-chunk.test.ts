import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_ITEMS } from "@/test-scenario";
import type { ScenarioDatabase, ScenarioItemName } from "@/test-scenario";

import {
  HYDRATE_CHUNK_SIZE,
  ItemQueryDatabase,
  readFieldVocabulary,
  readHydrateChunk,
} from ".";
import type { HydrateFields, HydratedItem } from ".";

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

function itemID(name: ScenarioItemName): number {
  scenario ??= openScenarioDatabase();
  const { key, library } = SCENARIO_ITEMS[name];
  const row = scenario.sqlite
    .prepare("select itemID from items where key = ? and libraryID = ?")
    .get(key, library === "personal" ? 1 : 2) as { itemID: number };
  return row.itemID;
}

function hydrate(
  names: readonly ScenarioItemName[],
  fields: HydrateFields,
): Map<ScenarioItemName, HydratedItem> {
  const ids = names.map(itemID);
  const hydrated = runOk(
    Effect.flatMap(readFieldVocabulary(), (vocabulary) =>
      readHydrateChunk({ vocabulary, itemIDs: ids, fields }),
    ),
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
    const vocabulary = runOk(readFieldVocabulary());

    expect(vocabulary.customFieldNames).toEqual([
      "review.status",
      "mood",
      "title",
      "publicationTitle",
    ]);
  });
});

describe("readHydrateChunk", () => {
  it("loads only the requested built-in and custom fields of each Item", () => {
    const items = hydrate(["fullDateArticle", "missingDateReport"], {
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

  it("resolves a base field through the type-specific field of the item type", () => {
    const items = hydrate(
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
    const items = hydrate(["aliasConflictChapter"], {
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
    const items = hydrate(["tieFirst", "tieSecond"], {
      builtIn: ["volume"],
      custom: [],
    });

    expect(plain(items.get("tieFirst"))?.fields).toEqual({ volume: "12" });
    expect(plain(items.get("tieSecond"))?.fields).toEqual({ volume: "12" });
  });

  it("gives an entry for every Item of the chunk, also one with no values", () => {
    const items = hydrate(["tieUntitled"], { builtIn: ["title"], custom: [] });

    expect(plain(items.get("tieUntitled"))).toEqual({ fields: {}, custom: {} });
  });

  it("rejects a chunk larger than the chunk size", () => {
    expect(HYDRATE_CHUNK_SIZE).toBe(250);
    const ids = Array.from({ length: 251 }, (_, i) => i + 1);

    expect(() =>
      runOk(
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
