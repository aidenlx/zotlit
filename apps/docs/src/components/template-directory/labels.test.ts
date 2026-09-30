import { describe, expect, it } from "vitest";

import {
  readTemplateDirectory,
  templateDirectoryRoot,
} from "@/lib/template-directory/read";
import { directorySite } from "@/lib/template-directory/site-data";
import { verifyTemplateDirectory } from "@/lib/template-directory/verify";
import { m } from "@/paraglide/messages.js";

import {
  annotationLabel,
  exampleLabel,
  itemTypesInSentence,
  optionLabel,
} from "./labels";

const site = directorySite(
  verifyTemplateDirectory(
    await readTemplateDirectory(await templateDirectoryRoot()),
  ),
);

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
    const ids = new Set(
      site.entries.flatMap(({ notes, citations }) => [
        ...notes.map(({ id }) => id),
        ...citations.map(({ id }) => id),
      ]),
    );
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(exampleLabel(id), id).toMatch(/^[A-Z]/);
    expect(exampleLabel("book-section")).toBe(
      m.docs_directory_example_book_section(),
    );
  });

  it("name the book variants by what differs", () => {
    expect([
      exampleLabel("book-full-details"),
      exampleLabel("book-few-details"),
      exampleLabel("book-no-annotations"),
    ]).toEqual([
      "A book with full details and highlights",
      "A book with few details",
      "A book with no highlights yet",
    ]);
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
