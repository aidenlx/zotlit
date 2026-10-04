import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
  readCandidateSet,
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
} from ".";
import type { StatementRun } from ".";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

const { personal } = SCENARIO_LIBRARIES;

/** Run a reader and collect the statements it runs. */
function observe<A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) {
  scenario ??= openScenarioDatabase();
  const runs: StatementRun[] = [];
  const exit = Effect.runSyncExit(
    effect.pipe(
      Effect.provideService(ItemQueryStatementObserver, (run) => {
        runs.push(run);
      }),
      Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    ),
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return { value: exit.value, runs };
}

describe("ItemQueryStatementObserver", () => {
  it("reports each statement with its reader and the rows it read", () => {
    const { value, runs } = observe(
      readScanPage({ libraryID: personal.libraryID, afterKey: null, size: 4 }),
    );

    // The first statement on a copy follows the layout check.
    expect(runs.map((run) => run.reader)).toEqual([
      "layout",
      "layout",
      "scan-page",
    ]);
    expect(runs.at(-1)!.rows).toBe(value);
    expect(runs.at(-1)!.rows).toHaveLength(4);
    expect(runs.at(-1)!.params).toMatchObject({ limit: 4 });
  });

  it("names the reader of every statement", () => {
    const { runs } = observe(
      Effect.gen(function* () {
        const { libraryID } = personal;
        const page = yield* readScanPage({ libraryID, afterKey: null });
        const itemIDs = page.map((row) => row.itemID);
        yield* readLibraryRowCount(libraryID);
        yield* readCandidateSet({
          libraryID,
          leaf: { kind: "key", key: page[0]!.key },
          limit: 2,
        });
        yield* readUniverseRows({ libraryID, itemIDs });
        const vocabulary = yield* readFieldVocabulary();
        const collectionPaths = yield* readCollectionPaths(personal);
        yield* readHydrateChunk({
          vocabulary,
          itemIDs,
          fields: { builtIn: ["title"], custom: [] },
          relations: ["creators", "tags", "collections", "attachments"],
          collectionPaths,
        });
      }),
    );

    expect(runs.map((run) => run.reader)).toEqual([
      "layout",
      "layout",
      "scan-page",
      "library-row-count",
      "candidate-set",
      "universe-rows",
      "field-vocabulary",
      "field-vocabulary",
      "collection-paths",
      "hydrate-chunk",
      "hydrate-chunk",
      "hydrate-chunk",
      "hydrate-chunk",
      "hydrate-chunk",
    ]);
  });

  it("reports nothing for a statement that fails", () => {
    const closed = openScenarioDatabase();
    const client = closed.db;
    closed.close();
    const runs: StatementRun[] = [];

    const exit = Effect.runSyncExit(
      readScanPage({ libraryID: personal.libraryID, afterKey: null }).pipe(
        Effect.provideService(ItemQueryStatementObserver, (run) => {
          runs.push(run);
        }),
        Effect.provideService(ItemQueryDatabase, { client }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(runs).toEqual([]);
  });
});
