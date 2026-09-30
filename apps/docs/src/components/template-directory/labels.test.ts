import { describe, expect, it } from "vitest";

import {
  readTemplateDirectory,
  templateDirectoryRoot,
} from "@/lib/template-directory/read";
import type { VariantKind } from "@/lib/template-directory/samples";
import { directorySite } from "@/lib/template-directory/site-data";
import { verifyTemplateDirectory } from "@/lib/template-directory/verify";
import { m } from "@/paraglide/messages.js";

import {
  annotationLabel,
  exampleLabel,
  itemTypesInSentence,
  shortExampleLabel,
  optionLabel,
} from "./labels";

const site = directorySite(
  verifyTemplateDirectory(
    await readTemplateDirectory(await templateDirectoryRoot()),
  ),
);

/** A sample as the site names it, by the item type and the variant its data holds. */
const named = (
  id: string,
  itemType: string | null,
  variant: VariantKind | null = null,
) => ({ id, itemType, variant });

/** Only the first letter is a capital, as the site writes an item type. */
const SENTENCE_CASE = /^[A-Z][^A-Z]*$/;

describe("the Directory's names", () => {
  it("name every research task, feature, and item type the index filters by, from the site's messages", () => {
    for (const facet of ["task", "feature", "itemType"] as const) {
      for (const option of site.facets[facet]) {
        const label = optionLabel(facet, option);
        expect(label, `${facet} ${option.value}`).not.toBe(option.value);
        if (facet === "itemType") {
          expect(label, option.value).toMatch(SENTENCE_CASE);
        }
      }
    }
    expect(optionLabel("itemType", { value: "newspaperArticle" })).toBe(
      m.docs_directory_item_type_newspaper_article(),
    );
    expect(optionLabel("task", { value: "writing" })).toBe(
      m.docs_directory_task_writing(),
    );
  });

  it("name every example item and citation an entry page shows", () => {
    const samples = new Map(
      site.entries
        .flatMap(({ notes, citations }) => [...notes, ...citations])
        .map((sample) => [sample.id, sample]),
    );
    expect(samples.size).toBeGreaterThan(0);
    for (const [id, sample] of samples) {
      expect(exampleLabel(sample), id).toMatch(/^[A-Z]/);
    }
    expect(exampleLabel(named("book-section", "bookSection"))).toBe(
      m.docs_directory_item_type_book_section(),
    );
    expect(exampleLabel(named("every-color", "conferencePaper"))).toBe(
      m.docs_directory_example_every_color(),
    );
  });

  it("name the example variants of an item type by what differs", () => {
    expect([
      exampleLabel(named("book-full-details", "book", "full-details")),
      exampleLabel(named("book-few-details", "book", "few-details")),
      exampleLabel(named("book-no-annotations", "book", "no-annotations")),
      exampleLabel(named("interview-few-details", "interview", "few-details")),
      exampleLabel(
        named("book-section-no-annotations", "bookSection", "no-annotations"),
      ),
    ]).toEqual([
      "A book with full details and highlights",
      "A book with few details",
      "A book with no highlights yet",
      "An interview with few details",
      "A book chapter with no highlights yet",
    ]);
  });

  it("name the examples of a Profile that takes several item types by the item type, with the two extra variants of its own", () => {
    expect([
      shortExampleLabel(named("letter-full-details", "letter", "full-details")),
      shortExampleLabel(
        named(
          "newspaper-article-full-details",
          "newspaperArticle",
          "full-details",
        ),
      ),
      shortExampleLabel(named("letter-few-details", "letter", "few-details")),
      shortExampleLabel(
        named("book-section-no-annotations", "bookSection", "no-annotations"),
      ),
    ]).toEqual([
      "Letter",
      "Newspaper article",
      "Letter, few details",
      "Book chapter, no highlights yet",
    ]);
    const everyColor = named("every-color", "conferencePaper");
    expect(shortExampleLabel(everyColor)).toBe(exampleLabel(everyColor));
  });

  it("name item types as a sentence does, one or several", () => {
    expect(itemTypesInSentence(["book"], "plural")).toBe("books");
    expect(itemTypesInSentence(["book"], "singular")).toBe("book");
    expect(
      itemTypesInSentence(["letter", "manuscript", "interview"], "plural"),
    ).toBe("letters, manuscripts, and interviews");
    expect(itemTypesInSentence(["letter", "manuscript"], "singular")).toBe(
      "letter or manuscript",
    );
  });

  it("name a Sample Annotation by its type and color", () => {
    expect(
      annotationLabel({ type: "highlight", color: { name: "yellow" } }),
    ).toBe(
      m.docs_directory_example_annotation_color({
        type: m.workbench_annotation_type({ type: "highlight" }),
        color: "yellow",
      }),
    );
    expect(
      annotationLabel({ type: "highlight", color: { hex: "#1f8a70" } }),
    ).toBe(
      m.docs_directory_example_annotation_custom_color({
        type: m.workbench_annotation_type({ type: "highlight" }),
        color: "#1f8a70",
      }),
    );
    expect(annotationLabel({ type: "note", color: null })).toBe(
      m.docs_directory_example_annotation({
        type: m.workbench_annotation_type({ type: "note" }),
      }),
    );
  });
});
