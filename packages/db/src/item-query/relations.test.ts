import { Effect } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  readItemAttachments,
  readItemAnnotations,
  readAttachmentAnnotations,
} from ".";

it("reads a paper's files and marks in source order, excluding trash and standalone files", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const ids = (
    scenario.sqlite
      .prepare("select itemID from items where libraryID = 1")
      .all() as { itemID: number }[]
  ).map((row) => row.itemID);
  expect(run(readItemAttachments(ids)).map((row) => row.key)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  const marks = [
    "ANN2LINK",
    "ANN2BAD2",
    "ANL2IMAG",
    "ANL2INK2",
    "ANL2UNDR",
    "ANL2TEXT",
    "ANN2HGHT",
    "ANN2NOTE",
    "ANN2IMAG",
    "ANN2INK2",
    "ANN2UNDR",
    "ANN2TEXT",
  ];
  expect(run(readItemAnnotations(ids)).map((row) => row.key)).toEqual(marks);
  expect(run(readAttachmentAnnotations(ids)).map((row) => row.key)).toEqual(
    marks,
  );
});
