import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";

import {
  ItemQueryDatabase,
  readAnnotationScanPage,
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  readAnnotationUniverseRows,
  readAnnotationHydrateChunk,
  readFieldVocabulary,
} from ".";

it("scans only live annotations of live attached Items, across keyset pages", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const rows = run(readAnnotationScanPage({ libraryID: 1, afterKey: null }));
  expect(rows.map((row) => row.key)).toEqual([
    "ANL2IMAG",
    "ANL2INK2",
    "ANL2TEXT",
    "ANL2UNDR",
    "ANN2BAD2",
    "ANN2HGHT",
    "ANN2IMAG",
    "ANN2INK2",
    "ANN2LINK",
    "ANN2NOTE",
    "ANN2TEXT",
    "ANN2UNDR",
  ]);
  expect(
    run(
      readAnnotationScanPage({ libraryID: 1, afterKey: "ANN2INK2", size: 2 }),
    ).map((row) => row.key),
  ).toEqual(["ANN2LINK", "ANN2NOTE"]);
  expect(
    run(
      readAnnotationScanPage({
        libraryID: SCENARIO_LIBRARIES.group.libraryID,
        afterKey: null,
      }),
    ).map((row) => row.key),
  ).toEqual(["ANN2GRUP"]);
  const excluded = scenario.sqlite
    .prepare(
      "select itemID from items where key in ('ANN2TRSH', 'ANN2DEAD', 'ANN2GONE', 'ANN2SOLO', 'ANN2GRUP')",
    )
    .all() as { itemID: number }[];
  expect(
    run(
      readAnnotationUniverseRows({
        libraryID: 1,
        itemIDs: [
          ...rows.map((row) => row.itemID),
          ...excluded.map((row) => row.itemID),
        ],
      }),
    ),
  ).toEqual(rows);
  const hydrated = run(
    readAnnotationHydrateChunk({
      rows,
      vocabulary: run(readFieldVocabulary()),
      fields: { builtIn: ["title", "citationKey"], custom: [] },
    }),
  );
  expect(
    hydrated.get(rows.find((row) => row.key === "ANN2UNDR")!.itemID),
  ).toMatchObject({
    text: "A <i>formatted</i> excerpt",
    comment: "<b>Comment</b>",
    tags: ["method"],
    parent: {
      fields: new Map([["title", "Exact Matching in Literature Review"]]),
    },
  });
  expect(
    hydrated.get(rows.find((row) => row.key === "ANN2BAD2")!.itemID)?.position,
  ).toBe("invalid JSON");
});

it("counts the live Annotation universe and applies a candidate limit after the parent join", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  expect(run(readAnnotationRowCount(1))).toBe(12);
  expect(run(readAnnotationRowCount(SCENARIO_LIBRARIES.group.libraryID))).toBe(
    1,
  );
  const candidates = run(
    readAnnotationCandidateSet({
      libraryID: 1,
      leaf: { kind: "parent", leaf: { kind: "key", key: "ART2FULL" } },
      limit: 4,
    }),
  );
  expect(candidates).toHaveLength(4);
  const live = run(
    readAnnotationUniverseRows({ libraryID: 1, itemIDs: candidates }),
  );
  expect(live.every((row) => row.parent.key === "ART2FULL")).toBe(true);
  expect(
    run(
      readAnnotationCandidateSet({
        libraryID: SCENARIO_LIBRARIES.group.libraryID,
        leaf: { kind: "parent", leaf: { kind: "key", key: "ART2FULL" } },
        limit: 4,
      }),
    ),
  ).toHaveLength(1);
});
