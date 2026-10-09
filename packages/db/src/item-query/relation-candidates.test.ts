import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
  readRelationCandidateSet,
  readUniverseRows,
  readAttachmentUniverseRows,
} from ".";

it("maps element candidates to live parents in one statement per chunk", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const statements: string[] = [];
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      effect.pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        Effect.provideService(ItemQueryStatementObserver, ({ reader }) =>
          statements.push(reader),
        ),
      ),
    );
  const ids = (
    scenario.sqlite.prepare("select itemID from items").all() as {
      itemID: number;
    }[]
  ).map((row) => row.itemID);
  run(readUniverseRows({ libraryID: 1, itemIDs: [] }));
  for (const relation of [
    "item-attachments",
    "item-annotations",
    "attachment-annotations",
  ] as const) {
    // Warm the layout check before counting the reader's statements.
    run(readRelationCandidateSet({ relation, libraryID: 1, itemIDs: ids }));
    statements.length = 0;
    const itemIDs = run(
      readRelationCandidateSet({ relation, libraryID: 1, itemIDs: ids }),
    );
    expect(statements).toEqual(["relation-candidate-set"]);
    const rows = run(
      relation === "attachment-annotations"
        ? readAttachmentUniverseRows({ libraryID: 1, itemIDs })
        : readUniverseRows({ libraryID: 1, itemIDs }),
    );
    expect(rows.map((row) => row.key).sort()).toEqual(
      relation === "attachment-annotations"
        ? ["PDF2LINK", "PDF2LIVE"]
        : ["ART2FULL"],
    );
    expect(new Set(itemIDs)).toEqual(new Set(rows.map((row) => row.itemID)));
    expect(new Set(itemIDs).size).toBe(itemIDs.length);
    expect(
      run(readRelationCandidateSet({ relation, libraryID: -1, itemIDs: ids })),
    ).toEqual([]);
    statements.length = 0;
    expect(
      run(readRelationCandidateSet({ relation, libraryID: 1, itemIDs: [] })),
    ).toEqual([]);
    expect(statements).toEqual([]);
  }
});
