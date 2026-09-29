import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import filenameSchema from "@zotlit/db/contract/filename.schema.json" with { type: "json" };
import noteSchema from "@zotlit/db/contract/note.schema.json" with { type: "json" };
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
} from "@zotlit/workbench/render";

import { DIRECTORY_SAMPLES } from "./index";

describe("Directory Samples", () => {
  it("cover the Sample Items and the item types they lack", () => {
    expect(
      DIRECTORY_SAMPLES.map(({ id, snapshot }) => [id, snapshot.item.itemType]),
    ).toEqual([
      ["journal-article", "journalArticle"],
      ["conference-paper", "conferencePaper"],
      ["book", "book"],
      ["thesis", "thesis"],
      ["book-section", "bookSection"],
      ["letter", "letter"],
      ["manuscript", "manuscript"],
      ["interview", "interview"],
      ["document", "document"],
    ]);
  });

  it("validate every root against the current contract artifacts", () => {
    const ajv = new Ajv2020({ strict: true });
    const note = ajv.compile(noteSchema);
    const filename = ajv.compile(filenameSchema);

    for (const { id, snapshot } of DIRECTORY_SAMPLES) {
      expect(
        note(snapshot.roots.note),
        `${id}: ${ajv.errorsText(note.errors)}`,
      ).toBe(true);
      expect(
        filename(snapshot.roots.filename),
        `${id}: ${ajv.errorsText(filename.errors)}`,
      ).toBe(true);
    }
  });

  it("render the default Profile with the derived item's own data", () => {
    const chapter = DIRECTORY_SAMPLES.find(({ id }) => id === "book-section")!;
    const result = renderProfile(DEFAULT_PROFILE_SOURCE, chapter.snapshot);

    expect(result.diagnostics).toEqual([]);
    expect(result.filename).toBe("tverskyJudgmentUncertaintyHeuristics1982");
    expect(result.creationBody).toContain(
      "# Judgment under uncertainty: Heuristics and biases",
    );
  });
});
