import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";

import {
  ItemQueryDatabase,
  readAnnotationScanPage,
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  readAnnotationAttachmentCandidateSet,
  readAnnotationUniverseRows,
  readAnnotationHydrateChunk,
  ItemQueryStatementObserver,
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
      details: true,
      tags: true,
      attachmentTitle: true,
    }),
  );
  expect(
    hydrated.get(rows.find((row) => row.key === "ANN2UNDR")!.itemID),
  ).toMatchObject({
    details: { text: "A <i>formatted</i> excerpt", comment: "<b>Comment</b>" },
    tags: ["method"],
    attachmentTitle: "Full Text PDF",
  });
  expect(
    hydrated.get(rows.find((row) => row.key === "ANN2BAD2")!.itemID)?.details
      ?.position,
  ).toBe("invalid JSON");
});

it("runs one statement for each load the caller names, and none for an unnamed load", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const readers: string[] = [];
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      effect.pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        Effect.provideService(ItemQueryStatementObserver, (statement) => {
          if (statement.reader !== "layout") readers.push(statement.reader);
        }),
      ),
    );
  const rows = run(readAnnotationScanPage({ libraryID: 1, afterKey: null }));
  readers.length = 0;
  const bare = run(readAnnotationHydrateChunk({ rows }));
  expect(readers).toEqual([]);
  expect([...bare.values()]).toEqual(rows.map(() => ({})));
  expect([...bare.keys()]).toEqual(rows.map((row) => row.itemID));

  const tagged = run(readAnnotationHydrateChunk({ rows, tags: true }));
  expect(readers).toEqual(["annotation-tags"]);
  const tagless = rows.find((row) => row.key === "ANL2IMAG")!.itemID;
  expect(tagged.get(tagless)).toEqual({ tags: [] });

  readers.length = 0;
  const titled = run(
    readAnnotationHydrateChunk({ rows, attachmentTitle: true }),
  );
  expect(readers).toEqual(["annotation-attachment-titles"]);
  expect(
    titled.get(rows.find((row) => row.key === "ANN2UNDR")!.itemID),
  ).toEqual({ attachmentTitle: "Full Text PDF" });

  readers.length = 0;
  run(readAnnotationHydrateChunk({ rows, details: true }));
  expect(readers).toEqual(["annotation-details"]);
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

// Failure modes: keys select the wrong parent level, cross Libraries, or exceed
// the cap after the parent join. The universe reader proves the returned rows.
it.each([
  ["self", ["ANN2HGHT", "ANN2GRUP"], 1],
  ["item", ["ART2FULL"], 12],
  ["attachment", ["PDF2LIVE", "PDF2GRUP"], 6],
] as const)(
  "reads bounded Annotation key candidates through %s",
  (target, keys, count) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
      Effect.runSync(
        Effect.provideService(effect, ItemQueryDatabase, {
          client: scenario.db,
        }),
      );
    const read = (
      libraryID: number,
      limit: number,
      selected: readonly string[] = keys,
    ) => {
      const leaf = { kind: "keys" as const, keys: selected };
      return target === "attachment"
        ? readAnnotationAttachmentCandidateSet({ libraryID, limit, leaf })
        : readAnnotationCandidateSet({
            libraryID,
            limit,
            leaf: target === "item" ? { kind: "parent", leaf } : leaf,
          });
    };
    const ids = run(read(1, 100));
    expect(
      run(readAnnotationUniverseRows({ libraryID: 1, itemIDs: ids })),
    ).toHaveLength(count);
    expect(run(read(SCENARIO_LIBRARIES.group.libraryID, 100))).toHaveLength(1);
    expect(run(read(1, 1))).toHaveLength(1);
    expect(run(read(1, 100, []))).toEqual([]);
  },
);
