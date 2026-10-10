import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";

import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
  readCollectionPaths,
  readAttachmentCandidateSet,
  readAttachmentScanPage,
  readAttachmentUniverseRows,
  readAttachmentRowCount,
  readAttachmentHydrateChunk,
} from ".";

it("reads only live Attachments of top-level live Items in the Target Library", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const rows = run(readAttachmentScanPage({ libraryID: 1, afterKey: null }));
  expect(rows.map((row) => row.key)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  expect(
    run(
      readAttachmentScanPage({ libraryID: 1, afterKey: "PDF2LINK", size: 1 }),
    ),
  ).toEqual([rows[1]]);
  expect(run(readAttachmentRowCount(1))).toBe(4);
  expect(
    run(
      readAttachmentScanPage({
        libraryID: SCENARIO_LIBRARIES.group.libraryID,
        afterKey: null,
      }),
    ).map((row) => row.key),
  ).toEqual(["PDF2GRUP"]);
  const ids = (
    scenario.sqlite.prepare("select itemID from itemAttachments").all() as {
      itemID: number;
    }[]
  ).map((row) => row.itemID);
  expect(
    run(readAttachmentUniverseRows({ libraryID: 1, itemIDs: ids })),
  ).toEqual(rows);
  const hydrated = run(
    readAttachmentHydrateChunk({ rows, details: true, tags: true }),
  );
  expect(hydrated.get(rows[1]!.itemID)).toMatchObject({
    details: {
      title: "Full Text PDF",
      contentType: "application/pdf",
      linkMode: 0,
    },
    tags: [],
  });
});

it("finds bounded candidates through Attachment fields and parent Collections", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const ids = run(
    readAttachmentCandidateSet({
      libraryID: 1,
      leaf: { kind: "key", value: "PDF2LINK" },
      limit: 1,
    }),
  );
  expect(
    run(readAttachmentUniverseRows({ libraryID: 1, itemIDs: ids })).map(
      (row) => row.key,
    ),
  ).toEqual(["PDF2LINK"]);
  expect(
    run(
      readAttachmentCandidateSet({
        libraryID: 1,
        leaf: { kind: "contentType", value: "application/pdf" },
        limit: 1,
      }),
    ),
  ).toHaveLength(1);
});

it("reads Tags and parent Collection candidates in one statement per requested chunk", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const readers: string[] = [];
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      effect.pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        Effect.provideService(ItemQueryStatementObserver, (statement) => {
          readers.push(statement.reader);
        }),
      ),
    );
  const collectionIDs = [...run(readCollectionPaths({ libraryID: 1 }))]
    .filter(([, path]) => path.join("/") === "Thesis/Methods")
    .map(([id]) => id);
  const live = (
    leaf: Parameters<typeof readAttachmentCandidateSet>[0]["leaf"],
  ) =>
    run(
      readAttachmentUniverseRows({
        libraryID: 1,
        itemIDs: run(
          readAttachmentCandidateSet({ libraryID: 1, leaf, limit: 100 }),
        ),
      }),
    ).map((row) => row.key);
  expect(live({ kind: "tag", value: "attachment-method" })).toEqual([
    "PDF2LINK",
  ]);
  expect(live({ kind: "linkMode", value: "linked_url" })).toEqual(["URL2LIVE"]);
  expect(
    live({ kind: "parent", leaf: { kind: "collection", collectionIDs } }),
  ).toEqual(["PDF2LINK", "PDF2LIVE", "URL2LIVE", "WEB2LIVE"]);
  const rows = run(readAttachmentScanPage({ libraryID: 1, afterKey: null }));
  readers.length = 0;
  run(readAttachmentHydrateChunk({ rows }));
  expect(readers).toEqual([]);
  const tagged = run(readAttachmentHydrateChunk({ rows, tags: true }));
  expect(readers).toEqual(["attachment-tags"]);
  expect(tagged.get(rows[0]!.itemID)).toEqual({ tags: ["attachment-method"] });
  readers.length = 0;
  run(readAttachmentHydrateChunk({ rows, details: true }));
  expect(readers).toEqual(["attachment-details"]);
});

it("reads bounded Attachment and parent key lists inside one Library", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const live = (
    libraryID: number,
    leaf: Parameters<typeof readAttachmentCandidateSet>[0]["leaf"],
  ) =>
    run(
      readAttachmentUniverseRows({
        libraryID,
        itemIDs: run(
          readAttachmentCandidateSet({ libraryID, leaf, limit: 100 }),
        ),
      }),
    ).map((row) => row.key);
  expect(
    live(1, {
      kind: "keys",
      keys: [
        "PDF2LIVE",
        "PDF2TRSH",
        "PDF2SOLO",
        "PDF2DEAD",
        "PDF2CHLD",
        "PDF2GRUP",
      ],
    }),
  ).toEqual(["PDF2LIVE"]);
  expect(
    live(SCENARIO_LIBRARIES.group.libraryID, {
      kind: "keys",
      keys: ["PDF2LIVE", "PDF2GRUP"],
    }),
  ).toEqual(["PDF2GRUP"]);
  expect(
    live(1, { kind: "parent", leaf: { kind: "keys", keys: ["ART2FULL"] } }),
  ).toEqual(["PDF2LINK", "PDF2LIVE", "URL2LIVE", "WEB2LIVE"]);
  expect(live(1, { kind: "keys", keys: [] })).toEqual([]);
  expect(
    run(
      readAttachmentCandidateSet({
        libraryID: 1,
        leaf: { kind: "parent", leaf: { kind: "keys", keys: ["ART2FULL"] } },
        limit: 2,
      }),
    ),
  ).toHaveLength(2);
});

// Failure modes: web links retain their MIME kind, missing MIME is omitted,
// or a candidate read crosses the requested Library.
it.each([
  ["application/pdf", 0, "pdf"],
  ["application/epub+zip", 0, "epub"],
  ["text/html", 1, "web"],
  ["application/xhtml+xml", 1, "web"],
  ["application/pdf", 3, "web"],
  [null, 0, "other"],
  ["image/png", 0, "other"],
] as const)(
  "finds fileType candidates for %s, link mode %s",
  (contentType, linkMode, expected) => {
    using scenario = openScenarioDatabase({ annotations: true });
    scenario.sqlite
      .prepare("update itemAttachments set contentType = ?, linkMode = ?")
      .run(contentType, linkMode);
    const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
      Effect.runSync(
        Effect.provideService(effect, ItemQueryDatabase, {
          client: scenario.db,
        }),
      );
    for (const value of ["pdf", "epub", "web", "other", "unknown"]) {
      const candidates = run(
        readAttachmentCandidateSet({
          libraryID: 1,
          leaf: { kind: "fileType", value },
          limit: 100,
        }),
      );
      const rows = run(
        readAttachmentUniverseRows({ libraryID: 1, itemIDs: candidates }),
      );
      expect(rows.map((row) => row.key)).toEqual(
        value === expected
          ? ["PDF2LINK", "PDF2LIVE", "URL2LIVE", "WEB2LIVE"]
          : [],
      );
    }
  },
);
