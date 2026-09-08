import type { ItemSnapshot } from "#/snapshot/types";
import { expect, it } from "vitest";

import { snapshotMatchFacts } from "./snapshot";

import sample from "#/samples/book.json";
it("reads direct membership paths and both tag types from the Item Snapshot", () => {
  const snapshot = {
    ...sample,
    roots: {
      ...sample.roots,
      note: {
        ...sample.roots.note,
        tags: [
          { name: "Manual", type: 0 },
          { name: "Automatic", type: 1 },
        ],
        collections: [{ path: ["Project", "Drafts"] }],
      },
    },
  } as ItemSnapshot;
  expect(snapshotMatchFacts(snapshot)).toEqual({
    library: { type: "personal" },
    itemType: "book",
    tags: ["Manual", "Automatic"],
    collections: [["Project", "Drafts"]],
  });
});
it("keeps missing membership data unevaluable", () => {
  const snapshot = {
    ...sample,
    roots: {
      ...sample.roots,
      note: { ...sample.roots.note, tags: { $inert: "unavailable" } },
    },
  } as ItemSnapshot;
  expect(snapshotMatchFacts(snapshot)).toBeNull();
});
