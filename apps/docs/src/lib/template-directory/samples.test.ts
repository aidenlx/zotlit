import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import filenameSchema from "@zotlit/db/contract/filename.schema.json" with { type: "json" };
import noteSchema from "@zotlit/db/contract/note.schema.json" with { type: "json" };
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
} from "@zotlit/workbench/render";

import { DIRECTORY_SAMPLES, EDGE_SAMPLES, EVERY_COLOR_SAMPLE } from "./index";
import { EXAMPLE_VARIANTS } from "./samples";

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

  describe("example variants", () => {
    const ITEM_TYPES = [
      ["journal-article", "journalArticle"],
      ["conference-paper", "conferencePaper"],
      ["book", "book"],
      ["book-section", "bookSection"],
      ["thesis", "thesis"],
      ["letter", "letter"],
      ["manuscript", "manuscript"],
      ["interview", "interview"],
      ["document", "document"],
      ["newspaper-article", "newspaperArticle"],
    ] as const;
    const variantsOf = (itemType: string) =>
      EXAMPLE_VARIANTS.filter(
        ({ snapshot }) => snapshot.item.itemType === itemType,
      );
    const annotationsOf = (sample: (typeof EXAMPLE_VARIANTS)[number]) =>
      sample.snapshot.roots.note.annotations as readonly Record<
        string,
        unknown
      >[];

    it("give each item type the three variants, named for it", () => {
      expect(EXAMPLE_VARIANTS.map(({ id, variant }) => [id, variant])).toEqual(
        ITEM_TYPES.flatMap(([slug]) => [
          [`${slug}-full-details`, "full-details"],
          [`${slug}-few-details`, "few-details"],
          [`${slug}-no-annotations`, "no-annotations"],
        ]),
      );
      for (const [slug, itemType] of ITEM_TYPES) {
        expect(
          variantsOf(itemType).map(({ id }) => id),
          itemType,
        ).toEqual([
          `${slug}-full-details`,
          `${slug}-few-details`,
          `${slug}-no-annotations`,
        ]);
      }
    });

    it.each(ITEM_TYPES)(
      "give the full %s an abstract and an annotation set of colored highlights, one with a comment, and one image",
      (_slug, itemType) => {
        const [full] = variantsOf(itemType);
        expect(full!.snapshot.roots.note.abstract).toEqual(expect.any(String));
        const annotations = annotationsOf(full!);
        const highlights = annotations.filter(
          ({ type }) => type === "highlight",
        );
        expect(highlights.length).toBeGreaterThanOrEqual(3);
        expect(highlights.length).toBeLessThanOrEqual(4);
        expect(
          highlights.filter(({ comment }) => comment !== null),
        ).toHaveLength(1);
        expect(new Set(highlights.map(({ colorName }) => colorName)).size).toBe(
          highlights.length,
        );
        expect(annotations.filter(({ type }) => type === "image")).toHaveLength(
          1,
        );
        const pages = annotations.map(({ page }) => page as number);
        expect(pages).toEqual([...pages].sort((a, b) => a - b));
      },
    );

    it.each(ITEM_TYPES)(
      "leave the abstract and all but one highlight out of the few-details %s",
      (_slug, itemType) => {
        const [full, few] = variantsOf(itemType);
        expect(few!.snapshot.roots.note.abstract).toBeNull();
        expect(annotationsOf(few!)).toHaveLength(1);
        expect(few!.snapshot.roots.note.title).not.toBe(
          full!.snapshot.roots.note.title,
        );
      },
    );

    it.each(ITEM_TYPES)(
      "keep the details of the full %s and leave its annotations out of the no-annotations variant",
      (_slug, itemType) => {
        const [full, , none] = variantsOf(itemType);
        expect(annotationsOf(none!)).toHaveLength(0);
        expect(none!.snapshot.roots.note.abstract).toBe(
          full!.snapshot.roots.note.abstract,
        );
        expect(none!.snapshot.roots.note.title).toBe(
          full!.snapshot.roots.note.title,
        );
      },
    );
  });

  it("hold, for entries that group by color, a note with the Sample Annotations and a highlight in every other color, in page order", () => {
    const annotations = EVERY_COLOR_SAMPLE.snapshot.roots.note
      .annotations as readonly Record<string, unknown>[];
    expect(
      annotations.map(({ type, colorName, colorHex, pageLabel }) => [
        type,
        colorName ?? colorHex,
        pageLabel,
      ]),
    ).toEqual([
      ["highlight", "yellow", "1"],
      ["highlight", "red", "1"],
      ["highlight", "green", "1"],
      ["highlight", "blue", "1"],
      ["highlight", "purple", "1"],
      ["highlight", "magenta", "1"],
      ["highlight", "orange", "1"],
      ["highlight", "gray", "1"],
      ["highlight", "plum", "1"],
      ["highlight", "#1f8a70", "1"],
      ["underline", "blue", "2"],
      ["note", "purple", "3"],
      ["text", null, "4"],
      ["image", "green", "5"],
      ["ink", "red", "6"],
    ]);
  });

  it("validate every root against the current contract artifacts", () => {
    const ajv = new Ajv2020({ strict: true });
    const note = ajv.compile(noteSchema);
    const filename = ajv.compile(filenameSchema);

    for (const { id, snapshot } of [
      ...DIRECTORY_SAMPLES,
      ...EDGE_SAMPLES,
      ...EXAMPLE_VARIANTS,
      EVERY_COLOR_SAMPLE,
    ]) {
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
