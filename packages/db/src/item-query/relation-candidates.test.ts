import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
  readRelationCandidateSet,
  readAnnotationCandidateSet,
  readAttachmentCandidateSet,
  readAnnotationAttachmentCandidateSet,
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

it.each([
  "attachment-item",
  "annotation-item",
  "annotation-attachment",
] as const)(
  "caps the composed parent selection %s within its Target Library",
  (relation) => {
    using scenario = openScenarioDatabase({ annotations: true });
    const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
      Effect.runSync(
        Effect.provideService(effect, ItemQueryDatabase, {
          client: scenario.db,
        }),
      );
    const read = (page: {
      libraryID: number;
      limit?: number;
      afterItemID?: number;
    }) => {
      const options = { limit: 500, ...page };
      if (relation === "annotation-attachment")
        return readAnnotationAttachmentCandidateSet({
          ...options,
          leaf: { kind: "keys", keys: ["PDF2LIVE"] },
        });
      const leaf = {
        kind: "parent" as const,
        leaf: { kind: "keys" as const, keys: ["ART2FULL"] },
      };
      return relation === "attachment-item"
        ? readAttachmentCandidateSet({ ...options, leaf })
        : readAnnotationCandidateSet({ ...options, leaf });
    };
    const all = run(read({ libraryID: 1 }));
    expect(all.length).toBeGreaterThan(1);
    const first = run(read({ libraryID: 1, limit: 1 }));
    const rest = run(
      read({
        libraryID: 1,
        afterItemID: first[0],
        limit: 500,
      }),
    );
    expect([...first, ...rest]).toEqual(all);
    expect(run(read({ libraryID: -1 }))).toEqual([]);
  },
);
